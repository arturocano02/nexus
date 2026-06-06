/**
 * delete-auth-users.ts
 * Deletes all auth users via Supabase Admin API.
 * Run AFTER the SQL reset so profiles/data are already gone.
 *
 * npx tsx scripts/delete-auth-users.ts
 */

import { createClient } from "@supabase/supabase-js";

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function main() {
  console.log("Deleting all auth users…\n");
  let page = 0;
  let total = 0;

  while (true) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    if (!data.users.length) break;

    for (const user of data.users) {
      const { error: e } = await svc.auth.admin.deleteUser(user.id);
      if (e) console.warn(`  ⚠ ${user.email}: ${e.message}`);
      else { console.log(`  ✓ ${user.email ?? user.id}`); total++; }
    }

    if (data.users.length < 100) break;
    page++;
  }

  console.log(`\nDone — ${total} user(s) deleted.`);
}

main().catch(err => { console.error(err); process.exit(1); });
