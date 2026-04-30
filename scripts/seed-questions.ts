/**
 * scripts/seed-questions.ts
 *
 * Seeds the `questions` table from data/taxonomy.json.
 * Each category entry contains an array of topic trees. Each tree is a
 * nested structure where every node represents one question (L1-L5).
 *
 * Run with:
 *   npx tsx scripts/seed-questions.ts
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// ---------------------------------------------------------------------------
// Types — mirror the JSON structure in data/taxonomy.json
// ---------------------------------------------------------------------------
interface QuestionNode {
  layer: number;
  text: string;
  is_tension: boolean;
  yes?: QuestionNode;
  no?: QuestionNode;
}

interface TaxonomyTopic {
  name: string;
  slug: string;
  subtopicSlug: string | null;
  // root node (L1 question)
  layer: number;
  text: string;
  is_tension: boolean;
  yes?: QuestionNode;
  no?: QuestionNode;
}

interface TaxonomyData {
  [categorySlug: string]: TaxonomyTopic[];
}

// ---------------------------------------------------------------------------
// Supabase client (service role — bypasses RLS)
// ---------------------------------------------------------------------------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supa = createClient(supabaseUrl, serviceKey);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch all taxonomy_categories, keyed by slug. */
async function fetchCategoryMap(): Promise<Map<string, string>> {
  const { data, error } = await supa
    .from("taxonomy_categories")
    .select("id, slug");
  if (error) throw error;
  return new Map((data ?? []).map((r: any) => [r.slug, r.id]));
}

/** Fetch all taxonomy_subtopics, keyed by slug. */
async function fetchSubtopicMap(): Promise<Map<string, string>> {
  const { data, error } = await supa
    .from("taxonomy_subtopics")
    .select("id, slug");
  if (error) throw error;
  return new Map((data ?? []).map((r: any) => [r.slug, r.id]));
}

/**
 * Recursively insert a question node and all its children.
 * Returns the UUID of the inserted row.
 */
async function insertNode(
  node: QuestionNode,
  categoryId: string,
  subtopicId: string | null,
  parentId: string | null,
  parentAnswer: "yes" | "no" | null
): Promise<string> {
  const { data, error } = await supa
    .from("questions")
    .insert({
      category_id:         categoryId,
      subtopic_id:         subtopicId,
      parent_question_id:  parentId,
      parent_answer:       parentAnswer,
      layer:               node.layer,
      question_text:       node.text,
      is_tension:          node.is_tension,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Insert failed for question:", node.text.slice(0, 60), error.message);
    throw error;
  }

  const id: string = data.id;

  // Recurse into children
  if (node.yes) await insertNode(node.yes, categoryId, subtopicId, id, "yes");
  if (node.no)  await insertNode(node.no,  categoryId, subtopicId, id, "no");

  return id;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("Loading taxonomy.json …");
  const taxonomyPath = path.join(process.cwd(), "data", "taxonomy.json");
  const raw = fs.readFileSync(taxonomyPath, "utf-8");
  const taxonomy: TaxonomyData = JSON.parse(raw);

  console.log("Fetching category and subtopic maps from Supabase …");
  const categoryMap  = await fetchCategoryMap();
  const subtopicMap  = await fetchSubtopicMap();

  let totalInserted = 0;
  let totalSkipped  = 0;

  for (const [categorySlug, topics] of Object.entries(taxonomy)) {
    if (topics.length === 0) {
      console.log(`  [${categorySlug}] no topics defined — skipping`);
      continue;
    }

    const categoryId = categoryMap.get(categorySlug);
    if (!categoryId) {
      console.warn(`  [${categorySlug}] category not found in DB — skipping`);
      totalSkipped += topics.length;
      continue;
    }

    console.log(`\n  [${categorySlug}] seeding ${topics.length} topic tree(s) …`);

    for (const topic of topics) {
      // Check if an L1 root question already exists for this topic (idempotent)
      const { data: existing } = await supa
        .from("questions")
        .select("id")
        .eq("category_id", categoryId)
        .eq("layer", 1)
        .eq("question_text", topic.text)
        .maybeSingle();

      if (existing) {
        console.log(`    [skip] "${topic.name}" — already seeded`);
        totalSkipped++;
        continue;
      }

      const subtopicId = topic.subtopicSlug
        ? (subtopicMap.get(topic.subtopicSlug) ?? null)
        : null;

      if (topic.subtopicSlug && !subtopicId) {
        console.warn(`    [warn] subtopic slug '${topic.subtopicSlug}' not found — seeding without subtopic link`);
      }

      // Build a root QuestionNode from the TaxonomyTopic fields
      const rootNode: QuestionNode = {
        layer:      topic.layer,
        text:       topic.text,
        is_tension: topic.is_tension,
        yes:        topic.yes,
        no:         topic.no,
      };

      console.log(`    Inserting tree: "${topic.name}"`);
      await insertNode(rootNode, categoryId, subtopicId, null, null);

      // Count nodes in this tree (2^layer - 1 for a full binary tree up to depth 5)
      // Actual count varies; just log success
      console.log(`    ✓ "${topic.name}" seeded`);
      totalInserted++;
    }
  }

  console.log(`\nDone. Seeded ${totalInserted} topic tree(s). Skipped ${totalSkipped}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
