import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  DELETE /api/positions/[id]

  Retracts a single deployed position.
  - Sets retracted_at = now()
  - Marks user_views.submitted_to_arena = false if this was the only
    deployed position for that topic
  - Recomputes collective_scores for the affected subtopic

  Returns { ok: true, subtopic_id }
*/
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const svc = supabaseService();

  // Verify this position belongs to the user
  const { data: pos } = await svc
    .from("inferred_positions")
    .select("id, subtopic_id, category_id, user_id, deployed_at")
    .eq("id", id)
    .maybeSingle();

  if (!pos || pos.user_id !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Mark retracted
  await svc
    .from("inferred_positions")
    .update({ retracted_at: new Date().toISOString() })
    .eq("id", id);

  // Check if any other deployed+non-retracted positions exist for this subtopic
  const { count } = await svc
    .from("inferred_positions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("subtopic_id", pos.subtopic_id)
    .not("deployed_at", "is", null)
    .is("retracted_at", null);

  // If none left, un-submit the user_view for this topic
  if (!count || count === 0) {
    try {
      const { data: sub } = await svc
        .from("taxonomy_subtopics")
        .select("name")
        .eq("id", pos.subtopic_id)
        .maybeSingle();
      if (sub?.name) {
        await svc
          .from("user_views")
          .update({ submitted_to_arena: false })
          .eq("user_id", user.id)
          .eq("topic_label", sub.name)
          .eq("is_deleted", false);
      }
    } catch { /* user_views may not exist */ }
  }

  // Recompute collective score for this subtopic
  await recomputeSubtopic(svc, pos.subtopic_id, pos.category_id);

  return NextResponse.json({ ok: true, subtopic_id: pos.subtopic_id });
}

// ---------------------------------------------------------------------------
// Shared recompute helper
// ---------------------------------------------------------------------------
export async function recomputeSubtopic(
  svc: ReturnType<typeof supabaseService>,
  subtopicId: string,
  categoryId: string | null,
) {
  const { data: deployed } = await svc
    .from("inferred_positions")
    .select("stance, weight_total, arguments_json, category_id")
    .eq("subtopic_id", subtopicId)
    .not("deployed_at", "is", null)
    .is("retracted_at", null);

  if (!deployed || deployed.length === 0) {
    // No positions left — remove collective score entry
    await svc.from("collective_scores").delete().eq("subtopic_id", subtopicId);
    return;
  }

  let yesWeight = 0, noWeight = 0, abstainCount = 0;
  const yesArgs: string[] = [], noArgs: string[] = [];

  for (const p of deployed) {
    const w = typeof p.weight_total === "number" ? p.weight_total : 1;
    const args: { text: string }[] = Array.isArray(p.arguments_json) ? p.arguments_json : [];
    if (p.stance === "yes") {
      yesWeight += w;
      for (const a of args) if (a.text && yesArgs.length < 10) yesArgs.push(a.text);
    } else if (p.stance === "no") {
      noWeight += w;
      for (const a of args) if (a.text && noArgs.length < 10) noArgs.push(a.text);
    } else if (p.stance === "abstain") {
      abstainCount++;
    }
  }

  const total = yesWeight + noWeight;
  const yesPct = total > 0 ? Math.round((yesWeight / total) * 100) : 50;
  const noPct  = 100 - yesPct;
  const gap    = Math.abs(yesPct - noPct);
  const tensionFlag =
    gap < 15      ? "hot"
    : yesPct > 70 ? "agreed"
    : yesPct < 30 ? "disputed"
    : "contested";

  await svc.from("collective_scores").upsert(
    {
      subtopic_id: subtopicId,
      category_id: categoryId ?? deployed[0].category_id ?? null,
      total_responses: deployed.length,
      yes_weighted_pct: yesPct,
      no_weighted_pct: noPct,
      abstain_count: abstainCount,
      tension_flag: tensionFlag,
      top_yes_args: dedup(yesArgs).slice(0, 3),
      top_no_args: dedup(noArgs).slice(0, 3),
      computed_at: new Date().toISOString(),
    },
    { onConflict: "subtopic_id" },
  );
}

function dedup(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((s) => {
    const k = s.toLowerCase().slice(0, 60);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
