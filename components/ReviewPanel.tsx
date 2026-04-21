"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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

export default function ReviewPanel({ open, sessionId, onClose, onSubmitted }: ReviewPanelProps) {
  const router = useRouter();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [phase, setPhase] = useState<"loading" | "review" | "submitting" | "done">("loading");
  const [deployedCount, setDeployedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const res = await fetch(`/api/submit?session_id=${encodeURIComponent(sessionId)}`);
      const body = await res.json();
      setItems(body.items ?? []);
      setPhase("review");
    } catch {
      setError("Could not load your responses. Please try again.");
      setPhase("review");
    }
  }

  useEffect(() => {
    if (open && phase === "loading" && items === null) {
      // Small delay so async classification has time to finish writing
      // to inferred_positions before we fetch the review items.
      const t = setTimeout(() => load(), 1200);
      return () => clearTimeout(t);
    }
  }, [open, phase, items]);

  function updateStance(positionId: string, stance: StanceValue) {
    setItems((prev) =>
      prev ? prev.map((it) => (it.position_id === positionId ? { ...it, stance } : it)) : prev,
    );
  }

  function updateArgument(positionId: string, text: string) {
    setItems((prev) =>
      prev
        ? prev.map((it) =>
          it.position_id === positionId
            ? { ...it, arguments: [{ text, ts: new Date().toISOString() }] }
            : it,
        )
        : prev,
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
        const data = await res.json();
        const count = data.deployed ?? items?.length ?? 0;
        setDeployedCount(count);
        setPhase("done");
        // Brief success moment, then carry the user to the Arena so they
        // can see their views incorporated into the collective in real time.
        setTimeout(() => {
          onSubmitted();
          router.push(`/arena?submitted=true&count=${count}`);
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

  const hasAnswers = (items?.filter((it) => it.stance && it.stance !== "unclear").length ?? 0) > 0;

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
            className="fixed inset-x-0 bottom-0 z-[200] mx-auto max-w-2xl w-full"
            style={{ maxHeight: "92dvh" }}
          >
            <div
              className="glass h-full rounded-t-[2.5rem] shadow-2xl flex flex-col text-secondary overflow-hidden"
              style={{ maxHeight: "92dvh" }}
            >
              {/* Header */}
              <div className="flex items-start justify-between px-7 pt-7 pb-4 shrink-0">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-amber font-bold mb-1">
                    What your agent will say
                  </p>
                  <h2 className="font-display text-2xl font-bold tracking-tight">
                    Review your views
                  </h2>
                  <p className="text-xs text-secondary/40 mt-1">
                    These are the positions the AI inferred from your conversation. Edit them before deploying.
                  </p>
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
                {phase === "loading" && (
                  <div className="py-16 text-center animate-pulse">
                    <p className="font-mono text-[10px] tracking-[0.5em] opacity-40 uppercase">
                      Analysing your conversation...
                    </p>
                  </div>
                )}

                {(phase === "review" || phase === "submitting") && items?.length === 0 && (
                  <div className="py-16 text-center space-y-3">
                    <p className="text-secondary/50 text-sm font-medium">
                      Nothing to review yet.
                    </p>
                    <p className="text-secondary/30 text-xs leading-relaxed max-w-xs mx-auto">
                      Classification runs after each message — it may still be processing, or the conversation didn&apos;t produce enough signal. Try saying a bit more about where you stand.
                    </p>
                  </div>
                )}

                {(phase === "review" || phase === "submitting") &&
                  items?.map((it) => (
                    <ReviewCard
                      key={it.position_id}
                      item={it}
                      onStanceChange={(s) => updateStance(it.position_id, s)}
                      onArgumentChange={(t) => updateArgument(it.position_id, t)}
                      disabled={phase === "submitting"}
                    />
                  ))}

                {phase === "submitting" && (
                  <div className="py-8 text-center animate-pulse">
                    <p className="font-mono text-[10px] tracking-[0.5em] opacity-40 uppercase">
                      Computing weights and deploying...
                    </p>
                  </div>
                )}

                {phase === "done" && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="py-16 text-center"
                  >
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 260, damping: 18 }}
                      className="w-14 h-14 rounded-full border-2 border-amber/60 flex items-center justify-center mx-auto mb-5"
                      style={{ background: "rgba(255,191,0,0.1)" }}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFBF00" strokeWidth="2.5">
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </motion.div>
                    <p className="text-amber font-display text-xl font-bold">
                      {deployedCount} view{deployedCount !== 1 ? "s" : ""} deployed
                    </p>
                    <p className="text-secondary/40 text-xs mt-2">
                      Taking you to the Arena...
                    </p>
                  </motion.div>
                )}

                {error && (
                  <p className="text-red-400 text-xs text-center py-2">{error}</p>
                )}
              </div>

              {/* Footer */}
              {phase === "review" && (
                <div className="shrink-0 px-7 pb-7 pt-4 border-t border-white/10 flex gap-3">
                  <button
                    onClick={onClose}
                    className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-secondary/40 hover:text-secondary transition-all"
                  >
                    Keep talking
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!hasAnswers}
                    className="flex-1 glass px-8 py-4 rounded-full text-xs font-bold uppercase tracking-[0.25em] text-amber border-2 border-amber hover:bg-amber/10 active:scale-95 transition-all shadow-xl disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Deploy your views
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
// Individual position card
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
  const [showReasoning, setShowReasoning] = useState(false);
  const [showWeight, setShowWeight] = useState(false);
  const [editingArg, setEditingArg] = useState(false);
  const stance = item.stance;
  const argText = item.arguments[0]?.text ?? "";

  const stanceConfig = stance && STANCE_LABELS[stance] ? STANCE_LABELS[stance] : null;

  const hasWeights = item.weight_d != null;
  const wD = item.weight_d?.toFixed(1) ?? "—";
  const wQ = item.weight_q?.toFixed(2) ?? "—";
  const wC = item.weight_c?.toFixed(1) ?? "—";
  const wTotal = item.weight_total?.toFixed(1) ?? "—";

  return (
    <div className="rounded-[1.5rem] border border-white/6 bg-white/[0.025] p-5 space-y-3">
      {/* Category + subtopic badge */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] font-bold tracking-[0.25em] uppercase text-amber/70">
          {item.category_name}
        </span>
        <span className="text-secondary/20 text-[9px]">›</span>
        <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-secondary/50">
          {item.subtopic_name}
        </span>
        {item.confidence != null && (
          <span className="ml-auto text-[9px] text-secondary/30">
            {Math.round(item.confidence * 100)}% confidence
          </span>
        )}
      </div>

      {/* Stance pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["yes", "no", "abstain"] as const).map((s) => {
          const cfg = STANCE_LABELS[s];
          const active = stance === s;
          return (
            <button
              key={s}
              disabled={disabled}
              onClick={() => onStanceChange(s)}
              className="px-4 py-1.5 rounded-full text-[10px] font-bold tracking-[0.2em] uppercase border transition-all"
              style={{
                color: active ? cfg.color : "rgba(245,245,245,0.4)",
                background: active ? cfg.bg : "transparent",
                borderColor: active ? cfg.color + "66" : "rgba(255,255,255,0.08)",
              }}
            >
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Why the AI thinks this */}
      {item.reasoning && (
        <div>
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-secondary/30 hover:text-secondary/60 transition-colors"
          >
            <span>{showReasoning ? "▾" : "▸"}</span>
            <span>Why the AI thinks this</span>
          </button>
          <AnimatePresence>
            {showReasoning && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 text-xs text-secondary/50 leading-relaxed pl-4 border-l border-white/10"
              >
                {item.reasoning}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Argument text (editable) */}
      {(stance === "yes" || stance === "no") && (
        <div>
          {editingArg ? (
            <textarea
              value={argText}
              onChange={(e) => onArgumentChange(e.target.value)}
              onBlur={() => setEditingArg(false)}
              autoFocus
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs text-secondary/80 outline-none resize-none"
              placeholder="Your argument..."
            />
          ) : (
            <button
              onClick={() => !disabled && setEditingArg(true)}
              className="w-full text-left px-4 py-3 rounded-xl border border-white/6 bg-white/[0.02] hover:border-white/15 transition-colors"
            >
              <p className="text-xs text-secondary/60 leading-relaxed line-clamp-2">
                {argText || (
                  <span className="italic opacity-40">
                    No argument captured — tap to add one
                  </span>
                )}
              </p>
            </button>
          )}
        </div>
      )}

      {/* Weight breakdown */}
      {hasWeights && (
        <div>
          <button
            onClick={() => setShowWeight(!showWeight)}
            className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-secondary/30 hover:text-secondary/60 transition-colors"
          >
            <span>{showWeight ? "▾" : "▸"}</span>
            <span>Contribution: {wTotal}</span>
          </button>
          <AnimatePresence>
            {showWeight && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 text-[10px] text-secondary/50 space-y-1 pl-4 border-l border-white/10"
              >
                <p>
                  Depth (D = {wD}) —{" "}
                  {Number(wD) >= 1.4
                    ? "deep engagement"
                    : Number(wD) >= 1.2
                      ? "solid engagement"
                      : "surface engagement"}
                </p>
                <p>Argument quality (Q = {wQ}) — how specific and consistent your argument was</p>
                <p>
                  Confidence (C = {wC}) —{" "}
                  {Number(wC) === 1
                    ? "firm, unhedged stance"
                    : Number(wC) === 0.8
                      ? "hedged stance"
                      : "abstained — not counted in vote totals"}
                </p>
                <p className="text-secondary/70 font-bold">
                  Weight = {wD} × {wQ} × {wC} = {wTotal}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
