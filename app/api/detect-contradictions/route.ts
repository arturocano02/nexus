import { NextRequest, NextResponse } from "next/server";
import { anthropic, MODEL } from "@/lib/anthropic";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  POST /api/detect-contradictions
  Body: { session_id?: string }   — optional; if omitted, scans all user positions

  Scans the current user's inferred_positions for logical contradictions and
  tension pairs, then writes them to contradiction_flags.

  Returns {
    found: number,
    flags: Array<{ position_a_id, position_b_id, description, severity }>
  }

  GET /api/detect-contradictions
  Returns existing (undismissed) contradiction flags for the current user,
  enriched with position details.
*/

// ---------------------------------------------------------------------------
// GET — fetch existing flags
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const svc = supabaseService();

  const { data: flags } = await svc
    .from("contradiction_flags")
    .select(`
      id,
      description,
      severity,
      created_at,
      position_a_id,
      position_b_id
    `)
    .eq("user_id", user.id)
    .is("dismissed_at", null)
    .order("created_at", { ascending: false });

  if (!flags || flags.length === 0) {
    return NextResponse.json({ flags: [] });
  }

  // Enrich with position details
  const posIds = [
    ...new Set([
      ...flags.map((f: any) => f.position_a_id),
      ...flags.map((f: any) => f.position_b_id),
    ])
  ];

  const { data: positions } = await svc
    .from("inferred_positions")
    .select("id, subtopic_id, stance, reasoning")
    .in("id", posIds);

  const subtopicIds = [...new Set((positions ?? []).map((p: any) => p.subtopic_id).filter(Boolean))];
  const { data: subtopics } = await svc
    .from("taxonomy_subtopics")
    .select("id, name")
    .in("id", subtopicIds);

  const posMap = new Map((positions ?? []).map((p: any) => [p.id, p]));
  const subMap = new Map((subtopics ?? []).map((s: any) => [s.id, s.name]));

  const enriched = (flags as any[]).map((f) => {
    const posA = posMap.get(f.position_a_id);
    const posB = posMap.get(f.position_b_id);
    return {
      id: f.id,
      description: f.description,
      severity: f.severity,
      created_at: f.created_at,
      position_a: posA ? {
        id: posA.id,
        subtopic_name: subMap.get(posA.subtopic_id) ?? "Unknown",
        stance: posA.stance,
      } : null,
      position_b: posB ? {
        id: posB.id,
        subtopic_name: subMap.get(posB.subtopic_id) ?? "Unknown",
        stance: posB.stance,
      } : null,
    };
  });

  return NextResponse.json({ flags: enriched });
}

// ---------------------------------------------------------------------------
// POST — detect and write contradiction flags
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { session_id?: string };
  const svc = supabaseService();

  // Fetch the user's positions — all deployed+non-retracted, or session-specific
  let positionsQuery = svc
    .from("inferred_positions")
    .select("id, subtopic_id, category_id, stance, reasoning, arguments_json, weight_d")
    .eq("user_id", user.id)
    .in("stance", ["yes", "no"])          // only definite stances can contradict
    .not("deployed_at", "is", null)
    .is("retracted_at", null);

  if (body.session_id) {
    positionsQuery = positionsQuery.eq("session_id", body.session_id);
  }

  const { data: positions } = await positionsQuery;

  if (!positions || positions.length < 2) {
    return NextResponse.json({ found: 0, flags: [] });
  }

  // Enrich with subtopic names and category names
  const subtopicIds = [...new Set(positions.map((p: any) => p.subtopic_id).filter(Boolean))];
  const categoryIds = [...new Set(positions.map((p: any) => p.category_id).filter(Boolean))];

  const [subRes, catRes] = await Promise.all([
    svc.from("taxonomy_subtopics").select("id, name").in("id", subtopicIds),
    svc.from("taxonomy_categories").select("id, name").in("id", categoryIds),
  ]);

  const subMap = new Map((subRes.data ?? []).map((s: any) => [s.id, s.name]));
  const catMap = new Map((catRes.data ?? []).map((c: any) => [c.id, c.name]));

  // Build a position list for Claude
  const positionList = (positions as any[]).map((p) => ({
    id: p.id,
    subtopic: subMap.get(p.subtopic_id) ?? "Unknown",
    category: catMap.get(p.category_id) ?? "Unknown",
    stance: p.stance,
    reasoning: p.reasoning ?? "",
  }));

  const positionText = positionList
    .map((p) => `[${p.id}] ${p.category} / ${p.subtopic}: ${p.stance.toUpperCase()} — ${p.reasoning}`)
    .join("\n");

  // Ask Claude to find contradictions
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: `These are a person's stated political positions. Find pairs that contradict or create significant logical tension with each other.

POSITIONS:
${positionText}

Find contradictions where:
- A person says YES to X but NO to something that logically depends on X
- Or two positions reflect genuinely incompatible values (e.g. "government should spend more" + "taxes should not rise")
- Or a position in one category undermines a position in another

For each contradiction pair:
- position_a_id: UUID from the list
- position_b_id: UUID from the list
- description: 1 sentence explaining the tension in plain English
- severity: "hard" (direct logical contradiction) or "soft" (value tension)

Skip trivial tensions. Focus on real contradictions that would challenge the person to reconsider.
Only flag pairs where confidence is high.

Return ONLY a JSON array: [{"position_a_id":"...","position_b_id":"...","description":"...","severity":"hard"}]
If no real contradictions exist, return []`,
      },
    ],
  });

  const raw = resp.content.find((c) => c.type === "text")?.text ?? "";
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");

  let detected: Array<{
    position_a_id: string;
    position_b_id: string;
    description: string;
    severity: "hard" | "soft";
  }> = [];

  if (start >= 0 && end > start) {
    try {
      detected = JSON.parse(raw.slice(start, end + 1));
    } catch { /* ignore parse errors */ }
  }

  // Validate IDs
  const validIds = new Set(positions.map((p: any) => p.id));
  const validFlags = detected.filter(
    (f) =>
      validIds.has(f.position_a_id) &&
      validIds.has(f.position_b_id) &&
      f.position_a_id !== f.position_b_id &&
      typeof f.description === "string" &&
      ["hard", "soft"].includes(f.severity)
  );

  if (validFlags.length === 0) {
    return NextResponse.json({ found: 0, flags: [] });
  }

  // Upsert to contradiction_flags — skip duplicates
  const now = new Date().toISOString();
  const written: typeof validFlags = [];

  for (const flag of validFlags) {
    // Ensure canonical order so the unique constraint works regardless of which is A vs B
    const [aId, bId] = [flag.position_a_id, flag.position_b_id].sort();
    try {
      await svc.from("contradiction_flags").upsert(
        {
          user_id: user.id,
          position_a_id: aId,
          position_b_id: bId,
          description: flag.description,
          severity: flag.severity,
          dismissed_at: null,
          created_at: now,
        },
        { onConflict: "user_id,position_a_id,position_b_id" }
      );
      written.push(flag);
    } catch { /* duplicate or table not yet created */ }
  }

  return NextResponse.json({ found: written.length, flags: written });
}

// ---------------------------------------------------------------------------
// PATCH /api/detect-contradictions — dismiss a flag
// Body: { flag_id: string }
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { flag_id } = await req.json() as { flag_id: string };
  if (!flag_id) return NextResponse.json({ error: "flag_id required" }, { status: 400 });

  const svc = supabaseService();

  await svc
    .from("contradiction_flags")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", flag_id)
    .eq("user_id", user.id); // RLS belt-and-suspenders

  return NextResponse.json({ ok: true });
}
