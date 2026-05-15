import { createClient } from "@supabase/supabase-js";
import fs from "fs";
function loadEnv() {
  const lines = fs.readFileSync(".env.local","utf-8").split("\n");
  for (const l of lines) { const eq = l.indexOf("="); if(eq>0) process.env[l.slice(0,eq).trim()] ??= l.slice(eq+1).trim().replace(/^["']|["']$/g,""); }
}
loadEnv();
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth:{autoRefreshToken:false,persistSession:false}});
const TEST_EMAILS = ["alice@nexo-test.dev","bob@nexo-test.dev","sam@nexo-test.dev"];
async function main() {
  const { data: users } = await supa.auth.admin.listUsers();
  const testIds = (users?.users ?? []).filter(u => TEST_EMAILS.includes(u.email ?? "")).map(u => u.id);
  console.log("Test user IDs:", testIds);
  for (const uid of testIds) {
    // Delete personal_links
    const { error: e1 } = await supa.from("personal_links").delete().eq("user_id", uid);
    if (e1) console.warn("personal_links delete:", e1.message);
    else console.log(`  Deleted personal_links for ${uid}`);
    // Hard-delete user_views
    const { error: e2 } = await supa.from("user_views").delete().eq("user_id", uid);
    if (e2) console.warn("user_views delete:", e2.message);
    else console.log(`  Deleted user_views for ${uid}`);
    // Delete inferred_positions
    const { error: e3 } = await supa.from("inferred_positions").delete().eq("user_id", uid);
    if (e3) console.warn("inferred_positions delete:", e3.message);
    else console.log(`  Deleted inferred_positions for ${uid}`);
  }
  console.log("Done — re-run seed-test-accounts.ts");
}
main().catch(console.error);
