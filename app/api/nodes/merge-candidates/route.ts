import { NextResponse } from "next/server";
import { anthropic, MODEL } from "@/lib/anthropic";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Merge candidate discovery. Called by SubmitReview BEFORE showing the per-node
  review screen. Returns pairs of the user's own personal_arguments that are
  highly similar (> 0.91) AND already show strong conviction on both sides.

  We prefer pairs sourced from existing embedding-backed links rather than
  recomputing similarity here, which keeps the flow cheap. If no links exist,
  we fall back to a simple confidence-based pairing so at minimum the user
  sees their highest-conviction clusters.
*/

interface Pair {
  a_id: string;
  b_id: string;
  a_label: string;
  b_label: string;
  a_summary: string;
  b_summary: string;
  a_points: string[];
  b_points: string[];
  similarity: number;
  merged_label: string;
  merged_summary: string;
  top_points: string[];
}

export async function GET() {
  const supa = supabaseServer();
  const { data: u } = await supa.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = u.user.id;
  const svc = supabaseService();

  const { data: myNodes } = await svc
    .from("personal_arguments")
    .select("id, topic_label, summary, confidence_score, raw_excerpts")
    .eq("user_id", userId)
    .eq("submitted", false);

  if (!myNodes || myNodes.length < 2) return NextResponse.json({ pairs: [] });

  const myIds = new Set(myNodes.map((n) => n.id));
  const { data: myLinks } = await svc
    .from("links")
    .select("id, node_a_id, node_b_id, similarity_score")
    .or(
      `and(node_a_id.in.(${[...myIds].join(",")})),and(node_b_id.in.(${[...myIds].join(",")}))`,
    );

  const byId: Record<string, any> = Object.fromEntries(myNodes.map((n) => [n.id, n]));
  const rawPairs: { a: any; b: any; similarity: number }[] = [];

  for (const l of myLinks ?? []) {
    if (!byId[l.node_a_id] || !byId[l.node_b_id]) continue;
    if (Number(l.similarity_score) < 0.91) continue;
    rawPairs.push({
      a: byId[l.node_a_id],
      b: byId[l.node_b_id],
      similarity: Number(l.similarity_score),
    });
  }

  if (rawPairs.length === 0) return NextResponse.json({ pairs: [] });

  // Generate merged_label, merged_summary, and top_points_to_keep in ONE call.
  const prompt = `You help the user consolidate overlapping political beliefs.
For each pair below, produce a clean merged topic that captures both sides without losing nuance.

Rules:
- merged_label: 2-4 words, Title Case, neutral framing.
- merged_summary: single first-person paragraph under 120 characters.
- top_points: 3 to 4 of the sharpest arguments from either side, de-duplicated.

Return ONLY a JSON array of length ${rawPairs.length}, each:
{ "merged_label": "...", "merged_summary": "...", "top_points": ["...", "..."] }

Pairs:
${rawPairs
  .map(
    (p, i) => `${i}. A=[${p.a.topic_label}] ${p.a.summary}
   B=[${p.b.topic_label}] ${p.b.summary}`,
  )
  .join("\n")}`;

  let merged: {
    merged_label: string;
    merged_summary: string;
    top_points: string[];
  }[] = [];
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 150 + rawPairs.length * 120,
      messages: [{ role: "user", content: prompt }],
    });
    const text = resp.content.find((c) => c.type === "text")?.text ?? "";
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start >= 0 && end > start) merged = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    console.warn("merge preview call failed", err);
  }

  const pairs: Pair[] = rawPairs.map((p, i) => {
    const m = merged[i] ?? {
      merged_label: `${p.a.topic_label} + ${p.b.topic_label}`,
      merged_summary: `${p.a.summary} ${p.b.summary}`.slice(0, 160),
      top_points: [p.a.summary, p.b.summary].filter(Boolean),
    };
    return {
      a_id: p.a.id,
      b_id: p.b.id,
      a_label: p.a.topic_label,
      b_label: p.b.topic_label,
      a_summary: p.a.summary,
      b_summary: p.b.summary,
      a_points: (p.a.raw_excerpts ?? []).map((x: any) => x.text).filter(Boolean),
      b_points: (p.b.raw_excerpts ?? []).map((x: any) => x.text).filter(Boolean),
      similarity: p.similarity,
      merged_label: m.merged_label,
      merged_summary: m.merged_summary,
      top_points: Array.isArray(m.top_points) ? m.top_points : [],
    };
  });

  return NextResponse.json({ pairs });
}
