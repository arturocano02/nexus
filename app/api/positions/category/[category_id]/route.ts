import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { recomputeSubtopic } from "@/app/api/positions/[id]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  DELETE /api/positions/category/[category_id]

  Retracts ALL deployed positions for the current user in a given category.
  - Sets retracted_at = now() on all matching inferred_positions
  - Un-submits all matching user_views for this category
  - Recomputes collective_scores for all affected subtopics

  Returns { ok: true, retracted: number, subtopics_updated: string[] }
*/
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ category_id: string }> }
) {
  const { category_id } = await params;

  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!category_id) {
    return NextResponse.json({ error: "category_id required" }, { status: 400 });
  }

  const svc = supabaseService();

  // Find all deployed, non-retracted positions for this user+category
  const { data: positions } = await svc
    .from("inferred_positions")
    .select("id, subtopic_id")
    .eq("user_id", user.id)
    .eq("category_id", category_id)
    .not("deployed_at", "is", null)
    .is("retracted_at", null);

  if (!positions || positions.length === 0) {
    return NextResponse.json({ ok: true, retracted: 0, subtopics_updated: [] });
  }

  const now = new Date().toISOString();
  const positionIds = positions.map((p: any) => p.id);
  const subtopicIds = [...new Set(positions.map((p: any) => p.subtopic_id).filter(Boolean))] as string[];

  // Bulk retract
  await svc
    .from("inferred_positions")
    .update({ retracted_at: now })
    .in("id", positionIds);

  // Un-submit user_views for all affected subtopics
  try {
    const { data: subtopics } = await svc
      .from("taxonomy_subtopics")
      .select("id, name")
      .in("id", subtopicIds);

    const topicNames = (subtopics ?? []).map((s: any) => s.name);
    if (topicNames.length > 0) {
      await svc
        .from("user_views")
        .update({ submitted_to_arena: false })
        .eq("user_id", user.id)
        .in("topic_label", topicNames)
        .eq("is_deleted", false);
    }
  } catch { /* user_views may not exist */ }

  // Recompute collective scores for all affected subtopics
  await Promise.all(
    subtopicIds.map((sid) => recomputeSubtopic(svc, sid, category_id))
  );

  return NextResponse.json({
    ok: true,
    retracted: positionIds.length,
    subtopics_updated: subtopicIds,
  });
}
