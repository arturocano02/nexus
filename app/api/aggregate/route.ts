import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import type { CategoryAggregate } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  GET /api/aggregate
  Returns per-category aggregated output for the Arena, built from
  collective_scores (pre-computed on each deploy) joined to taxonomy.

  Falls back to computing from raw inferred_positions if collective_scores
  is empty (e.g. before the first deploy).
*/

function tensionFlag(yesPct: number): "agreed" | "contested" | "disputed" | "hot" {
  const gap = Math.abs(yesPct - (100 - yesPct));
  if (gap < 15) return "hot";
  if (yesPct > 70) return "agreed";
  if (yesPct < 30) return "disputed";
  return "contested";
}

export async function GET() {
  const svc = supabaseService();

  // Taxonomy
  const [catRes, subRes, scoresRes] = await Promise.all([
    svc.from("taxonomy_categories").select("id, slug, name, sort_order").order("sort_order"),
    svc.from("taxonomy_subtopics").select("id, category_id, name, sort_order").order("sort_order"),
    svc.from("collective_scores").select("*"),
  ]);

  const categories = catRes.data ?? [];
  const subtopics = subRes.data ?? [];
  const scores = scoresRes.data ?? [];

  // Build lookup: subtopic_id → collective_score row
  const scoreMap = new Map(scores.map((s: any) => [s.subtopic_id, s]));

  const results: CategoryAggregate[] = categories.map((cat) => {
    const catSubtopics = subtopics.filter((s) => s.category_id === cat.id);

    const subtopicAggregates = catSubtopics.map((sub) => {
      const score = scoreMap.get(sub.id) as any | undefined;
      const yesPct = score?.yes_weighted_pct ?? 50;
      const noPct  = score?.no_weighted_pct ?? 50;

      return {
        subtopic_id: sub.id,
        subtopic_name: sub.name,
        yes_weighted_pct: yesPct,
        no_weighted_pct: noPct,
        abstain_count: score?.abstain_count ?? 0,
        tension_flag: score?.tension_flag ?? tensionFlag(yesPct),
        total_responses: score?.total_responses ?? 0,
      };
    });

    // Category-level rollup: average across subtopics with responses
    const withData = subtopicAggregates.filter((s) => s.total_responses > 0);
    const catYesPct =
      withData.length > 0
        ? Math.round(withData.reduce((sum, s) => sum + s.yes_weighted_pct, 0) / withData.length)
        : 50;
    const catNoPct = 100 - catYesPct;
    const catTotal = subtopicAggregates.reduce((sum, s) => sum + s.total_responses, 0);
    const catAbstain = subtopicAggregates.reduce((sum, s) => sum + s.abstain_count, 0);

    // Top args: pull from scores of most-responded subtopics
    const topSubtopics = [...subtopicAggregates]
      .sort((a, b) => b.total_responses - a.total_responses)
      .slice(0, 2);
    const topYes: string[] = [];
    const topNo: string[] = [];
    for (const s of topSubtopics) {
      const sc = scoreMap.get(s.subtopic_id) as any | undefined;
      if (sc?.top_yes_args) topYes.push(...sc.top_yes_args);
      if (sc?.top_no_args)  topNo.push(...sc.top_no_args);
    }

    return {
      category_id: cat.id,
      category_slug: cat.slug,
      category_name: cat.name,
      total_responses: catTotal,
      yes_weighted_pct: catYesPct,
      no_weighted_pct: catNoPct,
      abstain_count: catAbstain,
      tension_flag: tensionFlag(catYesPct),
      top_yes_args: topYes.slice(0, 3),
      top_no_args: topNo.slice(0, 3),
      subtopics: subtopicAggregates,
    };
  });

  return NextResponse.json({ categories: results });
}
