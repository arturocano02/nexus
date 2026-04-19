import { NextRequest, NextResponse } from "next/server";
import { anthropic, MODEL } from "@/lib/anthropic";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { getTopDebateCandidates } from "@/lib/debate_router";
import { processSemanticConnections } from "@/lib/semantic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 100% Claude-driven submission engine. No OpenAI dependencies.
 */

interface ReviewItem {
  topic_label: string;
  text: string;
  include: boolean;
  source_excerpts: string[];
  personal_argument_id: string;
  linked_node_id?: string;
}

export async function GET() {
  const supa = await supabaseServer();
  const { data: u } = await supa.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: args } = await supa
    .from("personal_arguments")
    .select("id, topic_label, summary, raw_excerpts")
    .eq("user_id", u.user.id)
    .eq("submitted", false);

  const items = args ?? [];
  if (items.length === 0) return NextResponse.json({ items: [] });

  let polished: { topic_label: string; summary: string }[] = items.map(a => ({
    topic_label: a.topic_label,
    summary: a.summary
  }));

  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: "You are the Nexus Polisher. Your only job is to take raw, rambling political opinions and sharpen them into a single, punchy, sophisticated first-person statement (max 60 words). Return ONLY JSON: { items: [{ topic_label: string, summary: string }] }",
      messages: [{ role: "user", content: `Polish these views: ${JSON.stringify(polished)}` }],
    });
    const content = resp.content.find(c => c.type === 'text')?.text;
    if (content) {
      const j = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
      if (Array.isArray(j.items)) polished = j.items;
    }
  } catch (err) {
    console.warn("Polishing failed, falling back to raw text", err);
  }

  const review: ReviewItem[] = items.map((a, i) => ({
    topic_label: polished[i]?.topic_label ?? a.topic_label,
    text: polished[i]?.summary ?? a.summary,
    include: true,
    source_excerpts: (a.raw_excerpts as any[] ?? []).map((e: any) => e.text),
    personal_argument_id: a.id,
  }));

  return NextResponse.json({ items: review });
}

export async function POST(req: NextRequest) {
  const supa = await supabaseServer();
  const { data: u } = await supa.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await req.json()) as { items: ReviewItem[]; anonymous: boolean };
  const items = (body.items ?? []).filter(i => i.include);
  const svc = supabaseService();

  // Submitting also promotes any draft clause stances the user picked up
  // during chat. This is the one place (outside the simulator) that moves
  // manifesto_clauses aggregates.
  const { data: promoted } = await svc.rpc("promote_draft_stances", {
    p_user_id: u.user.id,
    p_simulated: false,
  });
  const promotedStances = typeof promoted === "number" ? promoted : 0;

  if (items.length === 0) {
    return NextResponse.json({ inserted: 0, promoted_stances: promotedStances });
  }

  let inserted = 0;

  const { count } = await svc.from("agents").select("*", { count: 'exact', head: true }).eq("user_id", u.user.id);
  const isFirstTime = (count || 0) === 0;

  for (const item of items) {
    // Audit check: Ensuring topic_label is Title Case and clean
    const cleanLabel = item.topic_label.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

    const { data: existing } = await svc
      .from("public_nodes")
      .select("id")
      .ilike("topic_label", cleanLabel)
      .maybeSingle();

    let nodeId: string;
    if (existing) {
      nodeId = existing.id;
      await svc.from("public_nodes").update({ is_debating: true }).eq("id", nodeId);
    } else {
      const { data: created, error: createErr } = await svc.from("public_nodes").insert({
        topic_label: cleanLabel,
        consensus_summary: item.text,
        top_points: [item.text],
        is_debating: true
      }).select("id").single();

      if (createErr || !created) {
        console.error("Public node creation failed", createErr);
        continue;
      }
      nodeId = created.id;
    }

    await svc.from("agents").upsert({
      user_id: u.user.id,
      public_node_id: nodeId,
      argument_set: { topic_label: cleanLabel, text: item.text, source_excerpts: item.source_excerpts },
      is_active: true,
      is_anonymous: body.anonymous
    });

    await svc.from("personal_arguments").update({ submitted: true, summary: item.text }).eq("id", item.personal_argument_id);

    if (item.linked_node_id) {
      await svc.from("links").insert({
        node_a_id: nodeId,
        node_b_id: item.linked_node_id,
        similarity_score: 1.0,
        is_user_confirmed: true,
        particle_direction: 'a_to_b'
      });
    }

    // Semantic discovery still runs so arcs can form between related nodes
    // on the arena map. This is cheap and unrelated to the AI-vs-AI debate.
    processSemanticConnections(nodeId, 'public').catch(e => console.error("Discovery error:", e));

    // AI-vs-AI debate is OFF by default. Consensus now comes from real user
    // stances on manifesto clauses (see migration 0422/0423 and the
    // /api/simulate, /api/stances/submit flows). Set ENABLE_AGENT_DEBATE=1
    // in env to re-enable the old debate router for comparison experiments.
    if (process.env.ENABLE_AGENT_DEBATE === "1") {
      const candidates = await getTopDebateCandidates(u.user.id, cleanLabel, item.text, isFirstTime);
      const origin = req.nextUrl.origin;
      for (const cid of candidates) {
        fetch(`${origin}/api/debate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-debate-secret": process.env.DEBATE_WEBHOOK_SECRET || ""
          },
          body: JSON.stringify({ public_node_id: cid }),
        }).catch(e => console.error("Debate trigger fail:", e));
      }
    }

    inserted++;
  }

  return NextResponse.json({
    inserted,
    promoted_stances: promotedStances,
    status: "success",
  });
}
