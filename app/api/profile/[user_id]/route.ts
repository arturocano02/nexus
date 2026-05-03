import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  GET /api/profile/[user_id]

  Returns a user's publicly visible deployed positions, grouped by category.

  Response:
  {
    user: { id, display_name, created_at }
    categories: [
      {
        category_id, category_name, category_slug,
        positions: [
          {
            subtopic_id, subtopic_name,
            stance: "yes"|"no"|"abstain",
            argument: string | null,
            weight_total: number | null,
            weight_d, weight_q, weight_c,
            deployed_at
          }
        ]
      }
    ]
    total_positions: number
  }
*/
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ user_id: string }> }
) {
  const { user_id: userId } = await params;
  if (!userId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const svc = supabaseService();

  // Fetch profile (public display name)
  const { data: profile } = await svc
    .from("profiles")
    .select("id, display_name, created_at")
    .eq("id", userId)
    .maybeSingle();

  // Fetch all deployed positions for this user
  // "Deployed" = submitted_to_arena is true on user_views,
  // or deployed_at is set on inferred_positions.
  // We use inferred_positions as the source of truth since it carries weights.
  const { data: positions } = await svc
    .from("inferred_positions")
    .select(`
      id,
      category_id,
      subtopic_id,
      stance,
      reasoning,
      arguments_json,
      weight_d,
      weight_q,
      weight_c,
      weight_total,
      deployed_at,
      updated_at
    `)
    .eq("user_id", userId)
    .not("deployed_at", "is", null)
    .in("stance", ["yes", "no", "abstain"])
    .order("deployed_at", { ascending: false });

  if (!positions || positions.length === 0) {
    return NextResponse.json({
      user: profile ?? { id: userId, display_name: "Anonymous", created_at: null },
      categories: [],
      total_positions: 0,
    });
  }

  // Collect unique IDs for lookups
  const categoryIds = [...new Set(positions.map((p: any) => p.category_id).filter(Boolean))];
  const subtopicIds = [...new Set(positions.map((p: any) => p.subtopic_id).filter(Boolean))];

  const [catRes, subRes] = await Promise.all([
    svc.from("taxonomy_categories").select("id, name, slug").in("id", categoryIds),
    svc.from("taxonomy_subtopics").select("id, name").in("id", subtopicIds),
  ]);

  const catMap = new Map<string, { name: string; slug: string }>(
    (catRes.data ?? []).map((c: any) => [c.id, { name: c.name, slug: c.slug }])
  );
  const subMap = new Map<string, string>(
    (subRes.data ?? []).map((s: any) => [s.id, s.name])
  );

  // Group by category
  const byCategory = new Map<string, any[]>();
  for (const pos of positions) {
    const catId = pos.category_id ?? "__unknown__";
    if (!byCategory.has(catId)) byCategory.set(catId, []);
    byCategory.get(catId)!.push(pos);
  }

  const categories = Array.from(byCategory.entries())
    .map(([catId, catPositions]) => {
      const cat = catMap.get(catId) ?? { name: "Unknown", slug: "unknown" };
      return {
        category_id: catId,
        category_name: cat.name,
        category_slug: cat.slug,
        positions: catPositions.map((p: any) => {
          const args: { text: string; ts: string }[] = p.arguments_json ?? [];
          return {
            subtopic_id: p.subtopic_id,
            subtopic_name: subMap.get(p.subtopic_id) ?? "Unknown topic",
            stance: p.stance,
            argument: args[0]?.text ?? p.reasoning ?? null,
            weight_total: p.weight_total,
            weight_d: p.weight_d,
            weight_q: p.weight_q,
            weight_c: p.weight_c,
            deployed_at: p.deployed_at,
          };
        }),
      };
    })
    .sort((a, b) => a.category_name.localeCompare(b.category_name));

  return NextResponse.json({
    user: profile ?? { id: userId, display_name: "Anonymous", created_at: null },
    categories,
    total_positions: positions.length,
  });
}
