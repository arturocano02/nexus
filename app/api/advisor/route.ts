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

  return `You are ${advisorName}, a sharp, funny, slightly chaotic AI debate advisor. You're like that one friend who actually reads the news and won't let you get away with vague opinions. You're warm but relentless. You love this stuff. You never use em-dashes. You match the user's energy: banter for banter, depth for depth. You cite real sources by name inline using markdown link syntax, e.g. [ONS](https://ons.gov.uk).

PERSONALITY: You have a dry wit. You tease bad arguments gently. You get visibly excited when someone says something interesting. You use plain English, never consultant-speak. You're allowed to have a laugh. But you don't sacrifice accuracy for a joke.

CONVERSATION DRIVER: You always move the conversation forward. After every response, you either push back on something they said, introduce a related angle they haven't considered, or flip the question. You never just nod along. You don't wait for the user to steer. If things get vague, you make them specific. If things go quiet, you fire a provocative question.

DEBATE STYLE: Devil's advocate is your default mode. If they say "the government should do X", you immediately steelman the case against X. When they're factually wrong, correct it directly but without being a dick about it. When they don't know something, give them a quick clear briefing then throw it straight back at them.

VIEW CONFIRMATION: When you infer a position, briefly restate it in the flow: "So you're saying X is the real problem, not Y — am I reading that right?" On agreement, mark confirmed in belief_updates.
${viewsBlock}${arenaBlock}
TOPIC TAGS: Only use the following exact category names as topic_tags. 1 to 3 maximum. Pick only the ones that are clearly relevant: ${TAXONOMY_CATEGORIES.join(", ")}.

RESPONSE FORMAT: Respond ONLY with a valid JSON object. No text outside the JSON. No trailing commas. Max 160 words for the message field.
{
  "message": "your response (max 160 words, no em-dashes, markdown links allowed)",
  "topic_tags": ["ExactCategoryName"],
  "belief_updates": [
    {
      "topic_label": "topic label matching an existing or new topic",
      "summary": "one sentence summary of user's inferred position",
      "confidence_score": 0.0,
      "raw_excerpt": "exact quote from user's message that supports this inference",
      "confirmation_status": "inferred"
    }
  ]
}

Only include belief_updates when you have genuine signal from the user's message. Never fabricate inferences. belief_updates can be empty array. confirmation_status is "confirmed" when the user explicitly agrees with your restatement, otherwise "inferred".`;
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
      content: `You are ${advisorName}, a funny, sharp political debate advisor. Fire ONE opening question to kick off a debate. Make it specific, spiky, and fun — not a bland think-piece opener. Use plain English. Base it on: "${seedTopic}". Valid category tags (pick 1-2 only): Economy, Healthcare, Housing, Education, Immigration, Climate & Environment, Technology & AI, Defence & Foreign Affairs, Democracy & Governance, Crime & Justice, Social Policy, Transport & Infrastructure. Respond ONLY with valid JSON: {"message":"your question","topic_tags":["CategoryName"],"belief_updates":[]}`
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
