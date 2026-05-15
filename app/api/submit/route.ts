import { NextRequest, NextResponse } from "next/server";
import { anthropic, MODEL } from "@/lib/anthropic";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import type { ReviewItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  GET  /api/submit?session_id=xxx
    Returns all inferred_positions for this session enriched with
    category + subtopic names — ready to show in the ReviewPanel.

  POST /api/submit
    Computes W = D × Q × C for every inferred_position in the session,
    marks them deployed (deployed_at = now()), and updates collective_scores.
    Body: { session_id, overrides?: { [position_id]: { stance?, argument? } } }
*/

// -----------------------------------------------------------------------
// Weight formula
// -----------------------------------------------------------------------

function depthMultiplier(totalTurns: number): number {
  // D = depth of engagement. Derived from how many user turns exist in the session.
  if (totalTurns >= 10) return 1.6;
  if (totalTurns >= 6)  return 1.4;
  if (totalTurns >= 3)  return 1.2;
  return 1.0;
}

function confidenceSignal(stance: string | null, hedged: boolean): number {
  if (!stance || stance === "abstain" || stance === "unclear") return 0;
  return hedged ? 0.8 : 1.0;
}

function detectHedging(text: string): boolean {
  const hedgePhrases = [
    "i think maybe", "probably", "not sure but", "kind of", "sort of",
    "i guess", "might be", "could be", "perhaps", "i suppose",
  ];
  const lower = text.toLowerCase();
  return hedgePhrases.some((p) => lower.includes(p));
}

// -----------------------------------------------------------------------
// Quality scoring via Claude
// -----------------------------------------------------------------------
async function scoreArgumentQuality(
  argumentText: string,
  sessionArguments: string[],
): Promise<{ specificity: number; consistency: number }> {
  if (!argumentText || argumentText.length < 10) {
    return { specificity: 0.3, consistency: 0.8 };
  }
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: `Score this political argument on two dimensions, each 0–1:
1. Specificity: does it contain a concrete reason, example, or mechanism — not just a restatement of the position?
2. Internal consistency: does it contradict anything else the user said in this conversation?

Argument to score:
"${argumentText.slice(0, 400)}"

Other things the user said this session:
${sessionArguments.slice(0, 5).map((a) => `"${a.slice(0, 150)}"`).join("\n")}

Return ONLY JSON: { "specificity": 0.0, "consistency": 0.0 }`,
        },
      ],
    });
    const raw = resp.content.find((c) => c.type === "text")?.text ?? "";
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s >= 0 && e > s) {
      const parsed = JSON.parse(raw.slice(s, e + 1));
      return {
        specificity: typeof parsed.specificity === "number"
          ? Math.max(0, Math.min(1, parsed.specificity)) : 0.5,
        consistency: typeof parsed.consistency === "number"
          ? Math.max(0, Math.min(1, parsed.consistency)) : 0.5,
      };
    }
  } catch (err) {
    console.warn("Quality scoring failed", err);
  }
  return { specificity: 0.5, consistency: 0.8 };
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** Converts a subtopic slug-name like "Labour Market" into a natural question
 *  e.g. "Do you think immigration has a net negative effect on the labour market?" */
function subtopicToQuestion(subtopicName: string, categoryName: string): string {
  const name = subtopicName.toLowerCase();
  const cat = categoryName.toLowerCase();

  // Map well-known subtopic patterns to readable questions
  const patterns: [RegExp, string][] = [
    [/labour.market|labor.market/, `Does immigration harm the labour market more than it helps?`],
    [/public.service/, `Is immigration putting unsustainable pressure on public services?`],
    [/cultural.integr/, `Should cultural integration be a condition of immigration?`],
    [/border.security/, `Should border security be significantly tightened?`],
    [/taxation|tax/, `Should taxes on higher earners be increased?`],
    [/trade/, `Should the UK pursue more free trade agreements?`],
    [/employment|jobs/, `Should the government do more to regulate employment conditions?`],
    [/public.debt|deficit/, `Should the government prioritise reducing public debt?`],
    [/planning/, `Should planning restrictions be loosened to allow more development?`],
    [/affordab/, `Is the housing affordability crisis mainly a supply problem?`],
    [/social.hous/, `Should the government build significantly more social housing?`],
    [/land.own/, `Should land ownership be reformed to reduce speculation?`],
    [/nhs.fund|health.fund/, `Should NHS funding be substantially increased?`],
    [/mental.health/, `Is mental health adequately prioritised within the NHS?`],
    [/preventat/, `Should the NHS focus more resources on preventative care?`],
    [/pharma/, `Should pharmaceutical regulation be strengthened?`],
    [/net.zero/, `Should the UK maintain its current net-zero targets?`],
    [/energy.trans/, `Should the energy transition be accelerated?`],
    [/env.reg|environment.reg/, `Should environmental regulation be strengthened?`],
    [/adaptat/, `Should more resources go to climate adaptation rather than mitigation?`],
    [/nato/, `Should the UK increase its NATO spending commitments?`],
    [/nuclear/, `Should the UK maintain its nuclear deterrent?`],
    [/foreign.aid/, `Should the UK maintain or increase its foreign aid budget?`],
    [/trade.dipl/, `Should economic ties with authoritarian states be reduced?`],
    [/school.fund/, `Are UK schools underfunded?`],
    [/curriculum/, `Should the school curriculum be reformed?`],
    [/higher.ed|university/, `Should university tuition fees be reduced or abolished?`],
    [/skills|apprentice/, `Should vocational training be better funded than universities?`],
    [/ai.safe/, `Should AI development be more strictly regulated?`],
    [/data.priv/, `Should data privacy protections be strengthened?`],
    [/big.tech/, `Should large technology platforms be broken up or regulated?`],
    [/digital.inf/, `Should the government invest more in digital infrastructure?`],
  ];

  for (const [pattern, question] of patterns) {
    if (pattern.test(name)) return question;
  }

  // Generic fallback
  return `Do you broadly support the mainstream position on ${subtopicName}${categoryName ? ` (${categoryName})` : ""}?`;
}

// -----------------------------------------------------------------------
// GET — review payload
// -----------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });

  const svc = supabaseService();

  const { data: positions } = await svc
    .from("inferred_positions")
    .select("*")
    .eq("user_id", user.id)
    .eq("session_id", sessionId)
    .is("deployed_at", null)
    .order("created_at", { ascending: true });

  if (!positions || positions.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const categoryIds = [...new Set(positions.map((p: any) => p.category_id).filter(Boolean))];
  const subtopicIds = [...new Set(positions.map((p: any) => p.subtopic_id).filter(Boolean))];
  const questionIds = [...new Set(positions.map((p: any) => p.question_id).filter(Boolean))];

  const [catRes, subRes, qRes] = await Promise.all([
    svc.from("taxonomy_categories").select("id, name").in("id", categoryIds),
    svc.from("taxonomy_subtopics").select("id, name, latent_question_text").in("id", subtopicIds),
    questionIds.length > 0
      ? svc.from("questions").select("id, question_text").in("id", questionIds)
      : Promise.resolve({ data: [] }),
  ]);

  const catMap = new Map((catRes.data ?? []).map((c: any) => [c.id, c.name]));
  const subMap = new Map((subRes.data ?? []).map((s: any) => [s.id, s]));
  const qMap   = new Map((qRes.data ?? []).map((q: any) => [q.id, q.question_text as string]));

  const items: ReviewItem[] = positions
    .filter((p: any) => p.subtopic_id)
    .map((p: any) => {
      const sub = subMap.get(p.subtopic_id) as any;
      const subtopicName: string = sub?.name ?? "Unknown";
      // Priority: actual inferred question node > latent_question_text > pattern fallback
      const questionText: string =
        (p.question_id && qMap.get(p.question_id)) ??
        sub?.latent_question_text ??
        subtopicToQuestion(subtopicName, catMap.get(p.category_id) ?? "");

      return {
        position_id: p.id,
        category_id: p.category_id,
        category_name: catMap.get(p.category_id) ?? "Unknown",
        subtopic_id: p.subtopic_id,
        subtopic_name: subtopicName,
        question_text: questionText,
        stance: p.stance,
        confidence: p.confidence ?? 0.5,
        reasoning: p.reasoning ?? null,
        arguments: Array.isArray(p.arguments_json) ? p.arguments_json : [],
        weight_d: p.weight_d,
        weight_q: p.weight_q,
        weight_c: p.weight_c,
        weight_total: p.weight_total,
      };
    });

  return NextResponse.json({ items });
}

// -----------------------------------------------------------------------
// POST — compute weights + deploy
// -----------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json() as {
    session_id: string;
    overrides?: Record<string, { stance?: string; argument?: string }>;
  };

  const { session_id, overrides = {} } = body;
  if (!session_id) return NextResponse.json({ error: "session_id required" }, { status: 400 });

  const svc = supabaseService();

  // Load all undeployed positions for this session
  const { data: positions } = await svc
    .from("inferred_positions")
    .select("*")
    .eq("user_id", user.id)
    .eq("session_id", session_id)
    .is("deployed_at", null);

  if (!positions || positions.length === 0) {
    return NextResponse.json({ deployed: 0 });
  }

  // Count user turns in this session for depth multiplier
  const { count: turnCount } = await svc
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("session_id", session_id)
    .eq("role", "user");

  const totalTurns = turnCount ?? 0;

  // Collect all argument texts for consistency scoring
  const allArgs: string[] = positions.flatMap((p: any) =>
    (Array.isArray(p.arguments_json) ? p.arguments_json : []).map((a: any) => a.text ?? ""),
  ).filter(Boolean);

  let deployed = 0;

  for (const pos of positions) {
    const override = overrides[pos.id];
    const stance = override?.stance ?? pos.stance ?? "unclear";
    const argText =
      override?.argument ??
      (Array.isArray(pos.arguments_json) && pos.arguments_json.length > 0
        ? pos.arguments_json[0].text
        : "");

    // Use classifier-assigned depth (real tree layer 1-5) if present,
    // otherwise fall back to conversation-length heuristic
    const weight_d = typeof pos.weight_d === "number" && pos.weight_d > 0
      ? pos.weight_d
      : depthMultiplier(totalTurns);

    const otherArgs = allArgs.filter((a) => a !== argText);
    const { specificity, consistency } = await scoreArgumentQuality(argText, otherArgs);
    const weight_q = Math.round((0.5 + specificity * 0.5 + consistency * 0.5) * 1000) / 1000;

    const hedged = detectHedging(argText);
    const weight_c = confidenceSignal(stance, hedged);

    const weight_total =
      weight_c === 0
        ? 0
        : Math.round(weight_d * weight_q * weight_c * 1000) / 1000;

    const updatedArgs = override?.argument
      ? [{ text: override.argument, ts: new Date().toISOString() }]
      : (Array.isArray(pos.arguments_json) ? pos.arguments_json : []);

    await svc
      .from("inferred_positions")
      .update({
        stance,
        arguments_json: updatedArgs,
        weight_d,
        weight_q,
        weight_c,
        weight_total,
        deployed_at: new Date().toISOString(),
      })
      .eq("id", pos.id);

    deployed++;
  }

  // Recompute collective_scores for affected subtopics
  const subtopicIds = [...new Set(positions.map((p: any) => p.subtopic_id).filter(Boolean))];
  await recomputeCollectiveScores(svc, subtopicIds);

  return NextResponse.json({ deployed, session_id });
}

// -----------------------------------------------------------------------
// Recompute collective_scores for given subtopics
// -----------------------------------------------------------------------
async function recomputeCollectiveScores(
  svc: ReturnType<typeof supabaseService>,
  subtopicIds: string[],
) {
  for (const subtopicId of subtopicIds) {
    // All deployed positions for this subtopic
    const { data: deployed } = await svc
      .from("inferred_positions")
      .select("stance, weight_total, arguments_json, category_id")
      .eq("subtopic_id", subtopicId)
      .not("deployed_at", "is", null);

    if (!deployed || deployed.length === 0) continue;

    let yesWeight = 0;
    let noWeight = 0;
    let abstainCount = 0;
    const yesArgs: string[] = [];
    const noArgs: string[] = [];

    for (const p of deployed) {
      const w = typeof p.weight_total === "number" ? p.weight_total : 1;
      const args = Array.isArray(p.arguments_json) ? p.arguments_json : [];

      if (p.stance === "yes") {
        yesWeight += w;
        for (const a of args) {
          if (a.text && yesArgs.length < 10) yesArgs.push(a.text);
        }
      } else if (p.stance === "no") {
        noWeight += w;
        for (const a of args) {
          if (a.text && noArgs.length < 10) noArgs.push(a.text);
        }
      } else if (p.stance === "abstain") {
        abstainCount++;
      }
    }

    const total = yesWeight + noWeight;
    const yesPct = total > 0 ? Math.round((yesWeight / total) * 100) : 50;
    const noPct  = total > 0 ? Math.round((noWeight  / total) * 100) : 50;
    const gap    = Math.abs(yesPct - noPct);
    const tensionFlag =
      gap < 15       ? "hot"
      : yesPct > 70  ? "agreed"
      : yesPct < 30  ? "disputed"
      : "contested";

    await svc.from("collective_scores").upsert(
      {
        subtopic_id: subtopicId,
        category_id: deployed[0].category_id ?? null,
        total_responses: deployed.length,
        yes_weighted_pct: yesPct,
        no_weighted_pct: noPct,
        abstain_count: abstainCount,
        tension_flag: tensionFlag,
        top_yes_args: dedup(yesArgs).slice(0, 3),
        top_no_args: dedup(noArgs).slice(0, 3),
        computed_at: new Date().toISOString(),
      },
      { onConflict: "subtopic_id" }
    );
  }
}

function dedup(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((s) => {
    const k = s.toLowerCase().slice(0, 60);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
