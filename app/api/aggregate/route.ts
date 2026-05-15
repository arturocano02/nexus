import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import type { CategoryAggregate, QuestionAggregate } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tensionFlag(yesPct: number): "agreed" | "contested" | "disputed" | "hot" {
  const gap = Math.abs(yesPct - (100 - yesPct));
  if (gap < 15) return "hot";
  if (yesPct > 70) return "agreed";
  if (yesPct < 30) return "disputed";
  return "contested";
}

// -----------------------------------------------------------------------
// Deduplicate similar arguments by Jaccard word overlap > 60%
// Input must be sorted by confidence descending
// -----------------------------------------------------------------------
function deduplicateArgs(
  args: { text: string; confidence: number }[]
): string[] {
  const kept: { text: string; words: Set<string> }[] = [];
  for (const arg of args) {
    if (!arg.text.trim()) continue;
    const words = new Set(arg.text.toLowerCase().split(/\W+/).filter(Boolean));
    const isDup = kept.some(k => {
      const intersection = [...words].filter(w => k.words.has(w)).length;
      const union = new Set([...words, ...k.words]).size;
      return union > 0 && intersection / union > 0.6;
    });
    if (!isDup) kept.push({ text: arg.text, words });
  }
  return kept.map(k => k.text);
}

// -----------------------------------------------------------------------
// POST /api/aggregate  — recompute collective_scores from public_question_stances
// -----------------------------------------------------------------------
export async function POST(_req: NextRequest) {
  const svc = supabaseService();

  const { data: stances } = await svc
    .from("public_question_stances")
    .select("question_id, category_id, stance, confidence, core_argument");

  if (!stances?.length) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  // Group by question_id
  const groups = new Map<string, typeof stances>();
  for (const s of stances) {
    if (!groups.has(s.question_id)) groups.set(s.question_id, []);
    groups.get(s.question_id)!.push(s);
  }

  let updated = 0;

  for (const [questionId, rows] of groups) {
    const yes     = rows.filter(r => r.stance === "yes");
    const no      = rows.filter(r => r.stance === "no");
    const abstain = rows.filter(r => r.stance === "abstain");

    const totalWeight = rows.reduce((s, r) => s + Number(r.confidence ?? 0.5), 0);
    const yesWeight   = yes.reduce((s, r)  => s + Number(r.confidence ?? 0.5), 0);
    const noWeight    = no.reduce((s, r)   => s + Number(r.confidence ?? 0.5), 0);

    const yes_weighted_pct = totalWeight > 0 ? Math.round((yesWeight / totalWeight) * 100) : 50;
    const no_weighted_pct  = totalWeight > 0 ? Math.round((noWeight  / totalWeight) * 100) : 50;

    // Top args: sort by confidence desc, deduplicate, take 3
    const sortedYes = [...yes].sort((a, b) => Number(b.confidence) - Number(a.confidence))
      .map(r => ({ text: r.core_argument ?? "", confidence: Number(r.confidence) }));
    const sortedNo  = [...no].sort((a, b) => Number(b.confidence) - Number(a.confidence))
      .map(r => ({ text: r.core_argument ?? "", confidence: Number(r.confidence) }));

    const top_yes_args = deduplicateArgs(sortedYes).slice(0, 3);
    const top_no_args  = deduplicateArgs(sortedNo).slice(0, 3);

    const scoreData = {
      question_id:      questionId,
      category_id:      rows[0].category_id ?? null,
      yes_count:        yes.length,
      no_count:         no.length,
      abstain_count:    abstain.length,
      yes_weighted_pct,
      no_weighted_pct,
      top_yes_args,
      top_no_args,
      tension_flag:     tensionFlag(yes_weighted_pct),
      computed_at:      new Date().toISOString(),
    };

    const { data: existing } = await svc
      .from("collective_scores")
      .select("id")
      .eq("question_id", questionId)
      .maybeSingle();

    if (existing) {
      await svc.from("collective_scores").update(scoreData).eq("id", existing.id);
    } else {
      await svc.from("collective_scores").insert(scoreData);
    }

    updated++;
  }

  return NextResponse.json({ ok: true, updated });
}

// -----------------------------------------------------------------------
// GET /api/aggregate  — returns CategoryAggregate[] for the arena globe
// Reads collective_scores (keyed by question_id) joined with questions table
// -----------------------------------------------------------------------
export async function GET() {
  const svc = supabaseService();

  const [catRes, qRes, scoresRes] = await Promise.all([
    svc.from("taxonomy_categories").select("id, slug, name, sort_order").order("sort_order"),
    svc.from("questions").select("id, category_id, question_text, layer").in("layer", [1, 2]).order("layer"),
    svc.from("collective_scores").select("*").not("question_id", "is", null),
  ]);

  const categories = catRes.data ?? [];
  const questions  = qRes.data ?? [];
  const scores     = scoresRes.data ?? [];

  // question_id → score row
  const scoreMap = new Map(scores.map((s: any) => [s.question_id as string, s]));

  const results: CategoryAggregate[] = categories.map((cat) => {
    const catQuestions = questions.filter(q => q.category_id === cat.id);

    const questionAggregates: QuestionAggregate[] = catQuestions.map(q => {
      const score = scoreMap.get(q.id) as any | undefined;
      return {
        question_id:      q.id,
        question_text:    q.question_text,
        yes_count:        score?.yes_count    ?? 0,
        no_count:         score?.no_count     ?? 0,
        abstain_count:    score?.abstain_count ?? 0,
        yes_weighted_pct: score?.yes_weighted_pct ?? 50,
        no_weighted_pct:  score?.no_weighted_pct  ?? 50,
        top_yes_args:     score?.top_yes_args ?? [],
        top_no_args:      score?.top_no_args  ?? [],
      };
    });

    const withData = questionAggregates.filter(
      q => q.yes_count + q.no_count + q.abstain_count > 0
    );
    const catYesPct = withData.length > 0
      ? Math.round(withData.reduce((sum, q) => sum + q.yes_weighted_pct, 0) / withData.length)
      : 50;
    const catTotal   = questionAggregates.reduce((sum, q) => sum + q.yes_count + q.no_count + q.abstain_count, 0);
    const catAbstain = questionAggregates.reduce((sum, q) => sum + q.abstain_count, 0);

    // Top args: pull from most-responded questions
    const topQs = [...questionAggregates]
      .sort((a, b) => (b.yes_count + b.no_count) - (a.yes_count + a.no_count))
      .slice(0, 2);
    const topYes: string[] = [];
    const topNo:  string[] = [];
    for (const q of topQs) {
      topYes.push(...q.top_yes_args);
      topNo.push(...q.top_no_args);
    }

    return {
      category_id:      cat.id,
      category_slug:    cat.slug,
      category_name:    cat.name,
      total_responses:  catTotal,
      yes_weighted_pct: catYesPct,
      no_weighted_pct:  100 - catYesPct,
      abstain_count:    catAbstain,
      tension_flag:     tensionFlag(catYesPct),
      top_yes_args:     topYes.slice(0, 3),
      top_no_args:      topNo.slice(0, 3),
      subtopics:        [], // kept for type compat, questions array is the source of truth
      questions:        questionAggregates,
    };
  });

  return NextResponse.json({ categories: results });
}
