"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";
import type { UserView } from "@/lib/types";

interface ManifestoPanelProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onDeployed?: (submitted: UserView[]) => void;
}

type PendingView = UserView & { _removing?: boolean };

export default function ManifestoPanel({ open, onOpen, onClose, onDeployed }: ManifestoPanelProps) {
  const [views, setViews] = useState<PendingView[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasNew, setHasNew] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState(false);
  const [toast, setToast] = useState<{ msg: string; undoId?: string } | null>(null);
  const [mounted, setMounted] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const { user } = useUser();
  const supa = supabaseBrowser();

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open || !user) return;
    setViews([]);
    setDeployed(false);
    loadNewViews();
  }, [open, user?.id]);

  async function loadNewViews() {
    setLoading(true);
    try {
      const { data: profile } = await supa
        .from("profiles")
        .select("last_submitted_at")
        .eq("id", user!.id)
        .maybeSingle();

      const lastAt = (profile as any)?.last_submitted_at ?? null;

      let query = supa
        .from("user_views")
        .select("*")
        .eq("user_id", user!.id)
        .eq("is_deleted", false)
        .eq("submitted_to_arena", false)
        .order("confidence_score", { ascending: false });

      if (lastAt) query = (query as any).gt("created_at", lastAt);

      const { data } = await query;
      const rows = (data ?? []) as PendingView[];
      setViews(rows);
      setHasNew(rows.length > 0);
    } catch { /* ok */ }
    setLoading(false);
  }

  function showToast(msg: string, undoId?: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, undoId });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  async function saveSummary(id: string, summary: string) {
    setViews(prev => prev.map(v => v.id === id ? { ...v, summary } : v));
    await supa.from("user_views").update({ summary }).eq("id", id);
  }

  async function updateConfidence(id: string, score: number) {
    setViews(prev => prev.map(v => v.id === id ? { ...v, confidence_score: score } : v));
    await supa.from("user_views").update({ confidence_score: score, user_overridden: true }).eq("id", id);
  }

  function removeView(id: string) {
    setViews(prev => prev.map(v => v.id === id ? { ...v, _removing: true } : v));
    showToast("Removed. Tap to undo.", id);
    const t = setTimeout(async () => {
      await supa.from("user_views").update({ is_deleted: true }).eq("id", id);
      setViews(prev => prev.filter(v => v.id !== id));
      removeTimers.current.delete(id);
    }, 3500);
    removeTimers.current.set(id, t);
  }

  function undoRemove(id: string) {
    const t = removeTimers.current.get(id);
    if (t) clearTimeout(t);
    removeTimers.current.delete(id);
    setViews(prev => prev.map(v => v.id === id ? { ...v, _removing: false } : v));
    setToast(null);
  }

  async function deployAll() {
    const active = views.filter(v => !v._removing);
    if (!active.length || deploying) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/submit-views", { method: "POST" });
      const data = await res.json();
      if (res.ok && Array.isArray(data.submitted)) {
        setDeployed(true);
        onDeployed?.(data.submitted as UserView[]);
        setTimeout(() => { onClose(); setDeployed(false); }, 2200);
      }
    } catch { /* ok */ }
    setDeploying(false);
  }

  const activeViews = views.filter(v => !v._removing);

  const panel = (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: "fixed", inset: 0, zIndex: 195, background: "rgba(0,0,20,0.55)", backdropFilter: "blur(4px)" }}
            onClick={onClose}
          />

          {/* Panel slides down from top */}
          <motion.div
            initial={{ y: "-100%" }} animate={{ y: 0 }} exit={{ y: "-100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            style={{
              position: "fixed", top: 0, left: 0, right: 0,
              zIndex: 205, margin: "0 auto", maxWidth: "42rem", width: "100%",
              height: "82dvh", display: "flex", flexDirection: "column",
              background: "rgba(4,4,36,0.96)",
              backdropFilter: "blur(24px)",
              borderRadius: "0 0 20px 20px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {/* Header */}
            <div style={{ flexShrink: 0, padding: "max(48px, calc(env(safe-area-inset-top) + 16px)) 20px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 700, color: "#FFBF00" }}>Submit views</p>
                  <p style={{ fontSize: 11, color: "rgba(245,245,245,0.3)", marginTop: 2 }}>
                    Review and deploy your positions to the arena.
                  </p>
                </div>
                <button onClick={onClose} style={{ color: "rgba(245,245,245,0.3)", fontSize: 20, lineHeight: 1, background: "none", border: "none", cursor: "pointer", padding: 4 }}>✕</button>
              </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px", minHeight: 0 }}>
              {loading && (
                <p className="animate-pulse text-center text-xs" style={{ color: "rgba(245,245,245,0.2)", paddingTop: 48 }}>
                  Loading...
                </p>
              )}

              {!loading && !hasNew && (
                <div style={{ textAlign: "center", paddingTop: 56 }}>
                  <p style={{ fontSize: 16, marginBottom: 8 }}>🎯</p>
                  <p style={{ fontSize: 14, color: "rgba(245,245,245,0.55)", marginBottom: 6 }}>
                    Nothing new since your last submission.
                  </p>
                  <p style={{ fontSize: 12, color: "rgba(245,245,245,0.25)" }}>
                    Keep talking to your advisor.
                  </p>
                  <button
                    onClick={onClose}
                    style={{ marginTop: 24, fontSize: 12, color: "rgba(255,191,0,0.6)", background: "none", border: "none", cursor: "pointer" }}
                  >
                    Close
                  </button>
                </div>
              )}

              {!loading && hasNew && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4, paddingBottom: 8 }}>
                  <AnimatePresence>
                    {activeViews.map(view => (
                      <ReviewCard
                        key={view.id}
                        view={view}
                        onSaveSummary={summary => saveSummary(view.id, summary)}
                        onConfidenceChange={score => updateConfidence(view.id, score)}
                        onRemove={() => removeView(view.id)}
                      />
                    ))}
                  </AnimatePresence>
                  {activeViews.length === 0 && (
                    <p style={{ textAlign: "center", fontSize: 13, color: "rgba(245,245,245,0.25)", paddingTop: 32 }}>
                      All removed. Nothing to deploy.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Deploy button */}
            {hasNew && !loading && (
              <div style={{ flexShrink: 0, padding: "12px 16px", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
                <button
                  onClick={deployAll}
                  disabled={deploying || activeViews.length === 0 || deployed}
                  style={{
                    width: "100%",
                    padding: "14px",
                    borderRadius: 14,
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: "0.02em",
                    border: "none",
                    cursor: activeViews.length === 0 ? "default" : "pointer",
                    background: deployed
                      ? "rgba(255,191,0,0.15)"
                      : activeViews.length === 0
                        ? "rgba(255,255,255,0.06)"
                        : "#FFBF00",
                    color: deployed || activeViews.length === 0 ? "rgba(255,191,0,0.5)" : "#1a0e00",
                    opacity: deploying ? 0.7 : 1,
                    transition: "all 0.25s",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  {deployed ? "✓ Deployed to arena" : deploying ? (
                    <>
                      <motion.span
                        animate={{ rotate: 360 }}
                        transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                        style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(255,191,0,0.4)", borderTopColor: "#FFBF00", borderRadius: "50%" }}
                      />
                      Deploying...
                    </>
                  ) : `Deploy ${activeViews.length} view${activeViews.length !== 1 ? "s" : ""} to arena`}
                </button>
              </div>
            )}

            {/* Close handle */}
            <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", paddingBottom: 10 }} onClick={onClose}>
              <div style={{ width: 36, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.12)", cursor: "pointer" }} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  const toastEl = (
    <AnimatePresence>
      {toast && (
        <motion.div
          key="manifesto-toast"
          initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}
          style={{
            position: "fixed", bottom: 120, left: "50%", transform: "translateX(-50%)",
            zIndex: 230, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 10,
          }}
          className="glass rounded-full px-4 py-2 text-sm"
        >
          <span>{toast.msg}</span>
          {toast.undoId && (
            <button
              onClick={() => undoRemove(toast.undoId!)}
              style={{ fontSize: 11, fontWeight: 600, color: "#FFBF00", background: "none", border: "none", cursor: "pointer" }}
            >
              Undo
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {/* "My manifesto" amber pill at top of screen */}
      <button
        onClick={onOpen}
        style={{
          pointerEvents: "auto",
          background: "#FFBF00",
          color: "#1a1200",
          borderRadius: 999,
          padding: "6px 16px",
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: "0.02em",
          border: "none",
          cursor: "pointer",
          boxShadow: "0 4px 20px rgba(255,191,0,0.25)",
        }}
      >
        My manifesto
      </button>

      {mounted && createPortal(<>{panel}{toastEl}</>, document.body)}
    </>
  );
}

// -----------------------------------------------------------------------
// Single review card
// -----------------------------------------------------------------------
function ReviewCard({
  view,
  onSaveSummary,
  onConfidenceChange,
  onRemove,
}: {
  view: PendingView;
  onSaveSummary: (s: string) => void;
  onConfidenceChange: (n: number) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(view.summary);
  const pct = Math.round(view.confidence_score * 100);

  const topicColor = pct >= 70 ? "#FFBF00" : pct >= 40 ? "#00DCFF" : "#888780";

  function handleBlur() {
    setEditing(false);
    if (draft !== view.summary) onSaveSummary(draft);
  }

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.22 }}
      style={{
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(255,255,255,0.03)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Topic pill */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{
          display: "inline-block",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: topicColor,
          background: topicColor + "18",
          border: `1px solid ${topicColor}30`,
          borderRadius: 999,
          padding: "3px 10px",
        }}>
          {view.topic_label}
        </span>
        <button
          onClick={onRemove}
          style={{ fontSize: 11, color: "rgba(255,90,106,0.55)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}
        >
          Remove
        </button>
      </div>

      {/* Editable summary */}
      {editing ? (
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={handleBlur}
          autoFocus
          rows={3}
          style={{
            width: "100%", fontSize: 13, lineHeight: 1.55,
            color: "rgba(245,245,245,0.9)", background: "rgba(0,0,40,0.5)",
            border: "1px solid rgba(255,191,0,0.25)", borderRadius: 10,
            padding: "8px 10px", outline: "none", resize: "none",
          }}
        />
      ) : (
        <p
          onClick={() => { setEditing(true); setDraft(view.summary); }}
          style={{ fontSize: 13, color: "rgba(245,245,245,0.78)", lineHeight: 1.55, cursor: "text", minHeight: 20 }}
        >
          {view.summary || <span style={{ fontStyle: "italic", color: "rgba(245,245,245,0.3)" }}>Tap to add summary...</span>}
        </p>
      )}

      {/* Confidence slider */}
      <div>
        <input
          type="range"
          min={0}
          max={100}
          value={pct}
          onChange={e => onConfidenceChange(parseInt(e.target.value, 10) / 100)}
          className="confidence-slider"
          style={{
            background: `linear-gradient(to right, #FFBF00 ${pct}%, rgba(255,255,255,0.1) ${pct}%)`,
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
          <span style={{ fontSize: 9, color: "rgba(245,245,245,0.25)" }}>Less sure</span>
          <span style={{ fontSize: 9, color: "rgba(245,245,245,0.25)" }}>Very sure</span>
        </div>
      </div>
    </motion.div>
  );
}
