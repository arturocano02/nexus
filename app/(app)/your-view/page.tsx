"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";
import AdvisorButton from "@/components/AdvisorButton";
import AdvisorOverlay from "@/components/AdvisorOverlay";
import ManifestoPanel from "@/components/ManifestoPanel";
import type { MapNodeDatum, UserView, Link } from "@/lib/types";

const NodeMap = dynamic(() => import("@/components/NodeMap"), { ssr: false });

// Read arena context dropped by the arena page when "Add your argument" was tapped
function readArenaContext() {
  try {
    const raw = sessionStorage.getItem("nexus_arena_context");
    if (!raw) return null;
    sessionStorage.removeItem("nexus_arena_context");
    return JSON.parse(raw) as { topic: string; for_args: string[]; against_args: string[] };
  } catch {
    return null;
  }
}

// Color = intensity of conviction. All personal nodes stay in the amber family;
// brightness encodes how strongly the user feels — bright gold → dim ochre → near-black.
function colorFromConfidence(score: number): string {
  const s = Math.max(0, Math.min(1, score));
  if (s >= 0.78) return "#FFBF00"; // bright amber
  if (s >= 0.60) return "#D4900A"; // warm amber
  if (s >= 0.42) return "#9A630A"; // dark amber
  if (s >= 0.25) return "#5E3D0A"; // very dim amber-brown
  return "#3A2608";                // near-black amber (barely a flicker)
}

export default function YourViewPage() {
  const { user, ready } = useUser();

  // Primary data source: user_views
  const [userViews, setUserViews] = useState<UserView[]>([]);

  // Stance lookup: topic_label → best inferred stance
  const [stanceByTopic, setStanceByTopic] = useState<Map<string, "yes" | "no" | "abstain">>(new Map());

  // Advisor state
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [advisorTopic, setAdvisorTopic] = useState<string | null>(null);
  const [arenaContext, setArenaContext] = useState<{ topic: string; for_args: string[]; against_args: string[] } | null>(null);

  // Manifesto panel state (lifted so advisor overlay can open it)
  const [manifestoOpen, setManifestoOpen] = useState(false);

  // Raw personal_links rows from DB; processed into Link objects via useMemo below
  const [rawLinks, setRawLinks] = useState<any[]>([]);
  // Link clicked on globe → show explanation overlay
  const [selectedLink, setSelectedLink] = useState<Link | null>(null);

  const supa = supabaseBrowser();

  // Pick up arena context on mount
  useEffect(() => {
    const ctx = readArenaContext();
    if (ctx) {
      setArenaContext(ctx);
      setAdvisorTopic(ctx.topic);
      setAdvisorOpen(true);
    }
  }, []);

  // -----------------------------------------------------------------------
  // Load user_views (primary globe data source) + realtime subscription
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;

    async function loadViews() {
      try {
        const { data } = await supa
          .from("user_views")
          .select("*")
          .eq("user_id", user!.id)
          .eq("is_deleted", false);
        if (data) setUserViews(data as UserView[]);
      } catch { /* table may not exist yet */ }
    }

    loadViews();

    // Realtime: insert/update → merge into state, soft-delete → remove
    const ch = supa
      .channel(`views-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_views", filter: `user_id=eq.${user.id}` },
        (payload: any) => {
          const { eventType, new: next, old } = payload;
          if (eventType === "INSERT") {
            const v = next as UserView;
            if (!v.is_deleted) setUserViews(prev => [...prev, v]);
          } else if (eventType === "UPDATE") {
            const v = next as UserView;
            if (v.is_deleted) {
              setUserViews(prev => prev.filter(x => x.id !== v.id));
            } else {
              setUserViews(prev => {
                const idx = prev.findIndex(x => x.id === v.id);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = v;
                  return copy;
                }
                return [...prev, v];
              });
            }
          } else if (eventType === "DELETE") {
            setUserViews(prev => prev.filter(x => x.id !== old.id));
          }
        }
      )
      .subscribe();

    return () => { supa.removeChannel(ch); };
  }, [user?.id]);

  // -----------------------------------------------------------------------
  // Load inferred_positions + taxonomy_categories for stance lookup
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;

    async function loadStances() {
      try {
        const [catRes, subRes, posRes] = await Promise.all([
          supa.from("taxonomy_categories").select("id, name"),
          supa.from("taxonomy_subtopics").select("id, name"),
          supa
            .from("inferred_positions")
            .select("category_id, subtopic_id, stance, confidence")
            .eq("user_id", user!.id)
            .not("stance", "is", null)
            .neq("stance", "unclear"),
        ]);

        const categories: { id: string; name: string }[] = catRes.data ?? [];
        const subtopics: { id: string; name: string }[] = subRes.data ?? [];
        const positions: { category_id: string; subtopic_id: string | null; stance: string; confidence: number }[] = posRes.data ?? [];

        // Best stance per category_id and per subtopic_id (highest confidence wins)
        const bestByCategory = new Map<string, { stance: string; confidence: number }>();
        const bestBySubtopic = new Map<string, { stance: string; confidence: number }>();
        for (const p of positions) {
          if (p.category_id) {
            const ex = bestByCategory.get(p.category_id);
            if (!ex || p.confidence > ex.confidence)
              bestByCategory.set(p.category_id, { stance: p.stance, confidence: p.confidence });
          }
          if (p.subtopic_id) {
            const ex = bestBySubtopic.get(p.subtopic_id);
            if (!ex || p.confidence > ex.confidence)
              bestBySubtopic.set(p.subtopic_id, { stance: p.stance, confidence: p.confidence });
          }
        }

        const catIdByName = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));
        const subIdByName = new Map(subtopics.map(s => [s.name.toLowerCase(), s.id]));

        const map = new Map<string, "yes" | "no" | "abstain">();
        for (const view of userViews) {
          const label = view.topic_label.toLowerCase();
          // Subtopic name takes priority (most specific match)
          const subId = subIdByName.get(label);
          if (subId) {
            const best = bestBySubtopic.get(subId);
            if (best && ["yes", "no", "abstain"].includes(best.stance)) {
              map.set(view.topic_label, best.stance as "yes" | "no" | "abstain");
              continue;
            }
          }
          // Fall back to category name
          const catId = catIdByName.get(label);
          if (catId) {
            const best = bestByCategory.get(catId);
            if (best && ["yes", "no", "abstain"].includes(best.stance)) {
              map.set(view.topic_label, best.stance as "yes" | "no" | "abstain");
            }
          }
        }
        setStanceByTopic(map);
      } catch { /* tables may not exist yet */ }
    }

    loadStances();
  }, [user?.id, userViews]);

  // -----------------------------------------------------------------------
  // Load personal_links raw rows (processed into Link objects below)
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;
    async function loadLinks() {
      try {
        const { data } = await supa
          .from("personal_links")
          .select("id, node_a_id, node_b_id, relationship, strength, created_at")
          .eq("user_id", user!.id);
        if (data) setRawLinks(data);
      } catch { /* table may not exist yet */ }
    }
    loadLinks();
  }, [user?.id]);

  // Enrich raw links with labels and AI-generated explanation summaries
  const personalLinks = useMemo((): Link[] => {
    return rawLinks.map(l => {
      const viewA = userViews.find(v => v.id === l.node_a_id);
      const viewB = userViews.find(v => v.id === l.node_b_id);
      const aLabel = viewA?.topic_label ?? "this view";
      const bLabel = viewB?.topic_label ?? "this view";
      const isSupporting = l.relationship === "supporting";
      const link_summary = isSupporting
        ? `Your positions on ${aLabel} and ${bLabel} point in the same direction — they reinforce each other and suggest consistent underlying values.`
        : `Your positions on ${aLabel} and ${bLabel} pull against each other — holding both creates a tension in your political framework that may need resolving.`;
      return {
        id: l.id,
        node_a_id: `user_${l.node_a_id}`,
        node_b_id: `user_${l.node_b_id}`,
        similarity_score: l.strength,
        particle_direction: "a_to_b" as const,
        is_user_confirmed: false,
        relationship_label: (isSupporting ? "builds on" : "contradicts") as any,
        arc_color: isSupporting ? "#22c55e" : "#FF5A6A",
        link_summary,
        last_seen_at: l.created_at,
      };
    });
  }, [rawLinks, userViews]);

  // -----------------------------------------------------------------------
  // Arc tap — show explanation overlay for the clicked link
  // -----------------------------------------------------------------------
  const handleLinkSelect = useCallback((link: Link) => {
    setSelectedLink(link);
  }, []);

  // -----------------------------------------------------------------------
  // Node tap — open advisor pre-loaded with topic_label from the tapped view
  // -----------------------------------------------------------------------
  const handleNodeSelect = useCallback((id: string) => {
    const viewId = id.replace("user_", "");
    const view = userViews.find(v => v.id === viewId);
    if (view) {
      setAdvisorTopic(view.topic_label);
      setArenaContext(null);
      setAdvisorOpen(true);
    }
  }, [userViews]);

  // -----------------------------------------------------------------------
  // Build globe nodes from user_views
  // -----------------------------------------------------------------------
  const nodes = useMemo((): MapNodeDatum[] => {
    return userViews.map(view => {
      // Size = conversation volume: excerpts (conversation depth) + summary word count
      const excerptCount = Array.isArray(view.raw_excerpts) ? view.raw_excerpts.length : 0;
      const summaryWords = (view.summary || "").split(/\s+/).filter(Boolean).length;
      const volume = Math.min(1, excerptCount / 6 + summaryWords / 60);
      const weight = 0.25 + volume * 0.75;

      // Color = intensity of feeling (amber spectrum: bright → dim based on confidence)
      const hexColor = colorFromConfidence(view.confidence_score);

      // Conviction drives glow intensity — submitted views get a floor boost
      const conviction = view.submitted_to_arena
        ? Math.max(view.confidence_score, 0.82)
        : view.confidence_score;

      return {
        id: `user_${view.id}`,
        label: view.topic_label,
        weight,
        conviction,
        hexColor,
        isOwn: true,
        stance: stanceByTopic.get(view.topic_label) ?? null,
      };
    });
  }, [userViews, stanceByTopic]);

  // -----------------------------------------------------------------------
  // Loading skeleton
  // -----------------------------------------------------------------------
  if (!ready) {
    return (
      <div className="relative w-screen overflow-hidden" style={{ height: "100dvh" }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-64 h-64">
            {[
              { size: 80, x: "50%", y: "50%", delay: "0ms" },
              { size: 48, x: "30%", y: "30%", delay: "200ms" },
              { size: 40, x: "70%", y: "65%", delay: "400ms" },
            ].map((s, i) => (
              <div
                key={i}
                className="absolute rounded-full"
                style={{
                  width: s.size,
                  height: s.size,
                  left: s.x,
                  top: s.y,
                  transform: "translate(-50%, -50%)",
                  background: "radial-gradient(circle at 35% 35%, rgba(104,104,160,0.5), rgba(5,5,38,0.3))",
                  boxShadow: "0 0 40px rgba(104,104,160,0.15)",
                  animation: `pulse 2s ease-in-out ${s.delay} infinite`,
                }}
              />
            ))}
          </div>
        </div>
        <p className="absolute bottom-1/3 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.5em] text-secondary/20 uppercase animate-pulse">
          Loading your map...
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-screen overflow-hidden" style={{ height: "100dvh" }}>

      {/* 3D Globe */}
      <NodeMap
        nodes={nodes}
        links={personalLinks}
        onSelect={handleNodeSelect}
        onSelectLink={handleLinkSelect}
        radius={2.8}
        cameraDistance={11}
        emptyHint="Tap your advisor to start"
      />

      {/* ----------------------------------------------------------------
          Top overlay: legend (left) + My Manifesto button (center)
      ---------------------------------------------------------------- */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-start justify-between px-5 pointer-events-none"
        style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>

        {/* Left: legend */}
        <div className="flex flex-col gap-1 pointer-events-none">
          <p className="text-[9px] uppercase tracking-[0.35em] font-bold"
            style={{ color: "rgba(255,191,0,0.35)" }}>
            Your political map
          </p>
          {[
            { color: "#FFBF00", label: "High / Submitted" },
            { color: "#00DCFF", label: "Medium confidence" },
            { color: "#888780", label: "Low confidence" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 5px ${color}88` }} />
              <span className="text-[8px] font-bold tracking-widest" style={{ color: color + "77" }}>{label}</span>
            </div>
          ))}
          {/* Stance dots */}
          <div className="mt-1 flex flex-col gap-1">
            {[
              { color: "#4ade80", label: "Yes stance" },
              { color: "#FF5A6A", label: "No stance" },
              { color: "#888780", label: "Abstain" },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full border border-black/40" style={{ background: color, boxShadow: `0 0 4px ${color}` }} />
                <span className="text-[8px] font-bold tracking-widest" style={{ color: color + "77" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Center: Manifesto button */}
        <div className="absolute left-1/2 -translate-x-1/2"
          style={{ top: "max(16px, env(safe-area-inset-top))" }}>
          <ManifestoPanel
            open={manifestoOpen}
            onOpen={() => setManifestoOpen(true)}
            onClose={() => setManifestoOpen(false)}
            onDeployed={(submitted) => {
              setUserViews(prev => {
                const updated = [...prev];
                for (const s of submitted) {
                  const idx = updated.findIndex(v => v.id === s.id);
                  if (idx >= 0) updated[idx] = s;
                  else updated.push(s);
                }
                return updated;
              });
            }}
          />
        </div>
      </div>

      {/* ----------------------------------------------------------------
          Centre hint
      ---------------------------------------------------------------- */}
      <AnimatePresence>
        {!advisorOpen && nodes.length === 0 && (
          <motion.div
            key="centre-prompt"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
          >
            <h1
              className="font-display font-bold tracking-tight text-secondary leading-tight text-center px-6"
              style={{ fontSize: "clamp(1.1rem, 2.2vw, 1.6rem)", textShadow: "0 2px 20px rgba(0,0,0,0.8)" }}
            >
              What topic do you want to discuss today?
            </h1>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------------
          Bottom: Advisor button — fixed, above nav bar
      ---------------------------------------------------------------- */}
      <div
        className="absolute bottom-0 inset-x-0 z-20 flex justify-center pointer-events-none"
        style={{ paddingBottom: "calc(80px + max(16px, env(safe-area-inset-bottom)))" }}
      >
        <AdvisorButton
          onClick={() => { setAdvisorTopic(null); setArenaContext(null); setAdvisorOpen(true); }}
          hasAlert={false}
        />
      </div>

      {/* ----------------------------------------------------------------
          Advisor overlay
      ---------------------------------------------------------------- */}
      <AdvisorOverlay
        open={advisorOpen}
        onClose={() => setAdvisorOpen(false)}
        initialTopic={advisorTopic}
        arenaContext={arenaContext}
        unsubmittedCount={userViews.filter(v => !v.submitted_to_arena && !v.is_deleted).length}
        onOpenManifesto={() => setManifestoOpen(true)}
      />

      {/* ----------------------------------------------------------------
          Link explanation overlay — shown when an arc is clicked
      ---------------------------------------------------------------- */}
      <AnimatePresence>
        {selectedLink && (
          <motion.div
            key="link-explanation"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="absolute bottom-0 inset-x-0 z-30 flex justify-center pointer-events-none"
            style={{ paddingBottom: "calc(100px + max(16px, env(safe-area-inset-bottom)))" }}
          >
            <div
              className="pointer-events-auto mx-4 rounded-2xl px-5 py-4 max-w-sm w-full"
              style={{
                background: "rgba(6,8,22,0.97)",
                border: `1px solid ${selectedLink.arc_color ?? "#FFBF00"}44`,
                boxShadow: `0 8px 32px rgba(0,0,0,0.9), 0 0 20px ${selectedLink.arc_color ?? "#FFBF00"}18`,
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className="font-display text-[9px] font-bold tracking-[0.25em] uppercase"
                  style={{ color: selectedLink.arc_color ?? "#FFBF00" }}
                >
                  {selectedLink.arc_color === "#22c55e" ? "Strengthens" : "Contradicts"}
                </span>
                <button
                  onClick={() => setSelectedLink(null)}
                  className="text-white/30 hover:text-white/70 transition-colors text-sm leading-none"
                >
                  ✕
                </button>
              </div>
              <p className="text-white/75 text-[12px] leading-relaxed">
                {selectedLink.link_summary ?? "These two views are connected."}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
