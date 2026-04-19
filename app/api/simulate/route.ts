import { NextRequest, NextResponse } from "next/server";
import { anthropic, MODEL } from "@/lib/anthropic";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  10-user consensus simulation.

  Pipeline per persona (all 10 run in parallel):
    1. Claude writes a short 3-turn chat in the persona's voice, roaming
       the topic naturally (not clause by clause).
    2. A second Claude call reads the chat + the full clause list and
       decides: for each clause the conversation TOUCHED, what stance did
       the persona take, and what one-line reason captures it?
    3. Those become draft_stances rows. Nothing public moves yet.
    4. After all 10 are done we call promote_draft_stances() for each
       user, which copies draft -> user_stances. The existing on_stance
       trigger then recomputes manifesto_clauses.agreement_pct, which is
       what the graph reads.

  Why this shape:
    - Mirrors the real product loop (casual chat -> inferred stances ->
      explicit submit -> graph updates).
    - Keeps the AI-vs-AI debate layer out of the picture entirely.
    - Lets us see, after one call, "here's what 10 people agreed on and
      where they split, with the arguments they used".

  GET returns the current consensus + grouped arguments so you can
  inspect what a previous run produced without re-seeding.
*/

const PERSONAS: { slug: string; brief: string }[] = [
  {
    slug: "sim_border_hawk",
    brief:
      "Small-business owner in a border town. Worried about illegal crossings and strain on local services. Pro-legal-immigration, anti-illegal. Pragmatic, not ideological.",
  },
  {
    slug: "sim_progressive_activist",
    brief:
      "Community organiser in a big city. Sees migrants as neighbours. Believes in broad amnesty, worker protections, and well-funded integration services.",
  },
  {
    slug: "sim_tech_liberal",
    brief:
      "Software engineer, immigrant themselves. Cares about skill-based visas and fast, fair processing. Frustrated by bureaucracy but not ideological about numbers.",
  },
  {
    slug: "sim_union_worker",
    brief:
      "Trade unionist in construction. Supports migrant workers but wants employers held to wage floors. Skeptical of uncapped low-wage inflows that undercut local pay.",
  },
  {
    slug: "sim_retired_conservative",
    brief:
      "Retired teacher in a rural town. Believes rules should be enforced. Anti-amnesty but sympathetic to long-settled families with kids in local schools.",
  },
  {
    slug: "sim_libertarian",
    brief:
      "Classical liberal. Wants government out of labour markets. Supports open work visas, opposes most enforcement, skeptical of welfare parity for non-citizens.",
  },
  {
    slug: "sim_suburban_centrist",
    brief:
      "Parent in an outer suburb. Main lens is school places and GP waits. Not hostile to migration but wants infrastructure funding to track population growth.",
  },
  {
    slug: "sim_faith_based",
    brief:
      "Church volunteer running a refugee support group. Believes in humane adjudication and speedier asylum decisions. Strong on moral duty, cautious on amnesty.",
  },
  {
    slug: "sim_second_gen_pragmatist",
    brief:
      "Child of immigrants. Proud of their parents' legal route. Believes in a clear paid pathway after long settlement but wants the queue respected.",
  },
  {
    slug: "sim_skeptical_policy_wonk",
    brief:
      "Think-tank analyst. Reads the data. Dislikes shortage-list visas as lagging indicators. Supports employer accountability, agnostic on numbers.",
  },
];

interface Clause {
  id: string;
  section: string;
  statement: string;
}

interface SimulatedStance {
  clause_id: string;
  stance: "for" | "against" | "skip";
  reasoning: string;
}

interface SimulationResult {
  user_id: string;
  slug: string;
  conversation: { role: "user" | "assistant"; content: string }[];
  stances: SimulatedStance[];
  promoted: number;
}

export async function POST(_req: NextRequest) {
  const svc = supabaseService();

  // 1. Load all active clauses (the "subtopics" the sim will react to).
  const { data: clauses, error: clauseErr } = await svc
    .from("manifesto_clauses")
    .select("id, section, statement")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (clauseErr || !clauses || clauses.length === 0) {
    return NextResponse.json(
      { error: "no_clauses", hint: "Run migration 20260422 to seed manifesto_clauses first." },
      { status: 400 },
    );
  }

  // 2. Run each persona: create user, generate chat + stances, upsert drafts.
  const results = await Promise.all(
    PERSONAS.map((p) => runPersona(svc, p, clauses as Clause[])),
  );

  // 3. Promote every persona's drafts into user_stances. Each insert fires
  //    the existing recompute trigger so manifesto_clauses aggregates
  //    update exactly once per user, at submit time.
  for (const r of results) {
    if (!r.user_id) continue;
    const { data: promoted } = await svc.rpc("promote_draft_stances", {
      p_user_id: r.user_id,
      p_simulated: true,
    });
    r.promoted = typeof promoted === "number" ? promoted : 0;
  }

  // 4. Summary.
  const consensus = await loadConsensus(svc);

  return NextResponse.json({
    ok: true,
    personas: results.length,
    stances_total: results.reduce((acc, r) => acc + r.stances.length, 0),
    promoted_total: results.reduce((acc, r) => acc + (r.promoted ?? 0), 0),
    consensus,
    runs: results.map((r) => ({
      slug: r.slug,
      user_id: r.user_id,
      turns: r.conversation.length,
      stances: r.stances.length,
    })),
  });
}

export async function GET() {
  const svc = supabaseService();
  const consensus = await loadConsensus(svc);
  return NextResponse.json({ consensus });
}

// -----------------------------------------------------------------------
// Persona runner
// -----------------------------------------------------------------------
async function runPersona(
  svc: ReturnType<typeof supabaseService>,
  persona: { slug: string; brief: string },
  clauses: Clause[],
): Promise<SimulationResult> {
  const result: SimulationResult = {
    user_id: "",
    slug: persona.slug,
    conversation: [],
    stances: [],
    promoted: 0,
  };

  // Reuse an existing demo user for this slug so re-running the endpoint
  // doesn't accumulate a new account every time.
  const email = `${persona.slug}@nexus-sim.local`;
  const userId = await ensureDemoUser(svc, email, persona.slug);
  if (!userId) return result;
  result.user_id = userId;

  // Clear any prior drafts for this user before the new run so the
  // submit step only promotes the freshest opinion.
  await svc.from("draft_stances").delete().eq("user_id", userId);

  const payload = await generatePersonaPayload(persona, clauses);
  result.conversation = payload.conversation;
  result.stances = payload.stances;

  if (payload.stances.length === 0) return result;

  // Insert draft_stances one upsert per clause so we hit the unique
  // (user_id, clause_id) constraint cleanly.
  const rows = payload.stances.map((s) => ({
    user_id: userId,
    clause_id: s.clause_id,
    stance: s.stance,
    reasoning: s.reasoning,
    source: "inferred" as const,
    confidence: 0.75,
  }));
  const { error: insertErr } = await svc
    .from("draft_stances")
    .upsert(rows, { onConflict: "user_id,clause_id" });
  if (insertErr) {
    console.error("draft_stances upsert failed", persona.slug, insertErr.message);
  }

  return result;
}

async function ensureDemoUser(
  svc: ReturnType<typeof supabaseService>,
  email: string,
  slug: string,
): Promise<string | null> {
  // Try to find an existing row. auth.admin.listUsers can be paged, so
  // fall back to searching public.users by the email we set on signup.
  const { data: existing } = await svc
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created, error } = await svc.auth.admin.createUser({
    email,
    password: `sim-${slug}-${Math.random().toString(36).slice(2, 10)}`,
    email_confirm: true,
    user_metadata: { is_simulation: true, slug },
  });
  if (error || !created.user) {
    console.error("ensureDemoUser failed", slug, error?.message);
    return null;
  }
  // The handle_new_user trigger inserts into public.users automatically.
  // Label the row with the slug so the simulation output is easy to read.
  await svc
    .from("users")
    .update({ username: slug, display_name: slug, email })
    .eq("id", created.user.id);
  return created.user.id;
}

// -----------------------------------------------------------------------
// Claude call: one round-trip returns both the chat and the stance map.
// Keeping it in one call keeps token cost linear in the number of
// personas, not quadratic like debate rounds.
// -----------------------------------------------------------------------
async function generatePersonaPayload(
  persona: { slug: string; brief: string },
  clauses: Clause[],
): Promise<{ conversation: { role: "user" | "assistant"; content: string }[]; stances: SimulatedStance[] }> {
  const clauseList = clauses
    .map((c) => `- ${c.id} | ${c.section}: ${c.statement}`)
    .join("\n");

  const system = `You simulate one ordinary person talking to a politics app about immigration.
You must produce TWO things:
1. A short three-turn conversation (user -> assistant -> user) in the persona's voice. The user turns are natural, a little rambling, and may casually take positions on subtopics. The assistant turn is one dry devil's-advocate push.
2. A list of stances on the clauses below that the conversation actually touched or that the persona would obviously take. Skip clauses the persona simply did not care about.

STANCE RULES:
- stance must be one of: "for", "against", "skip".
- reasoning: one short sentence (max 20 words) in the persona's voice explaining WHY. Never say "for" or "against" literally, just explain.
- Do not invent a clause_id that isn't in the list.
- Aim for 4 to 7 stances per persona, not all clauses.

OUTPUT FORMAT: Return ONLY a single JSON object, no prose, no code fences.
{
  "conversation": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "stances": [
    { "clause_id": "<uuid from the list>", "stance": "for|against|skip", "reasoning": "..." }
  ]
}`;

  const userMsg = `PERSONA: ${persona.slug}
BRIEF: ${persona.brief}

CLAUSES (clause_id | section: statement):
${clauseList}

Produce the JSON now.`;

  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: userMsg }],
    });
    const raw = resp.content.find((c) => c.type === "text")?.text ?? "";
    const parsed = extractJson(raw);
    if (!parsed) return { conversation: [], stances: [] };

    const conversation = Array.isArray(parsed.conversation)
      ? parsed.conversation
          .filter((m: any) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
          .slice(0, 6)
      : [];

    const validIds = new Set(clauses.map((c) => c.id));
    const stances: SimulatedStance[] = Array.isArray(parsed.stances)
      ? parsed.stances
          .filter(
            (s: any) =>
              s &&
              validIds.has(s.clause_id) &&
              (s.stance === "for" || s.stance === "against" || s.stance === "skip"),
          )
          .map((s: any) => ({
            clause_id: s.clause_id as string,
            stance: s.stance as "for" | "against" | "skip",
            reasoning: typeof s.reasoning === "string" ? s.reasoning.trim().slice(0, 400) : "",
          }))
      : [];

    return { conversation, stances };
  } catch (err) {
    console.error("generatePersonaPayload failed", persona.slug, err);
    return { conversation: [], stances: [] };
  }
}

function extractJson(raw: string): any | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------
// Results loader shared by GET and POST.
// -----------------------------------------------------------------------
async function loadConsensus(svc: ReturnType<typeof supabaseService>) {
  const { data: explorer } = await svc
    .from("manifesto_explorer")
    .select("*")
    .order("category_sort", { ascending: true });

  const { data: args } = await svc
    .from("clause_arguments")
    .select("clause_id, stance, reasoning, is_simulated, created_at")
    .order("created_at", { ascending: false });

  const argsByClause = new Map<string, { for: string[]; against: string[] }>();
  for (const a of args ?? []) {
    if (!a.clause_id) continue;
    const bucket = argsByClause.get(a.clause_id) ?? { for: [], against: [] };
    if (a.stance === "for" && bucket.for.length < 5 && a.reasoning) bucket.for.push(a.reasoning);
    if (a.stance === "against" && bucket.against.length < 5 && a.reasoning) bucket.against.push(a.reasoning);
    argsByClause.set(a.clause_id, bucket);
  }

  const categories = new Map<string, any>();
  for (const row of explorer ?? []) {
    if (!row.category_id) continue;
    const cat =
      categories.get(row.category_id) ?? {
        category_id: row.category_id,
        slug: row.category_slug,
        title: row.category_title,
        blurb: row.category_blurb,
        sections: new Map<string, any>(),
      };
    categories.set(row.category_id, cat);
    if (!row.clause_id) continue;
    const section =
      cat.sections.get(row.section) ?? { section: row.section, clauses: [] };
    const bucket = argsByClause.get(row.clause_id) ?? { for: [], against: [] };
    section.clauses.push({
      clause_id: row.clause_id,
      statement: row.statement,
      agreement_pct: Number(row.agreement_pct),
      stance_count: row.stance_count,
      for_arguments: bucket.for,
      against_arguments: bucket.against,
    });
    cat.sections.set(row.section, section);
  }

  // Flatten maps -> arrays for JSON.
  return Array.from(categories.values()).map((c) => ({
    category_id: c.category_id,
    slug: c.slug,
    title: c.title,
    blurb: c.blurb,
    sections: Array.from(c.sections.values()),
  }));
}
