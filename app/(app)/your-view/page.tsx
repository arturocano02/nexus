"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";
import AdvisorButton from "@/components/AdvisorButton";
import AdvisorOverlay from "@/components/AdvisorOverlay";
import ManifestoPanel from "@/components/ManifestoPanel";
import type { TaxonomyCategory, MapNodeDatum, InferredPosition, UserView } from "@/lib/types";

const NodeMap = dynamic(() => import("@/components/NodeMap"), { ssr: false });

const GREY_BLOB = "#6868a0";

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

export default function YourViewPage() {
  const { user, ready } = useUser();
  const router = useRouter();

  const [categories, setCategories] = useState<TaxonomyCategory[]>([]);
  const [positions, setPositions] = useState<InferredPosition[]>([]);
  const [userViews, setUserViews] = useState<UserView[]>([]);
  const [viewsLoading, setViewsLoading] = useState(true);

  // Advisor state
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [advisorTopic, setAdvisorTopic] = useState<string | null>(null);
  const [arenaContext, setArenaContext] = useState<{ topic: string; for_args: string[]; against_args: string[] } | null>(null);

  // Manifesto panel state (lifted so advisor overlay can open it)
  const [manifestoOpen, setManifestoOpen] = useState(false);

  // Categories the user has spoken to — amber tint
  const [touchedIds, setTouchedIds] = useState<Set<string>>(new Set());

  const supa = supabaseBrowser();

  // Pick up arena context on mount (set by arena page "Add your argument")
  useEffect(() => {
    const ctx = readArenaContext();
    if (ctx) {
      setArenaContext(ctx);
      setAdvisorTopic(ctx.topic);
      setAdvisorOpen(true);
    }
  }, []);

  // -----------------------------------------------------------------------
  // Load categories
  // -----------------------------------------------------------------------
  useEffect(() => {
    async function load() {
      const { data } = await supa
        .from("taxonomy_categories")
        .select("id, slug, name, sort_order, created_at")
        .order("sort_order");
      if (data) {
        setCategories(data.map((c: any) => ({ ...c, opening_question: null })) as TaxonomyCategory[]);
      }
    }
    load();
  }, []);

  // -----------------------------------------------------------------------
  // Load inferred positions
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;
    async function loadPositions() {
      try {
        const { data, error } = await supa
          .from("inferred_positions")
          .select("*")
          .eq("user_id", user!.id);
        if (!error && data) {
          setPositions(data as InferredPosition[]);
          const prevCatIds = new Set(
            (data as InferredPosition[]).map(p => p.category_id).filter(Boolean) as string[]
          );
          if (prevCatIds.size > 0) {
            setTouchedIds(prev => new Set([...prev, ...prevCatIds]));
          }
        }
      } catch { /* table not yet created */ }
    }
    loadPositions();

    try {
      const sid = `pos-${user.id}`;
      const ch = supa
        .channel(sid)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "inferred_positions",
          filter: `user_id=eq.${user.id}`,
        }, () => loadPositions())
        .subscribe();
      return () => { supa.removeChannel(ch); };
    } catch { /* ignore */ }
  }, [user]);

  // -----------------------------------------------------------------------
  // Load user_views (for amber outline on submitted nodes)
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data } = await supa
          .from("user_views")
          .select("id, topic_label, submitted_to_arena, confidence_score")
          .eq("user_id", user.id)
          .eq("is_deleted", false);
        if (data) setUserViews(data as UserView[]);
      } catch { /* table may not exist */ }
      setViewsLoading(false);
    })();
  }, [user]);

  // -----------------------------------------------------------------------
  // Node tap — open advisor pre-loaded with that topic
  // -----------------------------------------------------------------------
  const handleNodeSelect = useCallback((id: string) => {
    const cat = categories.find(c => c.id === id || id.startsWith("sat-"));
    if (!cat) {
      // Satellite node — find parent category
      const subtopicId = id.replace("sat-", "");
      const pos = positions.find(p => p.subtopic_id === subtopicId);
      const parentCat = pos?.category_id
        ? categories.find(c => c.id === pos.category_id)
        : undefined;
      if (parentCat) {
        setAdvisorTopic(parentCat.name);
        setTouchedIds(prev => new Set([...prev, parentCat.id]));
      }
    } else {
      setAdvisorTopic(cat.name);
      setTouchedIds(prev => new Set([...prev, cat.id]));
    }
    setArenaContext(null);
    setAdvisorOpen(true);
  }, [categories, positions]);

  // Build set of submitted topic labels for amber outline
  const submittedTopics = new Set(
    userViews.filter(v => v.submitted_to_arena).map(v => v.topic_label)
  );

  // -----------------------------------------------------------------------
  // Build globe nodes
  // -----------------------------------------------------------------------
  function buildNodes(): MapNodeDatum[] {
    const byCategory = new Map<string, InferredPosition[]>();
    for (const p of positions) {
      if (!p.category_id) continue;
      const arr = byCategory.get(p.category_id) ?? [];
      arr.push(p);
      byCategory.set(p.category_id, arr);
    }

    const STANCE_HEX: Record<string, string> = {
      yes: "#00DCFF",
      no: "#FF5A6A",
      abstain: "#888780",
    };

    const nodes: MapNodeDatum[] = [];

    for (const cat of categories) {
      const catPos = byCategory.get(cat.id) ?? [];
      const hasPositions = catPos.length > 0;
      const isTouched = touchedIds.has(cat.id);
      const conviction = hasPositions
        ? Math.max(...catPos.map(p => p.confidence ?? 0.5))
        : isTouched ? 0.35 : 0;

      const deployedCount = catPos.filter(p => p.deployed_at).length;
      const weight = hasPositions
        ? Math.max(0.9, Math.min(1.4, 0.9 + deployedCount * 0.25))
        : 1.0;

      const isSubmittedToArena = submittedTopics.has(cat.name);

      nodes.push({
        id: cat.id,
        label: cat.name,
        weight,
        conviction,
        isOwn: hasPositions || isTouched,
        hexColor: isSubmittedToArena
          ? "#FFBF00"                                           // amber for submitted
          : (hasPositions || isTouched) ? undefined : GREY_BLOB,
      });

      // Satellite blobs
      const bySubtopic = new Map<string, InferredPosition>();
      for (const p of catPos) {
        if (!p.subtopic_id || !p.stance || p.stance === "unclear") continue;
        const existing = bySubtopic.get(p.subtopic_id);
        if (!existing || (p.confidence ?? 0) > (existing.confidence ?? 0)) {
          bySubtopic.set(p.subtopic_id, p);
        }
      }

      for (const [, p] of bySubtopic) {
        const argCount = Array.isArray(p.arguments_json) ? p.arguments_json.length : 0;
        const satWeight = Math.max(0.3, Math.min(0.9, 0.3 + argCount * 0.12));
        nodes.push({
          id: `sat-${p.subtopic_id}`,
          label: p.stance === "yes" ? "YES" : p.stance === "no" ? "NO" : "ABSTAIN",
          weight: satWeight,
          conviction: p.confidence ?? 0.5,
          parentId: cat.id,
          isSatellite: true,
          isOwn: true,
          hexColor: STANCE_HEX[p.stance!] ?? GREY_BLOB,
        });
      }
    }

    return nodes;
  }

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
        nodes={buildNodes()}
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
            { color: "#FFBF00", label: "Submitted" },
            { color: "#6868a0", label: "Unspoken" },
            { color: "#00DCFF", label: "Yes" },
            { color: "#FF5A6A", label: "No" },
            { color: "#888780", label: "Abstain" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 5px ${color}88` }} />
              <span className="text-[8px] font-bold tracking-widest" style={{ color: color + "77" }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Center: Manifesto button */}
        <div className="absolute left-1/2 -translate-x-1/2"
          style={{ top: "max(16px, env(safe-area-inset-top))" }}>
          <ManifestoPanel
            open={manifestoOpen}
            onOpen={() => setManifestoOpen(true)}
            onClose={() => setManifestoOpen(false)}
            onViewsChanged={() => {
              if (!user) return;
              supa.from("user_views").select("id, topic_label, submitted_to_arena, confidence_score")
                .eq("user_id", user.id).eq("is_deleted", false)
                .then(({ data }) => { if (data) setUserViews(data as UserView[]); });
            }}
          />
        </div>
      </div>

      {/* ----------------------------------------------------------------
          Centre hint
      ---------------------------------------------------------------- */}
      <AnimatePresence>
        {!advisorOpen && (
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
        unsubmittedCount={userViews.filter(v => !v.submitted_to_arena).length}
        onOpenManifesto={() => setManifestoOpen(true)}
      />
    </div>
  );
}
