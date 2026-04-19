import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Promote the signed-in user's draft_stances into user_stances. This is
  the ONLY place a regular user (i.e. not the simulator) can move the
  public aggregates. The upsert inside promote_draft_stances() fires the
  existing on_stance_change trigger, which recomputes
  manifesto_clauses.agreement_pct for every clause that was touched.

  Returns the new agreement_pct for each clause the user weighed in on
  so the client can animate the graph deltas without a full refetch.
*/

export async function POST() {
  const supa = await supabaseServer();
  const { data: u } = await supa.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const svc = supabaseService();

  // Capture which clauses the user had drafts on BEFORE we delete them,
  // so we can return fresh aggregates for just those clauses afterwards.
  const { data: drafts } = await svc
    .from("draft_stances")
    .select("clause_id")
    .eq("user_id", u.user.id);
  const touchedClauseIds = Array.from(new Set((drafts ?? []).map((d) => d.clause_id)));

  const { data: promoted, error: rpcErr } = await svc.rpc("promote_draft_stances", {
    p_user_id: u.user.id,
    p_simulated: false,
  });
  if (rpcErr) {
    console.error("promote_draft_stances failed", rpcErr.message);
    return NextResponse.json({ error: "promote_failed" }, { status: 500 });
  }

  let updated: any[] = [];
  if (touchedClauseIds.length > 0) {
    const { data: rows } = await svc
      .from("manifesto_clauses")
      .select("id, section, statement, agreement_pct, stance_count")
      .in("id", touchedClauseIds);
    updated = rows ?? [];
  }

  return NextResponse.json({
    promoted: typeof promoted === "number" ? promoted : 0,
    clauses: updated,
  });
}
