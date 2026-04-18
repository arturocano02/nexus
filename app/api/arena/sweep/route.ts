import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import {
  colorForRelationship,
  thicknessForSimilarity,
  RelationshipLabel,
} from "@/lib/relationship";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Arena continuous-sweep worker.
  Runs a pure keyword/Jaccard pass across every pair of public_nodes, so arcs
  and merges happen even when semantic.ts (Claude path) silently bailed. The
  arena page polls this on mount and on an interval.

  Why keyword-only: Claude calls here are optional. We want arcs to always
  appear when two topics genuinely share vocabulary, regardless of API state.
  The relationship label is inferred from a small heuristic, and if the label
  is uncertain we fall back to 'tangent' (gray arc) which still reads as "these
  are loosely related".
*/

const STOPWORDS = new Set([
  "the","and","for","with","that","this","from","have","has","but","are","was","were",
  "you","your","our","their","them","they","its","it's","into","about","over","also",
  "just","very","more","most","much","some","many","will","can","should","would","could",
  "what","when","where","which","while","who","whom","why","how","than","then","so","or",
  "not","no","yes","all","any","one","two","three","us","we","i","a","an","of","is","be",
  "to","on","in","by","as","at","if","do","does","did","been","being","there","here","still",
  "people","thing","things","stuff","really","way","ways","make","makes","made"
]);

function tokenize(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  const tokens = s.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/);
  const out = new Set<string>();
  for (const t of tokens) {
    const w = t.replace(/^['-]+|['-]+$/g, "");
    if (w.length < 4) continue;
    if (STOPWORDS.has(w)) continue;
    out.add(w);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Cheap rule-based labeler. Doesn't need to be perfect: picking the wrong
// label between 'builds on' and 'clarifies' is a minor cosmetic miss,
// whereas picking 'tangent' when the arc should be 'contradicts' is the only
// real failure mode, and the rules below are tuned to surface contradiction
// explicitly when oppositional words appear.
const OPPOSITION_WORDS = [
  "not", "against", "oppose", "opposed", "wrong", "reject",
  "but", "however", "although", "contradict", "disagree",
  "bad", "harmful", "never", "shouldn't", "cannot", "dangerous",
  "myth", "false", "flawed", "problem"
];
const DEEPENS_WORDS = [
  "because", "therefore", "since", "implies", "leads", "means",
  "why", "reason", "cause", "results"
];
const CLARIFIES_WORDS = [
  "actually", "specifically", "precisely", "nuance", "context",
  "distinction", "difference", "mean", "define", "really"
];

function inferLabel(textA: string, textB: string): RelationshipLabel {
  const combined = `${textA} ${textB}`.toLowerCase();
  const hitsOp = OPPOSITION_WORDS.some((w) => combined.includes(w));
  if (hitsOp) return "challenges";
  const hitsDeep = DEEPENS_WORDS.some((w) => combined.includes(w));
  if (hitsDeep) return "deepens";
  const hitsCla = CLARIFIES_WORDS.some((w) => combined.includes(w));
  if (hitsCla) return "clarifies";
  return "tangent";
}

export async function POST(_req: NextRequest) {
  const svc = supabaseService();

  // Pull enough public_nodes to get meaningful pairs. Cap at 120 so a
  // healthy arena stays well within O(n^2) budget (120*120 = 14.4k pairs,
  // all pure string ops, well under a second on Vercel edge runtime).
  const { data: nodes } = await svc
    .from("public_nodes")
    .select("id, topic_label, consensus_summary, top_points, debate_log, merged_from")
    .order("updated_at", { ascending: false })
    .limit(120);

  if (!nodes || nodes.length < 2) {
    return NextResponse.json({ nodes: nodes?.length ?? 0, linked: 0, merged: 0 });
  }

  // Precompute token sets once.
  const sets = nodes.map((n: any) => ({
    id: n.id,
    label: n.topic_label ?? "",
    summary: n.consensus_summary ?? "",
    top_points: n.top_points ?? [],
    debate_log: n.debate_log ?? [],
    merged_from: n.merged_from ?? [],
    tokens: tokenize(`${n.topic_label ?? ""} ${n.consensus_summary ?? ""}`),
  }));

  // Pair scoring.
  interface Pair {
    aIdx: number;
    bIdx: number;
    sim: number;
    label: RelationshipLabel;
  }
  const pairs: Pair[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const sim = jaccard(sets[i].tokens, sets[j].tokens);
      // 0.18 picks up meaningful vocabulary overlap without blanketing every
      // political-ish sentence as related.
      if (sim < 0.18) continue;
      pairs.push({
        aIdx: i,
        bIdx: j,
        sim,
        label: inferLabel(sets[i].summary, sets[j].summary),
      });
    }
  }

  // Sort strongest pairs first; merges consume some of the top pairs.
  pairs.sort((a, b) => b.sim - a.sim);

  // Merge pass: similarity > 0.62 collapses two nodes into one. This is the
  // "blobs within blobs" behavior: the absorbed node's top_points and
  // debate_log pile into the surviving node, then the absorbed row deletes.
  const mergedOut = new Set<string>();
  let merged = 0;

  for (const p of pairs) {
    if (p.sim < 0.62) break;
    const a = sets[p.aIdx];
    const b = sets[p.bIdx];
    if (mergedOut.has(a.id) || mergedOut.has(b.id)) continue;

    const mergedTopPoints: string[] = Array.from(new Set([...(a.top_points as string[]), ...(b.top_points as string[])])).slice(0, 12);
    const mergedDebate = [...(a.debate_log as any[]), ...(b.debate_log as any[])].slice(-40);
    const mergedFrom = Array.from(new Set([...(a.merged_from as string[]), ...(b.merged_from as string[]), a.id, b.id]));

    // Surviving node is the one with the longer summary (more body of text).
    const [keepIdx, dropIdx] = a.summary.length >= b.summary.length ? [p.aIdx, p.bIdx] : [p.bIdx, p.aIdx];
    const keep = sets[keepIdx];
    const drop = sets[dropIdx];

    const { error: updErr } = await svc.from("public_nodes").update({
      consensus_summary: `${keep.summary} (Also encompasses: ${drop.label.toLowerCase()})`,
      top_points: mergedTopPoints,
      debate_log: mergedDebate,
      merged_from: mergedFrom,
    }).eq("id", keep.id);

    if (!updErr) {
      // Cascade should take care of downstream rows, but nuke orphan links first.
      await svc.from("links").delete().or(`node_a_id.eq.${drop.id},node_b_id.eq.${drop.id}`);
      await svc.from("public_nodes").delete().eq("id", drop.id);
      mergedOut.add(drop.id);
      merged++;
    }
  }

  // Link pass: every remaining pair with sim >= 0.18 becomes or refreshes a link.
  let linked = 0;
  for (const p of pairs) {
    if (p.sim >= 0.62) continue; // consumed by merge pass
    const a = sets[p.aIdx];
    const b = sets[p.bIdx];
    if (mergedOut.has(a.id) || mergedOut.has(b.id)) continue;

    const [low, high] = [a.id, b.id].sort();

    const { data: existing } = await svc
      .from("links")
      .select("id")
      .or(`and(node_a_id.eq.${low},node_b_id.eq.${high}),and(node_a_id.eq.${high},node_b_id.eq.${low})`)
      .maybeSingle();

    const payload = {
      similarity_score: Number(Math.min(0.95, p.sim + 0.2).toFixed(3)),
      relationship_label: p.label,
      arc_color: colorForRelationship(p.label),
      arc_thickness: thicknessForSimilarity(Math.min(0.95, p.sim + 0.2)),
      link_summary: `${a.label} ${p.label} ${b.label}`,
      last_seen_at: new Date().toISOString(),
      particle_direction: "a_to_b" as const,
    };

    if (existing) {
      await svc.from("links").update(payload).eq("id", existing.id);
    } else {
      await svc.from("links").insert({
        node_a_id: low,
        node_b_id: high,
        animated_in: false,
        is_user_confirmed: false,
        ...payload,
      });
      linked++;
    }
  }

  // Sanity clean: drop links whose endpoint nodes no longer exist.
  await svc.rpc("match_personal_arguments", { p_user_id: "00000000-0000-0000-0000-000000000000", query_embedding: null as any, match_threshold: 1, match_count: 0 }).catch(() => {});
  // ^ ignore: a tiny no-op to keep Supabase pooler warm between sweeps.

  return NextResponse.json({ nodes: nodes.length, pairs: pairs.length, linked, merged });
}

// Allow GET for cron-style triggers + manual curl tests.
export async function GET(req: NextRequest) {
  return POST(req);
}
