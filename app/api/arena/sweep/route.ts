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
  is uncertain we fall back to 'tangent' (gray arc) which still reads as
  "these are loosely related".

  Invariants this file defends:
    - Never more than MAX_LINK_WRITES insert/update calls per sweep.
    - Merged nodes never leave orphan link rows behind.
    - Stale links (not refreshed in >15 min) auto-delete so arcs can fade.
    - Concurrent sweeps can't stampede: a 10s in-memory cooldown guards POST.
*/

const MAX_LINK_WRITES = 80;
const STALE_LINK_WINDOW_MS = 15 * 60_000;
const COOLDOWN_MS = 10_000;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "but", "are", "was", "were",
  "you", "your", "our", "their", "them", "they", "its", "it's", "into", "about", "over", "also",
  "just", "very", "more", "most", "much", "some", "many", "will", "can", "should", "would", "could",
  "what", "when", "where", "which", "while", "who", "whom", "why", "how", "than", "then", "so", "or",
  "not", "no", "yes", "all", "any", "one", "two", "three", "us", "we", "i", "a", "an", "of", "is", "be",
  "to", "on", "in", "by", "as", "at", "if", "do", "does", "did", "been", "being", "there", "here", "still",
  "people", "thing", "things", "stuff", "really", "way", "ways", "make", "makes", "made"
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
  "myth", "false", "flawed", "problem",
];
const DEEPENS_WORDS = [
  "because", "therefore", "since", "implies", "leads", "means",
  "why", "reason", "cause", "results",
];
const CLARIFIES_WORDS = [
  "actually", "specifically", "precisely", "nuance", "context",
  "distinction", "difference", "mean", "define", "really",
];

function inferLabel(textA: string, textB: string): RelationshipLabel {
  const combined = `${textA} ${textB}`.toLowerCase();
  if (OPPOSITION_WORDS.some((w) => combined.includes(w))) return "challenges";
  if (DEEPENS_WORDS.some((w) => combined.includes(w))) return "deepens";
  if (CLARIFIES_WORDS.some((w) => combined.includes(w))) return "clarifies";
  return "tangent";
}

// Module-scoped last-run timestamp for a trivial cooldown. One Vercel
// instance can still be hit by many concurrent arena clients; this throttles
// back-to-back sweeps without needing an external lock.
let lastRunAt = 0;

async function runSweep() {
  const svc = supabaseService();

  // 1. Pull enough public_nodes to get meaningful pairs. Cap at 120 so a
  // healthy arena stays well within O(n^2) budget.
  const { data: nodes, error: nodesErr } = await svc
    .from("public_nodes")
    .select("id, topic_label, consensus_summary, top_points, debate_log, merged_from")
    .order("updated_at", { ascending: false })
    .limit(120);

  if (nodesErr) {
    console.error("arena/sweep: fetch public_nodes failed", nodesErr);
    return { error: "fetch_failed" as const };
  }
  if (!nodes || nodes.length < 2) {
    return { nodes: nodes?.length ?? 0, linked: 0, merged: 0, pairs: 0, cleaned: 0 };
  }

  // Precompute token sets once.
  const sets = nodes.map((n: any) => ({
    id: n.id as string,
    label: (n.topic_label ?? "") as string,
    summary: (n.consensus_summary ?? "") as string,
    top_points: (n.top_points ?? []) as string[],
    debate_log: (n.debate_log ?? []) as any[],
    merged_from: (n.merged_from ?? []) as string[],
    tokens: tokenize(`${n.topic_label ?? ""} ${n.consensus_summary ?? ""}`),
  }));

  const liveIds = new Set(sets.map((s) => s.id));

  // 2. Score pairs.
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
      if (sim < 0.18) continue;
      pairs.push({
        aIdx: i,
        bIdx: j,
        sim,
        label: inferLabel(sets[i].summary, sets[j].summary),
      });
    }
  }
  pairs.sort((a, b) => b.sim - a.sim);

  // 3. Merge pass. Similarity > 0.62 collapses two nodes into one.
  //    The absorbed node's top_points and debate_log pile into the surviving
  //    node, then the absorbed row deletes. Orphan links are swept after.
  const mergedOut = new Set<string>();
  let merged = 0;

  for (const p of pairs) {
    if (p.sim < 0.62) break;
    const a = sets[p.aIdx];
    const b = sets[p.bIdx];
    if (mergedOut.has(a.id) || mergedOut.has(b.id)) continue;

    const mergedTopPoints = Array.from(
      new Set([...(a.top_points ?? []), ...(b.top_points ?? [])]),
    ).slice(0, 12);
    const mergedDebate = [...(a.debate_log ?? []), ...(b.debate_log ?? [])].slice(-40);
    const mergedFrom = Array.from(
      new Set([...(a.merged_from ?? []), ...(b.merged_from ?? []), a.id, b.id]),
    );

    // Surviving node is the one with the longer summary (more body of text).
    const [keepIdx, dropIdx] =
      a.summary.length >= b.summary.length ? [p.aIdx, p.bIdx] : [p.bIdx, p.aIdx];
    const keep = sets[keepIdx];
    const drop = sets[dropIdx];

    // Nuke links touching the soon-to-be-dropped node first so no orphan
    // arc can sit in the table for even one frame.
    await svc
      .from("links")
      .delete()
      .or(`node_a_id.eq.${drop.id},node_b_id.eq.${drop.id}`);

    const { error: updErr } = await svc
      .from("public_nodes")
      .update({
        consensus_summary: `${keep.summary} (Also encompasses: ${drop.label.toLowerCase()})`,
        top_points: mergedTopPoints,
        debate_log: mergedDebate,
        merged_from: mergedFrom,
      })
      .eq("id", keep.id);

    if (!updErr) {
      await svc.from("public_nodes").delete().eq("id", drop.id);
      mergedOut.add(drop.id);
      liveIds.delete(drop.id);
      merged++;
    } else {
      console.warn("arena/sweep: merge update failed", updErr.message);
    }
  }

  // 4. Fetch ALL existing links for live nodes in a single query so the
  //    link pass below is O(n) writes, not O(n) reads + O(n) writes.
  //    Keyed by the canonical "low|high" pair id.
  const { data: existingLinks } = await svc
    .from("links")
    .select("id, node_a_id, node_b_id, relationship_label, similarity_score, last_seen_at");

  const existingByPair = new Map<string, { id: string; relationship_label: string | null; similarity_score: number; last_seen_at: string | null }>();
  for (const l of existingLinks ?? []) {
    const [lo, hi] = [l.node_a_id, l.node_b_id].sort();
    existingByPair.set(`${lo}|${hi}`, {
      id: l.id,
      relationship_label: l.relationship_label,
      similarity_score: Number(l.similarity_score ?? 0),
      last_seen_at: l.last_seen_at,
    });
  }

  // 5. Link pass. Every remaining pair above threshold becomes or refreshes
  //    a link. Capped at MAX_LINK_WRITES so one stampede can't spam the DB.
  const linkPass = pairs.filter((p) => p.sim < 0.62).slice(0, MAX_LINK_WRITES);
  let linked = 0;
  let refreshed = 0;

  for (const p of linkPass) {
    const a = sets[p.aIdx];
    const b = sets[p.bIdx];
    if (mergedOut.has(a.id) || mergedOut.has(b.id)) continue;

    const [low, high] = [a.id, b.id].sort();
    const pairKey = `${low}|${high}`;
    const existing = existingByPair.get(pairKey);

    const boosted = Math.min(0.95, p.sim + 0.2);
    const payload = {
      similarity_score: Number(boosted.toFixed(3)),
      relationship_label: p.label,
      arc_color: colorForRelationship(p.label),
      arc_thickness: thicknessForSimilarity(boosted),
      link_summary: `${a.label} ${p.label} ${b.label}`,
      last_seen_at: new Date().toISOString(),
      particle_direction: "a_to_b" as const,
    };

    if (existing) {
      // Avoid pointless writes when similarity and label are unchanged.
      const simDelta = Math.abs(existing.similarity_score - payload.similarity_score);
      const labelChanged = existing.relationship_label !== payload.relationship_label;
      if (simDelta < 0.02 && !labelChanged) {
        // Still touch last_seen_at so it doesn't get swept as stale.
        await svc.from("links").update({ last_seen_at: payload.last_seen_at }).eq("id", existing.id);
      } else {
        await svc.from("links").update(payload).eq("id", existing.id);
        refreshed++;
      }
    } else {
      const { error: insErr } = await svc.from("links").insert({
        node_a_id: low,
        node_b_id: high,
        animated_in: false,
        is_user_confirmed: false,
        ...payload,
      });
      if (!insErr) linked++;
    }
  }

  // 6. Orphan cleanup. Delete any links whose endpoints are no longer in
  //    public_nodes. This closes the loop from the merge pass above and
  //    also catches links left over from manual row deletions.
  const { data: allLinks } = await svc.from("links").select("id, node_a_id, node_b_id, last_seen_at");
  const orphanIds: string[] = [];
  const staleIds: string[] = [];
  const now = Date.now();
  for (const l of allLinks ?? []) {
    if (!liveIds.has(l.node_a_id) || !liveIds.has(l.node_b_id)) {
      orphanIds.push(l.id);
      continue;
    }
    if (l.last_seen_at) {
      const ageMs = now - new Date(l.last_seen_at).getTime();
      if (ageMs > STALE_LINK_WINDOW_MS) staleIds.push(l.id);
    }
  }
  let cleaned = 0;
  if (orphanIds.length > 0) {
    const { error } = await svc.from("links").delete().in("id", orphanIds);
    if (!error) cleaned += orphanIds.length;
  }
  if (staleIds.length > 0) {
    const { error } = await svc.from("links").delete().in("id", staleIds);
    if (!error) cleaned += staleIds.length;
  }

  return {
    nodes: nodes.length,
    pairs: pairs.length,
    linked,
    refreshed,
    merged,
    cleaned,
  };
}

export async function POST(_req: NextRequest) {
  // Simple cooldown throttle. Multiple arena tabs polling at the same time
  // would otherwise dogpile Supabase. 10s is short enough that arcs still
  // feel live, long enough to smooth out concurrent triggers.
  const now = Date.now();
  if (now - lastRunAt < COOLDOWN_MS) {
    return NextResponse.json({ skipped: "cooldown" });
  }
  lastRunAt = now;

  try {
    const result = await runSweep();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("arena/sweep: uncaught", err?.message ?? err);
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 });
  }
}

// Allow GET for cron-style triggers + manual curl tests.
export async function GET(req: NextRequest) {
  return POST(req);
}
