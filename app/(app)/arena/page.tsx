"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
// Combined views overlay — redesigned per spec
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
  const router = useRouter();
  const supa = supabaseBrowser();

  // Fetch subtopic questions (latent_question_text) for the question section
  const [questions, setQuestions] = useState<{ subtopic_id: string; question: string }[]>([]);

  useEffect(() => {
    (async () => {
      const subIds = category.subtopics.map(s => s.subtopic_id);
      if (!subIds.length) return;
      const { data } = await supa
        .from("taxonomy_subtopics")
        .select("id, latent_question_text, name")
        .in("id", subIds);
      if (data) {
        setQuestions(
          data.map((s: any) => ({
            subtopic_id: s.id,
            question: s.latent_question_text || s.name,
          }))
        );
      }
    })();
  }, [category.category_id]);

  function handleAddArgument() {
    // Store context so your-view/advisor can pick it up
    sessionStorage.setItem("nexus_arena_context", JSON.stringify({
      topic: category.category_name,
      for_args: category.top_yes_args,
      against_args: category.top_no_args,
    }));
    onClose();
    router.push("/your-view");
  }

  const yesPct = category.yes_weighted_pct;
  const noPct = category.no_weighted_pct;
  const agentCount = category.total_responses;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[180] bg-black/60 backdrop-blur-sm"
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed inset-x-0 bottom-0 z-[190] mx-auto max-w-2xl w-full"
        style={{ maxHeight: "80dvh" }}
      >
        <div
          className="flex flex-col text-secondary overflow-hidden"
          style={{
            maxHeight: "80dvh",
            background: "rgba(4,2,24,0.97)",
            backdropFilter: "blur(24px)",
            borderTop: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "24px 24px 0 0",
          }}
        >
          {/* Header */}
          <div className="shrink-0 px-6 pt-6 pb-4 flex items-start justify-between">
            <div>
              <h2 className="font-display text-xl font-bold tracking-tight">
                {category.category_name}
              </h2>
              <p className="text-[11px] mt-1" style={{ color: "rgba(245,245,245,0.35)" }}>
                {agentCount} agent{agentCount !== 1 ? "s" : ""} contributed to this topic
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Split bar */}
          <div className="shrink-0 px-6 pb-4">
            <div className="flex rounded-xl overflow-hidden h-10 text-sm font-bold">
              <div
                className="flex items-center justify-center transition-all"
                style={{
                  flex: yesPct,
                  background: "rgba(255,191,0,0.25)",
                  borderRight: "1px solid rgba(0,0,0,0.3)",
                  color: "#FFBF00",
                  fontSize: 13,
                  minWidth: yesPct > 10 ? undefined : 0,
                }}
              >
                {yesPct > 12 && `${yesPct}%`}
              </div>
              <div
                className="flex items-center justify-center transition-all"
                style={{
                  flex: noPct,
                  background: "rgba(255,90,106,0.25)",
                  color: "#FF5A6A",
                  fontSize: 13,
                  minWidth: noPct > 10 ? undefined : 0,
                }}
              >
                {noPct > 12 && `${noPct}%`}
              </div>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] uppercase tracking-widest font-bold" style={{ color: "rgba(255,191,0,0.5)" }}>For</span>
              <span className="text-[9px] uppercase tracking-widest font-bold" style={{ color: "rgba(255,90,106,0.5)" }}>Against</span>
            </div>
          </div>

          {/* Questions */}
          {questions.length > 0 && (
            <div className="shrink-0 px-6 pb-4 space-y-1.5">
              {questions.slice(0, 3).map(q => (
                <p key={q.subtopic_id} className="text-sm italic" style={{ color: "rgba(255,191,0,0.75)" }}>
                  "{q.question}"
                </p>
              ))}
            </div>
          )}

          {/* For / Against columns */}
          <div className="flex-1 overflow-y-auto px-6 pb-4 scrollbar-hide">
            <div className="grid grid-cols-2 gap-3">
              {/* FOR column */}
              <div>
                <p className="text-[9px] uppercase tracking-[0.25em] font-bold mb-2"
                  style={{ color: "rgba(255,191,0,0.5)" }}>For</p>
                <div className="space-y-2">
                  {category.top_yes_args.slice(0, 5).map((arg, i) => (
                    <div
                      key={i}
                      className="rounded-xl px-3 py-2.5"
                      style={{ background: "rgba(255,191,0,0.06)", border: "1px solid rgba(255,191,0,0.1)" }}
                    >
                      <p className="text-xs leading-relaxed" style={{ color: "rgba(245,245,245,0.72)" }}>
                        {arg}
                      </p>
                      <span
                        className="text-[9px] mt-1.5 inline-flex items-center gap-1"
                        style={{ color: "rgba(255,191,0,0.4)" }}
                      >
                        #{i + 1} most common
                      </span>
                    </div>
                  ))}
                  {category.top_yes_args.length === 0 && (
                    <p className="text-xs" style={{ color: "rgba(245,245,245,0.2)" }}>No arguments yet</p>
                  )}
                </div>
              </div>

              {/* AGAINST column */}
              <div>
                <p className="text-[9px] uppercase tracking-[0.25em] font-bold mb-2"
                  style={{ color: "rgba(255,90,106,0.5)" }}>Against</p>
                <div className="space-y-2">
                  {category.top_no_args.slice(0, 5).map((arg, i) => (
                    <div
                      key={i}
                      className="rounded-xl px-3 py-2.5"
                      style={{ background: "rgba(255,90,106,0.06)", border: "1px solid rgba(255,90,106,0.1)" }}
                    >
                      <p className="text-xs leading-relaxed" style={{ color: "rgba(245,245,245,0.72)" }}>
                        {arg}
                      </p>
                      <span
                        className="text-[9px] mt-1.5 inline-flex items-center gap-1"
                        style={{ color: "rgba(255,90,106,0.4)" }}
                      >
                        #{i + 1} most common
                      </span>
                    </div>
                  ))}
                  {category.top_no_args.length === 0 && (
                    <p className="text-xs" style={{ color: "rgba(245,245,245,0.2)" }}>No arguments yet</p>
                  )}
                </div>
              </div>
            </div>

            {agentCount === 0 && (
              <p className="text-center text-sm py-8" style={{ color: "rgba(245,245,245,0.25)" }}>
                No contributions yet for this topic.
              </p>
            )}
          </div>

          {/* Add your argument CTA */}
          <div className="shrink-0 px-6 pb-8 pt-3 border-t border-white/5">
            <button
              onClick={handleAddArgument}
              className="w-full btn-primary py-3 text-sm font-semibold"
            >
              Add your argument
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
