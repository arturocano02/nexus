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

// -----------------------------------------------------------------------
// Color from confidence_score (spec: amber ≥0.7, cyan 0.4–0.7, gray <0.4)
// -----------------------------------------------------------------------
function colorFromConfidence(score: number): string {
  if (score >= 0.7) return "#FFBF00";
  if (score >= 0.4) return "#00DCFF";
  return "#888780";
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

  // Personal links: supporting/contradicting arcs between user_views
  const [personalLinks, setPersonalLinks] = useState<Link[]>([]);

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
        const [catRes, posRes] = await Promise.all([
          supa.from("taxonomy_categories").select("id, name"),
          supa
            .from("inferred_positions")
            .select("category_id, stance, confidence")
            .eq("user_id", user!.id)
            .not("stance", "is", null)
            .neq("stance", "unclear"),
        ]);

        const categories: { id: string; name: string }[] = catRes.data ?? [];
        const positions: { category_id: string; stance: string; confidence: number }[] = posRes.data ?? [];

        // Best stance per category_id (highest confidence)
        const bestByCategory = new Map<string, { stance: string; confidence: number }>();
        for (const p of positions) {
          if (!p.category_id) continue;
          const existing = bestByCategory.get(p.category_id);
          if (!existing || p.confidence > existing.confidence) {
            bestByCategory.set(p.category_id, { stance: p.stance, confidence: p.confidence });
          }
        }

        // Map category name (lowercased) → stance
        const catIdByName = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));
        const map = new Map<string, "yes" | "no" | "abstain">();
        for (const view of userViews) {
          const catId = catIdByName.get(view.topic_label.toLowerCase());
          if (!catId) continue;
          const best = bestByCategory.get(catId);
          if (best && ["yes", "no", "abstain"].includes(best.stance)) {
            map.set(view.topic_label, best.stance as "yes" | "no" | "abstain");
          }
        }
        setStanceByTopic(map);
      } catch { /* tables may not exist yet */ }
    }

    loadStances();
  }, [user?.id, userViews]);

  // -----------------------------------------------------------------------
  // Load personal_links for green/red arcs
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;

    async function loadLinks() {
      try {
        const { data } = await supa
          .from("personal_links")
          .select("id, node_a_id, node_b_id, relationship, strength, created_at")
          .eq("user_id", user!.id);
        if (!data) return;
        setPersonalLinks(
          data.map(l => ({
            id: l.id,
            node_a_id: `user_${l.node_a_id}`,
            node_b_id: `user_${l.node_b_id}`,
            similarity_score: l.strength,
            particle_direction: "a_to_b" as const,
            is_user_confirmed: false,
            relationship_label: null,
            arc_color: l.relationship === "supporting" ? "#22c55e" : "#FF5A6A",
            last_seen_at: l.created_at,
          }))
        );
      } catch { /* table may not exist yet */ }
    }

    loadLinks();
  }, [user?.id]);

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
      const excerptCount = Array.isArray(view.raw_excerpts) ? view.raw_excerpts.length : 0;
      // Size: 0.3 (0 excerpts) → 1.0 (10+ excerpts)
      const weight = 0.3 + (Math.min(excerptCount, 10) / 10) * 0.7;

      // Submitted nodes are always amber; others are confidence-colored
      const hexColor = view.submitted_to_arena
        ? "#FFBF00"
        : colorFromConfidence(view.confidence_score);

      // Slightly boost conviction for submitted nodes so their glow is visually distinct
      const conviction = view.submitted_to_arena
        ? Math.max(view.confidence_score, 0.85)
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
    </div>
  );
}
