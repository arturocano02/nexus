import { NextRequest, NextResponse } from "next/server";
import { anthropic, MODEL } from "@/lib/anthropic";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  POST /api/chat
  Body: {
    messages:      ChatMessage[]   — full conversation history (role/content pairs)
    session_id:    string
    category_id:   string | null   — null on first turn (no category picked yet)
    category_slug: string | null
  }

  Response: text/event-stream (SSE)
  Events:
    data: {"type":"delta","text":"..."}
    data: {"type":"done"}
    data: {"type":"error","message":"..."}

  Behaviour:
  - If messages is empty, the AI sends the opening question for the category
    (fetched from taxonomy_categories.opening_question).
  - Otherwise the AI continues the conversation as a curious interviewer /
    devil's advocate / knowledgeable explainer.
  - After every user turn, classification runs async in the background
    (triggerClassify) without blocking the stream.
  - Every turn is saved to public.messages.

  V5 update: subtopic goals and classification now use the `questions` table
  (binary decision tree, L1-L5) instead of the deprecated `taxonomy_questions`.
  The classifier infers depth (1-5) so weight_d in inferred_positions reflects
  which layer of the tree the user actually engaged with.
*/

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
function buildSystemPrompt(
  categoryName: string,
  subtopicGoals: string,
  userTurnCount: number,
  avgUserWords: number,
): string {
  const lengthRule =
    avgUserWords <= 15
      ? "Keep your replies short — 1 punchy sentence + 1 question. Max 30 words total."
      : avgUserWords <= 50
      ? "Match the user's length. 2 sentences + 1 question max."
      : "Up to 3 sentences + 1 question. No more.";

  const contradictionRule =
    userTurnCount >= 4
      ? "You have conversation history. If the user contradicts an earlier statement, name it directly — 'But earlier you said X — how do you square that with Y?'"
      : "";

  return `You are a sharp, curious political sparring partner having a real debate about ${categoryName}.

${subtopicGoals ? `PRIVATE AGENDA — your hidden job is to gather enough signal to understand this person's position on these questions. Never ask them directly. Draw it out naturally through conversation:
${subtopicGoals}

TOPIC FOCUS: Work through these one at a time. Look at the conversation history and identify which subtopic you've been exploring most recently — stay on that thread. Only move to a new subtopic when the user clearly signals a shift themselves, and briefly acknowledge it ("ok, switching to X then —"). Don't jump between subtopics.

` : ""}ENGAGING WITH WHAT THEY SAY: Always engage with the substance of what the user just said before pushing further. Never tell them they're being vague or need to be more specific — instead interpret their point charitably, engage with it directly, then sharpen the debate with your follow-up. If they give you a short or broad answer, treat it as a real position and probe it.

LENGTH: ${lengthRule}

STYLE: Direct and engaged. Reference actual policies, real examples, or stats when relevant. Push back on their reasoning — not on whether they said enough. Always end with one short punchy question.
${contradictionRule ? `\nCONTRADICTIONS: ${contradictionRule}` : ""}
Never moralize. Never fawn. Never reveal you're tracking their views. Stay within ${categoryName}.`;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = await req.json() as {
    messages: ChatMessage[];
    session_id: string;
    category_id: string | null;
    category_slug: string | null;
  };

  const { messages, session_id, category_id, category_slug } = body;
  if (!session_id) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  const svc = supabaseService();

  // Resolve category
  let categoryName = "this topic";
  let resolvedCategoryId = category_id;

  if (category_id) {
    const { data: cat } = await svc
      .from("taxonomy_categories")
      .select("name")
      .eq("id", category_id)
      .maybeSingle();
    if (cat) categoryName = cat.name;
  } else if (category_slug) {
    const { data: cat } = await svc
      .from("taxonomy_categories")
      .select("id, name")
      .eq("slug", category_slug)
      .maybeSingle();
    if (cat) {
      resolvedCategoryId = cat.id;
      categoryName = cat.name;
    }
  }

  // Upsert session
  if (resolvedCategoryId) {
    try {
      await svc.from("sessions").upsert(
        { id: session_id, user_id: user.id, category_id: resolvedCategoryId, last_active: new Date().toISOString() },
        { onConflict: "id" }
      );
    } catch { /* table may not exist yet */ }
  }

  // -------------------------------------------------------------------
  // Build subtopic goals from V5 `questions` table (L1 root nodes)
  // -------------------------------------------------------------------
  let subtopicGoals = "";
  if (resolvedCategoryId) {
    try {
      const { data: subtopics } = await svc
        .from("taxonomy_subtopics")
        .select("id, name, latent_question_text")
        .eq("category_id", resolvedCategoryId)
        .eq("is_other", false)
        .order("sort_order");

      if (subtopics && subtopics.length > 0) {
        const subIds = subtopics.map((s: any) => s.id);

        // Fetch L1 root questions from the V5 `questions` table
        const { data: rootQs } = await svc
          .from("questions")
          .select("subtopic_id, question_text")
          .in("subtopic_id", subIds)
          .eq("layer", 1)
          .is("parent_question_id", null);

        // Build a map: subtopic_id → first L1 question text
        const l1BySubtopic = new Map<string, string>();
        for (const q of rootQs ?? []) {
          if (!l1BySubtopic.has(q.subtopic_id)) {
            l1BySubtopic.set(q.subtopic_id, q.question_text);
          }
        }

        subtopicGoals = subtopics
          .map((s: any) => {
            const goal = s.latent_question_text ?? l1BySubtopic.get(s.id) ?? s.name;
            return `• ${s.name}: "${goal}"`;
          })
          .join("\n");
      }
    } catch { /* questions table may not exist yet */ }
  }

  // Adaptive length from recent user turns
  const userMessages = messages.filter((m) => m.role === "user");
  const avgUserWords =
    userMessages.length > 0
      ? userMessages.slice(-3).reduce((sum, m) => sum + m.content.split(/\s+/).length, 0) /
        Math.min(3, userMessages.length)
      : 20;

  // -------------------------------------------------------------------
  // SSE stream
  // -------------------------------------------------------------------
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      }

      try {
        let assistantContent = "";

        // First turn — send opening question
        if (messages.length === 0) {
          let opener: string | null = null;
          try {
            const { data: catFull } = await svc
              .from("taxonomy_categories")
              .select("opening_question")
              .eq("id", resolvedCategoryId ?? "")
              .maybeSingle();
            opener = catFull?.opening_question ?? null;
          } catch { /* column may not exist yet */ }

          opener = opener ?? `What aspect of ${categoryName} do you feel most strongly about?`;

          send({ type: "delta", text: opener });
          assistantContent = opener;

          try {
            await svc.from("messages").insert({
              user_id: user.id, session_id, category_id: resolvedCategoryId ?? null,
              role: "assistant", content: opener,
            });
          } catch { /* table not yet created */ }

          send({ type: "done" });
          controller.close();
          return;
        }

        // Subsequent turns — save user message, generate reply
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role === "user") {
          try {
            await svc.from("messages").insert({
              user_id: user.id, session_id, category_id: resolvedCategoryId ?? null,
              role: "user", content: lastMessage.content,
            });
          } catch { /* table not yet created */ }
        }

        const anthropicMessages = messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        const resp = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 300,
          system: buildSystemPrompt(categoryName, subtopicGoals, userMessages.length, avgUserWords),
          messages: anthropicMessages,
        });

        assistantContent = resp.content.find((c) => c.type === "text")?.text ?? "";
        send({ type: "delta", text: assistantContent });

        try {
          await svc.from("messages").insert({
            user_id: user.id, session_id, category_id: resolvedCategoryId ?? null,
            role: "assistant", content: assistantContent,
          });
        } catch { /* table not yet created */ }

        // Fire-and-forget classification using V5 questions tree
        if (resolvedCategoryId && lastMessage.role === "user") {
          triggerClassify({
            userId: user.id,
            sessionId: session_id,
            categoryId: resolvedCategoryId,
            messages: [
              ...messages,
              { role: "assistant" as const, content: assistantContent },
            ],
          }).catch((err) => console.warn("[classify error]", err));
        }

        send({ type: "done" });
        controller.close();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Stream error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message: msg })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ---------------------------------------------------------------------------
// Async classification — V5 version
//
// Key improvements over V4:
// 1. Uses `questions` table (binary tree) instead of `taxonomy_questions`
// 2. Passes all L1+L2 question nodes per subtopic so Claude can identify
//    which branch the user was on
// 3. Claude returns `depth` (1-5) and `question_id` (best matching node)
// 4. weight_d is populated from the actual tree layer, not just 1.0
// ---------------------------------------------------------------------------
async function triggerClassify(payload: {
  userId: string;
  sessionId: string;
  categoryId: string;
  messages: ChatMessage[];
}) {
  const svc = supabaseService();

  // Subtopics for this category
  const { data: subtopics } = await svc
    .from("taxonomy_subtopics")
    .select("id, name, slug, is_other")
    .eq("category_id", payload.categoryId)
    .order("sort_order");

  if (!subtopics || subtopics.length === 0) return;

  const namedSubtopics = subtopics.filter((s: any) => !s.is_other);
  if (namedSubtopics.length === 0) return;

  const subtopicIds = namedSubtopics.map((s: any) => s.id);

  // Fetch L1 and L2 question nodes from the V5 `questions` table.
  // L1 = root of each decision tree (the core binary question).
  // L2 = first YES/NO split — tells us which branch the user is on.
  // Passing both layers gives Claude enough context to estimate depth.
  const { data: questionNodes } = await svc
    .from("questions")
    .select("id, subtopic_id, layer, question_text, parent_answer, parent_question_id")
    .in("subtopic_id", subtopicIds)
    .in("layer", [1, 2])
    .order("layer");

  // Build per-subtopic question context string
  type QNode = {
    id: string;
    subtopic_id: string;
    layer: number;
    question_text: string;
    parent_answer: string | null;
    parent_question_id: string | null;
  };

  const nodesBySubtopic = new Map<string, QNode[]>();
  for (const n of (questionNodes ?? []) as QNode[]) {
    if (!nodesBySubtopic.has(n.subtopic_id)) nodesBySubtopic.set(n.subtopic_id, []);
    nodesBySubtopic.get(n.subtopic_id)!.push(n);
  }

  // Assemble the subtopic list for the classifier prompt
  const subtopicList = namedSubtopics
    .map((s: any) => {
      const nodes = nodesBySubtopic.get(s.id) ?? [];
      const l1 = nodes.find(n => n.layer === 1);
      const l2yes = nodes.find(n => n.layer === 2 && n.parent_answer === "yes");
      const l2no  = nodes.find(n => n.layer === 2 && n.parent_answer === "no");

      let nodeDesc = "";
      if (l1) {
        nodeDesc += `\n  L1 [${l1.id}]: "${l1.question_text}"`;
        if (l2yes) nodeDesc += `\n  L2-YES [${l2yes.id}]: "${l2yes.question_text}"`;
        if (l2no)  nodeDesc += `\n  L2-NO  [${l2no.id}]: "${l2no.question_text}"`;
      }

      return `- ${s.name} (subtopic_id: ${s.id})${nodeDesc}`;
    })
    .join("\n");

  const conversationText = payload.messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const { data: catData } = await svc
    .from("taxonomy_categories")
    .select("name")
    .eq("id", payload.categoryId)
    .maybeSingle();
  const categoryName = catData?.name ?? "this topic";

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    messages: [
      {
        role: "user",
        content: `Analyse this conversation about ${categoryName} and infer the user's political positions.

SUBTOPICS with their binary question tree nodes (L1 = root, L2-YES = if they agreed, L2-NO = if they disagreed):
${subtopicList}

CONVERSATION:
${conversationText}

For each subtopic where the user's view can be meaningfully inferred, output:
- subtopic_id: exact UUID
- stance: "yes" | "no" | "abstain" | "unclear"
  "yes" = user broadly supports the L1 proposition
  "no" = user opposes or is sceptical
  "abstain" = explicitly declines
  "unclear" = too little signal
- confidence: 0.0–1.0
- depth: 1–5 (how specific was their engagement? 1=vague opinion, 2=basic position, 3=nuanced argument, 4=detailed reasoning, 5=highly specific policy-level)
- question_id: the UUID of the L1 or L2 question node that best captures what they were specifically engaging with (use L2 if you can tell which branch they're on, otherwise L1)
- reasoning: 1–2 sentences citing what they said
- key_argument: single strongest argument the user made (or "" if none)

Only include subtopics where confidence > 0.3 and the conversation has real signal.
Return ONLY a JSON array: [{"subtopic_id":"...","stance":"...","confidence":0.0,"depth":1,"question_id":"...","reasoning":"...","key_argument":"..."}, ...]`,
      },
    ],
  });

  const raw = resp.content.find((c) => c.type === "text")?.text ?? "";
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < start) return;

  let inferences: Array<{
    subtopic_id: string;
    stance: string;
    confidence: number;
    depth: number;
    question_id: string;
    reasoning: string;
    key_argument: string;
  }>;

  try {
    inferences = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return;
  }

  // Build a set of valid question UUIDs from what we fetched
  const validQuestionIds = new Set<string>(
    (questionNodes ?? []).map((n: any) => n.id)
  );

  const now = new Date().toISOString();

  for (const inf of inferences) {
    if (!inf.subtopic_id || typeof inf.confidence !== "number") continue;
    const sub = namedSubtopics.find((s: any) => s.id === inf.subtopic_id);
    if (!sub) continue;

    const stance = ["yes", "no", "abstain", "unclear"].includes(inf.stance)
      ? inf.stance
      : "unclear";
    const confidence = Math.max(0, Math.min(1, inf.confidence));

    // Depth must be 1-5; if Claude gave something invalid, default to 1
    const depth = typeof inf.depth === "number" && inf.depth >= 1 && inf.depth <= 5
      ? Math.round(inf.depth)
      : 1;
    const weightD = depth; // D=1 at L1, D=5 at L5

    // Validate the question_id Claude returned; fall back to the L1 node
    let questionId: string | null = null;
    if (inf.question_id && validQuestionIds.has(inf.question_id)) {
      questionId = inf.question_id;
    } else {
      // Fall back: find the L1 root for this subtopic
      const l1 = (questionNodes ?? []).find(
        (n: any) => n.subtopic_id === inf.subtopic_id && n.layer === 1
      );
      questionId = (l1 as any)?.id ?? null;
    }

    const args = inf.key_argument ? [{ text: inf.key_argument, ts: now }] : [];

    // Upsert inferred_positions with real depth + question_id
    try {
      await svc.from("inferred_positions").upsert(
        {
          user_id: payload.userId,
          session_id: payload.sessionId,
          category_id: payload.categoryId,
          subtopic_id: inf.subtopic_id,
          question_id: questionId,
          stance,
          confidence,
          reasoning: inf.reasoning ?? null,
          arguments_json: args,
          weight_d: weightD,
          updated_at: now,
        },
        { onConflict: "user_id,session_id,subtopic_id" }
      );
    } catch { /* table not yet created */ }

    // Upsert user_views — persistent cross-session record
    if (inf.key_argument || inf.reasoning) {
      try {
        const { data: existingView } = await svc
          .from("user_views")
          .select("id, raw_excerpts, submitted_to_arena")
          .eq("user_id", payload.userId)
          .eq("topic_label", (sub as any).name)
          .eq("is_deleted", false)
          .maybeSingle();

        // Submitted views are immutable
        if (existingView?.submitted_to_arena) continue;

        const existingExcerpts: string[] = Array.isArray(existingView?.raw_excerpts)
          ? existingView.raw_excerpts
          : [];
        const newExcerpt = inf.key_argument ?? inf.reasoning ?? "";
        const raw_excerpts = newExcerpt
          ? [...new Set([...existingExcerpts, newExcerpt])].slice(-20)
          : existingExcerpts;

        if (existingView) {
          await svc.from("user_views").update({
            summary: inf.reasoning ?? "",
            confidence_score: confidence,
            raw_excerpts,
            updated_at: now,
          }).eq("id", existingView.id);
        } else {
          await svc.from("user_views").insert({
            user_id: payload.userId,
            topic_label: (sub as any).name,
            summary: inf.reasoning ?? "",
            confidence_score: confidence,
            raw_excerpts,
          });
        }
      } catch { /* user_views may not exist yet */ }
    }
  }
}
