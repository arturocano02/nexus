import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const { event_type, metadata } = await req.json().catch(() => ({}));
  if (!event_type) return NextResponse.json({ ok: false }, { status: 400 });

  try {
    const svc = supabaseService();
    await svc.from("auth_events").insert({
      user_id: user.id,
      event_type,
      metadata: metadata ?? null,
    });
  } catch { /* table may not exist yet */ }

  return NextResponse.json({ ok: true });
}
