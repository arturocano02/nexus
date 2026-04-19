import { NextRequest } from "next/server";
import { anthropic, MODEL } from "@/lib/anthropic";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import type { BeliefUpdate, PersonalArgument } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  The chat endpoint is the engine behind Screen 1. It does three things in one turn:
  1. Streams a sharp, devil's-advocate reply to the UI so typing feels alive.
  2. Silently extracts structured belief updates (topic, summary, confidence) from
     what the user just said and upserts them into personal_arguments. That is what
     grows the blob map as the conversation goes on.
  3. Emits a tail event with the list of updated node ids so the client can do a
     celebratory pulse without a full refetch.

  We ask Claude for a single JSON object. The client already extracts the 'message'
  field from the streaming text, so this stays compatible with the existing UI.
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
  ]
}`;

export async function POST(req: NextRequest) {
  const { messages } = await req.json();
  const supa = await supabaseServer();
  const { data: u } = await supa.auth.getUser();
  const userId = u.user?.id;

  const response = await anthropic.messages.create({
    model: MODEL,
    // 1200 tokens covers the 120-word cap plus belief_updates JSON comfortably.
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
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

      // Upsert beliefs server-side using the authenticated user's cookie session.
      // We bypass RLS with the service client because the conversation can come
      // in on anonymous auth and we want to guarantee writes succeed even if the
      // JWT refresh window closes mid-stream.
      const updatedIds: string[] = [];
      if (userId && beliefUpdates.length > 0) {
        const svc = supabaseService();
        for (const b of beliefUpdates) {
          const id = await upsertBelief(svc, userId, b);
          if (id) updatedIds.push(id);
        }
      }

      controller.enqueue(
        encoder.encode(
          JSON.stringify({
            type: "final",
            message: finalMessage,
            updated_node_ids: updatedIds,
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
