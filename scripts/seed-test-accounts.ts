/**
 * scripts/seed-test-accounts.ts
 *
 * Creates 3 test accounts with richly varied political positions, stances,
 * and personal links — for testing the 3D mind map, arena, and manifesto views.
 *
 * Personas:
 *   Alice Foster   — alice@nexo-test.dev / NexoTest1!   (Progressive, high data density)
 *   Robert Clarke  — bob@nexo-test.dev   / NexoTest1!   (Conservative, medium density)
 *   Sam Patel      — sam@nexo-test.dev   / NexoTest1!   (Centrist, sparse / near-empty state)
 *
 * Run with:
 *   npx tsx scripts/seed-test-accounts.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import crypto from "crypto";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] ??= val;
  }
}
loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supa = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function uuid() { return crypto.randomUUID(); }

function arg(text: string): { text: string; ts: string } {
  return { text, ts: new Date().toISOString() };
}

async function getOrCreateUser(
  email: string,
  password: string,
  profile: { username: string; display_name: string; age: number }
): Promise<string> {
  const { data: list } = await supa.auth.admin.listUsers();
  const existing = list?.users?.find((u: any) => u.email === email);

  let userId: string;

  if (existing) {
    console.log(`  [skip] Auth user already exists: ${email}`);
    userId = existing.id;
  } else {
    const { data, error } = await supa.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser(${email}): ${error.message}`);
    userId = data.user.id;
    console.log(`  [created] Auth user: ${email} → ${userId}`);
  }

  const { error: pErr } = await supa.from("profiles").upsert(
    { id: userId, ...profile },
    { onConflict: "id" }
  );
  if (pErr) console.warn(`  [warn] profile upsert: ${pErr.message}`);

  try { await supa.from("users").upsert({ id: userId, username: profile.username }); } catch { /* ok */ }

  return userId;
}

async function fetchCategoryMap(): Promise<Map<string, string>> {
  const { data } = await supa.from("taxonomy_categories").select("id, slug");
  return new Map((data ?? []).map((r: any) => [r.slug, r.id]));
}

// Returns slug → { id, name } — use DB name directly as topic_label
async function fetchSubtopicDetails(): Promise<Map<string, { id: string; name: string }>> {
  const { data } = await supa.from("taxonomy_subtopics").select("id, slug, name");
  return new Map((data ?? []).map((r: any) => [r.slug, { id: r.id, name: r.name }]));
}

async function insertView(
  userId: string,
  topicLabel: string,
  summary: string,
  confidenceScore: number,
  rawExcerpts: string[],
  submittedToArena: boolean
): Promise<string> {
  const submittedAt = submittedToArena ? new Date().toISOString() : null;

  const { data: existing } = await supa
    .from("user_views")
    .select("id")
    .eq("user_id", userId)
    .eq("topic_label", topicLabel)
    .eq("is_deleted", false)
    .maybeSingle();

  if (existing) {
    console.log(`    [skip] "${topicLabel}"`);
    return existing.id;
  }

  const { data, error } = await supa
    .from("user_views")
    .insert({
      user_id: userId,
      topic_label: topicLabel,
      summary,
      confidence_score: confidenceScore,
      raw_excerpts: rawExcerpts,
      submitted_to_arena: submittedToArena,
      submitted_at: submittedAt,
      is_deleted: false,
    })
    .select("id")
    .single();

  if (error) throw new Error(`insertView("${topicLabel}"): ${error.message}`);
  console.log(`    [ok] "${topicLabel}"`);
  return data.id;
}

async function insertLink(
  userId: string,
  nodeAId: string,
  nodeBId: string,
  relationship: "supporting" | "contradicting",
  strength: number
): Promise<void> {
  const { error } = await supa.from("personal_links").upsert(
    { user_id: userId, node_a_id: nodeAId, node_b_id: nodeBId, relationship, strength },
    { onConflict: "user_id,node_a_id,node_b_id" }
  );
  if (error) console.warn(`    [warn] insertLink: ${error.message}`);
}

async function insertPosition(
  userId: string,
  categoryId: string,
  subtopicId: string,
  stance: "yes" | "no" | "abstain" | "unclear",
  confidence: number,
  reasoning: string,
  arguments_: { text: string; ts: string }[],
  weightD: number,
  weightQ: number,
  weightC: number,
  deployed = true
): Promise<void> {
  const sessionId = uuid();
  const weightTotal = deployed ? Math.round(weightD * weightQ * weightC * 1000) / 1000 : 0;
  const deployedAt  = deployed ? new Date().toISOString() : null;

  const { error } = await supa.from("inferred_positions").upsert(
    {
      user_id: userId, session_id: sessionId, category_id: categoryId, subtopic_id: subtopicId,
      stance, confidence, reasoning, arguments_json: arguments_,
      weight_d: weightD, weight_q: weightQ, weight_c: weightC,
      weight_total: weightTotal, deployed_at: deployedAt,
    },
    { onConflict: "user_id,session_id,subtopic_id" }
  );
  if (error) console.warn(`    [warn] insertPosition(${subtopicId}): ${error.message}`);
}

// -----------------------------------------------------------------------
// PERSONA A — Alice Foster: Progressive, 10 views, mixed YES+NO stances
// Blob sizes vary: 5–6 excerpts = large, 2–3 = medium, 1 = small
// -----------------------------------------------------------------------
async function seedAlice(
  catMap: Map<string, string>,
  subDetails: Map<string, { id: string; name: string }>
) {
  console.log("\n=== Alice Foster (Progressive) ===");

  const userId = await getOrCreateUser(
    "alice@nexo-test.dev",
    "NexoTest1!",
    { username: "alice_foster", display_name: "Alice Foster", age: 31 }
  );

  function sub(slug: string) {
    const d = subDetails.get(slug);
    if (!d) console.warn(`    [warn] subtopic not found: ${slug}`);
    return d ?? { id: "", name: slug };
  }

  console.log("  Inserting user_views …");
  const v: Record<string, string> = {};

  // Large blobs — 5–6 excerpts (core deeply-held beliefs)
  const nhsSub = sub("nhs-funding");
  v.nhs = await insertView(userId, nhsSub.name,
    "NHS funding needs a 4% real-terms uplift every year for a decade. Austerity has hollowed it out beyond what minor reform can fix.",
    0.94,
    ["Waiting lists are the longest ever recorded in NHS history.",
     "Every £1 in preventative care saves £3 downstream — the Treasury acknowledges this.",
     "Nurses are leaving for Australia and Canada because their pay is embarrassing.",
     "My GP surgery has a 6-week wait for a standard appointment.",
     "Compare us to Germany or France — the NHS has been in managed decline for 15 years."],
    true);

  const netZeroSub = sub("net-zero");
  v.netZero = await insertView(userId, netZeroSub.name,
    "The 2050 net-zero target must be brought forward to 2040. The IPCC is unambiguous and political will is the only bottleneck.",
    0.97,
    ["Every major climate model has us off-track by a decade.",
     "Renewables are now the cheapest source of new electricity globally.",
     "The economic case for inaction has completely collapsed.",
     "We're already seeing 1.2°C of warming in real-time disasters.",
     "The IEA says no new fossil fuel projects from now on.",
     "Flood insurance in coastal areas is already unaffordable — that's the future arriving early."],
    true);

  const socialHousingSub = sub("social-housing");
  v.socialHousing = await insertView(userId, socialHousingSub.name,
    "The government must build at minimum 150,000 social homes a year. Housing is infrastructure, not an asset class.",
    0.91,
    ["Social housing stock has fallen by over a million since Thatcher.",
     "Private landlords extract billions in rent while providing zero social value.",
     "Families are stuck in temporary accommodation for 3 years or more.",
     "Council housing in Vienna is world-class — we could do the same with political commitment.",
     "The housing cost is the primary driver of London brain-drain to cheaper cities."],
    true);

  const mentalHealthSub = sub("mental-health");
  v.mentalHealth = await insertView(userId, mentalHealthSub.name,
    "Mental health receives 11% of NHS budget but accounts for 28% of disease burden. That gap is a policy scandal.",
    0.87,
    ["We would never tell someone with a broken leg to wait 18 months.",
     "The economic cost of untreated mental illness dwarfs the treatment costs.",
     "CAMHS waiting lists exceed one year in most areas.",
     "Suicide remains the leading cause of death for men under 50 — this is preventable."],
    true);

  // Medium blobs — 2–3 excerpts
  const energySub = sub("energy-transition");
  v.energy = await insertView(userId, energySub.name,
    "Wind and nuclear must be fast-tracked in parallel. Ideological purity on energy sources is a luxury we cannot afford.",
    0.85,
    ["Hinkley Point C proves we can do large-scale nuclear if we commit politically.",
     "Offshore wind is now cheaper per unit than new gas — the economics are settled."],
    true);

  const schoolSub = sub("school-funding");
  v.schoolFunding = await insertView(userId, schoolSub.name,
    "Per-pupil funding in England remains below 2009 real-terms levels. Closing that gap must be a first-term priority.",
    0.88,
    ["Teachers buying classroom supplies from their own salary is a civilisational failure.",
     "Early years investment consistently shows the highest social return of any public spend."],
    true);

  const higherEdSub = sub("higher-ed");
  v.higherEd = await insertView(userId, higherEdSub.name,
    "Tuition fees are a graduate tax by another name, and they disproportionately burden working-class students.",
    0.78,
    ["The £9,250 system hasn't improved graduate outcomes — it loaded a generation with debt.",
     "Germany offers free university and maintains a stronger industrial workforce. We can do the same."],
    true);

  const mentalHealthProvSub = sub("mental-health");
  // Already handled above — add planning (small blob)
  const planSub = sub("planning");
  v.planning = await insertView(userId, planSub.name,
    "Planning reform is needed to unlock housing supply — but without gutting green belt or environmental protections.",
    0.61,
    ["NIMBYism is destroying supply in every commuter town around London."],
    true);

  // Deliberate NO stances — Alice opposes nuclear deterrent (anti-militarist) and trade deregulation
  const nuclearSub = sub("nuclear");
  v.nuclear = await insertView(userId, nuclearSub.name,
    "The nuclear deterrent costs £3bn a year and hasn't deterred a single actual threat we've faced since the Cold War.",
    0.74,
    ["Modern threats are cyber, disinformation, and proxy conflict — not ICBMs.",
     "That £3bn could fund 30,000 nurses or 100 new GP surgeries."],
    true);

  const tradeSub = sub("trade");
  v.trade = await insertView(userId, tradeSub.name,
    "Post-Brexit trade deals have consistently surrendered food standards and worker protections for marginal GDP gains.",
    0.66,
    ["The Australia deal was described by our own trade select committee as net negative for UK farmers."],
    false); // Not yet deployed to arena

  // -- personal_links --
  console.log("  Inserting personal_links …");
  await insertLink(userId, v.socialHousing, v.nhs,         "supporting",    0.71);
  await insertLink(userId, v.netZero,       v.energy,       "supporting",    0.93);
  await insertLink(userId, v.mentalHealth,  v.nhs,          "supporting",    0.88);
  await insertLink(userId, v.higherEd,      v.schoolFunding, "supporting",   0.77);
  await insertLink(userId, v.netZero,       v.planning,     "supporting",    0.58);
  await insertLink(userId, v.nuclear,       v.nhs,          "supporting",    0.64); // redirect military spend → NHS
  await insertLink(userId, v.nuclear,       v.trade,        "contradicting", 0.51); // anti-military but ambivalent on trade deals

  // -- inferred_positions — MIX of YES and NO --
  console.log("  Inserting inferred_positions …");
  type P = [string, string, "yes"|"no"|"abstain", number, string, {text:string;ts:string}[], number, number, number];
  const positions: P[] = [
    ["healthcare", "nhs-funding",       "yes", 0.94, "4% real increase every year for a decade",               [arg("Waiting lists longest ever"), arg("Pay driving nurses abroad")], 5.0, 0.92, 1.0],
    ["climate",    "net-zero",          "yes", 0.97, "Bring 2050 target to 2040 minimum",                      [arg("IPCC says off-track"), arg("Renewables now cheapest")], 5.0, 0.95, 1.0],
    ["housing",    "social-housing",    "yes", 0.91, "150,000 state-built social homes per year",               [arg("Stock down 1M since Thatcher"), arg("Families in temp accom 3yr+")], 5.0, 0.89, 1.0],
    ["healthcare", "mental-health",     "yes", 0.87, "Rebalance NHS budget to match 28% disease burden",        [arg("CAMHS waits over 1 year"), arg("Suicide #1 cause of death men<50")], 4.0, 0.85, 1.0],
    ["climate",    "energy-transition", "yes", 0.85, "Wind + nuclear in parallel",                              [arg("Hinkley proves large nuclear viable"), arg("Wind cheapest per unit")], 4.0, 0.83, 1.0],
    ["education",  "school-funding",    "yes", 0.88, "Close per-pupil gap to 2009 real terms",                  [arg("Teachers buying own supplies"), arg("Early years best ROI")], 4.0, 0.86, 1.0],
    ["education",  "higher-ed",         "yes", 0.78, "Abolish or halve tuition fees",                           [arg("Graduate tax by another name"), arg("Germany does it")], 3.0, 0.76, 1.0],
    ["housing",    "planning",          "yes", 0.61, "Reform planning to unlock supply",                         [arg("NIMBYism destroying supply everywhere")], 2.0, 0.59, 1.0],
    // NO stances
    ["defence",   "nuclear",            "no",  0.74, "Nuclear deterrent: strategic theatre not security",        [arg("Hasn't deterred any actual threat in 30yr"), arg("£3bn = 30,000 nurses")], 3.0, 0.72, 1.0],
    ["economy",   "trade",              "no",  0.66, "Post-Brexit deals surrender standards for nothing",        [arg("Australia deal net negative for farmers")], 2.0, 0.64, 1.0],
  ];

  for (const [catSlug, subSlug, stance, conf, reasoning, args, wD, wQ, wC] of positions) {
    const catId = catMap.get(catSlug);
    const subDet = subDetails.get(subSlug);
    if (!catId || !subDet?.id) { console.warn(`    [skip] ${catSlug}/${subSlug}`); continue; }
    await insertPosition(userId, catId, subDet.id, stance, conf, reasoning, args, wD, wQ, wC, true);
  }

  console.log("  ✓ Alice seeded");
}

// -----------------------------------------------------------------------
// PERSONA B — Robert Clarke: Conservative, 6 views, YES defence + NO spending
// -----------------------------------------------------------------------
async function seedBob(
  catMap: Map<string, string>,
  subDetails: Map<string, { id: string; name: string }>
) {
  console.log("\n=== Robert Clarke (Conservative) ===");

  const userId = await getOrCreateUser(
    "bob@nexo-test.dev",
    "NexoTest1!",
    { username: "robert_clarke", display_name: "Robert Clarke", age: 54 }
  );

  function sub(slug: string) {
    const d = subDetails.get(slug);
    if (!d) console.warn(`    [warn] subtopic not found: ${slug}`);
    return d ?? { id: "", name: slug };
  }

  console.log("  Inserting user_views …");
  const v: Record<string, string> = {};

  // Large blobs — core convictions (4–5 excerpts)
  const natoSub = sub("nato");
  v.nato = await insertView(userId, natoSub.name,
    "The UK must increase defence spending to 3% of GDP immediately. The post-Cold War peace dividend is definitively over.",
    0.94,
    ["Putin's full-scale invasion of Ukraine settled this debate for a generation.",
     "Germany spent 30 years freeloading on US defence — we cannot repeat that mistake.",
     "Article 5 relies on credibility. Cut spending and you undermine the whole deterrent architecture.",
     "Trump is correct that European nations must stop outsourcing their security to Washington."],
    true);

  const nuclearSub = sub("nuclear");
  v.nuclear = await insertView(userId, nuclearSub.name,
    "Trident is the cheapest insurance policy ever purchased. Unilateral disarmament in a multipolar world would be geopolitically suicidal.",
    0.96,
    ["Every serious strategic analysis concludes nuclear deterrence prevents great-power conflict.",
     "Less than 5% of the defence budget — literally the cheapest peace we've bought.",
     "North Korea has nuclear weapons for a reason — democracies giving them up is naive.",
     "We reduced conventional forces and gave up chemical weapons — we cannot give up the ultimate backstop."],
    true);

  const debtSub = sub("public-debt");
  v.publicDebt = await insertView(userId, debtSub.name,
    "Britain's debt-to-GDP is at peacetime highs. Every pound of borrowing is a tax on tomorrow's workers.",
    0.88,
    ["£100 billion on debt interest last year — that's almost the entire NHS capital budget.",
     "Every Labour government has left office with higher debt than it inherited.",
     "The IMF has flagged UK debt trajectory as a concern requiring action."],
    true);

  // Medium blobs — 2 excerpts
  const taxSub = sub("taxation");
  v.taxation = await insertView(userId, taxSub.name,
    "The UK tax burden is at its highest since WW2. We are taxing productivity and entrepreneurial capital out of the country.",
    0.83,
    ["Capital gains tax hikes have visibly accelerated departure of founders to Dubai and Lisbon.",
     "The Laffer curve is empirically documented at these marginal rates."],
    true);

  const tradeSub = sub("trade");
  v.trade = await insertView(userId, tradeSub.name,
    "Post-Brexit we have freedom to strike trade deals on our own terms. The India FTA would add £6bn per year.",
    0.77,
    ["Commonwealth trade network is massively underexploited by both sides.",
     "The EU's regulatory union was strangling UK services exports for 20 years."],
    true);

  // Small blob — 1 excerpt
  const bigTechSub = sub("big-tech");
  v.bigTech = await insertView(userId, bigTechSub.name,
    "Heavy-handed tech regulation would destroy the UK's one genuine post-industrial growth engine.",
    0.66,
    ["GDPR alone cost UK SMEs an estimated £4 billion in compliance overhead."],
    true);

  // -- personal_links --
  console.log("  Inserting personal_links …");
  await insertLink(userId, v.nato,       v.nuclear,    "supporting",    0.93);
  await insertLink(userId, v.publicDebt, v.taxation,   "supporting",    0.87);
  await insertLink(userId, v.trade,      v.publicDebt, "supporting",    0.62);
  await insertLink(userId, v.bigTech,    v.trade,      "supporting",    0.56);
  await insertLink(userId, v.taxation,   v.nato,       "contradicting", 0.44); // wants lower taxes AND higher defence — real tension

  // -- inferred_positions — YES to defence+trade, NO to high taxes+regulation --
  console.log("  Inserting inferred_positions …");
  type P = [string, string, "yes"|"no", number, string, {text:string;ts:string}[], number, number, number];
  const positions: P[] = [
    ["defence",    "nato",        "yes", 0.94, "Increase to 3% GDP immediately",                   [arg("Ukraine settled the debate"), arg("Article 5 needs credibility")], 5.0, 0.92, 1.0],
    ["defence",    "nuclear",     "yes", 0.96, "Trident non-negotiable",                            [arg("Cheapest peace ever bought"), arg("Nuclear states don't get invaded")], 5.0, 0.94, 1.0],
    ["economy",    "public-debt", "yes", 0.88, "Reduce debt as first fiscal priority",              [arg("£100bn interest pa"), arg("Every Labour govt ends with more debt")], 4.0, 0.86, 1.0],
    ["economy",    "trade",       "yes", 0.77, "Aggressive post-Brexit bilateral deals",            [arg("India FTA worth £6bn/yr"), arg("Commonwealth underexploited")], 3.0, 0.75, 1.0],
    // NO stances
    ["economy",    "taxation",    "no",  0.83, "Tax burden at WW2 high — must reduce sharply",     [arg("CGT hikes accelerating founder flight"), arg("Laffer curve documented here")], 4.0, 0.81, 1.0],
    ["technology", "big-tech",    "no",  0.66, "Regulation kills UK's innovation edge",             [arg("GDPR cost SMEs £4bn in compliance")], 2.0, 0.64, 1.0],
  ];

  for (const [catSlug, subSlug, stance, conf, reasoning, args, wD, wQ, wC] of positions) {
    const catId = catMap.get(catSlug);
    const subDet = subDetails.get(subSlug);
    if (!catId || !subDet?.id) { console.warn(`    [skip] ${catSlug}/${subSlug}`); continue; }
    await insertPosition(userId, catId, subDet.id, stance, conf, reasoning, args, wD, wQ, wC, true);
  }

  console.log("  ✓ Bob seeded");
}

// -----------------------------------------------------------------------
// PERSONA C — Sam Patel: Sparse centrist — tests near-empty + low-confidence state
// -----------------------------------------------------------------------
async function seedSam(
  catMap: Map<string, string>,
  subDetails: Map<string, { id: string; name: string }>
) {
  console.log("\n=== Sam Patel (Centrist / Sparse) ===");

  const userId = await getOrCreateUser(
    "sam@nexo-test.dev",
    "NexoTest1!",
    { username: "sam_patel", display_name: "Sam Patel", age: 26 }
  );

  function sub(slug: string) {
    const d = subDetails.get(slug);
    if (!d) console.warn(`    [warn] subtopic not found: ${slug}`);
    return d ?? { id: "", name: slug };
  }

  console.log("  Inserting user_views …");
  const v: Record<string, string> = {};

  const affSub = sub("affordability");
  v.affordability = await insertView(userId, affSub.name,
    "Something needs to change on housing affordability — but I'm genuinely not sure whether more government intervention is the answer.",
    0.38,
    ["Rents have doubled in five years in every city I've lived in.",
     "But the 1960s council housing schemes were often badly managed."],
    true);

  const empSub = sub("employment");
  v.employment = await insertView(userId, empSub.name,
    "Zero-hours contracts work for some people — the flexibility is real. But exploitation is clearly happening too.",
    0.31,
    ["My sister prefers hers while studying. But gig economy drivers have no security whatsoever."],
    false);

  const prevSub = sub("preventative");
  v.preventative = await insertView(userId, prevSub.name,
    "Intuitively prevention must be cheaper than cure — but evidence for prevention programmes is often weaker than claimed.",
    0.22,
    ["Early intervention seems obvious on first principles."],
    false);

  // No personal_links — tests the arc-free globe

  console.log("  Inserting inferred_positions …");
  const affCat = catMap.get("housing");
  const affDet = subDetails.get("affordability");
  if (affCat && affDet?.id) {
    await insertPosition(userId, affCat, affDet.id, "abstain", 0.38,
      "Uncertain whether market or state solution is better",
      [arg("Rents doubled 5yr"), arg("60s council housing often poorly managed")],
      2.0, 0.52, 0.6, true);
  }

  const empCat = catMap.get("economy");
  const empDet = subDetails.get("employment");
  if (empCat && empDet?.id) {
    await insertPosition(userId, empCat, empDet.id, "no", 0.31,
      "Sceptical of heavy-handed employment regulation — flexibility matters",
      [arg("Flexibility genuinely useful for some workers")],
      1.0, 0.48, 0.8, false);
  }

  console.log("  ✓ Sam seeded");
}

// -----------------------------------------------------------------------
// Recompute collective_scores for all deployed subtopics
// -----------------------------------------------------------------------
async function recomputeCollectiveScores() {
  console.log("\n  Recomputing collective_scores …");
  const { data: subtopics } = await supa.from("taxonomy_subtopics").select("id, category_id");
  if (!subtopics) return;

  for (const st of (subtopics as any[])) {
    const { data: deployed } = await supa
      .from("inferred_positions")
      .select("stance, weight_total, arguments_json, category_id")
      .eq("subtopic_id", st.id)
      .not("deployed_at", "is", null);

    if (!deployed || deployed.length === 0) continue;

    let yesWeight = 0, noWeight = 0, abstainCount = 0;
    const yesArgs: string[] = [], noArgs: string[] = [];

    for (const p of (deployed as any[])) {
      const w = typeof p.weight_total === "number" ? p.weight_total : 1;
      const args: any[] = Array.isArray(p.arguments_json) ? p.arguments_json : [];
      if (p.stance === "yes") { yesWeight += w; args.forEach((a: any) => yesArgs.length < 10 && a.text && yesArgs.push(a.text)); }
      else if (p.stance === "no") { noWeight += w; args.forEach((a: any) => noArgs.length < 10 && a.text && noArgs.push(a.text)); }
      else if (p.stance === "abstain") abstainCount++;
    }

    const total = yesWeight + noWeight;
    const yesPct = total > 0 ? Math.round((yesWeight / total) * 100) : 50;
    const noPct  = total > 0 ? Math.round((noWeight  / total) * 100) : 50;
    const gap    = Math.abs(yesPct - noPct);
    const tension = gap < 15 ? "hot" : yesPct > 70 ? "agreed" : yesPct < 30 ? "disputed" : "contested";

    await supa.from("collective_scores").upsert({
      subtopic_id: st.id,
      category_id: (deployed as any[])[0]?.category_id ?? null,
      total_responses: deployed.length,
      yes_weighted_pct: yesPct,
      no_weighted_pct: noPct,
      abstain_count: abstainCount,
      tension_flag: tension,
      top_yes_args: yesArgs.slice(0, 3),
      top_no_args: noArgs.slice(0, 3),
      computed_at: new Date().toISOString(),
    }, { onConflict: "subtopic_id" });
  }
  console.log("  ✓ collective_scores updated");
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------
async function main() {
  console.log("Fetching taxonomy maps …");
  const catMap     = await fetchCategoryMap();
  const subDetails = await fetchSubtopicDetails();

  console.log(`  Categories: ${catMap.size}, Subtopics: ${subDetails.size}`);

  if (catMap.size === 0 || subDetails.size === 0) {
    console.error("\n⚠  Taxonomy tables empty — run migrations and seed-questions.ts first.");
    process.exit(1);
  }

  await seedAlice(catMap, subDetails);
  await seedBob(catMap, subDetails);
  await seedSam(catMap, subDetails);
  await recomputeCollectiveScores();

  console.log("\n✅ All test accounts seeded.\n");
  console.log("Test credentials:");
  console.log("  alice@nexo-test.dev  /  NexoTest1!   (Progressive — 10 views, 7 links, YES+NO stances)");
  console.log("  bob@nexo-test.dev    /  NexoTest1!   (Conservative — 6 views, 5 links, YES+NO stances)");
  console.log("  sam@nexo-test.dev    /  NexoTest1!   (Sparse centrist — 3 views, 1 deployed, ABSTAIN+NO)");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
