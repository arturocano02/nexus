import { NextRequest, NextResponse } from "next/server";
import { anthropic, MODEL } from "@/lib/anthropic";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import type { ConversationMessage, BeliefUpdate, AdvisorApiResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  POST /api/advisor
  Body: {
    message:        string | null    — null triggers an opening question
    initial_topic?: string           — pre-load topic context from node tap
    arena_context?: {                — from arena "Add your argument" flow
      topic: string
      for_args:     string[]
      against_args: string[]
    }
  }
  Response: AdvisorApiResponse { message, topic_tags, belief_updates }
*/

const MAX_HISTORY = 40;
const KEEP_FIRST = 5;

// -----------------------------------------------------------------------
// Module-level taxonomy cache (persists across requests in same process)
// -----------------------------------------------------------------------

interface QuestionRow {
  id: string;
  category_id: string;
  subtopic_id: string | null;
  layer: number;
  question_text: string;
}

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
}

let _questions: QuestionRow[] | null = null;
let _categories: CategoryRow[] | null = null;

async function loadTaxonomyCache(svc: ReturnType<typeof supabaseService>) {
  if (_questions && _categories) return;
  const [qRes, cRes] = await Promise.all([
    svc
      .from("questions")
      .select("id, category_id, subtopic_id, layer, question_text")
      .in("layer", [1, 2])
      .order("layer"),
    svc.from("taxonomy_categories").select("id, slug, name"),
  ]);
  if (qRes.data) _questions = qRes.data as QuestionRow[];
  if (cRes.data) _categories = cRes.data as CategoryRow[];
}

// -----------------------------------------------------------------------
// Conversation helpers
// -----------------------------------------------------------------------

function truncateHistory(msgs: ConversationMessage[]): ConversationMessage[] {
  if (msgs.length <= MAX_HISTORY) return msgs;
  return [...msgs.slice(0, KEEP_FIRST), ...msgs.slice(-(MAX_HISTORY - KEEP_FIRST))];
}

function buildSystemPrompt(
  advisorName: string,
  userViews: { topic_label: string; summary: string; confidence_score: number }[],
  arenaContext?: { topic: string; for_args: string[]; against_args: string[] },
): string {
  const viewsBlock = userViews.length > 0
    ? `\nESTABLISHED USER VIEWS (confirmed, non-deleted — use for spotting genuine contradictions only):\n${
        userViews.map(v => `- ${v.topic_label}: ${v.summary} (confidence ${Math.round(v.confidence_score * 100)}%)`).join("\n")
      }\n`
    : "";

  const arenaBlock = arenaContext
    ? `\nFOCUS TOPIC FROM ARENA: "${arenaContext.topic}"\nTop arguments FOR: ${arenaContext.for_args.slice(0, 3).join(" | ")}\nTop arguments AGAINST: ${arenaContext.against_args.slice(0, 3).join(" | ")}\nUse these as context to make your conversation focused and well-informed.\n`
    : "";

  const TAXONOMY_CATEGORIES = ["Economy", "Healthcare", "Housing", "Education", "Immigration", "Climate & Environment", "Technology & AI", "Defence & Foreign Affairs", "Democracy & Governance", "Crime & Justice", "Social Policy", "Transport & Infrastructure"];

  return `You are ${advisorName}, a debate sparring partner. Sharp, funny, direct. You never lecture. You never waffle. Short punchy replies. You push back hard on every position. You always end with a specific question or provocation. No em-dashes. Plain English only. Cite real sources inline: [ONS](https://ons.gov.uk). If they're vague, call it out and make them be specific. If they say something interesting, say so briefly then hit back harder.
${viewsBlock}${arenaBlock}
TOPIC TAGS: Only use these exact names as topic_tags, 1-3 max: ${TAXONOMY_CATEGORIES.join(", ")}.

VIEW INFERENCE: When the user clearly takes a position, restate it briefly ("So you think X — right?") and mark in belief_updates on confirmation.

CONFIDENCE SCORING for belief_updates:
- 0.8–1.0: stated clearly and defended with reasons
- 0.5–0.7: stated but uncertain or qualified ("I think", "maybe")
- 0.3–0.5: vague, hedged, or partially contradicted
- 0.1–0.3: highly uncertain, contradictory, or just speculating

RESPONSE FORMAT: Valid JSON only. No text outside it. Max 80 words in message field.
{"message":"reply (max 80 words, no em-dashes)","topic_tags":["Category"],"belief_updates":[{"topic_label":"label","summary":"one sentence","confidence_score":0.0,"raw_excerpt":"exact user quote","confirmation_status":"inferred"}]}

belief_updates only when you have real signal. Empty array otherwise. confirmation_status "confirmed" only when user explicitly agrees.`;
}

async function buildOpeningQuestion(
  advisorName: string,
  svc: ReturnType<typeof supabaseService>,
  arenaContext?: { topic: string; for_args: string[]; against_args: string[] },
): Promise<AdvisorApiResponse> {
  let seedTopic = "a major policy debate";
  if (arenaContext) {
    seedTopic = arenaContext.topic;
  } else {
    try {
      const { data: tensions } = await svc
        .from("collective_scores")
        .select("tension_flag, top_yes_args, top_no_args")
        .in("tension_flag", ["hot", "disputed"])
        .limit(3);
      if (tensions && tensions.length > 0) {
        const pick = tensions[Math.floor(Math.random() * tensions.length)];
        const arg = pick.top_yes_args?.[0] ?? pick.top_no_args?.[0];
        if (arg) seedTopic = arg;
      }
    } catch { /* collective_scores may be empty */ }
  }

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [{
      role: "user",
      content: `You are ${advisorName}, a sharp debate sparring partner. Fire ONE short opening question — spiky, specific, fun. Under 30 words. No waffle. Base it on: "${seedTopic}". Tags (pick 1-2): Economy, Healthcare, Housing, Education, Immigration, Climate & Environment, Technology & AI, Defence & Foreign Affairs, Democracy & Governance, Crime & Justice, Social Policy, Transport & Infrastructure. Respond ONLY with valid JSON: {"message":"question here","topic_tags":["CategoryName"],"belief_updates":[]}`
    }],
  });

  const raw = resp.content.find(c => c.type === "text")?.text ?? "";
  return safeParseResponse(raw) ?? {
    message: `A third of working adults now say the political system no longer represents them. Is that a failure of politicians, voters, or the system itself?`,
    topic_tags: ["democracy"],
    belief_updates: [],
  };
}

function safeParseResponse(raw: string): AdvisorApiResponse | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (typeof parsed.message !== "string") return null;
    return {
      message: parsed.message,
      topic_tags: Array.isArray(parsed.topic_tags) ? parsed.topic_tags : [],
      belief_updates: Array.isArray(parsed.belief_updates) ? parsed.belief_updates : [],
    };
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------
// Main POST handler
// -----------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json() as {
    message: string | null;
    initial_topic?: string;
    arena_context?: { topic: string; for_args: string[]; against_args: string[] };
  };

  const svc = supabaseService();
  const now = new Date().toISOString();

  // Load taxonomy cache (no-op if already loaded)
  await loadTaxonomyCache(svc);

  // Load profile (for advisor_name)
  const { data: profile } = await svc
    .from("profiles")
    .select("advisor_name, display_name")
    .eq("id", user.id)
    .maybeSingle();

  const advisorName = profile?.advisor_name || "Nexus";

  // Load non-deleted user_views for system context
  let userViews: { topic_label: string; summary: string; confidence_score: number }[] = [];
  try {
    const { data } = await svc
      .from("user_views")
      .select("topic_label, summary, confidence_score")
      .eq("user_id", user.id)
      .eq("is_deleted", false)
      .neq("summary", "");
    if (data) userViews = data;
  } catch { /* table may not exist yet */ }

  // Load conversation
  let conversation: ConversationMessage[] = [];
  let conversationId: string | null = null;
  try {
    const { data: conv } = await svc
      .from("conversations")
      .select("id, messages")
      .eq("user_id", user.id)
      .maybeSingle();
    if (conv) {
      conversationId = conv.id;
      conversation = Array.isArray(conv.messages) ? conv.messages : [];
    }
  } catch { /* table may not exist yet */ }

  // -----------------------------------------------------------------------
  // Opening question: no message yet
  // -----------------------------------------------------------------------
  if (body.message === null) {
    if (conversation.length > 0) {
      const lastAssistant = [...conversation].reverse().find(m => m.role === "assistant");
      if (lastAssistant) {
        return NextResponse.json({
          message: lastAssistant.content,
          topic_tags: lastAssistant.topic_tags ?? [],
          belief_updates: [],
        } satisfies AdvisorApiResponse);
      }
    }

    const opener = await buildOpeningQuestion(advisorName, svc, body.arena_context);
    const openerMsg: ConversationMessage = {
      role: "assistant",
      content: opener.message,
      topic_tags: opener.topic_tags,
      belief_updates: [],
      timestamp: now,
    };
    conversation = [openerMsg];
    await saveConversation(svc, user.id, conversation, conversationId);
    return NextResponse.json(opener);
  }

  // -----------------------------------------------------------------------
  // Regular turn: user sent a message
  // -----------------------------------------------------------------------
  const userMsg: ConversationMessage = {
    role: "user",
    content: body.message,
    timestamp: now,
  };
  conversation = [...conversation, userMsg];

  const history = truncateHistory(conversation);
  const anthropicMessages = history.map(m => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const systemPrompt = buildSystemPrompt(advisorName, userViews, body.arena_context);

  let apiResponse: AdvisorApiResponse;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: systemPrompt,
      messages: anthropicMessages,
    });

    const raw = resp.content.find(c => c.type === "text")?.text ?? "";
    apiResponse = safeParseResponse(raw) ?? {
      message: "I couldn't formulate a response. Could you rephrase that?",
      topic_tags: [],
      belief_updates: [],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const assistantMsg: ConversationMessage = {
    role: "assistant",
    content: apiResponse.message,
    topic_tags: apiResponse.topic_tags,
    belief_updates: apiResponse.belief_updates,
    timestamp: new Date().toISOString(),
  };
  conversation = [...conversation, assistantMsg];

  await saveConversation(svc, user.id, conversation, conversationId);

  // Fire-and-forget: upsert user_views, then classify raw turn into taxonomy questions
  upsertBeliefUpdates(svc, user.id, apiResponse.belief_updates).catch(
    err => console.warn("[advisor] belief upsert failed:", err)
  );
  classifyTurn(svc, user.id, body.message, apiResponse.message, apiResponse.topic_tags).catch(
    err => console.warn("[advisor] classification failed:", err)
  );

  return NextResponse.json(apiResponse);
}

// -----------------------------------------------------------------------
// Conversation persistence
// -----------------------------------------------------------------------

async function saveConversation(
  svc: ReturnType<typeof supabaseService>,
  userId: string,
  messages: ConversationMessage[],
  existingId: string | null,
) {
  try {
    if (existingId) {
      await svc
        .from("conversations")
        .update({ messages, updated_at: new Date().toISOString() })
        .eq("id", existingId);
    } else {
      await svc
        .from("conversations")
        .insert({ user_id: userId, messages });
    }
  } catch { /* table may not exist yet */ }
}

// -----------------------------------------------------------------------
// Belief upsert into user_views
// -----------------------------------------------------------------------

async function upsertBeliefUpdates(
  svc: ReturnType<typeof supabaseService>,
  userId: string,
  updates: BeliefUpdate[],
) {
  if (!updates.length) return;
  const now = new Date().toISOString();

  for (const upd of updates) {
    if (!upd.topic_label || typeof upd.confidence_score !== "number") continue;

    const { data: existing } = await svc
      .from("user_views")
      .select("id, raw_excerpts, submitted_to_arena, user_overridden")
      .eq("user_id", userId)
      .eq("topic_label", upd.topic_label)
      .eq("is_deleted", false)
      .maybeSingle();

    if (existing?.submitted_to_arena) continue; // read-only

    const excerpts: string[] = Array.isArray(existing?.raw_excerpts)
      ? existing.raw_excerpts : [];
    if (upd.raw_excerpt) {
      excerpts.push(upd.raw_excerpt);
      excerpts.splice(0, Math.max(0, excerpts.length - 20));
    }

    if (existing) {
      await svc.from("user_views").update({
        summary: upd.summary,
        ...(!existing.user_overridden && { confidence_score: Math.max(0, Math.min(1, upd.confidence_score)) }),
        raw_excerpts: excerpts,
        updated_at: now,
      }).eq("id", existing.id);
    } else {
      await svc.from("user_views").insert({
        user_id: userId,
        topic_label: upd.topic_label,
        summary: upd.summary,
        confidence_score: Math.max(0, Math.min(1, upd.confidence_score)),
        raw_excerpts: excerpts,
      });
    }
  }
}

// -----------------------------------------------------------------------
// Taxonomy classification pipeline — one call per conversation turn
// -----------------------------------------------------------------------

async function classifyTurn(
  svc: ReturnType<typeof supabaseService>,
  userId: string,
  userMessage: string,
  assistantMessage: string,
  topicTags: string[],
) {
  if (!_questions || !_categories) return;

  // Match cached categories to the topic tags returned by the advisor
  const relevantCats = _categories.filter(c =>
    topicTags.some(tag =>
      c.name.toLowerCase().includes(tag.toLowerCase()) ||
      tag.toLowerCase().includes(c.name.toLowerCase())
    )
  );
  if (!relevantCats.length) return;

  const catIds = new Set(relevantCats.map(c => c.id));
  const candidates = _questions.filter(q => catIds.has(q.category_id)).slice(0, 24);
  if (!candidates.length) return;

  const questionsList = candidates
    .map(q => `${q.id}: ${q.question_text}`)
    .join("\n");

  // Single classification call for the whole turn
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: "You are a political position classifier. Given the user's message and the assistant's reply, identify which of the provided taxonomy questions the user's words imply an answer to. For each one, return: question_id, stance (yes/no/abstain), core_argument (one sentence — a quote or close paraphrase of what the user said), confidence (0.0 to 1.0). Return only a JSON array, no other text. If nothing can be inferred return an empty array [].",
    messages: [{
      role: "user",
      content: `User message: "${userMessage}"\n\nAssistant reply: "${assistantMessage}"\n\nTaxonomy questions:\n${questionsList}`,
    }],
  });

  const raw = resp.content.find(c => c.type === "text")?.text ?? "";
  let results: Array<{
    question_id: string;
    stance: string;
    core_argument: string;
    confidence: number;
  }>;
  try {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end <= start) return;
    results = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(results)) return;
  } catch {
    return;
  }

  const now = new Date().toISOString();

  await Promise.allSettled(
    results.map(async (result) => {
      if (!result.question_id) return;
      const question = candidates.find(q => q.id === result.question_id);
      if (!question) return;

      const stance = result.stance as "yes" | "no" | "abstain";
      if (!["yes", "no", "abstain"].includes(stance)) return;

      const confidence = Math.max(0, Math.min(1, result.confidence ?? 0.5));
      const coreArgument = (result.core_argument ?? "").slice(0, 200);

      const { data: existing } = await svc
        .from("inferred_positions")
        .select("id, confidence")
        .eq("user_id", userId)
        .eq("question_id", result.question_id)
        .maybeSingle();

      if (existing) {
        // Only update if new classification is more confident
        if (confidence > Number(existing.confidence ?? 0)) {
          await svc.from("inferred_positions").update({
            stance,
            confidence,
            core_argument: coreArgument,
            updated_at: now,
          }).eq("id", existing.id);
        }
      } else {
        await svc.from("inferred_positions").insert({
          user_id: userId,
          session_id: "advisor_extraction",
          question_id: result.question_id,
          category_id: question.category_id,
          subtopic_id: question.subtopic_id ?? null,
          stance,
          confidence,
          core_argument: coreArgument,
          arguments_json: [],
        });
      }
    })
  );
}

// -----------------------------------------------------------------------
// Sync public_nodes tension stats after classifyBelief
// -----------------------------------------------------------------------

async function syncPublicNode(
  svc: ReturnType<typeof supabaseService>,
  categoryId: string,
  categoryName: string,
) {
  const { data: scores } = await svc
    .from("collective_scores")
    .select("yes_weighted_pct, total_responses, tension_flag")
    .eq("category_id", categoryId);

  if (!scores || !scores.length) return;

  const totalResponses = scores.reduce((s, r) => s + (Number(r.total_responses) || 0), 0);
  const hotCount = scores.filter(s => s.tension_flag === "hot" || s.tension_flag === "disputed").length;
  const tensionCoefficient = scores.length > 0 ? hotCount / scores.length : 0;
  const noiseSaturation = Math.min(1, totalResponses / 100);

  const { data: existing } = await svc
    .from("public_nodes")
    .select("id")
    .eq("category_id", categoryId)
    .maybeSingle();

  if (existing) {
    await svc.from("public_nodes").update({ tension_coefficient: tensionCoefficient, noise_saturation: noiseSaturation }).eq("id", existing.id);
  } else {
    await svc.from("public_nodes").insert({
      category_id: categoryId,
      topic_label: categoryName,
      tension_coefficient: tensionCoefficient,
      noise_saturation: noiseSaturation,
    });
  }
}

// -----------------------------------------------------------------------
// Detect supporting / contradicting links between user_views
// -----------------------------------------------------------------------

async function detectAndSaveLinks(
  svc: ReturnType<typeof supabaseService>,
  userId: string,
  updates: BeliefUpdate[],
) {
  if (!updates.length) return;

  const { data: allViews } = await svc
    .from("user_views")
    .select("id, topic_label, summary")
    .eq("user_id", userId)
    .eq("is_deleted", false)
    .neq("summary", "");

  if (!allViews || allViews.length < 2) return;

  // Only process the first updated belief to cap AI calls
  const upd = updates[0];
  const viewA = allViews.find(v => v.topic_label === upd.topic_label);
  if (!viewA?.summary) return;

  const others = allViews.filter(v => v.id !== viewA.id).slice(0, 5);

  await Promise.allSettled(
    others.map(async (viewB) => {
      if (!viewB.summary) return;

      // Skip if any link already exists between this pair (either direction)
      const [fwdRes, revRes] = await Promise.all([
        svc.from("personal_links").select("id").eq("user_id", userId).eq("node_a_id", viewA.id).eq("node_b_id", viewB.id).maybeSingle(),
        svc.from("personal_links").select("id").eq("user_id", userId).eq("node_a_id", viewB.id).eq("node_b_id", viewA.id).maybeSingle(),
      ]);
      if (fwdRes.data || revRes.data) return;

      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 80,
        messages: [{
          role: "user",
          content: `Do these two political positions support or contradict each other?\nA (${viewA.topic_label}): ${viewA.summary}\nB (${viewB.topic_label}): ${viewB.summary}\nReturn JSON only: {"relationship":"supporting","strength":0.6}`,
        }],
      });

      const raw = resp.content.find(c => c.type === "text")?.text ?? "";
      const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
      if (s < 0 || e <= s) return;
      let result: { relationship?: string; strength?: number };
      try { result = JSON.parse(raw.slice(s, e + 1)); } catch { return; }

      const relationship = result.relationship === "contradicting" ? "contradicting" : "supporting";
      const strength = Math.max(0, Math.min(1, result.strength ?? 0.5));

      await svc.from("personal_links").insert({
        user_id: userId,
        node_a_id: viewA.id,
        node_b_id: viewB.id,
        relationship,
        strength,
      });
    })
  );
}

