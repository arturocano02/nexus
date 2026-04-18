"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface ReviewItem {
  topic_label: string;
  text: string;
  include: boolean;
  source_excerpts: string[];
  personal_argument_id: string;
}

interface MergePair {
  a_id: string;
  b_id: string;
  a_label: string;
  b_label: string;
  a_summary: string;
  b_summary: string;
  a_points: string[];
  b_points: string[];
  similarity: number;
  merged_label: string;
  merged_summary: string;
  top_points: string[];
}

type Phase = "loading" | "merge" | "review" | "deploying";

export default function SubmitReview({
  open,
  onClose,
  onConfirm,
  anonymous,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  anonymous: boolean;
}) {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [mergePairs, setMergePairs] = useState<MergePair[]>([]);
  const [currentMergeIdx, setCurrentMergeIdx] = useState(0);
  const [mergeSelections, setMergeSelections] = useState<Record<string, Set<string>>>({});
  const [mergeLabelOverrides, setMergeLabelOverrides] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("loading");
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    setMergePairs([]);
    setCurrentMergeIdx(0);
    setMergeSelections({});
    setMergeLabelOverrides({});
    setPhase("loading");

    // Fetch merge candidates first so we can offer to consolidate overlapping
    // beliefs BEFORE the user has to rubber-stamp two almost-identical nodes.
    (async () => {
      try {
        const [mergeRes, reviewRes] = await Promise.all([
          fetch("/api/nodes/merge-candidates").then((r) => r.json()),
          fetch("/api/submit").then((r) => r.json()),
        ]);
        const pairs: MergePair[] = mergeRes.pairs ?? [];
        setItems(reviewRes.items ?? []);
        setMergePairs(pairs);
        // Seed default selections: every top_point checked.
        const seed: Record<string, Set<string>> = {};
        for (const p of pairs) {
          seed[`${p.a_id}:${p.b_id}`] = new Set(p.top_points);
        }
        setMergeSelections(seed);
        setPhase(pairs.length > 0 ? "merge" : "review");
      } catch (err) {
        console.error("Review load failed", err);
        setItems([]);
        setPhase("review");
      }
    })();
  }, [open]);

  async function handleMergeConfirm(pair: MergePair) {
    const key = `${pair.a_id}:${pair.b_id}`;
    const chosen = Array.from(mergeSelections[key] ?? new Set());
    const label = mergeLabelOverrides[key] ?? pair.merged_label;
    try {
      await fetch("/api/nodes/confirm-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          original_node_a_id: pair.a_id,
          original_node_b_id: pair.b_id,
          merged_label: label,
          merged_summary: pair.merged_summary,
          top_points_to_keep: chosen,
        }),
      });
    } catch (e) {
      console.error("merge confirm failed", e);
    }
    advanceMerge();
  }

  function handleMergeSkip() {
    advanceMerge();
  }

  async function advanceMerge() {
    const next = currentMergeIdx + 1;
    if (next >= mergePairs.length) {
      // Refresh review items after any merges so the per-node screen is clean.
      const fresh = await fetch("/api/submit").then((r) => r.json());
      setItems(fresh.items ?? []);
      setPhase("review");
    } else {
      setCurrentMergeIdx(next);
    }
  }

  async function confirm() {
    const activeItems = items?.filter((i) => i.include) || [];
    if (activeItems.length === 0) {
      onClose();
      return;
    }
    setPhase("deploying");
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: activeItems, anonymous }),
      });
      if (res.ok) {
        onConfirm?.();
        onClose();
      } else {
        const d = await res.json();
        alert("Error: " + (d.error || "Failed to submit"));
        setPhase("review");
      }
    } catch (e) {
      alert("Submission error. Please try again.");
      setPhase("review");
    }
  }

  const current = mergePairs[currentMergeIdx];
  const currentKey = current ? `${current.a_id}:${current.b_id}` : "";
  const currentSelections = current ? mergeSelections[currentKey] ?? new Set<string>() : new Set<string>();
  const currentLabel = current
    ? mergeLabelOverrides[currentKey] ?? current.merged_label
    : "";

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[190] bg-black/70 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed inset-x-0 bottom-0 md:top-8 md:bottom-28 z-[200] mx-auto max-w-2xl w-full h-[90dvh] md:h-auto"
          >
            <div className="glass h-full rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 md:p-8 shadow-2xl flex flex-col relative overflow-hidden text-secondary">
              <button
                onClick={onClose}
                className="absolute top-6 right-6 w-10 h-10 flex items-center justify-center rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors z-30"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {phase === "loading" && (
                <div className="m-auto py-20 text-center animate-pulse">
                  <p className="font-mono text-[10px] tracking-[0.5em] opacity-40 uppercase">Mapping overlaps...</p>
                </div>
              )}

              {phase === "merge" && current && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="mb-4 pr-12">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-amber font-bold">
                      Merge Preview {currentMergeIdx + 1} of {mergePairs.length}
                    </p>
                    <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight mt-1">
                      These two topics are converging
                    </h2>
                    <p className="text-xs text-secondary/50 mt-2">
                      Similarity {(current.similarity * 100).toFixed(0)}%. Merge them into a single stronger position?
                    </p>
                  </div>
                  <div className="flex-1 overflow-y-auto pr-1 scrollbar-hide space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <SideCard label={current.a_label} summary={current.a_summary} />
                      <SideCard label={current.b_label} summary={current.b_summary} />
                    </div>
                    <div className="rounded-3xl border border-amber/30 bg-amber/5 p-5">
                      <p className="text-[10px] uppercase tracking-[0.25em] text-amber/80 font-bold mb-2">
                        Merged topic
                      </p>
                      <input
                        value={currentLabel}
                        onChange={(e) =>
                          setMergeLabelOverrides((m) => ({ ...m, [currentKey]: e.target.value }))
                        }
                        className="w-full bg-transparent outline-none font-display text-xl md:text-2xl font-bold tracking-tight text-amber"
                      />
                      <p className="text-sm text-secondary/80 leading-relaxed mt-2">
                        {current.merged_summary}
                      </p>
                    </div>
                    <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-5">
                      <p className="text-[10px] uppercase tracking-[0.25em] text-secondary/60 font-bold mb-3">
                        Keep which points?
                      </p>
                      <ul className="space-y-2">
                        {current.top_points.map((pt, i) => {
                          const checked = currentSelections.has(pt);
                          return (
                            <li key={i}>
                              <label className="flex items-start gap-3 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    setMergeSelections((m) => {
                                      const next = new Set(m[currentKey] ?? new Set());
                                      if (e.target.checked) next.add(pt);
                                      else next.delete(pt);
                                      return { ...m, [currentKey]: next };
                                    });
                                  }}
                                  className="w-4 h-4 mt-1 rounded border-amber/40 bg-transparent text-amber focus:ring-amber/40"
                                />
                                <span className="text-sm text-secondary/80 leading-relaxed group-hover:text-secondary transition-colors">
                                  {pt}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col md:flex-row gap-3 pt-4 border-t border-white/10">
                    <button
                      onClick={handleMergeSkip}
                      className="w-full md:w-auto px-6 py-3 text-xs font-bold uppercase tracking-widest text-secondary/60 hover:text-secondary transition-colors"
                    >
                      Keep separate
                    </button>
                    <button
                      onClick={() => handleMergeConfirm(current)}
                      className="flex-1 glass px-6 py-3 rounded-full text-xs font-bold uppercase tracking-[0.25em] text-amber border-2 border-amber hover:bg-amber/10 active:scale-95 transition-all shadow-xl"
                    >
                      Merge into one
                    </button>
                  </div>
                </div>
              )}

              {phase === "review" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="mb-6 pr-12">
                    <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight">
                      Review deployment
                    </h2>
                    <p className="text-xs uppercase tracking-[0.2em] text-secondary/40 font-bold mt-1">
                      Injecting to {anonymous ? "Anonymous" : "Public"} Arena
                    </p>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-hide">
                    {items?.length === 0 && (
                      <p className="text-center py-20 text-secondary/40 italic">
                        Nothing new to broadcast.
                      </p>
                    )}
                    {items?.map((it, i) => (
                      <div
                        key={it.personal_argument_id}
                        className="bg-white/5 border border-white/5 rounded-3xl p-5 md:p-6 transition-all hover:border-amber/20"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-[10px] uppercase tracking-[0.25em] text-amber font-bold">
                            {it.topic_label}
                          </span>
                          <label className="flex items-center gap-2 cursor-pointer group">
                            <span className="text-[10px] uppercase font-bold tracking-widest text-secondary/30 group-hover:text-amber transition-colors">
                              Include
                            </span>
                            <input
                              type="checkbox"
                              checked={it.include}
                              className="w-4 h-4 rounded border-amber/40 bg-transparent text-amber focus:ring-amber/40"
                              onChange={(e) =>
                                setItems((arr) =>
                                  arr!.map((x, j) =>
                                    j === i ? { ...x, include: e.target.checked } : x,
                                  ),
                                )
                              }
                            />
                          </label>
                        </div>
                        <textarea
                          value={it.text}
                          onChange={(e) =>
                            setItems((arr) =>
                              arr!.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                            )
                          }
                          rows={3}
                          className="w-full bg-transparent text-base md:text-sm leading-relaxed outline-none border-none p-0 resize-none placeholder:text-secondary/20"
                        />
                        <button
                          onClick={() => setExpanded(expanded === i ? null : i)}
                          className="mt-4 flex items-center gap-2"
                        >
                          <span className="text-[9px] font-bold tracking-widest text-secondary/30 hover:text-secondary transition-colors uppercase">
                            {expanded === i
                              ? "- HIDE SOURCES"
                              : `+ VIEW SOURCES (${it.source_excerpts.length})`}
                          </span>
                        </button>
                        {expanded === i && (
                          <motion.ul
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            className="mt-4 space-y-3 border-l-2 border-amber/20 pl-4 py-1"
                          >
                            {it.source_excerpts.map((e, k) => (
                              <li key={k} className="text-[11px] text-secondary/50 italic leading-relaxed">
                                "{e}"
                              </li>
                            ))}
                          </motion.ul>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 flex flex-col md:flex-row items-center justify-between gap-4 pt-6 border-t border-white/10">
                    <button
                      onClick={onClose}
                      className="w-full md:w-auto px-8 py-3 text-xs font-bold uppercase tracking-widest text-secondary/40 hover:text-secondary transition-all"
                    >
                      Abort Mission
                    </button>
                    <button
                      onClick={confirm}
                      disabled={!items || items.length === 0}
                      className="w-full md:w-auto glass px-12 py-5 rounded-full text-xs font-bold uppercase tracking-[0.25em] text-amber border-2 border-amber hover:bg-amber/10 active:scale-95 transition-all shadow-xl disabled:opacity-30"
                    >
                      Confirm + Deploy
                    </button>
                  </div>
                </div>
              )}

              {phase === "deploying" && (
                <div className="m-auto py-20 text-center animate-pulse">
                  <p className="font-mono text-[10px] tracking-[0.5em] opacity-40 uppercase">Deploying to arena...</p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function SideCard({ label, summary }: { label: string; summary: string }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
      <p className="text-[10px] uppercase tracking-[0.25em] text-secondary/60 font-bold mb-2">
        {label}
      </p>
      <p className="text-sm text-secondary/80 leading-relaxed line-clamp-4">{summary}</p>
    </div>
  );
}
