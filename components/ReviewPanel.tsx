"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ReviewItem } from "@/lib/types";

type StanceValue = "yes" | "no" | "abstain" | "unclear" | null;

interface ReviewPanelProps {
  open: boolean;
  sessionId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

const STANCE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  yes: { label: "YES", color: "#00DCFF", bg: "rgba(0,220,255,0.12)" },
  no: { label: "NO", color: "#FF5A6A", bg: "rgba(255,90,106,0.12)" },
  abstain: { label: "ABSTAIN", color: "#888780", bg: "rgba(136,135,128,0.12)" },
  unclear: { label: "UNCLEAR", color: "#FFBF00", bg: "rgba(255,191,0,0.12)" },
};

interface ContradictionFlag {
  id: string;
  description: string;
  severity: "hard" | "soft";
  position_a: { id: string; subtopic_name: string; stance: string } | null;
  position_b: { id: string; subtopic_name: string; stance: string } | null;
}

export default function ReviewPanel({ open, sessionId, onClose, onSubmitted }: ReviewPanelProps) {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [phase, setPhase] = useState<"loading" | "review" | "submitting" | "done">("loading");
  const [error, setError] = useState<string | null>(null);
  const [contradictions, setContradictions] = useState<ContradictionFlag[]>([]);

  // Load (or reset) whenever the panel opens/closes
  useEffect(() => {
    if (!open) {
      // Reset for next open
      setTimeout(() => {
        setItems(null);
        setPhase("loading");
        setError(null);
      }, 400); // wait for exit animation
      return;
    }
    load();
  }, [open, sessionId]);

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      // Load review items and run contradiction detection in parallel
      const [reviewRes, contraRes] = await Promise.all([
        fetch(`/api/submit?session_id=${encodeURIComponent(sessionId)}`),
        fetch("/api/detect-contradictions"),
      ]);
      const reviewBody = await reviewRes.json();
      setItems(reviewBody.items ?? []);

      // Contradiction detection: fire scan after items are loaded
      // (existing flags loaded immediately; new scan runs async)
      const contraBody = await contraRes.json();
      setContradictions(contraBody.flags ?? []);

      // Also trigger a fresh scan for this session
      fetch("/api/detect-contradictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      })
        .then(r => r.json())
        .then(d => {
          if (d.found > 0) {
            // Reload flags after scan
            fetch("/api/detect-contradictions")
              .then(r => r.json())
              .then(d2 => setContradictions(d2.flags ?? []));
          }
        })
        .catch(() => { /* non-critical */ });

      setPhase("review");
    } catch {
      setError("Could not load your responses. Please try again.");
      setPhase("review");
    }
  }

  async function dismissContradiction(flagId: string) {
    setContradictions(prev => prev.filter(f => f.id !== flagId));
    await fetch("/api/detect-contradictions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag_id: flagId }),
    }).catch(() => { /* best-effort */ });
  }

  function updateStance(id: string, stance: StanceValue) {
    setItems(prev =>
      prev ? prev.map(it => it.position_id === id ? { ...it, stance } : it) : prev
    );
  }

  function updateArgument(id: string, text: string) {
    setItems(prev =>
      prev
        ? prev.map(it =>
            it.position_id === id
              ? { ...it, arguments: [{ text, ts: new Date().toISOString() }] }
              : it
          )
        : prev
    );
  }

  async function handleSubmit() {
    if (!items) return;
    setPhase("submitting");

    const overrides: Record<string, { stance?: string; argument?: string }> = {};
    for (const it of items) {
      overrides[it.position_id] = {
        stance: it.stance ?? "unclear",
        argument: it.arguments[0]?.text ?? "",
      };
    }

    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, overrides }),
      });
      if (res.ok) {
        setPhase("done");
        setTimeout(() => {
          onSubmitted();
          onClose();
        }, 1000);
      } else {
        const d = await res.json();
        setError(d.error ?? "Submission failed. Please try again.");
        setPhase("review");
      }
    } catch {
      setError("Network error. Please try again.");
      setPhase("review");
    }
  }

  const hasAnswers = (items?.filter(it => it.stance && it.stance !== "unclear").length ?? 0) > 0;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={phase !== "submitting" && phase !== "done" ? onClose : undefined}
            className="fixed inset-0 z-[190] bg-black/70 backdrop-blur-sm"
          />

          {/* Panel */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed inset-x-0 bottom-0 z-[200] mx-auto max-w-2xl w-full"
            style={{ maxHeight: "92dvh" }}
          >
            <div
              className="h-full rounded-t-[2.5rem] shadow-2xl flex flex-col text-secondary overflow-hidden"
              style={{
                maxHeight: "92dvh",
                background: "rgba(6,6,22,0.97)",
                backdropFilter: "blur(32px)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderBottom: "none",
              }}
            >
              {/* Header */}
              <div className="flex items-start justify-between px-7 pt-7 pb-4 shrink-0">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] font-bold mb-1" style={{ color: "#FFBF0099" }}>
                    Before you submit
                  </p>
                  <h2 className="font-display text-2xl font-bold tracking-tight">
                    Review your views
                  </h2>
                  {items && items.length > 0 && phase === "review" && (
                    <p className="text-secondary/30 text-xs mt-1">
                      {items.length} position{items.length !== 1 ? "s" : ""} ready to deploy to the manifesto
                    </p>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors shrink-0"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-7 pb-4 space-y-4 scrollbar-hide">

                {/* Contradiction flags */}
                {contradictions.length > 0 && phase === "review" && (
                  <div className="space-y-2 mb-2">
                    {contradictions.map(flag => (
                      <motion.div
                        key={flag.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -8 }}
                        className="rounded-2xl px-4 py-3 flex items-start gap-3"
                        style={{
                          background: flag.severity === "hard"
                            ? "rgba(255,90,106,0.08)"
                            : "rgba(255,191,0,0.06)",
                          border: `1px solid ${flag.severity === "hard" ? "rgba(255,90,106,0.25)" : "rgba(255,191,0,0.20)"}`,
                        }}
                      >
                        <span className="text-base mt-0.5 shrink-0">
                          {flag.severity === "hard" ? "⚡" : "～"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.2em] font-bold mb-1"
                            style={{ color: flag.severity === "hard" ? "#FF5A6A" : "#FFBF00" }}>
                            {flag.severity === "hard" ? "Contradiction" : "Tension"}
                          </p>
                          <p className="text-xs text-secondary/70 leading-relaxed">
                            {flag.description}
                          </p>
                          {flag.position_a && flag.position_b && (
                            <p className="text-[10px] text-secondary/30 mt-1.5">
                              {flag.position_a.subtopic_name} ({flag.position_a.stance})
                              {" vs "}
                              {flag.position_b.subtopic_name} ({flag.position_b.stance})
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => dismissContradiction(flag.id)}
                          className="shrink-0 text-secondary/20 hover:text-secondary/50 transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </motion.div>
                    ))}
                  </div>
                )}

                {phase === "loading" && (
                  <div className="py-16 text-center">
                    <p className="font-mono text-[10px] tracking-[0.5em] text-secondary/20 uppercase animate-pulse">
                      Preparing review...
                    </p>
                  </div>
                )}

                {(phase === "review" || phase === "submitting") && items?.length === 0 && (
                  <div className="py-16 text-center space-y-3">
                    <p className="text-secondary/40 text-sm">
                      No new positions to submit yet.
                    </p>
                    <p className="text-secondary/25 text-xs">
                      Keep talking — the AI will extract your views as the conversation develops.
                    </p>
                  </div>
                )}

                {(phase === "review" || phase === "submitting") &&
                  items?.map((it) => (
                    <ReviewCard
                      key={it.position_id}
                      item={it}
                      onStanceChange={s => updateStance(it.position_id, s)}
                      onArgumentChange={t => updateArgument(it.position_id, t)}
                      disabled={phase === "submitting"}
                    />
                  ))}

                {phase === "submitting" && (
                  <div className="py-8 text-center">
                    <p className="font-mono text-[10px] tracking-[0.5em] text-secondary/25 uppercase animate-pulse">
                      Deploying to manifesto...
                    </p>
                  </div>
                )}

                {phase === "done" && (
                  <div className="py-16 text-center space-y-2">
                    <motion.p
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="font-display text-2xl font-bold"
                      style={{ color: "#FFBF00" }}
                    >
                      Views deployed.
                    </motion.p>
                    <p className="text-secondary/40 text-xs">
                      Your positions are now part of the collective output.
                    </p>
                    <p className="text-secondary/25 text-[10px] mt-2 animate-pulse">
                      Taking you to the arena...
                    </p>
                  </div>
                )}

                {error && (
                  <p className="text-red-400/80 text-xs text-center py-2 px-4 rounded-xl bg-red-400/5 border border-red-400/10">
                    {error}
                  </p>
                )}
              </div>

              {/* Footer */}
              {phase === "review" && (
                <div className="shrink-0 px-7 pb-7 pt-4 flex gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <button
                    onClick={onClose}
                    className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-secondary/30 hover:text-secondary/55 transition-colors"
                  >
                    Keep talking
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!hasAnswers}
                    className="flex-1 px-8 py-4 rounded-full text-xs font-bold uppercase tracking-[0.25em] border-2 transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      borderColor: hasAnswers ? "rgba(255,191,0,0.6)" : "rgba(255,255,255,0.1)",
                      color: hasAnswers ? "#FFBF00" : "rgba(255,255,255,0.3)",
                      background: hasAnswers ? "rgba(255,191,0,0.06)" : "transparent",
                      boxShadow: hasAnswers ? "0 0 30px rgba(255,191,0,0.1)" : "none",
                    }}
                  >
                    Deploy to manifesto
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// -----------------------------------------------------------------------
// Individual question card
// -----------------------------------------------------------------------
function ReviewCard({
  item,
  onStanceChange,
  onArgumentChange,
  disabled,
}: {
  item: ReviewItem;
  onStanceChange: (s: StanceValue) => void;
  onArgumentChange: (t: string) => void;
  disabled: boolean;
}) {
  const [showWeight, setShowWeight] = useState(false);
  const [editingArg, setEditingArg] = useState(false);
  const stance = item.stance;
  const argText = item.arguments[0]?.text ?? "";

  const hasWeights = item.weight_d != null;
  const wD = item.weight_d?.toFixed(1) ?? "—";
  const wQ = item.weight_q?.toFixed(2) ?? "—";
  const wC = item.weight_c?.toFixed(1) ?? "—";
  const wTotal = item.weight_total?.toFixed(1) ?? "—";

  return (
    <div className="rounded-[1.5rem] border border-white/6 bg-white/[0.025] overflow-hidden">
      {/* Category + subtopic */}
      <div className="px-5 pt-4 pb-2 flex items-center gap-2 flex-wrap">
        <span className="text-[9px] font-bold tracking-[0.25em] uppercase" style={{ color: "#FFBF0077" }}>
          {item.category_name}
        </span>
        <span className="text-secondary/20 text-[9px]">›</span>
        <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-secondary/35">
          {item.subtopic_name}
        </span>
      </div>

      {/* Question — prominent */}
      <div className="px-5 pb-4">
        <p className="text-sm leading-relaxed text-secondary/90 font-medium">
          {item.question_text}
        </p>
        {item.reasoning && (
          <p className="text-[10px] text-secondary/35 mt-2 leading-relaxed italic">
            AI: {item.reasoning.slice(0, 120)}{item.reasoning.length > 120 ? "…" : ""}
          </p>
        )}
      </div>

      {/* Stance pills */}
      <div className="px-5 pb-4 flex items-center gap-2">
        {(["yes", "no", "abstain"] as const).map(s => {
          const cfg = STANCE_LABELS[s];
          const active = stance === s;
          return (
            <button
              key={s}
              disabled={disabled}
              onClick={() => onStanceChange(s)}
              className="flex-1 py-2.5 rounded-full text-[10px] font-bold tracking-[0.2em] uppercase border transition-all active:scale-95"
              style={{
                color: active ? cfg.color : "rgba(245,245,245,0.35)",
                background: active ? cfg.bg : "transparent",
                borderColor: active ? cfg.color + "55" : "rgba(255,255,255,0.07)",
              }}
            >
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Argument */}
      {(stance === "yes" || stance === "no") && (
        <div className="px-5 pb-4">
          {editingArg ? (
            <textarea
              value={argText}
              onChange={e => onArgumentChange(e.target.value)}
              onBlur={() => setEditingArg(false)}
              autoFocus
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-secondary/80 outline-none resize-none focus:border-white/20 transition-colors"
              placeholder="Your argument (optional but strengthens your vote weight)..."
            />
          ) : (
            <button
              onClick={() => !disabled && setEditingArg(true)}
              className="w-full text-left px-4 py-3 rounded-xl border border-white/6 bg-white/[0.02] hover:border-white/12 transition-colors"
            >
              <p className="text-xs text-secondary/50 leading-relaxed line-clamp-2">
                {argText || <span className="italic opacity-40">Add an argument to increase your vote weight...</span>}
              </p>
            </button>
          )}
        </div>
      )}

      {/* Weight breakdown */}
      {hasWeights && (
        <div className="px-5 pb-4" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <button
            onClick={() => setShowWeight(!showWeight)}
            className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-secondary/25 hover:text-secondary/50 transition-colors mt-3"
          >
            <span>{showWeight ? "▾" : "▸"}</span>
            <span>Vote weight: {wTotal}</span>
          </button>
          <AnimatePresence>
            {showWeight && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 text-[10px] text-secondary/40 space-y-1 pl-4 border-l border-white/10"
              >
                <p>Depth D={wD} · Argument quality Q={wQ} · Confidence C={wC}</p>
                <p className="text-secondary/60 font-bold">W = {wD} × {wQ} × {wC} = {wTotal}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
