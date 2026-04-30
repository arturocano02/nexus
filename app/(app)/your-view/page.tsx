"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";
import ReviewPanel from "@/components/ReviewPanel";
import ConversationPanel from "@/components/ConversationPanel";
import TopicDetailPanel from "@/components/TopicDetailPanel";
import type { TaxonomyCategory, MapNodeDatum, InferredPosition, UserView } from "@/lib/types";

const NodeMap = dynamic(() => import("@/components/NodeMap"), { ssr: false });

function newSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const GREY_BLOB = "#6868a0";

export default function YourViewPage() {
  const { user, ready } = useUser();
  const router = useRouter();
  const sessionId = useRef(newSessionId());
  // After submitting, trigger physicsBoost explosion then navigate to arena
  const [merging, setMerging] = useState(false);   // hides text, shows overlay
  const [exploding, setExploding] = useState(false); // physicsBoost on globe

  const [categories, setCategories] = useState<TaxonomyCategory[]>([]);
  const [positions, setPositions] = useState<InferredPosition[]>([]);
  const [userViews, setUserViews] = useState<UserView[]>([]);
  const [viewsLoading, setViewsLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<TaxonomyCategory | null>(null);
  // null = full category summary view; string = subtopic-specific view
  const [activeSubtopicId, setActiveSubtopicId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  // Categories the user has spoken to — amber immediately even before classification
  const [touchedIds, setTouchedIds] = useState<Set<string>>(new Set());
  // Whether the active conversation has enough turns to submit
  const [canReview, setCanReview] = useState(false);

  const supa = supabaseBrowser();

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
  // Load user_views for amber outline (submitted nodes)
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
  // Load ALL inferred positions for this user (all sessions)
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;
    const sid = sessionId.current;

    async function loadPositions() {
      try {
        const { data, error } = await supa
          .from("inferred_positions")
          .select("*")
          .eq("user_id", user!.id);
        if (!error && data) {
          setPositions(data as InferredPosition[]);
          // Pre-seed touchedIds from categories the user has spoken about before
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

    // Realtime: listen for new positions in the current session, then reload all
    try {
      const ch = supa
        .channel(`positions-${sid}`)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "inferred_positions",
          filter: `session_id=eq.${sid}`,
        }, () => loadPositions())
        .subscribe();
      return () => { supa.removeChannel(ch); };
    } catch { /* ignore */ }
  }, [user]);

  // -----------------------------------------------------------------------
  // Click a globe node
  // Satellite click → subtopic detail view
  // Category click with history → category summary view
  // Category click fresh → open chat directly
  // -----------------------------------------------------------------------
  const handleNodeSelect = useCallback((id: string) => {
    if (id.startsWith("sat-")) {
      // Satellite: resolve to parent category + show subtopic detail
      const subtopicId = id.replace("sat-", "");
      const pos = positions.find(p => p.subtopic_id === subtopicId);
      const cat = pos?.category_id ? categories.find(c => c.id === pos.category_id) : undefined;
      if (!cat) return;

      setActiveCategory(cat);
      setActiveSubtopicId(subtopicId);
      setTouchedIds(prev => new Set([...prev, cat.id]));
      setCanReview(false);
      setDetailOpen(true);
    } else {
      // Category blob
      const cat = categories.find(c => c.id === id);
      if (!cat) return;

      setActiveCategory(cat);
      setActiveSubtopicId(null); // full category summary
      setTouchedIds(prev => new Set([...prev, cat.id]));
      setCanReview(false);

      const hasHistory = touchedIds.has(cat.id) || positions.some(p => p.category_id === cat.id);
      if (hasHistory) {
        setDetailOpen(true);
      } else {
        setChatOpen(true);
      }
    }
  }, [categories, touchedIds, positions]);

  function handleClose() { setChatOpen(false); }
  function handleCloseWithReview() { setChatOpen(false); setReviewOpen(true); }

  function handleSubmitted() {
    // Step 1 (0ms): Hide all text overlays
    setMerging(true);
    // Step 2 (700ms): Globe updates via realtime; show new deployed blobs settling
    // Step 3 (1400ms): Trigger physics explosion — blobs blast outward toward arena
    setTimeout(() => setExploding(true), 1400);
    // Step 4 (3000ms): Navigate to arena
    setTimeout(() => router.push("/arena"), 3000);
  }

  // Stance → satellite blob color
  const STANCE_HEX: Record<string, string> = {
    yes: "#00DCFF",
    no: "#FF5A6A",
    abstain: "#888780",
  };

  // Build a set of topic_labels that have been submitted to arena (for amber outline)
  const submittedTopics = new Set(
    userViews.filter(v => v.submitted_to_arena).map(v => v.topic_label)
  );

  // -----------------------------------------------------------------------
  // Build globe nodes — category blobs + subtopic satellites
  // Satellite weight is based on argument count so blobs grow as you talk more
  // -----------------------------------------------------------------------
  function buildNodes(): MapNodeDatum[] {
    const byCategory = new Map<string, InferredPosition[]>();
    for (const p of positions) {
      if (!p.category_id) continue;
      const arr = byCategory.get(p.category_id) ?? [];
      arr.push(p);
      byCategory.set(p.category_id, arr);
    }

    const nodes: MapNodeDatum[] = [];

    for (const cat of categories) {
      const catPos = byCategory.get(cat.id) ?? [];
      const hasPositions = catPos.length > 0;
      const isTouched = touchedIds.has(cat.id);
      const isActive = cat.id === activeCategory?.id && (chatOpen || detailOpen);

      const conviction = hasPositions
        ? Math.max(...catPos.map(p => p.confidence ?? 0.5))
        : isTouched ? 0.35
        : 0;

      const deployedCount = catPos.filter(p => p.deployed_at).length;
      const weight = hasPositions
        ? Math.max(0.9, Math.min(1.4, 0.9 + deployedCount * 0.25))
        : 1.0;

      // Category blob (amber outline if this topic has been submitted to arena)
      const isSubmittedToArena = submittedTopics.has(cat.name);
      nodes.push({
        id: cat.id,
        label: cat.name,
        weight,
        conviction,
        pulsing: isActive,
        isOwn: hasPositions || isTouched,
        hexColor: (hasPositions || isTouched) ? undefined : GREY_BLOB,
        // submitted nodes get a subtle amber outline marker via hexColor hint
        ...(isSubmittedToArena && { isSubmittedToArena: true } as any),
      });

      // Satellite blobs — one per subtopic with a clear inferred stance
      // Deduplicate: highest confidence per subtopic
      const bySubtopic = new Map<string, InferredPosition>();
      for (const p of catPos) {
        if (!p.subtopic_id || !p.stance || p.stance === "unclear") continue;
        const existing = bySubtopic.get(p.subtopic_id);
        if (!existing || (p.confidence ?? 0) > (existing.confidence ?? 0)) {
          bySubtopic.set(p.subtopic_id, p);
        }
      }

      for (const [subtopicId, p] of bySubtopic) {
        // Weight grows with argument count so the blob visually expands as you add more
        const argCount = Array.isArray(p.arguments_json) ? p.arguments_json.length : 0;
        const satWeight = Math.max(0.3, Math.min(0.9, 0.3 + argCount * 0.12));

        nodes.push({
          id: `sat-${subtopicId}`,
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

  const hasUndeployed = positions.some(p => !p.deployed_at && !p.retracted_at);

  if (!ready) {
    return (
      <div className="relative h-screen w-screen overflow-hidden">
        {/* Skeleton globe — three pulsing placeholder spheres */}
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
    <div className="relative h-screen w-screen overflow-hidden">

      {/* 3D Globe — exploding=true after submit triggers the merge/explode animation */}
      <NodeMap
        nodes={buildNodes()}
        onSelect={merging ? undefined : handleNodeSelect}
        radius={2.8}
        cameraDistance={11}
        physicsBoost={exploding}
        emptyHint="Loading topics..."
      />

      {/* Corner label + colour legend */}
      <div className="absolute top-5 left-5 z-20 pointer-events-none space-y-2">
        <p className="text-[9px] uppercase tracking-[0.35em] font-bold"
           style={{ color: "rgba(255,191,0,0.35)" }}>
          Your political map
        </p>
        {/* Legend — always visible */}
        <div className="flex flex-col gap-1">
          {[
            { color: "#FFBF00", label: "Topic" },
            { color: "#6868a0", label: "Unspoken" },
            { color: "#00DCFF", label: "Yes" },
            { color: "#FF5A6A", label: "No" },
            { color: "#888780", label: "Abstain" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 5px ${color}88` }} />
              <span className="text-[8px] font-bold tracking-widest" style={{ color: color + "77" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Centre prompt — fades when anything is open or merging */}
      <AnimatePresence>
        {!chatOpen && !detailOpen && !merging && (
          <motion.div
            key="centre-prompt"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
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

      {/* Top-right controls */}
      <div className="absolute top-5 right-5 z-20 flex gap-2">
        {chatOpen && !canReview && (
          <button
            onClick={handleClose}
            className="px-3 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-[0.2em] border transition-all"
            style={{
              color: "rgba(255,255,255,0.5)",
              borderColor: "rgba(255,255,255,0.15)",
              background: "rgba(0,0,20,0.4)",
              backdropFilter: "blur(10px)",
            }}
          >
            Hide chat
          </button>
        )}
        {/* Single submit CTA — only when undeployed positions exist and panel is not already open */}
        {hasUndeployed && !reviewOpen && !merging && (
          <motion.button
            onClick={() => setReviewOpen(true)}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="px-3 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-[0.2em] border transition-all"
            style={{
              color: "#FFBF00",
              borderColor: "rgba(255,191,0,0.5)",
              background: "rgba(255,191,0,0.1)",
              backdropFilter: "blur(10px)",
              boxShadow: "0 0 20px rgba(255,191,0,0.15)",
            }}
          >
            Submit views
          </motion.button>
        )}
      </div>

      {/* Topic detail panel — subtopic or category summary depending on what was clicked */}
      <TopicDetailPanel
        open={detailOpen}
        category={activeCategory}
        subtopicId={activeSubtopicId}
        onClose={() => setDetailOpen(false)}
        onContinue={() => {
          setDetailOpen(false);
          setChatOpen(true);
        }}
      />

      {/* Conversation panel */}
      <ConversationPanel
        open={chatOpen}
        category={activeCategory}
        sessionId={sessionId.current}
        initialMessage={null}
        onClose={handleClose}
        onReview={() => { setChatOpen(false); setReviewOpen(true); }}
        onCloseWithReview={handleCloseWithReview}
        onCanReviewChange={setCanReview}
      />

      {/* Merge animation overlay — 3-phase sequence */}
      <AnimatePresence>
        {merging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[300] flex flex-col items-center justify-center pointer-events-none"
          >
            {/* Phase 1 text: views deployed, blobs updating */}
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="font-display text-2xl font-bold tracking-tight text-center"
              style={{ color: "#FFBF00", textShadow: "0 0 40px rgba(255,191,0,0.5)" }}
            >
              Views deployed
            </motion.p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="font-mono text-[10px] tracking-[0.4em] text-secondary/30 uppercase mt-2"
            >
              Updating your map...
            </motion.p>
            {/* Phase 2 text: exploding into arena */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.5 }}
              className="font-mono text-[10px] tracking-[0.4em] text-secondary/25 uppercase mt-1"
            >
              Merging into the arena...
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Review panel */}
      <ReviewPanel
        open={reviewOpen}
        sessionId={sessionId.current}
        onClose={() => setReviewOpen(false)}
        onSubmitted={handleSubmitted}
      />
    </div>
  );
}
