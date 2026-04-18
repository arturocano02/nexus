import { supabaseService } from "./supabase/service";

export async function logDebateTokens(nodeId: string, tokens: number) {
    const svc = supabaseService();

    // Get current round number
    const { data: node } = await svc
        .from("public_nodes")
        .select("debate_log")
        .eq("id", nodeId)
        .single();

    const round = Array.isArray(node?.debate_log) ? node!.debate_log.length : 1;

    await svc.from("debate_token_log").insert({
        node_id: nodeId,
        tokens_used: tokens,
        round_number: round
    });
}
