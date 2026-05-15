"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";
import type { CategoryAggregate, MapNodeDatum, QuestionAggregate } from "@/lib/types";

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
  // category_ids where the user has deployed positions
  const [myCategoryIds, setMyCategoryIds] = useState<Set<string>>(new Set());

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
      window.history.replaceState({}, "", window.location.pathname);
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

  // Load the user's deployed category_ids for blob highlighting
  useEffect(() => {
    if (!user) return;
    async function loadMine() {
      const { data } = await supa
        .from("inferred_positions")
        .select("category_id")
        .eq("user_id", user!.id)
        .not("deployed_at", "is", null)
        .not("category_id", "is", null);
      if (data) {
        setMyCategoryIds(new Set(data.map((p: any) => p.category_id).filter(Boolean)));
      }
    }
    loadMine();
  }, [user]);

  // Pulse the user's category blobs on fresh arrival from submission
  useEffect(() => {
    if (!banner || categories.length === 0 || myCategoryIds.size === 0) return;
    setPulsingIds(new Set(myCategoryIds));
    const t = setTimeout(() => setPulsingIds(new Set()), 5000);
    return () => clearTimeout(t);
  }, [banner, categories, myCategoryIds]);

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

  // Highlight category blobs where the user has deployed
  const highlightIds = myCategoryIds;

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
// Category overlay — shows per-question split bars + expandable top args
// -----------------------------------------------------------------------
function CategoryOverlay({
  category,
  onClose,
}: {
  category: CategoryAggregate;
  onClose: () => void;
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function handleAddArgument() {
    sessionStorage.setItem("nexus_arena_context", JSON.stringify({
      topic: category.category_name,
      for_args: category.top_yes_args,
      against_args: category.top_no_args,
    }));
    onClose();
    router.push("/your-view");
  }

  // Questions with any data, sorted by response count desc
  const activeQuestions = (category.questions ?? [])
    .filter(q => q.yes_count + q.no_count + q.abstain_count > 0)
    .sort((a, b) => (b.yes_count + b.no_count + b.abstain_count) - (a.yes_count + a.no_count + a.abstain_count));

  const yesPct    = category.yes_weighted_pct;
  const noPct     = category.no_weighted_pct;
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
        style={{ maxHeight: "85dvh" }}
      >
        <div
          className="flex flex-col text-secondary overflow-hidden"
          style={{
            maxHeight: "85dvh",
            background: "rgba(4,2,24,0.97)",
            backdropFilter: "blur(24px)",
            borderTop: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "24px 24px 0 0",
          }}
        >
          {/* Header */}
          <div className="shrink-0 px-6 pt-6 pb-3 flex items-start justify-between">
            <div>
              <h2 className="font-display text-xl font-bold tracking-tight">
                {category.category_name}
              </h2>
              <p className="text-[11px] mt-1" style={{ color: "rgba(245,245,245,0.35)" }}>
                {agentCount} agent{agentCount !== 1 ? "s" : ""} · overall lean
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

          {/* Category-level split bar */}
          <div className="shrink-0 px-6 pb-4">
            <div className="flex rounded-xl overflow-hidden h-9">
              <div
                className="flex items-center justify-center transition-all"
                style={{
                  flex: yesPct,
                  background: "rgba(255,191,0,0.22)",
                  borderRight: "1px solid rgba(0,0,0,0.3)",
                  color: "#FFBF00",
                  fontSize: 12,
                  fontWeight: 700,
                  minWidth: yesPct > 10 ? undefined : 0,
                }}
              >
                {yesPct > 12 && `${yesPct}% for`}
              </div>
              <div
                className="flex items-center justify-center transition-all"
                style={{
                  flex: noPct,
                  background: "rgba(255,90,106,0.22)",
                  color: "#FF5A6A",
                  fontSize: 12,
                  fontWeight: 700,
                  minWidth: noPct > 10 ? undefined : 0,
                }}
              >
                {noPct > 12 && `${noPct}% against`}
              </div>
            </div>
          </div>

          {/* Per-question list */}
          <div className="flex-1 overflow-y-auto px-6 pb-4 scrollbar-hide space-y-3">
            {activeQuestions.length === 0 && (
              <p className="text-center text-sm py-8" style={{ color: "rgba(245,245,245,0.25)" }}>
                No contributions yet. Be the first to add your view.
              </p>
            )}

            {activeQuestions.map(q => {
              const total = q.yes_count + q.no_count + q.abstain_count;
              const isExpanded = expandedId === q.question_id;
              return (
                <div
                  key={q.question_id}
                  style={{
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.07)",
                    background: "rgba(255,255,255,0.03)",
                    overflow: "hidden",
                  }}
                >
                  {/* Question row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : q.question_id)}
                    style={{
                      width: "100%", textAlign: "left", background: "none", border: "none",
                      cursor: "pointer", padding: "12px 14px",
                    }}
                  >
                    <p style={{ fontSize: 13, color: "rgba(245,245,245,0.85)", lineHeight: 1.45, marginBottom: 8 }}>
                      {q.question_text}
                    </p>

                    {/* Mini split bar */}
                    <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", height: 6, marginBottom: 4 }}>
                      <div style={{ flex: q.yes_weighted_pct, background: "rgba(255,191,0,0.5)" }} />
                      <div style={{ flex: q.no_weighted_pct, background: "rgba(255,90,106,0.5)" }} />
                      <div style={{ flex: Math.max(0, 100 - q.yes_weighted_pct - q.no_weighted_pct), background: "rgba(136,135,128,0.3)" }} />
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 10, color: "#FFBF00", fontWeight: 600 }}>{q.yes_weighted_pct}% for</span>
                      <span style={{ fontSize: 10, color: "#FF5A6A", fontWeight: 600 }}>{q.no_weighted_pct}% against</span>
                      <span style={{ fontSize: 10, color: "rgba(245,245,245,0.3)", marginLeft: "auto" }}>
                        {total} agent{total !== 1 ? "s" : ""}
                        {" · "}
                        <span style={{ color: "rgba(255,191,0,0.5)" }}>{isExpanded ? "▲" : "▼"}</span>
                      </span>
                    </div>
                  </button>

                  {/* Expanded: top args side-by-side */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{ overflow: "hidden" }}
                      >
                        <div style={{
                          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
                          padding: "0 14px 14px", borderTop: "1px solid rgba(255,255,255,0.05)",
                          paddingTop: 10,
                        }}>
                          <ArgColumn
                            label="For"
                            args={q.top_yes_args}
                            color="#FFBF00"
                            bg="rgba(255,191,0,0.06)"
                            border="rgba(255,191,0,0.12)"
                          />
                          <ArgColumn
                            label="Against"
                            args={q.top_no_args}
                            color="#FF5A6A"
                            bg="rgba(255,90,106,0.06)"
                            border="rgba(255,90,106,0.12)"
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>

          {/* CTA */}
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

function ArgColumn({
  label, args, color, bg, border,
}: {
  label: string;
  args: string[];
  color: string;
  bg: string;
  border: string;
}) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.25em] font-bold mb-2" style={{ color: color + "80" }}>
        {label}
      </p>
      <div className="space-y-1.5">
        {args.slice(0, 3).map((arg, i) => (
          <div
            key={i}
            className="rounded-lg px-2.5 py-2"
            style={{ background: bg, border: `1px solid ${border}` }}
          >
            <p className="text-[11px] leading-relaxed" style={{ color: "rgba(245,245,245,0.72)" }}>
              {arg}
            </p>
          </div>
        ))}
        {args.length === 0 && (
          <p className="text-[11px]" style={{ color: "rgba(245,245,245,0.2)" }}>No arguments yet</p>
        )}
      </div>
    </div>
  );
}
