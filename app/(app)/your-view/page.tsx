"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";
import ConversationPanel from "@/components/ConversationPanel";
import ReviewPanel from "@/components/ReviewPanel";
import type { MapNodeDatum, UserView, TaxonomyCategory } from "@/lib/types";

const NodeMap = dynamic(() => import("@/components/NodeMap"), { ssr: false });

const CATEGORY_ICONS: Record<string, string> = {
  housing: "⌂",
  economy: "◈",
  defence: "◉",
  healthcare: "✦",
  climate: "◎",
  education: "◇",
  technology: "◆",
  immigration: "○",
};

function colorFromConfidence(score: number): string {
  const s = Math.max(0, Math.min(1, score));
  if (s >= 0.78) return "#FFBF00";
  if (s >= 0.60) return "#D4900A";
  if (s >= 0.42) return "#9A630A";
  if (s >= 0.25) return "#5E3D0A";
  return "#3A2608";
}

export default function YourViewPage() {
  const { user, ready } = useUser();

  const [categories, setCategories] = useState<TaxonomyCategory[]>([]);
  const [userViews, setUserViews] = useState<UserView[]>([]);
  const [stanceByTopic, setStanceByTopic] = useState<Map<string, "yes" | "no" | "abstain">>(new Map());

  // One session ID per category, stable for the lifetime of this page mount
  const sessionsByCat = useRef<Map<string, string>>(new Map());

  // Active conversation state
  const [activeCat, setActiveCat] = useState<TaxonomyCategory | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [convOpen, setConvOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [canReview, setCanReview] = useState(false);

  const supa = supabaseBrowser();

  // -----------------------------------------------------------------------
  // Load categories
  // -----------------------------------------------------------------------
  useEffect(() => {
    async function load() {
      try {
        const { data } = await supa
          .from("taxonomy_categories")
          .select("id, name, slug, sort_order, opening_question, created_at")
          .order("sort_order");
        if (data) setCategories(data as TaxonomyCategory[]);
      } catch { /* ok */ }
    }
    load();
  }, []);

  // -----------------------------------------------------------------------
  // Load user_views + realtime subscription
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
      } catch { /* ok */ }
    }
    loadViews();

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
                if (idx >= 0) { const copy = [...prev]; copy[idx] = v; return copy; }
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
  // Stance lookup — maps topic_label → best inferred stance
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

        const cats: { id: string; name: string }[] = catRes.data ?? [];
        const subs: { id: string; name: string }[] = subRes.data ?? [];
        const positions: { category_id: string; subtopic_id: string | null; stance: string; confidence: number }[] = posRes.data ?? [];

        const bestByCat = new Map<string, { stance: string; confidence: number }>();
        const bestBySub = new Map<string, { stance: string; confidence: number }>();
        for (const p of positions) {
          if (p.category_id) {
            const ex = bestByCat.get(p.category_id);
            if (!ex || p.confidence > ex.confidence)
              bestByCat.set(p.category_id, { stance: p.stance, confidence: p.confidence });
          }
          if (p.subtopic_id) {
            const ex = bestBySub.get(p.subtopic_id);
            if (!ex || p.confidence > ex.confidence)
              bestBySub.set(p.subtopic_id, { stance: p.stance, confidence: p.confidence });
          }
        }

        const catIdByName = new Map(cats.map(c => [c.name.toLowerCase(), c.id]));
        const subIdByName = new Map(subs.map(s => [s.name.toLowerCase(), s.id]));

        const map = new Map<string, "yes" | "no" | "abstain">();
        for (const view of userViews) {
          const label = view.topic_label.toLowerCase();
          const subId = subIdByName.get(label);
          if (subId) {
            const best = bestBySub.get(subId);
            if (best && ["yes", "no", "abstain"].includes(best.stance)) {
              map.set(view.topic_label, best.stance as "yes" | "no" | "abstain");
              continue;
            }
          }
          const catId = catIdByName.get(label);
          if (catId) {
            const best = bestByCat.get(catId);
            if (best && ["yes", "no", "abstain"].includes(best.stance)) {
              map.set(view.topic_label, best.stance as "yes" | "no" | "abstain");
            }
          }
        }
        setStanceByTopic(map);
      } catch { /* ok */ }
    }

    loadStances();
  }, [user?.id, userViews]);

  // -----------------------------------------------------------------------
  // Open a category — get or create a stable session for this page mount
  // -----------------------------------------------------------------------
  function openCategory(cat: TaxonomyCategory) {
    let sessionId = sessionsByCat.current.get(cat.id);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionsByCat.current.set(cat.id, sessionId);
    }
    setActiveCat(cat);
    setActiveSessionId(sessionId);
    setCanReview(false);
    setConvOpen(true);
  }

  // Tap a globe node → open that category's conversation
  const handleNodeSelect = useCallback((id: string) => {
    const viewId = id.replace("user_", "");
    const view = userViews.find(v => v.id === viewId);
    if (!view) return;
    const cat = categories.find(
      c => c.name.toLowerCase() === view.topic_label.toLowerCase() ||
           c.slug.toLowerCase() === view.topic_label.toLowerCase()
    );
    if (cat) openCategory(cat);
  }, [userViews, categories]);

  // -----------------------------------------------------------------------
  // Globe nodes
  // -----------------------------------------------------------------------
  const nodes = useMemo((): MapNodeDatum[] => {
    return userViews.map(view => {
      const excerptCount = Array.isArray(view.raw_excerpts) ? view.raw_excerpts.length : 0;
      const summaryWords = (view.summary || "").split(/\s+/).filter(Boolean).length;
      const volume = Math.min(1, excerptCount / 6 + summaryWords / 60);
      const weight = 0.25 + volume * 0.75;
      const hexColor = colorFromConfidence(view.confidence_score);
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
          <p className="font-mono text-[10px] tracking-[0.5em] text-secondary/20 uppercase animate-pulse">
            Loading your map...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-screen overflow-hidden" style={{ height: "100dvh" }}>

      {/* 3D Globe */}
      <NodeMap
        nodes={nodes}
        onSelect={handleNodeSelect}
        radius={2.8}
        cameraDistance={11}
        emptyHint="Pick a topic below to start"
      />

      {/* Top: legend */}
      <div
        className="absolute top-0 inset-x-0 z-20 px-5 pointer-events-none"
        style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}
      >
        <p className="text-[9px] uppercase tracking-[0.35em] font-bold mb-1.5" style={{ color: "rgba(255,191,0,0.35)" }}>
          Your political map
        </p>
        <div className="flex flex-col gap-1">
          {[
            { color: "#FFBF00", label: "High conviction" },
            { color: "#9A630A", label: "Low conviction" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
              <span className="text-[8px] font-bold tracking-widest" style={{ color: color + "77" }}>{label}</span>
            </div>
          ))}
          {[
            { color: "#00DCFF", label: "Yes" },
            { color: "#FF5A6A", label: "No" },
            { color: "#888780", label: "Abstain" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full border border-black/40" style={{ background: color }} />
              <span className="text-[8px] font-bold tracking-widest" style={{ color: color + "77" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Centre hint when globe is empty */}
      <AnimatePresence>
        {nodes.length === 0 && !convOpen && (
          <motion.div
            key="empty-hint"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
          >
            <p
              className="font-display font-bold tracking-tight text-secondary text-center px-8"
              style={{ fontSize: "clamp(1.1rem, 2.2vw, 1.5rem)", textShadow: "0 2px 20px rgba(0,0,0,0.8)" }}
            >
              Pick a topic below to start
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------------
          Category picker — horizontal scroll row above nav bar
          Hidden while conversation is open so it doesn't compete
      ---------------------------------------------------------------- */}
      <AnimatePresence>
        {!convOpen && (
          <motion.div
            key="cat-picker"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="absolute inset-x-0 z-20"
            style={{ bottom: "calc(80px + max(12px, env(safe-area-inset-bottom)))" }}
          >
            <div className="flex gap-2 px-4 overflow-x-auto scrollbar-hide">
              {categories.map(cat => {
                const hasViews = userViews.some(
                  v => v.topic_label.toLowerCase() === cat.name.toLowerCase()
                );
                return (
                  <button
                    key={cat.id}
                    onClick={() => openCategory(cat)}
                    className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-full transition-all active:scale-95"
                    style={{
                      background: hasViews
                        ? "rgba(255,191,0,0.12)"
                        : "rgba(6,6,22,0.82)",
                      backdropFilter: "blur(16px)",
                      WebkitBackdropFilter: "blur(16px)",
                      border: hasViews
                        ? "1px solid rgba(255,191,0,0.4)"
                        : "1px solid rgba(255,255,255,0.1)",
                      color: hasViews ? "#FFBF00" : "rgba(245,245,245,0.55)",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                      boxShadow: "0 2px 16px rgba(0,0,0,0.4)",
                    }}
                  >
                    <span style={{ fontSize: 13, lineHeight: 1 }}>
                      {CATEGORY_ICONS[cat.slug] ?? "◆"}
                    </span>
                    {cat.name}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------------
          Conversation panel — slides up when category picked
      ---------------------------------------------------------------- */}
      {activeCat && activeSessionId && (
        <ConversationPanel
          open={convOpen}
          category={activeCat}
          sessionId={activeSessionId}
          onClose={() => setConvOpen(false)}
          onReview={() => setReviewOpen(true)}
          onCanReviewChange={setCanReview}
          onCloseWithReview={() => {
            setConvOpen(false);
            setReviewOpen(true);
          }}
        />
      )}

      {/* ----------------------------------------------------------------
          Review panel — opens on top for stance confirmation + deploy
      ---------------------------------------------------------------- */}
      {activeSessionId && (
        <ReviewPanel
          open={reviewOpen}
          sessionId={activeSessionId}
          onClose={() => setReviewOpen(false)}
          onSubmitted={() => {
            setReviewOpen(false);
            setConvOpen(false);
          }}
        />
      )}
    </div>
  );
}
