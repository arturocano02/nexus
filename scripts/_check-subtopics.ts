import { createClient } from "@supabase/supabase-js";
import fs from "fs";
function loadEnv() {
  const lines = fs.readFileSync(".env.local","utf-8").split("\n");
  for (const l of lines) { const eq = l.indexOf("="); if(eq>0) process.env[l.slice(0,eq).trim()] ??= l.slice(eq+1).trim().replace(/^["']|["']$/g,""); }
}
loadEnv();
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken:false, persistSession:false }});
async function main() {
  const {data} = await supa.from("taxonomy_subtopics").select("slug, name").order("slug");
  for (const r of (data ?? [])) console.log(`${String(r.slug).padEnd(30)} → "${r.name}"`);
}
main().catch(console.error);
