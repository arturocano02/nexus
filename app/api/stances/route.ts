import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Draft-stance read/write endpoint.

  POST upserts one or more draft stances for the signed-in user. A draft
  is a provisional for/against/skip on a manifesto clause. Nothing in the
  public graph moves as a result of this call: drafts are private until
  the user clicks submit.

  GET returns the current user's drafts joined with the clause text so a
  review screen can show "here's what I said during chat, confirm or
  change before I broadcast".
*/

interface IncomingStance {
  clause_id: string;
  stance: "for" | "against" | "skip";
  reasoning?: string | null;
  confidence?: number | null;
  source?: "direct" | "inferred" | "prompt" | null;
}

export async function POST(req: NextRequest) {
  const supa = await supabaseServer();
  const { data: u } = await supa.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await req.json()) as { stances?: IncomingStance[] };
  const stances = Array.isArray(body.stances) ? body.stances : [];
  const clean = stances.filter(
    (s) =>
      s &&
      typeof s.clause_id === "string" &&
      (s.stance === "for" || s.stance === "against" || s.stance === "skip"),
  );
  if (clean.length === 0) return NextResponse.json({ upserted: 0 });

  const svc = supabaseService();
  const rows = clean.map((s) => ({
    user_id: u.user.id,
    clause_id: s.clause_id,
    stance: s.stance,
    reasoning: s.reasoning?.toString().slice(0, 400) ?? null,
    confidence: typeof s.confidence === "number" ? Math.max(0, Math.min(1, s.confidence)) : 0.6,
    source: s.source ?? "inferred",
  }));

  const { error } = await svc
    .from("draft_stances")
    .upsert(rows, { onConflict: "user_id,clause_id" });

  if (error) {
    console.error("draft_stances upsert failed", error.message);
    return NextResponse.json({ error: "upsert_failed" }, { status: 500 });
  }
  return NextResponse.json({ upserted: rows.length });
}

export async function GET() {
  const supa = await supabaseServer();
  const { data: u } = await supa.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const svc = supabaseService();
  const { data: drafts } = await svc
    .from("draft_stances")
    .select("clause_id, stance, reasoning, confidence, source, updated_at")
    .eq("user_id", u.user.id);

  const clauseIds = (drafts ?? []).map((d) => d.clause_id);
  if (clauseIds.length === 0) return NextResponse.json({ drafts: [] });

  const { data: clauses } = await svc
    .from("manifesto_clauses")
    .select("id, section, statement, category_id")
    .in("id", clauseIds);

  const byId = new Map((clauses ?? []).map((c: any) => [c.id, c]));
  const joined = (drafts ?? []).map((d) => ({
    ...d,
    clause: byId.get(d.clause_id) ?? null,
  }));
  return NextResponse.json({ drafts: joined });
}
