import { NextRequest, NextResponse } from "next/server";
import { anthropic, MODEL } from "@/lib/anthropic";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { embedBatch, embeddingsAvailable, toVectorLiteral } from "@/lib/embeddings";
import {
  RELATIONSHIP_LABELS,
  RelationshipLabel,
  colorForRelationship,
  thicknessForSimilarity,
} from "@/lib/relationship";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Live link engine.
  Client batches user statements (3 messages or 5 seconds, whichever comes first)
  and posts them here. We do three things:
    1. Embed the new statements in ONE OpenAI call.
    2. For each new statement, pgvector-search the user's personal_arguments
       for neighbours with cosine similarity > 0.75.
    3. In ONE Anthropic call, label every (a, b) pair with one of the six
       relationship tags. Insert/update links accordingly.
  This keeps token spend flat no matter how big the batch gets, which is the
  spec's core token-efficiency requirement.
*/

interface GenRequest {
  statements: { topic_id?: string; text: string }[];
}

export async function POST(req: NextRequest) {
  const supa = await supabaseServer();
  const { data: u } = await supa.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = u.user.id;

  const { statements } = (await req.json()) as GenRequest;
  const isBackgroundPulse = !Array.isArray(statements) || statements.length === 0;

  if (!embeddingsAvailable()) {
    // Graceful no-op so the app still runs without the embedding key.
    return NextResponse.json({ inserted: 0, skipped: "no-openai-key" });
  }

  const svc = supabaseService();
  const anchorsToMatch: { id: string; topic_label: string; summary: string; embedding: any }[] = [];

  if (!isBackgroundPulse) {
    // 1. Embed the new statements in a single API call.
    const texts = statements.map((s) => s.text).filter((t) => t && t.trim().length > 0);
    const embeds = texts.length > 0 ? await embedBatch(texts) : [];

    // 2. Figure out which personal_argument each statement belongs to
    for (let i = 0; i < statements.length; i++) {
      const s = statements[i];
      const vec = embeds[i];
      if (!vec) continue;
      if (s.topic_id) {
        const { data: row } = await svc
          .from("personal_arguments")
          .select("id, word_count, topic_label, summary")
          .eq("id", s.topic_id)
          .maybeSingle();
        if (row) {
          const addedWords = s.text.split(/\s+/).filter(Boolean).length;
          await svc
            .from("personal_arguments")
            .update({
              word_count: (row.word_count ?? 0) + addedWords,
              embedding: toVectorLiteral(vec),
            })
            .eq("id", row.id);

          anchorsToMatch.push({
            id: row.id,
            topic_label: row.topic_label,
            summary: row.summary ?? "",
            embedding: vec
          });
        }
      }
    }
  } else {
    // BACKGROUND BRAIN SCAN: No new statements. Pick up to 4 'stale' nodes
    // that haven't been updated recently to cross-reference with the graph.
    const { data: staleNodes } = await svc
      .from("personal_arguments")
      .select("id, topic_label, summary, embedding")
      .eq("user_id", userId)
      .not("embedding", "is", null)
      .order("updated_at", { ascending: true })
      .limit(4);

    if (staleNodes) {
      for (const n of staleNodes) {
        anchorsToMatch.push({
          id: n.id,
          topic_label: n.topic_label,
          summary: n.summary ?? "",
          embedding: n.embedding // string literal from pgvector
        });
        // Bump updated_at so it cycles to the back of the queue
        await svc.from("personal_arguments").update({ updated_at: new Date().toISOString() }).eq("id", n.id);
      }
    }
  }

  if (anchorsToMatch.length === 0) return NextResponse.json({ inserted: 0 });

  // 3. For each anchor node, find neighbours across the graph.
  const candidatePairs: {
    statement_idx: number;
    a_id: string; // the anchor node
    b_id: string; // the neighbour that was matched
    similarity: number;
    a_label: string;
    b_label: string;
    a_summary: string;
    b_summary: string;
  }[] = [];

  for (let i = 0; i < anchorsToMatch.length; i++) {
    const anchor = anchorsToMatch[i];
    const vecLiteral = typeof anchor.embedding === "string" ? anchor.embedding : toVectorLiteral(anchor.embedding);

    const { data: matches, error: rpcErr } = await svc.rpc("match_personal_arguments", {
      p_user_id: userId,
      query_embedding: vecLiteral,
      match_threshold: 0.70, // Slightly lower threshold to ensure old nodes can find weaker tethers
      match_count: 8,
    });
    if (rpcErr) {
      console.warn("match_personal_arguments error", rpcErr);
      continue;
    }
    for (const m of matches ?? []) {
      if (m.id === anchor.id) continue;
      candidatePairs.push({
        statement_idx: i,
        a_id: anchor.id,
        b_id: m.id,
        similarity: Number(m.similarity),
        a_label: anchor.topic_label,
        b_label: m.topic_label,
        a_summary: anchor.summary ?? "",
        b_summary: m.summary ?? "",
      });
    }
  }

  // 3.5. MERGE PASS (Blobs within Blobs):
  // If similarity is very high (> 0.82), we merge the nodes completely.
  // The 'raw_excerpts' act as the subtopics that get grouped together.
  const mergedIds = new Set<string>();
  for (const p of candidatePairs) {
    if (p.similarity > 0.82 && !mergedIds.has(p.a_id) && !mergedIds.has(p.b_id)) {
      const { data: bNode } = await svc.from("personal_arguments").select("*").eq("id", p.b_id).maybeSingle();
      const { data: aNode } = await svc.from("personal_arguments").select("*").eq("id", p.a_id).maybeSingle();

      if (aNode && bNode) {
        const mergedExcerpts = [...(aNode.raw_excerpts || []), ...(bNode.raw_excerpts || [])];
        // Create a grouped summary to show they combined
        const newSummary = `${aNode.summary} (Also encompasses: ${bNode.topic_label.toLowerCase()})`;

        // Push B's subtopics into A, making A larger and richer
        await svc.from("personal_arguments").update({
          summary: newSummary,
          raw_excerpts: mergedExcerpts,
          word_count: (aNode.word_count || 0) + (bNode.word_count || 0),
        }).eq("id", p.a_id);

        // Erase B
        await svc.from("personal_arguments").delete().eq("id", p.b_id);

        mergedIds.add(p.b_id);
      }
    }
  }

  // Filter out pairs that involve deleted/merged nodes to avoid creating orphan links
  const finalPairs = candidatePairs.filter(p => !mergedIds.has(p.b_id) && !mergedIds.has(p.a_id));

  if (finalPairs.length === 0) return NextResponse.json({ inserted: 0, merged: mergedIds.size });

  // 4. Label every remaining pair in a single Anthropic call.
  const labelingPrompt = `You label relationships between political topic pairs.
For each pair, pick EXACTLY one label from: ${RELATIONSHIP_LABELS.join(", ")}.
Return ONLY a JSON array of the same length, each item { "label": "..." }. No prose.

Pairs:
${finalPairs
      .map(
        (p, i) => `${i}. A=[${p.a_label}] ${p.a_summary}
   B=[${p.b_label}] ${p.b_summary}`,
      )
      .join("\n")}`;

  let labels: RelationshipLabel[] = [];
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: Math.min(200, 50 + finalPairs.length * 8),
      messages: [{ role: "user", content: labelingPrompt }],
    });
    const text = resp.content.find((c) => c.type === "text")?.text ?? "";
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start >= 0 && end > start) {
      const arr = JSON.parse(text.slice(start, end + 1));
      labels = arr.map((x: any) => (isRelationshipLabel(x?.label) ? x.label : "tangent"));
    }
  } catch (err) {
    console.warn("relationship label call failed", err);
  }
  if (labels.length !== finalPairs.length) {
    // Fall back to a safe default rather than skip inserts.
    labels = finalPairs.map(() => "tangent" as RelationshipLabel);
  }

  // 5. Insert or update each link.
  let inserted = 0;
  for (let i = 0; i < finalPairs.length; i++) {
    const p = finalPairs[i];
    const label = labels[i];
    const color = colorForRelationship(label);
    const thickness = thicknessForSimilarity(p.similarity);

    // Canonical ordering so we always find the same row regardless of which
    // side asked for the link first.
    const [low, high] = [p.a_id, p.b_id].sort();

    const { data: existing } = await svc
      .from("links")
      .select("id, similarity_score, relationship_label")
      .or(
        `and(node_a_id.eq.${low},node_b_id.eq.${high}),and(node_a_id.eq.${high},node_b_id.eq.${low})`,
      )
      .maybeSingle();

    if (existing) {
      await svc
        .from("links")
        .update({
          similarity_score: p.similarity,
          relationship_label: label,
          arc_color: color,
          arc_thickness: thickness,
          link_summary: shortReason(label, p.a_label, p.b_label),
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await svc.from("links").insert({
        node_a_id: low,
        node_b_id: high,
        similarity_score: p.similarity,
        relationship_label: label,
        arc_color: color,
        arc_thickness: thickness,
        link_summary: shortReason(label, p.a_label, p.b_label),
        animated_in: false,
        particle_direction: "a_to_b",
        is_user_confirmed: false,
      });
      inserted++;
    }
  }

  // 6. Fade out links whose last-seen similarity has dropped below 0.75.
  //    Cheap scheduled cleanup: expire links for this user's nodes that
  //    haven't been touched in the last 10 minutes.
  await svc
    .from("links")
    .delete()
    .lt("last_seen_at", new Date(Date.now() - 10 * 60_000).toISOString())
    .lt("similarity_score", 0.75);

  return NextResponse.json({ inserted, pairs: finalPairs.length, merged: mergedIds.size });
}

function isRelationshipLabel(v: any): v is RelationshipLabel {
  return typeof v === "string" && (RELATIONSHIP_LABELS as string[]).includes(v);
}

function shortReason(label: RelationshipLabel, a: string, b: string): string {
  return `${a} ${label} ${b}`;
}
