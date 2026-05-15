import { NextRequest, NextResponse } from "next/server";
import { anthropic, MODEL } from "@/lib/anthropic";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  GET  /api/manifesto
    Returns agreed collective positions organised by category.
    Reads collective_scores keyed by question_id, joins with questions table.

  POST /api/manifesto
    Generates a political manifesto from agreed + contested positions.
*/

// -----------------------------------------------------------------------
// Shared: load agreed/contested scores with question text and category name
// -----------------------------------------------------------------------
async function loadPositions(
  svc: ReturnType<typeof supabaseService>,
  flags: string[],
) {
  const { data: scores } = await svc
    .from("collective_scores")
    .select("question_id, category_id, yes_count, no_count, abstain_count, yes_weighted_pct, no_weighted_pct, top_yes_args, top_no_args, tension_flag")
    .in("tension_flag", flags)
    .not("question_id", "is", null)
    .order("yes_count", { ascending: false });

  if (!scores?.length) return { sections: [], scores: [] };

  const questionIds = scores.map((r: any) => r.question_id).filter(Boolean);
  const categoryIds = [...new Set(scores.map((r: any) => r.category_id).filter(Boolean))];

  const [{ data: questions }, { data: cats }] = await Promise.all([
    svc.from("questions").select("id, question_text").in("id", questionIds),
    svc.from("taxonomy_categories").select("id, name").in("id", categoryIds),
  ]);

  const qMap   = new Map((questions ?? []).map((q: any) => [q.id, q.question_text as string]));
  const catMap = new Map((cats ?? []).map((c: any) => [c.id, c.name as string]));

  // Group by category
  const byCategory = new Map<string, any>();
  for (const row of scores) {
    const catId = (row as any).category_id ?? "unknown";
    if (!byCategory.has(catId)) {
      byCategory.set(catId, {
        category_id: catId,
        category_name: catMap.get(catId) ?? "Unknown",
        positions: [],
      });
    }
    const total = ((row as any).yes_count ?? 0) + ((row as any).no_count ?? 0) + ((row as any).abstain_count ?? 0);
    byCategory.get(catId).positions.push({
      question_id:      (row as any).question_id,
      question_text:    qMap.get((row as any).question_id) ?? "Unknown",
      yes_pct:          (row as any).yes_weighted_pct,
      no_pct:           (row as any).no_weighted_pct,
      responses:        total,
      top_yes_args:     (row as any).top_yes_args ?? [],
      top_no_args:      (row as any).top_no_args ?? [],
      tension_flag:     (row as any).tension_flag,
    });
  }

  return { sections: Array.from(byCategory.values()), scores };
}

// -----------------------------------------------------------------------
// GET — raw agreed positions
// -----------------------------------------------------------------------
export async function GET() {
  const svc = supabaseService();
  const { sections, scores } = await loadPositions(svc, ["agreed"]);

  if (!scores.length) {
    return NextResponse.json({ sections: [], total: 0 });
  }

  return NextResponse.json({ sections, total: scores.length });
}

// -----------------------------------------------------------------------
// POST — generate manifesto prose
// -----------------------------------------------------------------------
export async function POST(_req: NextRequest) {
  const svc = supabaseService();
  const { sections, scores } = await loadPositions(svc, ["agreed", "contested"]);

  if (!scores.length) {
    return NextResponse.json({ manifesto: null, reason: "no_data" });
  }

  const sectionText = sections.map((cat: any) =>
    cat.positions.map((p: any) => {
      const direction = p.yes_pct >= 50 ? "YES" : "NO";
      const strength  = p.tension_flag === "agreed" ? "strong consensus" : "lean";
      const topArgs: string[] = direction === "YES" ? p.top_yes_args : p.top_no_args;
      return [
        `[${cat.category_name}] ${p.question_text}`,
        `Collective: ${direction} (${p.yes_pct}% yes, ${strength}, ${p.responses} responses)`,
        topArgs.length > 0 ? `Key arguments: ${topArgs.slice(0, 2).join(" | ")}` : "",
      ].filter(Boolean).join("\n");
    }).join("\n\n")
  ).join("\n\n---\n\n");

  const prompt = `You are drafting a collective political manifesto for a UK civic platform called Nexo.

The following are collectively-agreed political positions derived from weighted deliberative conversations:

${sectionText}

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
  return NextResponse.json({ manifesto, positions_used: scores.length });
}
