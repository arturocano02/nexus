import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Confirm merge: the user accepted the merge preview. We:
    1. Keep node A as the surviving merged node (update label/summary/excerpts).
    2. Move B's excerpts into A, delete B.
    3. Re-route any links pointing at B to A.
    4. Record the merge in merged_nodes for an audit trail.
  All via the service role so RLS never gets in the way of the merge.
*/

interface Body {
  original_node_a_id: string;
  original_node_b_id: string;
  merged_label: string;
  merged_summary: string;
  top_points_to_keep: string[];
}

export async function POST(req: NextRequest) {
  const supa = supabaseServer();
  const { data: u } = await supa.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = u.user.id;
  const svc = supabaseService();
  const body = (await req.json()) as Body;

  const { data: a } = await svc
    .from("personal_arguments")
    .select("*")
    .eq("id", body.original_node_a_id)
    .eq("user_id", userId)
    .maybeSingle();
  const { data: b } = await svc
    .from("personal_arguments")
    .select("*")
    .eq("id", body.original_node_b_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!a || !b) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const mergedExcerpts = [
    ...((a.raw_excerpts as any[]) ?? []),
    ...((b.raw_excerpts as any[]) ?? []),
    ...body.top_points_to_keep.map((t) => ({ text: t, ts: new Date().toISOString() })),
  ];

  await svc
    .from("personal_arguments")
    .update({
      topic_label: body.merged_label,
      summary: body.merged_summary,
      raw_excerpts: mergedExcerpts,
      word_count:
        Number((a as any).word_count ?? 0) + Number((b as any).word_count ?? 0),
      confidence_score: Math.max(
        Number(a.confidence_score ?? 0),
        Number(b.confidence_score ?? 0),
      ),
    })
    .eq("id", a.id);

  // Re-point links from b -> a, then de-dupe / delete self-links.
  await svc.from("links").update({ node_a_id: a.id }).eq("node_a_id", b.id);
  await svc.from("links").update({ node_b_id: a.id }).eq("node_b_id", b.id);
  await svc.from("links").delete().eq("node_a_id", a.id).eq("node_b_id", a.id);

  await svc.from("personal_arguments").delete().eq("id", b.id);

  await svc.from("merged_nodes").insert({
    user_id: userId,
    original_node_a_id: a.id,
    original_node_b_id: b.id,
    merged_node_id: a.id,
    merged_label: body.merged_label,
    merged_summary: body.merged_summary,
    top_points: body.top_points_to_keep,
    merged_by_user: true,
  });

  return NextResponse.json({ merged_node_id: a.id });
}
