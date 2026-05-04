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

RESPONSE FORMAT: Valid JSON only. No text outside it. Max 80 words in message field.
{"message":"reply (max 80 words, no em-dashes)","topic_tags":["Category"],"belief_updates":[{"topic_label":"label","summary":"one sentence","confidence_score":0.0,"raw_excerpt":"exact user quote","confirmation_status":"inferred"}]}

belief_updates only when you have real signal. Empty array otherwise. confirmation_status "confirmed" only when user explicitly agrees.`;
}

async function buildOpeningQuestion(
  advisorName: string,
  svc: ReturnType<typeof supabaseService>,
  arenaContext?: { topic: string; for_args: string[]; against_args: string[] },
): Promise<AdvisorApiResponse> {
  // Fetch high-tension topics to seed a specific opening question
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
    // Extract JSON even if there's surrounding text
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
    // If conversation already has messages, return the last assistant message
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

    // Fresh conversation — generate opener
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

  // Build API history (truncated)
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

  // Append assistant message to conversation
  const assistantMsg: ConversationMessage = {
    role: "assistant",
    content: apiResponse.message,
    topic_tags: apiResponse.topic_tags,
    belief_updates: apiResponse.belief_updates,
    timestamp: new Date().toISOString(),
  };
  conversation = [...conversation, assistantMsg];

  // Persist conversation
  await saveConversation(svc, user.id, conversation, conversationId);

  // Upsert user_views from belief_updates (fire-and-forget style)
  upsertBeliefUpdates(svc, user.id, apiResponse.belief_updates).catch(
    err => console.warn("[advisor] belief upsert failed:", err)
  );

  return NextResponse.json(apiResponse);
}

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
      .select("id, raw_excerpts, submitted_to_arena")
      .eq("user_id", userId)
      .eq("topic_label", upd.topic_label)
      .eq("is_deleted", false)
      .maybeSingle();

    if (existing?.submitted_to_arena) continue; // read-only

    const excerpts: string[] = Array.isArray(existing?.raw_excerpts)
      ? existing.raw_excerpts : [];
    if (upd.raw_excerpt) {
      excerpts.push(upd.raw_excerpt);
      excerpts.splice(0, Math.max(0, excerpts.length - 20)); // keep last 20
    }

    if (existing) {
      await svc.from("user_views").update({
        summary: upd.summary,
        confidence_score: Math.max(0, Math.min(1, upd.confidence_score)),
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
