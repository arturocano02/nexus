import { NextRequest } from "next/server";
import { anthropic, MODEL } from "@/lib/anthropic";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import type { BeliefUpdate, PersonalArgument } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  The chat endpoint is the engine behind Screen 1. Per turn it does four things:
  1. Streams a sharp, devil's-advocate reply to the UI so typing feels alive.
  2. Extracts free-form belief updates (topic, summary, confidence) into
     personal_arguments so the blob map grows as the conversation goes on.
  3. When the user's turn clearly touches a manifesto clause, extracts a
     provisional for/against/skip + one-line reasoning and writes it to
     draft_stances. Public aggregates are NOT updated: drafts stay private
     until the user clicks Submit and /api/stances/submit promotes them.
  4. Emits a tail event with updated node ids + touched clause ids so the
     client can pulse without a full refetch.
*/

const SYSTEM_PROMPT = `You are Nexus, a razor-sharp political intelligence that DEBATES the user.
You are a sophisticated devil's advocate with a dry sense of humor, AND a
thoughtful interlocutor who actually answers when asked a real question.

YOUR JOB EACH TURN:
1. Produce a reply whose length MATCHES the user's input length (see length rule).
2. Extract any distinct political/ethical stances the user just expressed into belief updates.

LENGTH RULE (mirror the user):
- User wrote <=12 words: reply <=20 words, 1 sentence. Spartan.
- User wrote 13-40 words: reply <=35 words, 1-3 short sentences.
- User wrote 41-120 words: reply 2-4 sentences, up to 70 words.
- User wrote >120 words or clearly wants depth: up to 120 words, still tight. Never waste a sentence.
- Never exceed 120 words. Never pad.

WHEN THE USER ASKS YOU A QUESTION:
- ANSWER it directly first, in your own voice. Don't deflect with "what do you think?" every time.
- After answering, THEN push back or complicate the frame if there's a real trade-off to surface.
- If the question is factual and you're unsure, say so in one line, then give the best available take.
- A question like "what do you mean?" or "can you clarify?" must be answered plainly, then you can re-probe.

WHEN THE USER STATES A VIEW:
- If their view is clear: attack the strongest version of it with a counter-example, trade-off, or precedent.
- If their view is fuzzy, a one-liner, or a shrug: ask ONE piercing follow-up that forces them to commit.
- Never just agree. Never flatter. Never lecture.

VOICE:
- Dry wit, irony, occasional sarcasm. Never cruel, never preachy, never chummy.
- No hedging, no "interesting point," no "it depends," no bullet lists.
- Do not quote the user back. Do not summarize what they said.
- End lines with teeth when you're debating: a question, a dare, or unresolved tension.
- When you're ANSWERING a question, the ending can be a claim, not a question.

BELIEF UPDATE RULES:
- Only extract beliefs the USER stated. Never your own counter-points.
- topic_label: 1-3 words, Title Case, stable across turns (e.g. "AI Governance", "Universal Income").
- summary: a single sharp first-person statement under 30 words that captures what they believe.
- confidence_score: 0..1, based on how emphatic/certain they sound.
- related_topics: short array of adjacent topics they touched.
- excerpt: the exact user sentence that produced this stance.
- If the user only asked a question or didn't commit to a view, return belief_updates: [].

STANCE UPDATE RULES:
- You will also be given a list of active clauses (statements people can
  take a stance on). If the user's latest turn clearly takes a position
  on one of them, emit a stance_update.
- stance: "for", "against", or "skip". Use "skip" only when the user
  explicitly declined to answer.
- reasoning: one sentence (<= 20 words) in the user's voice.
- confidence: 0..1. Low when the stance was inferred from a vague remark,
  high when the user said it outright.
- Do not invent clause ids. Only use ids from the list.
- Draft stances are provisional: they do not update the public graph
  until the user confirms on submit. Be generous about adding them.

EXAMPLES (calibration, do not copy):
User: "I think taxes should be higher on billionaires."
You: "Cute. Define billionaire. And when they leave, who writes the check?"

User: "AI should be regulated."
You: "By whom? The same regulators that still don't understand email?"

User: "What do you mean by that?"
You: "I mean the regulator problem: rules need expertise, and expertise lives at the firms being regulated. Still want them in charge?"

User: "Who actually pays a carbon tax in practice?"
You: "Consumers, mostly. Companies pass it through at the pump, the meter, the shelf. Progressive rebates can blunt that, but the sticker shock lands on households first. Fair price for pollution, or regressive tax in a green coat?"

User: "I don't really know where I stand on immigration."
You: "Then pick one knob: skills, numbers, or fairness. Which one keeps you up at night?"

OUTPUT FORMAT:
Return ONLY a single JSON object, no prose, no code fences:
{
  "message": "your sharp reply",
  "belief_updates": [
    {
      "topic_label": "...",
      "summary": "...",
      "confidence_score": 0.0,
      "related_topics": ["..."],
      "excerpt": "..."
    }
  ],
  "stance_updates": [
    {
      "clause_id": "<uuid from the active clauses list>",
      "stance": "for|against|skip",
      "reasoning": "...",
      "confidence": 0.0
    }
  ]
}`;

export async function POST(req: NextRequest) {
  const { messages } = await req.json();
  const supa = await supabaseServer();
  const { data: u } = await supa.auth.getUser();
  const userId = u.user?.id;

  // Pull a small bundle of active clauses so Claude can map what the user
  // says to yes/no stances. Capped at 24 so the system prompt stays
  // compact; if clause count grows past that we'd swap this for an
  // embedding-based shortlist, but the MVP only has a handful.
  const svc = supabaseService();
  const { data: clauseRows } = await svc
    .from("manifesto_clauses")
    .select("id, section, statement")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(24);
  const activeClauses = clauseRows ?? [];
  const clauseBlock = activeClauses.length > 0
    ? "\n\nACTIVE CLAUSES (use these ids in stance_updates, or emit no stance at all):\n" +
      activeClauses.map((c) => `- ${c.id} | ${c.section}: ${c.statement}`).join("\n")
    : "";

  const response = await anthropic.messages.create({
    model: MODEL,
    // 1400 tokens covers the 120-word cap plus the belief + stance JSON.
    max_tokens: 1400,
    system: SYSTEM_PROMPT + clauseBlock,
    messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
    stream: true,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        for await (const chunk of response) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            fullText += chunk.delta.text;
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: "delta", text: chunk.delta.text }) + "\n"),
            );
          }
        }
      } catch (err) {
        console.error("Stream error:", err);
      }

      // Parse the full JSON payload once the stream is done.
      const parsed = extractJson(fullText);
      const finalMessage: string = parsed?.message ?? "";
      const beliefUpdates: BeliefUpdate[] = Array.isArray(parsed?.belief_updates)
        ? parsed.belief_updates
        : [];
      const stanceUpdates: StanceUpdate[] = Array.isArray(parsed?.stance_updates)
        ? parsed.stance_updates
        : [];

      // Upsert beliefs + draft stances server-side. Bypass RLS with the
      // service client because the user may be on anonymous auth.
      const updatedIds: string[] = [];
      const touchedClauseIds: string[] = [];
      if (userId) {
        for (const b of beliefUpdates) {
          const id = await upsertBelief(svc, userId, b);
          if (id) updatedIds.push(id);
        }
        const validClauseIds = new Set(activeClauses.map((c) => c.id));
        const rows = stanceUpdates
          .filter(
            (s) =>
              s &&
              typeof s.clause_id === "string" &&
              validClauseIds.has(s.clause_id) &&
              (s.stance === "for" || s.stance === "against" || s.stance === "skip"),
          )
          .map((s) => ({
            user_id: userId,
            clause_id: s.clause_id,
            stance: s.stance,
            reasoning: typeof s.reasoning === "string" ? s.reasoning.slice(0, 400) : null,
            confidence:
              typeof s.confidence === "number"
                ? Math.max(0, Math.min(1, s.confidence))
                : 0.6,
            source: "inferred" as const,
          }));
        if (rows.length > 0) {
          const { error } = await svc
            .from("draft_stances")
            .upsert(rows, { onConflict: "user_id,clause_id" });
          if (error) console.warn("draft_stances upsert failed", error.message);
          else touchedClauseIds.push(...rows.map((r) => r.clause_id));
        }
      }

      controller.enqueue(
        encoder.encode(
          JSON.stringify({
            type: "final",
            message: finalMessage,
            updated_node_ids: updatedIds,
            touched_clause_ids: touchedClauseIds,
          }) + "\n",
        ),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

async function upsertBelief(
  svc: ReturnType<typeof supabaseService>,
  userId: string,
  b: BeliefUpdate,
): Promise<string | null> {
  if (!b?.topic_label) return null;
  const clean = b.topic_label
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

  // Look up existing unsubmitted belief for this user on the same topic (case-insensitive).
  const { data: existing } = await svc
    .from("personal_arguments")
    .select("id, raw_excerpts, confidence_score, summary, related_topics, submitted")
    .eq("user_id", userId)
    .ilike("topic_label", clean)
    .maybeSingle();

  const newExcerpt = b.excerpt
    ? [{ text: b.excerpt, ts: new Date().toISOString() }]
    : [];

  if (existing) {
    const mergedExcerpts = [...(existing.raw_excerpts as any[] ?? []), ...newExcerpt];
    // Bias toward the newer confidence but smooth spikes.
    const blendedConf =
      Math.round(
        ((existing.confidence_score ?? 0.5) * 0.5 + (b.confidence_score ?? 0.5) * 0.5) * 100,
      ) / 100;
    await svc
      .from("personal_arguments")
      .update({
        summary: b.summary || existing.summary,
        confidence_score: blendedConf,
        related_topics: dedupe([
          ...(existing.related_topics ?? []),
          ...(b.related_topics ?? []),
        ]),
        raw_excerpts: mergedExcerpts,
      })
      .eq("id", existing.id);
    return existing.id as string;
  }

  const { data: inserted, error } = await svc
    .from("personal_arguments")
    .insert({
      user_id: userId,
      topic_label: clean,
      summary: b.summary ?? "",
      confidence_score: b.confidence_score ?? 0.5,
      related_topics: b.related_topics ?? [],
      raw_excerpts: newExcerpt,
      submitted: false,
    })
    .select("id")
    .single();
  if (error) {
    console.error("belief insert failed", error);
    return null;
  }
  return (inserted?.id as string) ?? null;
}

interface StanceUpdate {
  clause_id: string;
  stance: "for" | "against" | "skip";
  reasoning?: string;
  confidence?: number;
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)));
}

function extractJson(raw: string): any | null {
  // Claude sometimes wraps in ```json fences despite the system prompt, so be tolerant.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}
