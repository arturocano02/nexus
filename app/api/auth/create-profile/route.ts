import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { userId, username, display_name, advisor_name, age } = await req.json();

  if (!userId || !username || !display_name) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const supa = supabaseService();

  const { error } = await supa.from("profiles").insert({
    id: userId,
    username,
    display_name,
    advisor_name: advisor_name ?? null,
    age: age ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
