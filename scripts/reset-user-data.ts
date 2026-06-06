/**
 * reset-user-data.ts
 *
 * Wipes ALL user-generated data while preserving taxonomy/structure tables.
 * Run with: npx tsx scripts/reset-user-data.ts
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ─── Tables to KEEP (taxonomy / structure) ─────────────────────────────────
const KEEP = new Set([
  "taxonomy_categories",
  "taxonomy_subtopics",
  "taxonomy_questions",
  "questions",
  "manifesto_categories",
]);

// ─── Tables to TRUNCATE (all user-generated data) ──────────────────────────
const USER_DATA_TABLES = [
  // Conversation / AI interaction data
  "conversations",
  "messages",
  "sessions",
  // Inferred positions and views
  "inferred_positions",
  "user_views",
  "draft_stances",
  "user_stances",
  "public_question_stances",
  // Collective / aggregated output
  "collective_scores",
  "public_nodes",
  "personal_links",
  "links",
  "merged_nodes",
  "contradiction_flags",
  // Manifesto / published output
  "manifesto_clauses",
  "share_snapshots",
  // Debate
  "debate_outcomes",
  "debate_token_log",
  // Auth / profile / logs
  "auth_events",
  "feedback",
  "notification_preferences",
  "moderation_log",
  "api_spend_log",
  "api_budget",
  // Profiles last (referenced by others)
  "profiles",
];

async function truncateTable(table: string): Promise<boolean> {
  const { error } = await svc.rpc("exec_sql", {
    sql: `TRUNCATE TABLE public.${table} RESTART IDENTITY CASCADE;`,
  }).throwOnError().catch(() => ({ error: null }));

  // Fallback: delete all rows if TRUNCATE via RPC isn't available
  const { error: delErr } = await svc.from(table).delete().gte("id", "00000000-0000-0000-0000-000000000000");
  if (delErr) {
    // Try text id pattern
    const { error: delErr2 } = await svc.from(table).delete().neq("id", "impossible-sentinel-that-wont-match-anything");
    if (delErr2) {
      console.warn(`  ⚠ Could not clear ${table}:`, delErr2.message);
      return false;
    }
  }
  return true;
}

async function deleteAllAuthUsers() {
  console.log("\n── Deleting auth users ──────────────────────────────");

  let page = 0;
  let deleted = 0;

  while (true) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 100 });
    if (error) { console.error("listUsers error:", error.message); break; }
    if (!data.users.length) break;

    for (const user of data.users) {
      const { error: delErr } = await svc.auth.admin.deleteUser(user.id);
      if (delErr) {
        console.warn(`  ⚠ Could not delete ${user.email}:`, delErr.message);
      } else {
        console.log(`  ✓ Deleted ${user.email ?? user.id}`);
        deleted++;
      }
    }

    if (data.users.length < 100) break;
    page++;
  }

  console.log(`\n  ${deleted} auth user(s) deleted.`);
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Nexus — Full User Data Reset");
  console.log("═══════════════════════════════════════════════════");
  console.log("Keeping:", [...KEEP].join(", "));
  console.log("\n── Clearing user data tables ────────────────────────");

  let cleared = 0;
  for (const table of USER_DATA_TABLES) {
    // Use a simple delete-all that works without needing RPC
    const { error } = await svc
      .from(table)
      .delete()
      .not("id", "is", null) // matches all rows that have an id
      .throwOnError()
      .catch((e: { message: string }) => ({ error: e }));

    if (error && typeof error === "object" && "message" in error) {
      // Try fallback for tables without uuid id
      const { error: e2 } = await svc
        .from(table)
        .delete()
        .neq("created_at", "1970-01-01")
        .throwOnError()
        .catch((e: { message: string }) => ({ error: e }));

      if (e2 && typeof e2 === "object" && "message" in e2) {
        console.warn(`  ⚠ ${table}: ${(e2 as { message: string }).message}`);
        continue;
      }
    }

    console.log(`  ✓ ${table}`);
    cleared++;
  }

  await deleteAllAuthUsers();

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`  Done. ${cleared} tables cleared.`);
  console.log("  Taxonomy tables untouched.");
  console.log("═══════════════════════════════════════════════════\n");
}

main().catch(console.error);
