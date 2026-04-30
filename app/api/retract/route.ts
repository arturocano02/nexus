import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  POST /api/retract
  Body: { position_id: string, retract: boolean }

  Marks an inferred_position as retracted (or un-retracts it).
  Retracting removes the weight from collective_scores but preserves
  the record and the consensus it already shaped.
*/

export async function POST(req: NextRequest) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { position_id, retract } = await req.json() as {
    position_id: string;
    retract: boolean;
  };
  if (!position_id) return NextResponse.json({ error: "position_id required" }, { status: 400 });

  const svc = supabaseService();

  // Verify ownership
  const { data: pos } = await svc
    .from("inferred_positions")
    .select("id, subtopic_id, user_id")
    .eq("id", position_id)
    .maybeSingle();

  if (!pos || pos.user_id !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await svc
    .from("inferred_positions")
    .update({ retracted_at: retract ? new Date().toISOString() : null })
    .eq("id", position_id);

  // Recompute collective score for this subtopic excluding retracted positions
  await recomputeSubtopic(svc, pos.subtopic_id);

  return NextResponse.json({ ok: true, retracted: retract });
}

async function recomputeSubtopic(
  svc: ReturnType<typeof supabaseService>,
  subtopicId: string,
) {
  const { data: deployed } = await svc
    .from("inferred_positions")
    .select("stance, weight_total, arguments_json, category_id")
    .eq("subtopic_id", subtopicId)
    .not("deployed_at", "is", null)
    .is("retracted_at", null); // exclude retracted

  if (!deployed || deployed.length === 0) return;

  let yesWeight = 0, noWeight = 0, abstainCount = 0;
  const yesArgs: string[] = [], noArgs: string[] = [];

  for (const p of deployed) {
    const w = typeof p.weight_total === "number" ? p.weight_total : 1;
    const args = Array.isArray(p.arguments_json) ? p.arguments_json : [];
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
      category_id: deployed[0].category_id ?? null,
      total_responses: deployed.length,
      yes_weighted_pct: yesPct,
      no_weighted_pct: noPct,
      abstain_count: abstainCount,
      tension_flag: tensionFlag,
      top_yes_args: yesArgs.slice(0, 3),
      top_no_args: noArgs.slice(0, 3),
      computed_at: new Date().toISOString(),
    },
    { onConflict: "subtopic_id" },
  );
}
