import { NextRequest, NextResponse } from "next/server";
import { anthropic, MODEL } from "@/lib/anthropic";
import { supabaseService } from "@/lib/supabase/service";
import { logDebateTokens } from "@/lib/token_logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MOD_SYSTEM = `You are a neutral debate moderator. Identify agreement and disagreement. 
Return JSON ONLY: { consensus_points: string[], unresolved_points: { position_a: string, position_b: string }[], agreement_pct: number, tension_coefficient: number, top_points: string[] }`;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-debate-secret");
  const expected = process.env.DEBATE_WEBHOOK_SECRET ?? "";
  if (expected && secret !== expected) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  if (!body.public_node_id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const svc = supabaseService();
  const { data: node } = await svc.from("public_nodes").select("*").eq("id", body.public_node_id).single();
  if (!node) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: agents } = await svc.from("agents").select("*").eq("public_node_id", node.id).order("created_at", { ascending: false }).limit(1);
  const latest = agents?.[0];
  if (!latest) return NextResponse.json({ skipped: true });

  const setA = { label: "consensus", points: [node.consensus_summary, ...node.top_points].filter(Boolean) };
  const setB = { label: "incoming", points: [(latest.argument_set as any).text].filter(Boolean) };

  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: MOD_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify({ set_a: setA, set_b: setB }) }],
    });

    const text = resp.content.find(c => c.type === 'text')?.text || "";
    const result = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

    // Log tokens
    const totalTokens = (resp.usage.input_tokens || 0) + (resp.usage.output_tokens || 0);
    logDebateTokens(node.id, totalTokens).catch(console.error);

    const noise = Math.max(0, Math.min(1, result.unresolved_points.length / 8));
    const resolved = result.tension_coefficient < 0.2 && result.agreement_pct >= 85;

    // RULE 2: Summary regeneration rules
    // Only regenerate if: round completes, agreement shifts > 15, or > 5 new excerpts
    const agreementShift = Math.abs(node.agreement_pct - result.agreement_pct);
    let newSummary = node.consensus_summary;

    if (agreementShift > 15 || (node.debate_log?.length % 3 === 0)) {
      const sumResp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 200,
        system: "Summarize the current political consensus for this topic in one punchy sentence.",
        messages: [{ role: "user", content: `Consensus Points: ${result.consensus_points.join("; ")}` }],
      });
      newSummary = sumResp.content.find(c => c.type === 'text')?.text || newSummary;
    }

    await svc.from("public_nodes").update({
      consensus_summary: newSummary,
      top_points: result.top_points.slice(0, 5),
      agreement_pct: result.agreement_pct,
      tension_coefficient: result.tension_coefficient,
      noise_saturation: noise,
      is_resolved: resolved,
      is_debating: false
    }).eq("id", node.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
