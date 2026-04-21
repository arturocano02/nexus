"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";
import ReviewPanel from "@/components/ReviewPanel";
import ConversationPanel from "@/components/ConversationPanel";
import type { TaxonomyCategory, MapNodeDatum, InferredPosition } from "@/lib/types";

const NodeMap = dynamic(() => import("@/components/NodeMap"), { ssr: false });

function newSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const GREY_BLOB = "#6868a0";
const TOUCHED_AMBER = "#FFBF00"; // amber — blob turns this the moment you start talking

export default function YourViewPage() {
  const { user, ready } = useUser();
  const sessionId = useRef(newSessionId());

  const [categories, setCategories] = useState<TaxonomyCategory[]>([]);
  const [positions, setPositions] = useState<InferredPosition[]>([]);
  const [activeCategory, setActiveCategory] = useState<TaxonomyCategory | null>(null);
  const [initialMessage, setInitialMessage] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  // Categories the user has spoken to this session — they turn amber immediately,
  // even before classification completes.
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
  // Real-time inferred positions
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;
    const sid = sessionId.current;

    // Load ALL positions for this user across every session so previously
    // discussed topics stay amber when they come back to the map.
    async function loadPositions() {
      try {
        const { data, error } = await supa
          .from("inferred_positions")
          .select("*")
          .eq("user_id", user!.id);
        if (!error && data) {
          setPositions(data as InferredPosition[]);
          // Pre-seed touchedIds from any category the user has spoken about before
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

    // Realtime: listen for new positions in the current session only,
    // then reload the full user set so the map stays in sync.
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
  // -----------------------------------------------------------------------
  const handleNodeSelect = useCallback((id: string) => {
    const cat = categories.find(c => c.id === id);
    if (!cat) return;
    // Mark as touched immediately so blob turns amber right away
    setTouchedIds(prev => new Set([...prev, id]));
    setActiveCategory(cat);
    setInitialMessage(`I want to discuss ${cat.name}`);
    setCanReview(false); // reset for fresh conversation
    setChatOpen(true);
  }, [categories]);

  // -----------------------------------------------------------------------
  // Close chat — if enough turns have been made, open ReviewPanel instead
  // -----------------------------------------------------------------------
  function handleClose() {
    setChatOpen(false);
  }

  function handleCloseWithReview() {
    setChatOpen(false);
    setReviewOpen(true);
  }

  // -----------------------------------------------------------------------
  // Build globe nodes
  // Hierarchy: active (pulsing amber) > has positions (amber/conviction) >
  //            touched (amber dim) > untouched (grey)
  // -----------------------------------------------------------------------
  function buildNodes(): MapNodeDatum[] {
    const byCategory = new Map<string, InferredPosition[]>();
    for (const p of positions) {
      if (!p.category_id) continue;
      const arr = byCategory.get(p.category_id) ?? [];
      arr.push(p);
      byCategory.set(p.category_id, arr);
    }

    return categories.map((cat) => {
      const catPos = byCategory.get(cat.id) ?? [];
      const hasPositions = catPos.length > 0;
      const isTouched = touchedIds.has(cat.id);
      const isActive = cat.id === activeCategory?.id && chatOpen;

      // Use max confidence across all sessions — the user's strongest signal wins
      const avgConv = hasPositions
        ? Math.max(...catPos.map(p => p.confidence ?? 0.5))
        : isTouched ? 0.35   // touched this session but not yet classified — dim amber
        : 0;

      // Weight grows with deployed positions across all time, not just this session
      const deployedCount = catPos.filter(p => p.deployed_at).length;
      const weight = hasPositions
        ? Math.max(0.9, Math.min(1.4, 0.9 + deployedCount * 0.25))
        : 1.0;

      return {
        id: cat.id,
        label: cat.name,
        weight,
        conviction: avgConv,
        pulsing: isActive,
        isOwn: hasPositions || isTouched,
        // Grey only for completely untouched blobs; amber for everything else
        hexColor: (hasPositions || isTouched) ? undefined : GREY_BLOB,
      };
    });
  }

  const hasUndeployed = positions.some(p => !p.deployed_at);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="font-mono text-[10px] tracking-[0.5em] text-secondary/20 uppercase animate-pulse">
          Loading...
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden">

      {/* ---- 3D Globe ---- */}
      <NodeMap
        nodes={buildNodes()}
        onSelect={handleNodeSelect}
        radius={4}
        cameraDistance={15}
        emptyHint="Loading topics..."
      />

      {/* ---- Corner label ---- */}
      <div className="absolute top-5 left-5 z-20 pointer-events-none">
        <p className="text-[9px] uppercase tracking-[0.35em] font-bold"
           style={{ color: "rgba(255,191,0,0.35)" }}>
          Your political map
        </p>
      </div>

      {/* ---- Centre question (fades when chat is open) ---- */}
      <AnimatePresence>
        {!chatOpen && (
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

      {/* ---- Top-right controls ---- */}
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
        {hasUndeployed && (
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

      {/* ---- Conversation panel ---- */}
      <ConversationPanel
        open={chatOpen}
        category={activeCategory}
        sessionId={sessionId.current}
        initialMessage={initialMessage}
        onClose={handleClose}
        onReview={() => { setChatOpen(false); setReviewOpen(true); }}
        onCloseWithReview={handleCloseWithReview}
        onCanReviewChange={setCanReview}
      />

      {/* ---- Review panel ---- */}
      <ReviewPanel
        open={reviewOpen}
        sessionId={sessionId.current}
        onClose={() => setReviewOpen(false)}
        onSubmitted={() => {}}
      />
    </div>
  );
}
