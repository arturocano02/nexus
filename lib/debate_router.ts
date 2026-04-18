import { supabaseService } from "./supabase/service";
import { anthropic, MODEL } from "./anthropic";

/**
 * 100% Claude-driven Debate Router.
 * No OpenAI dependencies.
 */

interface DebateScore {
    nodeId: string;
    score: number;
}

export async function getTopDebateCandidates(
    userId: string,
    topicLabel: string,
    summary: string,
    isFirstTime: boolean
): Promise<string[]> {
    const svc = supabaseService();

    // 1. Fetch available active nodes to consider for debate
    const { data: candidates } = await svc
        .from("public_nodes")
        .select("id, topic_label, consensus_summary, is_resolved, tension_coefficient")
        .eq("is_debating", true)
        .limit(20);

    if (!candidates || candidates.length === 0) return [];

    // 2. Ask Claude to select the most relevant/tense sparring partners
    const prompt = `You are the Nexus Debate Matchmaker. 
New Participant: [${topicLabel}] - ${summary}

Arena Candidates:
${candidates.map((c, i) => `${i}: [${c.topic_label}] - ${c.is_resolved ? 'RESOLVED' : 'ACTIVE'}`).join('\n')}

Identify which 3 Arena Candidates would create the most interesting, tense, or clarifying intellectual conflict with the New Participant.
Return ONLY a JSON array of indices: [number, number, number].`;

    try {
        const resp = await anthropic.messages.create({
            model: MODEL,
            max_tokens: 200,
            messages: [{ role: "user", content: prompt }],
        });

        const content = resp.content.find(c => c.type === 'text')?.text;
        if (!content) return [];

        const indices = JSON.parse(content.slice(content.indexOf("["), content.lastIndexOf("]") + 1));

        const selectedIds: string[] = [];
        for (const idx of indices) {
            const cand = candidates[idx];
            if (cand) selectedIds.push(cand.id);
        }

        // Return 1 if first time, up to 3 otherwise
        return selectedIds.slice(0, isFirstTime ? 1 : 3);

    } catch (err) {
        console.error("Debate routing via Claude failed:", err);
        // Fallback: pick first one if everything fails
        return [candidates[0].id];
    }
}
