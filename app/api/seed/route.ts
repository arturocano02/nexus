import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Predefined fake personas with diverse political views
const FAKE_PERSONAS = [
    {
        username: "liberty_hawk",
        topics: [
            {
                topic_label: "Gun Rights",
                summary: "The Second Amendment is non-negotiable. An armed populace is the last check on government overreach.",
                confidence: 0.92,
                related: ["Civil Liberties", "Government Power"],
            },
            {
                topic_label: "Free Markets",
                summary: "Deregulation drives innovation. The government should get out of the way of entrepreneurs.",
                confidence: 0.88,
                related: ["Tax Policy", "Government Power"],
            },
        ],
    },
    {
        username: "green_future",
        topics: [
            {
                topic_label: "Climate Action",
                summary: "We need aggressive carbon taxes and a full transition to renewables within 15 years.",
                confidence: 0.95,
                related: ["Energy Policy", "Economic Justice"],
            },
            {
                topic_label: "Corporate Accountability",
                summary: "Corporations should be legally liable for environmental damage with no cap on fines.",
                confidence: 0.82,
                related: ["Climate Action", "Free Markets"],
            },
        ],
    },
    {
        username: "pragmatic_center",
        topics: [
            {
                topic_label: "Healthcare Reform",
                summary: "A public option alongside private insurance is the most realistic path to universal coverage.",
                confidence: 0.78,
                related: ["Tax Policy", "Economic Justice"],
            },
            {
                topic_label: "Immigration",
                summary: "We need both stronger border security and a clear path to citizenship for people already here.",
                confidence: 0.72,
                related: ["Economic Justice", "Civil Liberties"],
            },
        ],
    },
    {
        username: "data_driven",
        topics: [
            {
                topic_label: "Education",
                summary: "School choice and charter schools have shown measurable improvements in underserved communities.",
                confidence: 0.81,
                related: ["Economic Justice", "Government Power"],
            },
            {
                topic_label: "Tax Policy",
                summary: "A flat consumption tax would be simpler, fairer, and harder to game than income taxes.",
                confidence: 0.74,
                related: ["Free Markets", "Economic Justice"],
            },
        ],
    },
    {
        username: "social_justice_now",
        topics: [
            {
                topic_label: "Economic Justice",
                summary: "Wealth inequality is the root cause of most social problems. We need wealth caps and UBI.",
                confidence: 0.91,
                related: ["Healthcare Reform", "Education"],
            },
            {
                topic_label: "Criminal Justice",
                summary: "Mass incarceration is a failed experiment. We need to defund punitive policing and invest in communities.",
                confidence: 0.87,
                related: ["Civil Liberties", "Economic Justice"],
            },
        ],
    },
    {
        username: "national_unity",
        topics: [
            {
                topic_label: "Immigration",
                summary: "Immigration should be strictly merit-based. Cultural integration must be a priority.",
                confidence: 0.85,
                related: ["National Security", "Economic Justice"],
            },
            {
                topic_label: "National Security",
                summary: "Military strength is the foundation of peace. Weakness invites aggression.",
                confidence: 0.9,
                related: ["Government Power", "Immigration"],
            },
        ],
    },
    {
        username: "tech_libertarian",
        topics: [
            {
                topic_label: "Digital Privacy",
                summary: "Government surveillance is the greatest threat to individual freedom in the 21st century.",
                confidence: 0.93,
                related: ["Civil Liberties", "Government Power"],
            },
            {
                topic_label: "AI Regulation",
                summary: "AI regulation should be minimal. Innovation will solve problems faster than bureaucracy can write rules.",
                confidence: 0.76,
                related: ["Free Markets", "Digital Privacy"],
            },
        ],
    },
    {
        username: "community_first",
        topics: [
            {
                topic_label: "Housing Policy",
                summary: "We need massive public housing investment and rent control to combat the affordability crisis.",
                confidence: 0.84,
                related: ["Economic Justice", "Government Power"],
            },
            {
                topic_label: "Civil Liberties",
                summary: "Individual rights must be balanced with community welfare. Freedom without responsibility is anarchy.",
                confidence: 0.69,
                related: ["Criminal Justice", "Government Power"],
            },
        ],
    },
];

// POST /api/seed - populate the system with fake agents
export async function POST() {
    const svc = supabaseService();
    let usersCreated = 0;
    let nodesCreated = 0;
    let agentsCreated = 0;

    for (const persona of FAKE_PERSONAS) {
        // Create a fake auth user via admin API
        const { data: authUser, error: authErr } = await svc.auth.admin.createUser({
            email: `${persona.username}@nexus-demo.local`,
            password: `demo-${persona.username}-${Date.now()}`,
            email_confirm: true,
            user_metadata: { username: persona.username, is_demo: true },
        });

        if (authErr || !authUser.user) {
            console.error(`Failed to create user ${persona.username}:`, authErr?.message);
            continue;
        }

        const userId = authUser.user.id;
        usersCreated++;

        // Update public profile
        await svc.from("users").update({ username: persona.username }).eq("id", userId);

        for (const topic of persona.topics) {
            // Create personal argument
            const { data: pa } = await svc.from("personal_arguments").insert({
                user_id: userId,
                topic_label: topic.topic_label,
                summary: topic.summary,
                confidence_score: topic.confidence,
                related_topics: topic.related,
                raw_excerpts: [{ text: topic.summary, ts: new Date().toISOString() }],
                submitted: true,
            }).select("id").single();

            if (!pa) continue;

            // Upsert into public_nodes
            const { data: existing } = await svc
                .from("public_nodes")
                .select("id, debate_log, top_points")
                .ilike("topic_label", topic.topic_label)
                .maybeSingle();

            let nodeId: string;
            const debateEntry = {
                agent_id: userId,
                text: topic.summary,
                is_anonymous: true,
                ts: new Date().toISOString(),
            };

            if (existing) {
                nodeId = existing.id;
                const log = Array.isArray(existing.debate_log) ? existing.debate_log : [];
                const points = Array.isArray(existing.top_points) ? existing.top_points : [];
                await svc.from("public_nodes").update({
                    debate_log: [...log, debateEntry],
                    top_points: [...points, topic.summary].slice(-10),
                    is_debating: true,
                    agreement_pct: Math.round(Math.random() * 40 + 30),
                    tension_coefficient: +(Math.random() * 0.6 + 0.2).toFixed(3),
                }).eq("id", nodeId);
            } else {
                const { data: created } = await svc.from("public_nodes").insert({
                    topic_label: topic.topic_label,
                    consensus_summary: topic.summary,
                    top_points: [topic.summary],
                    debate_log: [debateEntry],
                    is_debating: true,
                    agreement_pct: Math.round(Math.random() * 40 + 30),
                    tension_coefficient: +(Math.random() * 0.6 + 0.2).toFixed(3),
                }).select("id").single();

                if (!created) continue;
                nodeId = created.id;
            }
            nodesCreated++;

            // Create agent link
            await svc.from("agents").insert({
                user_id: userId,
                public_node_id: nodeId,
                argument_set: { topic_label: topic.topic_label, text: topic.summary },
                is_anonymous: true,
                is_active: true,
            });
            agentsCreated++;
        }
    }

    return NextResponse.json({
        success: true,
        usersCreated,
        nodesCreated,
        agentsCreated,
        message: `Seeded ${usersCreated} fake users with ${agentsCreated} agent positions across ${nodesCreated} topic nodes.`,
    });
}
