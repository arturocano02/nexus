import { supabaseService } from "./supabase/service";
import { anthropic, MODEL } from "./anthropic";
import {
  colorForRelationship,
  thicknessForSimilarity,
  RELATIONSHIP_LABELS,
  RelationshipLabel,
} from "./relationship";

/**
 * REPLACED: No longer using OpenAI / pgvector for nodes.
 * Now using Claude to semantically scan and link nodes.
 */

export async function processSemanticConnections(nodeId: string, type: 'personal' | 'public') {
    const svc = supabaseService();
    const table = type === 'personal' ? 'personal_arguments' : 'public_nodes';

    // 1. Get the node data
    const { data: node } = await svc
        .from(table)
        .select("id, topic_label, summary")
        .eq("id", nodeId)
        .single();

    if (!node) return;

    // 2. Fetch other nodes to compare against
    // To scale, we limit this to recent or highly active nodes
    const { data: others } = await svc
        .from("public_nodes")
        .select("id, topic_label, consensus_summary")
        .neq("id", nodeId)
        .limit(25); // Claude can easily handle 25 context items

    if (!others || others.length === 0) return;

    // 3. Ask Claude which ones are related, AND what kind of relationship it is.
    // Giving Claude the label vocabulary upfront gets us properly color-coded
    // arcs in the arena (not just gray tangent defaults).
    const prompt = `You are a semantic analyzer for a political mind-map.
New Topic: [${node.topic_label}] - ${node.summary}

Existing Topics in the Arena:
${others.map((o, i) => `${i}: [${o.topic_label}] - ${o.consensus_summary?.slice(0, 100)}...`).join('\n')}

Identify which existing topics are logically related to the new topic, and
for each, pick EXACTLY ONE relationship label from: ${RELATIONSHIP_LABELS.join(", ")}.

Return ONLY a JSON array of objects:
{ index: number, similarity: number (0.0 to 1.0), label: string, reasoning: string (max 10 words) }
Only include items with similarity > 0.6.`;

    try {
        const resp = await anthropic.messages.create({
            model: MODEL,
            max_tokens: 1000,
            messages: [{ role: "user", content: prompt }],
        });

        const content = resp.content.find(c => c.type === 'text')?.text;
        if (!content) return;

        const matchResults = JSON.parse(content.slice(content.indexOf("["), content.lastIndexOf("]") + 1));

        // 4. Create links in the database
        for (const match of matchResults) {
            const other = others[match.index];
            if (!other) continue;

            const similarity = Math.min(1, Math.max(0, match.similarity));

            // Check if link already exists
            const { data: existing } = await svc
                .from("links")
                .select("id")
                .or(`and(node_a_id.eq.${nodeId},node_b_id.eq.${other.id}),and(node_a_id.eq.${other.id},node_b_id.eq.${nodeId})`)
                .maybeSingle();

            if (!existing) {
                // Use Claude's suggested label when valid, otherwise fall back
                // to tangent so the arc still renders (gray) until signal arrives.
                const relationship: RelationshipLabel =
                    (RELATIONSHIP_LABELS as readonly string[]).includes(match.label)
                        ? (match.label as RelationshipLabel)
                        : "tangent";
                await svc.from("links").insert({
                    node_a_id: nodeId,
                    node_b_id: other.id,
                    similarity_score: similarity,
                    link_summary: match.reasoning,
                    particle_direction: 'a_to_b',
                    relationship_label: relationship,
                    arc_color: colorForRelationship(relationship),
                    arc_thickness: thicknessForSimilarity(similarity),
                    animated_in: false,
                });

                // Merge check
                if (similarity > 0.9 && type === 'public') {
                    await attemptMerge(nodeId, other.id);
                }
            }
        }
    } catch (err) {
        console.error("Semantic connection discovery failed:", err);
    }
}

async function attemptMerge(idA: string, idB: string) {
    const svc = supabaseService();
    const { data: nodeA } = await svc.from("public_nodes").select("*").eq("id", idA).single();
    const { data: nodeB } = await svc.from("public_nodes").select("*").eq("id", idB).single();

    if (!nodeA || !nodeB) return;

    // Perform AI Merge
    const prompt = `Merge these two political topics into one super-node. 
    A: [${nodeA.topic_label}] ${nodeA.consensus_summary}
    B: [${nodeB.topic_label}] ${nodeB.consensus_summary}
    Return JSON: { topic_label: string, consensus_summary: string }`;

    const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
    });

    const content = resp.content.find(c => c.type === 'text')?.text;
    if (content) {
        try {
            const result = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
            const mergedFrom = Array.from(new Set([...(nodeA.merged_from || []), ...(nodeB.merged_from || []), idA, idB]));

            await svc.from("public_nodes").update({
                topic_label: result.topic_label,
                consensus_summary: result.consensus_summary,
                merged_from: mergedFrom
            }).eq("id", idA);

            await svc.from("public_nodes").delete().eq("id", idB);
        } catch (err) {
            console.error("Merge failure:", err);
        }
    }
}

export async function batchGenerateLinkSummaries(linkIds: string[]) {
    // This is now largely handled by the discovery prompt reasoning field.
    // Kept for backward compatibility if needed.
}
