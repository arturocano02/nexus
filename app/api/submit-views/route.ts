import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { anthropic, MODEL } from "@/lib/anthropic";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  POST /api/submit-views
  Full pipeline:
  1.  Mark views submitted + stamp agent_id
  2.  Moderation check per view (100 tokens, parallel)
  3.  Update inferred_positions.deployed_at for safe views
  4.  Upsert public_nodes with merged consensus_summary
  5.  Fire aggregate refresh (side-effect only — collective_scores already live)
  6.  Return rich response
*/

// -----------------------------------------------------------------------
// Moderation check
// -----------------------------------------------------------------------
interface ModResult {
  is_safe: boolean;
  category: "safe" | "hate_speech" | "incitement" | "spam" | "personal_attack";
}

async function moderateView(summary: string): Promise<ModResult> {
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 100,
      messages: [{
        role: "user",
        content: `Is this political opinion safe for a public debate platform? Opinion: ${summary}. Return JSON only: {"is_safe":true,"category":"safe"}`,
      }],
    });
    const raw = resp.content.find(c => c.type === "text")?.text ?? "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return { is_safe: true, category: "safe" };
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return {
      is_safe: !!parsed.is_safe,
      category: parsed.category ?? "safe",
    };
  } catch {
    // Fail open — don't block submission on API errors
    return { is_safe: true, category: "safe" };
  }
}

// -----------------------------------------------------------------------
// Consensus merge — called when public_node already has a summary
// -----------------------------------------------------------------------
async function mergeSummaries(existing: string, incoming: string): Promise<string> {
  if (!existing.trim()) return incoming;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 100,
      messages: [{
        role: "user",
        content: `Merge these two political opinion summaries into one coherent sentence (max 25 words). Return only the merged text, no quotes. Summary 1: ${existing}. New view: ${incoming}.`,
      }],
    });
    const merged = resp.content.find(c => c.type === "text")?.text?.trim() ?? "";
    return merged || incoming;
  } catch {
    return existing;
  }
}

// -----------------------------------------------------------------------
// Main handler
// -----------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const svc = supabaseService();
  const now = new Date().toISOString();

  // ---- Fetch profile for last_submitted_at filter ----
  const { data: profile } = await svc
    .from("profiles")
    .select("last_submitted_at")
    .eq("id", user.id)
    .maybeSingle();
  const lastSubmittedAt = profile?.last_submitted_at ?? null;

  // ---- Fetch unsubmitted views (new since last deploy) ----
  let query = svc
    .from("user_views")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_deleted", false)
    .eq("submitted_to_arena", false);
  if (lastSubmittedAt) query = (query as any).gt("created_at", lastSubmittedAt);

  const { data: views, error: fetchErr } = await query;
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!views || views.length === 0) {
    return NextResponse.json({ submitted_count: 0, skipped_count: 0, submitted: [], message: "no_new_views" });
  }

  // ---- Step 1: Generate agent_id, mark all submitted ----
  const agentId = randomUUID();
  const ids = views.map((v: any) => v.id);

  const { error: updateErr } = await svc
    .from("user_views")
    .update({ submitted_to_arena: true, submitted_at: now, agent_id: agentId })
    .in("id", ids);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await svc.from("profiles").update({ last_submitted_at: now }).eq("id", user.id);

  // ---- Load taxonomy for category matching ----
  const { data: catRows } = await svc
    .from("taxonomy_categories")
    .select("id, name, slug");
  const categories: { id: string; name: string; slug: string }[] = catRows ?? [];
  const catByName = new Map(categories.map(c => [c.name.toLowerCase(), c]));

  // ---- Load collective_scores for agreement_pct lookup (by category_id) ----
  const { data: scoreRows } = await svc
    .from("collective_scores")
    .select("category_id, yes_weighted_pct, total_responses");
  const allScores: { category_id: string; yes_weighted_pct: number; total_responses: number }[] = scoreRows ?? [];

  function agreementPctForCategory(catId: string): number {
    const catScores = allScores.filter(s => s.category_id === catId && s.total_responses > 0);
    if (!catScores.length) return 50;
    return Math.round(catScores.reduce((sum, s) => sum + s.yes_weighted_pct, 0) / catScores.length);
  }

  // ---- Steps 2–4: Moderate + process each view (parallel) ----
  const submitted: { view: any; category_name: string }[] = [];
  let skippedCount = 0;

  await Promise.allSettled(
    views.map(async (view: any) => {
      // Step 2: Moderation
      const modResult = await moderateView(view.summary || view.topic_label);
      if (!modResult.is_safe) {
        skippedCount++;
        await svc.from("moderation_log").insert({
          user_id: user.id,
          content: view.summary,
          source: "submit",
          category: modResult.category,
          is_safe: false,
          model_name: MODEL,
        });
        return;
      }

      // Find matching taxonomy category
      const category = catByName.get(view.topic_label?.toLowerCase());
      const categoryName = category?.name ?? view.topic_label;

      submitted.push({ view, category_name: categoryName });

      if (!category) return; // no taxonomy match — view submitted but no further pipeline

      // Step 3: Mark inferred_positions deployed_at
      await svc
        .from("inferred_positions")
        .update({ deployed_at: now })
        .eq("user_id", user.id)
        .eq("category_id", category.id)
        .is("deployed_at", null);

      // Step 4: Upsert public_nodes
      const agreementPct = agreementPctForCategory(category.id);
      const { data: existingNode } = await svc
        .from("public_nodes")
        .select("id, consensus_summary, contributor_count")
        .eq("category_id", category.id)
        .maybeSingle();

      if (existingNode) {
        const merged = await mergeSummaries(existingNode.consensus_summary, view.summary);
        await svc.from("public_nodes").update({
          consensus_summary: merged,
          agreement_pct: agreementPct,
          contributor_count: existingNode.contributor_count + 1,
          updated_at: now,
        }).eq("id", existingNode.id);
      } else {
        await svc.from("public_nodes").insert({
          category_id: category.id,
          topic_label: category.name,
          consensus_summary: view.summary ?? "",
          agreement_pct: agreementPct,
          contributor_count: 1,
        });
      }
    })
  );

  // ---- Step 5: Fire aggregate refresh (collective_scores already live via
  //              advisor classification pipeline; this triggers any caches) ----
  try {
    const baseUrl = new URL(req.url).origin;
    fetch(`${baseUrl}/api/aggregate`).catch(() => {});
  } catch { /* non-critical */ }

  // ---- Step 6: Rich response ----
  const submittedViews = submitted.map(({ view, category_name }) => ({
    ...view,
    submitted_to_arena: true,
    submitted_at: now,
    agent_id: agentId,
    category_name,
  }));

  return NextResponse.json({
    submitted_count: submitted.length,
    skipped_count: skippedCount,
    agent_id: agentId,
    submitted_at: now,
    submitted: submittedViews,
  });
}
