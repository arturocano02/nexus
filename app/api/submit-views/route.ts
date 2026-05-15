import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  POST /api/submit-views
  Body: {
    positions: Array<{
      id:            string   — inferred_positions.id
      question_id:   string
      category_id:   string | null
      stance:        "yes" | "no" | "abstain"
      core_argument: string
      confidence:    number   — 0..1
    }>
  }

  Pipeline:
  1. Update each inferred_position (stance, core_argument, confidence, deployed_at)
  2. Write anonymised rows to public_question_stances (one agent_id per batch)
  3. Trigger aggregate recompute (POST /api/aggregate)
*/

interface PositionPayload {
  id: string;
  question_id: string;
  category_id: string | null;
  stance: "yes" | "no" | "abstain";
  core_argument: string;
  confidence: number;
}

export async function POST(req: NextRequest) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json() as { positions?: PositionPayload[] };
  const positions: PositionPayload[] = Array.isArray(body.positions) ? body.positions : [];

  if (!positions.length) {
    return NextResponse.json({ deployed_count: 0, message: "nothing_to_deploy" });
  }

  const svc = supabaseService();
  const now = new Date().toISOString();
  const agentId = randomUUID();

  // 1. Update inferred_positions in parallel
  await Promise.allSettled(
    positions.map(p =>
      svc
        .from("inferred_positions")
        .update({
          stance: p.stance,
          core_argument: p.core_argument.slice(0, 500),
          confidence: Math.max(0, Math.min(1, p.confidence)),
          deployed_at: now,
          updated_at: now,
        })
        .eq("id", p.id)
        .eq("user_id", user.id) // safety: only touch own rows
    )
  );

  // 2. Write anonymised stances to public_question_stances
  const stanceRows = positions.map(p => ({
    agent_id: agentId,
    question_id: p.question_id,
    category_id: p.category_id ?? null,
    stance: p.stance,
    confidence: Math.max(0, Math.min(1, p.confidence)),
    core_argument: p.core_argument.slice(0, 500) || null,
  }));

  await svc.from("public_question_stances").insert(stanceRows);

  // 3. Trigger aggregate recompute (fire-and-forget)
  try {
    const origin = new URL(req.url).origin;
    fetch(`${origin}/api/aggregate`, { method: "POST" }).catch(() => {});
  } catch { /* non-critical */ }

  return NextResponse.json({
    deployed_count: positions.length,
    agent_id: agentId,
    deployed_at: now,
  });
}
