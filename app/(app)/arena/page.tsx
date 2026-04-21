"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";
import type { CategoryAggregate, MapNodeDatum, SubtopicAggregate } from "@/lib/types";

const NodeMap = dynamic(() => import("@/components/NodeMap"), { ssr: false });

// -----------------------------------------------------------------------
// Colour helpers — green/amber/red for arena blobs
// -----------------------------------------------------------------------

function tensionColor(flag: string, yesPct: number): string {
  if (flag === "agreed")    return "#22C55E"; // green
  if (flag === "disputed")  return "#EF4444"; // red
  if (flag === "hot")       return "#F97316"; // orange — almost 50/50
  return "#FFBF00";                           // amber — contested but directional
}

function tensionToConviction(yesPct: number): number {
  // Map yes% to a 0..1 conviction value for blob sizing / glow
  return yesPct / 100;
}

export default function ArenaPage() {
  const { user } = useUser();
  const [categories, setCategories] = useState<CategoryAggregate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CategoryAggregate | null>(null);
  const [mySubtopicIds, setMySubtopicIds] = useState<Set<string>>(new Set());

  // Post-submission state
  const [banner, setBanner] = useState<{ count: number } | null>(null);
  const [pulsingIds, setPulsingIds] = useState<Set<string>>(new Set());

  const supa = supabaseBrowser();

  // Detect ?submitted=true arrival from ReviewPanel
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("submitted") === "true") {
      const count = parseInt(params.get("count") ?? "0", 10);
      setBanner({ count });
      // Clean URL without reloading
      window.history.replaceState({}, "", window.location.pathname);
      // Auto-hide banner after 5s
      setTimeout(() => setBanner(null), 5000);
    }
  }, []);

  async function load() {
    try {
      const res = await fetch("/api/aggregate");
      const body = await res.json();
      setCategories(body.categories ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // Load aggregate data + 30s polling
  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Load user's own deployed positions to highlight their nodes
  useEffect(() => {
    if (!user) return;
    async function loadMine() {
      const { data } = await supa
        .from("inferred_positions")
        .select("subtopic_id, category_id")
        .eq("user_id", user!.id)
        .not("deployed_at", "is", null);
      if (data) {
        setMySubtopicIds(new Set(data.map((p: any) => p.subtopic_id).filter(Boolean)));
      }
    }
    loadMine();
  }, [user]);

  // When we arrive fresh from a submission AND categories have loaded,
  // pulse the user's blobs to show their contribution landing.
  useEffect(() => {
    if (!banner || categories.length === 0 || mySubtopicIds.size === 0) return;
    const myCatIds = new Set(
      categories
        .filter((cat) => cat.subtopics.some((s) => mySubtopicIds.has(s.subtopic_id)))
        .map((cat) => cat.category_id),
    );
    if (myCatIds.size === 0) return;
    setPulsingIds(myCatIds);
    const t = setTimeout(() => setPulsingIds(new Set()), 5000);
    return () => clearTimeout(t);
  }, [banner, categories, mySubtopicIds]);

  // Build globe nodes from categories
  const nodes: MapNodeDatum[] = categories.map((cat) => ({
    id: cat.category_id,
    label: cat.category_name,
    weight: Math.max(0.3, Math.min(1.8, 0.3 + cat.total_responses * 0.05)),
    conviction: tensionToConviction(cat.yes_weighted_pct),
    tension: cat.tension_flag === "hot" ? 1 : cat.tension_flag === "contested" ? 0.5 : 0,
    isOwn: false,
    pulsing: pulsingIds.has(cat.category_id),
    hexColor: tensionColor(cat.tension_flag, cat.yes_weighted_pct),
  }));

  // Highlight ids = categories where user has deployed positions
  const highlightIds = new Set(
    categories
      .filter((cat) =>
        cat.subtopics.some((s) => mySubtopicIds.has(s.subtopic_id))
      )
      .map((cat) => cat.category_id)
  );

  const handleSelect = useCallback(
    (id: string) => {
      const cat = categories.find((c) => c.category_id === id);
      setSelected(cat ?? null);
    },
    [categories],
  );

  // Only block render on the very first load (no data yet)
  if (loading && categories.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="font-mono text-[10px] tracking-[0.5em] text-secondary/20 uppercase animate-pulse">
          Loading collective data...
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* 3D Globe */}
      <NodeMap
        nodes={nodes}
        isArena
        highlightIds={highlightIds}
        onSelect={handleSelect}
      />

      {/* Submission banner — slides in from top when arriving from ReviewPanel */}
      <AnimatePresence>
        {banner && (
          <motion.div
            key="submitted-banner"
            initial={{ opacity: 0, y: -60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -60 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            className="absolute top-5 inset-x-0 z-30 flex justify-center pointer-events-none"
          >
            <div
              className="flex items-center gap-3 px-6 py-3 rounded-full"
              style={{
                background: "rgba(8,10,24,0.88)",
                backdropFilter: "blur(24px)",
                border: "1px solid rgba(34,197,94,0.35)",
                boxShadow: "0 4px 32px rgba(34,197,94,0.15)",
              }}
            >
              {/* Animated pulse dot */}
              <motion.div
                className="w-2 h-2 rounded-full bg-[#22C55E] shrink-0"
                animate={{ scale: [1, 1.6, 1], opacity: [1, 0.5, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
              <span className="text-[11px] font-bold tracking-wide text-[#22C55E]">
                {banner.count} view{banner.count !== 1 ? "s" : ""} added to the collective
              </span>
              <span className="text-[10px] text-secondary/30 ml-1">
                — your contribution is now live
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top header */}
      <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between px-6 pt-6 pointer-events-none">
        <div>
          <p className="text-[9px] uppercase tracking-[0.4em] text-amber/50 font-bold">
            The Arena
          </p>
          <p className="text-secondary/40 text-xs mt-0.5">
            Collective political positions
          </p>
        </div>
        <div className="flex items-center gap-3 pointer-events-auto">
          {/* Manifesto link — only shown when there are agreed positions */}
          {categories.some(c => c.tension_flag === "agreed") && (
            <Link href="/manifesto"
              className="px-4 py-2 rounded-full text-[9px] font-bold uppercase tracking-[0.2em] border transition-all"
              style={{ color: "#22C55E", borderColor: "rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.07)" }}>
              Manifesto
            </Link>
          )}
          {/* Legend */}
          <div className="flex items-center gap-3 glass px-4 py-2 rounded-full text-[9px] font-bold uppercase tracking-[0.15em]">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
              Agreed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#F97316]" />
              Hot
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
              Disputed
            </span>
          </div>
        </div>
      </div>

      {/* Category detail overlay */}
      <AnimatePresence>
        {selected && (
          <CategoryOverlay
            category={selected}
            userSubtopicIds={mySubtopicIds}
            onClose={() => setSelected(null)}
          />
        )}
      </AnimatePresence>

      {/* No data message */}
      {categories.every((c) => c.total_responses === 0) && (
        <div className="absolute inset-0 flex items-end justify-center pb-24 pointer-events-none">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass px-8 py-5 rounded-2xl text-center max-w-sm"
          >
            <p className="text-amber font-display font-bold text-lg mb-1">No data yet</p>
            <p className="text-secondary/50 text-sm">
              Have a conversation and deploy your views to see collective results here.
            </p>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// Category detail overlay (slide-up)
// -----------------------------------------------------------------------
function CategoryOverlay({
  category,
  userSubtopicIds,
  onClose,
}: {
  category: CategoryAggregate;
  userSubtopicIds: Set<string>;
  onClose: () => void;
}) {
  const flag = category.tension_flag;
  const flagColor = tensionColor(flag, category.yes_weighted_pct);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[180] bg-black/50 backdrop-blur-sm"
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed inset-x-0 bottom-0 z-[190] mx-auto max-w-2xl w-full"
        style={{ maxHeight: "70dvh" }}
      >
        <div
          className="glass h-full rounded-t-[2.5rem] flex flex-col text-secondary overflow-hidden"
          style={{ maxHeight: "70dvh" }}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-7 pt-7 pb-4 shrink-0">
            <div>
              <p
                className="text-[9px] uppercase tracking-[0.3em] font-bold mb-1"
                style={{ color: flagColor }}
              >
                {flag.toUpperCase()} — {category.total_responses} response{category.total_responses !== 1 ? "s" : ""}
              </p>
              <h2 className="font-display text-2xl font-bold tracking-tight">
                {category.category_name}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Overall yes/no bar */}
          <div className="px-7 pb-4 shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[9px] uppercase tracking-widest text-secondary/40">
                {category.yes_weighted_pct}% yes
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${category.yes_weighted_pct}%`,
                    background: `linear-gradient(90deg, ${flagColor}, ${flagColor}99)`,
                  }}
                />
              </div>
              <span className="text-[9px] uppercase tracking-widest text-secondary/40">
                {category.no_weighted_pct}% no
              </span>
            </div>
          </div>

          {/* Subtopics */}
          <div className="flex-1 overflow-y-auto px-7 pb-7 space-y-3 scrollbar-hide">
            {category.subtopics
              .filter((s) => s.total_responses > 0)
              .sort((a, b) => b.total_responses - a.total_responses)
              .map((sub) => (
                <SubtopicRow
                  key={sub.subtopic_id}
                  subtopic={sub}
                  isOwn={userSubtopicIds.has(sub.subtopic_id)}
                />
              ))}

            {category.subtopics.every((s) => s.total_responses === 0) && (
              <p className="text-secondary/30 text-sm text-center py-8">
                No responses for this topic yet.
              </p>
            )}

            {/* Top arguments */}
            {(category.top_yes_args.length > 0 || category.top_no_args.length > 0) && (
              <div className="pt-2 space-y-4">
                {category.top_yes_args.length > 0 && (
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-[#00DCFF]/60 font-bold mb-2">
                      Top yes arguments
                    </p>
                    {category.top_yes_args.map((arg, i) => (
                      <p key={i} className="text-xs text-secondary/60 leading-relaxed pl-3 border-l border-[#00DCFF]/20 mb-2">
                        {arg}
                      </p>
                    ))}
                  </div>
                )}
                {category.top_no_args.length > 0 && (
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-[#FF5A6A]/60 font-bold mb-2">
                      Top no arguments
                    </p>
                    {category.top_no_args.map((arg, i) => (
                      <p key={i} className="text-xs text-secondary/60 leading-relaxed pl-3 border-l border-[#FF5A6A]/20 mb-2">
                        {arg}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}

function SubtopicRow({
  subtopic,
  isOwn,
}: {
  subtopic: SubtopicAggregate;
  isOwn: boolean;
}) {
  const color = tensionColor(subtopic.tension_flag, subtopic.yes_weighted_pct);

  return (
    <div className="rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-secondary/80">
            {subtopic.subtopic_name}
          </span>
          {isOwn && (
            <span className="text-[8px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber/10 text-amber/70 border border-amber/20">
              your view
            </span>
          )}
        </div>
        <span
          className="text-[9px] uppercase tracking-widest font-bold"
          style={{ color }}
        >
          {subtopic.tension_flag}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-secondary/40 w-8">
          {subtopic.yes_weighted_pct}%
        </span>
        <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${subtopic.yes_weighted_pct}%`,
              background: color,
            }}
          />
        </div>
        <span className="text-[9px] text-secondary/40 w-8 text-right">
          {subtopic.no_weighted_pct}%
        </span>
      </div>
      <p className="text-[9px] text-secondary/25 mt-1">
        {subtopic.total_responses} response{subtopic.total_responses !== 1 ? "s" : ""}
        {subtopic.abstain_count > 0 ? ` · ${subtopic.abstain_count} abstained` : ""}
      </p>
    </div>
  );
}
