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
    devil's advocate / knowledgeable explainer. It never asks yes/no questions
    explicitly — it asks open, inviting questions and lets the user reveal their views.
  - After every user turn, classification runs async in the background
    (triggerClassify) without blocking the stream.
  - Every turn (both assistant and user messages) is saved to public.messages.
*/

function buildSystemPrompt(
  categoryName: string,
  subtopicGoals: string,
  userTurnCount: number,
  avgUserWords: number,
): string {
  // Calibrate response length to how much the user writes
  const lengthRule =
    avgUserWords <= 15
      ? "User writes short. You write SHORT — 1 punchy sentence + 1 question. Max 30 words total."
      : avgUserWords <= 50
      ? "Match the user's length. 2 sentences max + 1 question."
      : "User writes a lot. You can go up to 3 sentences + 1 question, but no more.";

  const contradictionRule =
    userTurnCount >= 4
      ? "You have conversation history with this person. Look for contradictions with what they said earlier and call them out directly — 'But earlier you said X, now you're saying Y — which is it?'"
      : "";

  return `You are a sharp political sparring partner. Topic: ${categoryName}.

${subtopicGoals ? `PRIVATE — your real job is to gather enough signal to confidently infer this person's stance on the following questions. Never ask them directly. Draw it out naturally through debate, pushback, and specific questions that force them to reveal their position:
${subtopicGoals}

` : ""}LENGTH: ${lengthRule}

STYLE: Direct, a little combative, witty when possible. Name actual policies, stats, cases. Make them work for their position. Always end with one short punchy question.
${contradictionRule ? `\nCONTRADICTIONS: ${contradictionRule}` : ""}
Never moralize. Never fawn. Never reveal you're analysing their views. ${categoryName} only — don't drift.`;
}

export async function POST(req: NextRequest) {
  // Auth check
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

  // Fetch category info — select only stable columns (opening_question added by V2 migration)
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

  // Upsert session record — table may not exist yet (pre-V2-migration), ignore errors
  if (resolvedCategoryId) {
    try {
      await svc.from("sessions").upsert(
        { id: session_id, user_id: user.id, category_id: resolvedCategoryId, last_active: new Date().toISOString() },
        { onConflict: "id" }
      );
    } catch { /* table not yet created — safe to skip */ }
  }

  // Fetch subtopic goals — the questions the AI needs to extract views on.
  // These go into the hidden section of the system prompt.
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
        // For each subtopic, use latent_question_text if set, else fall back to depth-1 question
        const subIds = subtopics.map((s: any) => s.id);
        const { data: questions } = await svc
          .from("taxonomy_questions")
          .select("subtopic_id, question_text")
          .in("subtopic_id", subIds)
          .eq("depth_layer", 1);

        const qBySubtopic = new Map((questions ?? []).map((q: any) => [q.subtopic_id, q.question_text]));

        subtopicGoals = subtopics
          .map((s: any) => {
            const q = s.latent_question_text ?? qBySubtopic.get(s.id) ?? s.name;
            return `• ${s.name}: "${q}"`;
          })
          .join("\n");
      }
    } catch { /* taxonomy tables may not exist yet */ }
  }

  // Compute adaptive length hint from the last few user messages
  const userMessages = messages.filter((m) => m.role === "user");
  const avgUserWords =
    userMessages.length > 0
      ? userMessages.slice(-3).reduce((sum, m) => sum + m.content.split(/\s+/).length, 0) /
        Math.min(3, userMessages.length)
      : 20;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      }

      try {
        let assistantContent = "";

        // FIRST TURN: when history is empty, AI opens with a contextual question.
        // (opening_question column is optional — falls back to a generated opener)
        if (messages.length === 0) {
          // Try to fetch opening_question if it exists
          let opener: string | null = null;
          try {
            const { data: catFull } = await svc
              .from("taxonomy_categories")
              .select("opening_question")
              .eq("id", resolvedCategoryId ?? "")
              .maybeSingle();
            opener = catFull?.opening_question ?? null;
          } catch { /* column may not exist yet */ }

          opener = opener ?? `What aspect of ${categoryName} do you feel most strongly about? I'd love to hear what's on your mind.`;

          send({ type: "delta", text: opener });
          assistantContent = opener;

          // Persist to messages table if it exists
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

        // SUBSEQUENT TURNS: save user message, then stream AI reply
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

        // Non-streaming: collect the full response then send as one delta.
        // Per-token streaming caused truncation in the Next.js dev environment
        // (only the first token was reaching the client).
        const resp = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 300,
          system: buildSystemPrompt(
            categoryName,
            subtopicGoals,
            userMessages.length,
            avgUserWords,
          ),
          messages: anthropicMessages,
        });

        assistantContent =
          resp.content.find((c) => c.type === "text")?.text ?? "";
        send({ type: "delta", text: assistantContent });

        // Save assistant reply (best-effort — table may not exist yet)
        try {
          await svc.from("messages").insert({
            user_id: user.id, session_id, category_id: resolvedCategoryId ?? null,
            role: "assistant", content: assistantContent,
          });
        } catch { /* table not yet created */ }

        // Fire-and-forget classification
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
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: msg })}\n\n`
          )
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

// -----------------------------------------------------------------------
// Async classification (fire-and-forget)
// -----------------------------------------------------------------------

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

  // Depth-1 questions as reference anchors
  const subtopicIds = subtopics.map((s: { id: string }) => s.id);
  const { data: questions } = await svc
    .from("taxonomy_questions")
    .select("subtopic_id, question_text")
    .in("subtopic_id", subtopicIds)
    .eq("depth_layer", 1);

  const anchorBySubtopic = new Map<string, string>();
  for (const q of questions ?? []) {
    anchorBySubtopic.set(q.subtopic_id, q.question_text);
  }

  const namedSubtopics = subtopics.filter((s: { is_other: boolean }) => !s.is_other);
  const subtopicList = namedSubtopics
    .map((s: { id: string; name: string }) => {
      const anchor = anchorBySubtopic.get(s.id);
      return `- ${s.name} (id: ${s.id})${anchor ? ` — anchor question: "${anchor}"` : ""}`;
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
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: `Analyse this conversation about ${categoryName} and infer the user's political positions.

SUBTOPICS (only classify against these):
${subtopicList}

CONVERSATION:
${conversationText}

For each subtopic where the user's view can be meaningfully inferred from what they said, output:
- subtopic_id: the exact UUID from the list above
- stance: "yes" | "no" | "abstain" | "unclear"
  "yes" = user broadly supports or is sympathetic to the mainstream position on this subtopic
  "no" = user is sceptical or opposes it
  "abstain" = user explicitly declines to take a position
  "unclear" = too little signal
- confidence: 0.0–1.0
- reasoning: 1–2 sentences citing specific things the user said
- key_argument: the single strongest argument the user made (or "" if none clear)

Only include subtopics where confidence > 0.3 and the conversation has real signal.
Return ONLY a JSON array: [{"subtopic_id":"...","stance":"...","confidence":0.0,"reasoning":"...","key_argument":"..."}, ...]`,
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
    reasoning: string;
    key_argument: string;
  }>;

  try {
    inferences = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return;
  }

  const now = new Date().toISOString();

  for (const inf of inferences) {
    if (!inf.subtopic_id || typeof inf.confidence !== "number") continue;
    const sub = namedSubtopics.find((s: { id: string }) => s.id === inf.subtopic_id);
    if (!sub) continue;

    const args = inf.key_argument
      ? [{ text: inf.key_argument, ts: now }]
      : [];

    // Upsert inferred_positions (raw session-level data)
    try {
      await svc.from("inferred_positions").upsert(
        {
          user_id: payload.userId,
          session_id: payload.sessionId,
          category_id: payload.categoryId,
          subtopic_id: inf.subtopic_id,
          stance: ["yes", "no", "abstain", "unclear"].includes(inf.stance) ? inf.stance : "unclear",
          confidence: Math.max(0, Math.min(1, inf.confidence)),
          reasoning: inf.reasoning ?? null,
          arguments_json: args,
          updated_at: now,
        },
        { onConflict: "user_id,session_id,subtopic_id" }
      );
    } catch { /* table not yet created */ }

    // Upsert user_views — persistent, user-editable view keyed on user+topic
    // Only upsert if this user has a profile row (authenticated users only)
    if (inf.key_argument || inf.reasoning) {
      try {
        const { data: existingView } = await svc
          .from("user_views")
          .select("id, raw_excerpts, submitted_to_arena")
          .eq("user_id", payload.userId)
          .eq("topic_label", (sub as { name: string }).name)
          .eq("is_deleted", false)
          .maybeSingle();

        if (existingView && existingView.submitted_to_arena) {
          // Submitted views are read-only — skip update
          continue;
        }

        const existingExcerpts: string[] = Array.isArray(existingView?.raw_excerpts)
          ? existingView.raw_excerpts
          : [];
        const newExcerpt = inf.key_argument ?? inf.reasoning ?? "";
        const raw_excerpts = newExcerpt
          ? [...new Set([...existingExcerpts, newExcerpt])].slice(-20) // keep last 20
          : existingExcerpts;

        if (existingView) {
          await svc.from("user_views").update({
            summary: inf.reasoning ?? "",
            confidence_score: Math.max(0, Math.min(1, inf.confidence)),
            raw_excerpts,
            updated_at: now,
          }).eq("id", existingView.id);
        } else {
          await svc.from("user_views").insert({
            user_id: payload.userId,
            topic_label: (sub as { name: string }).name,
            summary: inf.reasoning ?? "",
            confidence_score: Math.max(0, Math.min(1, inf.confidence)),
            raw_excerpts,
          });
        }
      } catch { /* profiles table may not exist or user has no profile */ }
    }
  }
}
