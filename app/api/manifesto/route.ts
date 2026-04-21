import { NextRequest, NextResponse } from "next/server";
import { anthropic, MODEL } from "@/lib/anthropic";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  GET  /api/manifesto
    Returns agreed collective positions (tension_flag = 'agreed') with
    their top arguments, organised by category.

  POST /api/manifesto
    Generates a political manifesto using Claude from agreed + strongly-leaning
    collective positions. Returns { manifesto: string }.
*/

// -----------------------------------------------------------------------
// GET — raw agreed positions
// -----------------------------------------------------------------------
export async function GET() {
  const svc = supabaseService();

  const { data: agreed } = await svc
    .from("collective_scores")
    .select("subtopic_id, category_id, yes_weighted_pct, no_weighted_pct, total_responses, top_yes_args, top_no_args")
    .eq("tension_flag", "agreed")
    .order("total_responses", { ascending: false });

  if (!agreed || agreed.length === 0) {
    return NextResponse.json({ sections: [], total: 0 });
  }

  const categoryIds = [...new Set(agreed.map((r: any) => r.category_id).filter(Boolean))];
  const subtopicIds = agreed.map((r: any) => r.subtopic_id);

  const [catRes, subRes] = await Promise.all([
    svc.from("taxonomy_categories").select("id, name").in("id", categoryIds),
    svc.from("taxonomy_subtopics").select("id, name").in("id", subtopicIds),
  ]);

  const catMap = new Map((catRes.data ?? []).map((c: any) => [c.id, c.name]));
  const subMap = new Map((subRes.data ?? []).map((s: any) => [s.id, s.name]));

  const byCategory = new Map<string, any>();
  for (const row of agreed) {
    const catId = row.category_id ?? "unknown";
    if (!byCategory.has(catId)) {
      byCategory.set(catId, {
        category_id: catId,
        category_name: catMap.get(catId) ?? "Unknown",
        positions: [],
      });
    }
    byCategory.get(catId).positions.push({
      subtopic_id: row.subtopic_id,
      subtopic_name: subMap.get(row.subtopic_id) ?? "Unknown",
      yes_pct: row.yes_weighted_pct,
      no_pct: row.no_weighted_pct,
      responses: row.total_responses,
      top_yes_args: row.top_yes_args ?? [],
      top_no_args: row.top_no_args ?? [],
    });
  }

  return NextResponse.json({
    sections: Array.from(byCategory.values()),
    total: agreed.length,
  });
}

// -----------------------------------------------------------------------
// POST — generate manifesto prose
// -----------------------------------------------------------------------
export async function POST(_req: NextRequest) {
  const svc = supabaseService();

  // Include agreed + contested-but-directional positions
  const { data: positions } = await svc
    .from("collective_scores")
    .select("subtopic_id, category_id, yes_weighted_pct, no_weighted_pct, total_responses, top_yes_args, top_no_args, tension_flag")
    .in("tension_flag", ["agreed", "contested"])
    .order("total_responses", { ascending: false });

  if (!positions || positions.length === 0) {
    return NextResponse.json({ manifesto: null, reason: "no_data" });
  }

  const subtopicIds = positions.map((r: any) => r.subtopic_id);
  const categoryIds = [...new Set(positions.map((r: any) => r.category_id).filter(Boolean))];

  const [catRes, subRes] = await Promise.all([
    svc.from("taxonomy_categories").select("id, name").in("id", categoryIds),
    svc.from("taxonomy_subtopics").select("id, name").in("id", subtopicIds),
  ]);

  const catMap = new Map((catRes.data ?? []).map((c: any) => [c.id, c.name]));
  const subMap = new Map((subRes.data ?? []).map((s: any) => [s.id, s.name]));

  const sections = positions.map((row: any) => {
    const direction = row.yes_weighted_pct >= 50 ? "YES" : "NO";
    const strength = row.tension_flag === "agreed" ? "strong consensus" : "lean";
    const topArgs: string[] = direction === "YES"
      ? (row.top_yes_args ?? [])
      : (row.top_no_args ?? []);
    return [
      `[${catMap.get(row.category_id) ?? "Unknown"} › ${subMap.get(row.subtopic_id) ?? "Unknown"}]`,
      `Collective: ${direction} (${row.yes_weighted_pct}% yes, ${strength}, ${row.total_responses} responses)`,
      topArgs.length > 0 ? `Key arguments: ${topArgs.slice(0, 2).join(" | ")}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  const prompt = `You are drafting a collective political manifesto for a UK civic platform called Nexo.

The following are collectively-agreed political positions derived from weighted deliberative conversations:

${sections}

Write a manifesto with these requirements:
- One short preamble paragraph explaining what Nexo is and how this manifesto was produced (collective deliberation, not top-down policy)
- Organised by policy area (use the category names above as section headings)
- Each section has 2-4 concrete, specific policy commitments derived directly from the agreed positions
- Where the collective leans YES, frame it as a commitment or pledge. Where they lean NO, frame it as a clear rejection or reform.
- Ground each commitment in the key arguments (use them as rationale, don't quote verbatim)
- Tone: direct, civic, confident — like a real UK party manifesto, not corporate speak
- Total length: 450-650 words
- Finish with a single bold closing sentence

Write only the manifesto. No meta-commentary or headers outside the document itself.`;

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1400,
    messages: [{ role: "user", content: prompt }],
  });

  const manifesto = resp.content.find((c) => c.type === "text")?.text ?? "";

  return NextResponse.json({ manifesto, positions_used: positions.length });
}
