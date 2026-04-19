import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Read endpoint for the layered manifesto explorer:
    Category (e.g. Immigration)
      -> Section (e.g. Border and enforcement)
         -> Clause (statement + agreement_pct + stance_count)
            -> grouped for_arguments / against_arguments

  Agreement numbers here are computed from real user_stances submissions
  only. Mid-chat draft stances never touch these values.
*/

export async function GET() {
  const svc = supabaseService();

  const { data: explorer, error: expErr } = await svc
    .from("manifesto_explorer")
    .select("*")
    .order("category_sort", { ascending: true });

  if (expErr) {
    return NextResponse.json({ error: "explorer_failed" }, { status: 500 });
  }

  const clauseIds = (explorer ?? [])
    .filter((r: any) => r.clause_id)
    .map((r: any) => r.clause_id as string);

  const { data: args } = clauseIds.length > 0
    ? await svc
        .from("clause_arguments")
        .select("clause_id, stance, reasoning, is_simulated, created_at")
        .in("clause_id", clauseIds)
        .order("created_at", { ascending: false })
    : { data: [] };

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
      for_argument_seed: row.for_argument,
      against_argument_seed: row.against_argument,
    });
    cat.sections.set(row.section, section);
  }

  const result = Array.from(categories.values()).map((c) => ({
    category_id: c.category_id,
    slug: c.slug,
    title: c.title,
    blurb: c.blurb,
    sections: Array.from(c.sections.values()),
  }));

  return NextResponse.json({ categories: result });
}
