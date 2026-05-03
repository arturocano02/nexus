"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";
import type { UserView } from "@/lib/types";

interface ManifestoPanelProps {
  /** Called when a view is submitted to arena, so the globe can update */
  onViewsChanged?: () => void;
}

export default function ManifestoPanel({ onViewsChanged }: ManifestoPanelProps) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<UserView[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mounted, setMounted] = useState(false);
  const { user } = useUser();
  const supa = supabaseBrowser();

  useEffect(() => { setMounted(true); }, []);

  // Load views when panel opens
  useEffect(() => {
    if (!open || !user) return;
    (async () => {
      setLoading(true);
      try {
        const { data } = await supa
          .from("user_views")
          .select("*")
          .eq("user_id", user.id)
          .eq("is_deleted", false)
          .order("confidence_score", { ascending: false });
        if (data) setViews(data as UserView[]);
      } catch { /* ok */ }
      setLoading(false);
    })();
  }, [open, user]);

  function showToast(msg: string, duration = 3000) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), duration);
  }

  // -----------------------------------------------------------------------
  // Edit summary inline
  // -----------------------------------------------------------------------
  function startEdit(v: UserView) {
    if (v.submitted_to_arena) return;
    setEditingId(v.id);
    setEditText(v.summary);
  }

  async function saveEdit(id: string) {
    await supa.from("user_views").update({ summary: editText }).eq("id", id);
    setViews(prev => prev.map(v => v.id === id ? { ...v, summary: editText } : v));
    setEditingId(null);
    showToast("Saved");
  }

  // -----------------------------------------------------------------------
  // Confidence slider
  // -----------------------------------------------------------------------
  async function updateConfidence(id: string, score: number) {
    setViews(prev => prev.map(v => v.id === id ? { ...v, confidence_score: score } : v));
    await supa.from("user_views").update({ confidence_score: score }).eq("id", id);
  }

  // -----------------------------------------------------------------------
  // Soft delete with 4s undo
  // -----------------------------------------------------------------------
  function requestDelete(id: string) {
    showToast("View removed. Undo?", 4000);
    setViews(prev => prev.map(v => v.id === id ? { ...v, _pendingDelete: true } as any : v));
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    deleteTimer.current = setTimeout(() => commitDelete(id), 4000);
  }

  async function commitDelete(id: string) {
    await supa.from("user_views").update({ is_deleted: true }).eq("id", id);
    setViews(prev => prev.filter(v => v.id !== id));
    onViewsChanged?.();
  }

  function undoDelete(id: string) {
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    setViews(prev => prev.map(v => v.id === id ? { ...v, _pendingDelete: false } as any : v));
    setToast(null);
  }

  // -----------------------------------------------------------------------
  // Submit to arena
  // -----------------------------------------------------------------------
  async function submitToArena(v: UserView) {
    if (v.submitted_to_arena) return;
    const now = new Date().toISOString();
    const { error } = await supa.from("user_views").update({
      submitted_to_arena: true,
      submitted_at: now,
    }).eq("id", v.id);
    if (!error) {
      setViews(prev => prev.map(view =>
        view.id === v.id ? { ...view, submitted_to_arena: true, submitted_at: now } : view
      ));
      showToast("View submitted to the arena");
      onViewsChanged?.();
    }
  }

  const activeViews = views.filter(v => !(v as any)._pendingDelete);

  return (
    <>
      {/* Pill button — top center */}
      <button
        onClick={() => setOpen(true)}
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

      {/* Slide-down panel + toast — portaled to body to escape any parent transforms */}
      {mounted && createPortal(
        <>
          <AnimatePresence>
            {open && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{
                    position: "fixed", inset: 0, zIndex: 195,
                    background: "rgba(0,0,20,0.5)", backdropFilter: "blur(4px)",
                  }}
                  onClick={() => setOpen(false)}
                />

                <motion.div
                  initial={{ y: "-100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "-100%" }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  style={{
                    position: "fixed", top: 0, left: 0, right: 0,
                    zIndex: 205, margin: "0 auto",
                    maxWidth: "42rem", width: "100%",
                    height: "70dvh", display: "flex", flexDirection: "column",
                    background: "#000033",
                    borderRadius: "0 0 16px 16px",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {/* Header */}
                  <div style={{ flexShrink: 0, padding: "48px 24px 16px" }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "#FFBF00" }}>
                      Your positions
                    </p>
                    <p style={{ fontSize: 12, color: "rgba(245,245,245,0.35)", marginTop: 2 }}>
                      What you believe, in your own words.
                    </p>
                  </div>

                  {/* Views list */}
                  <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                    {loading && (
                      <p className="text-center text-xs animate-pulse" style={{ color: "rgba(245,245,245,0.25)", paddingTop: 40 }}>
                        Loading your positions...
                      </p>
                    )}

                    {!loading && activeViews.length === 0 && (
                      <div style={{ textAlign: "center", paddingTop: 48 }}>
                        <p style={{ fontSize: 13, color: "rgba(245,245,245,0.3)" }}>No positions yet.</p>
                        <p style={{ fontSize: 11, color: "rgba(245,245,245,0.18)", marginTop: 6 }}>
                          Talk to your advisor to start building your political map.
                        </p>
                      </div>
                    )}

                    {activeViews.map(view => (
                      <ViewCard
                        key={view.id}
                        view={view}
                        editingId={editingId}
                        editText={editText}
                        onEditStart={() => startEdit(view)}
                        onEditChange={setEditText}
                        onEditSave={() => saveEdit(view.id)}
                        onEditCancel={() => setEditingId(null)}
                        onConfidenceChange={score => updateConfidence(view.id, score)}
                        onDelete={() => requestDelete(view.id)}
                        onSubmit={() => submitToArena(view)}
                      />
                    ))}
                  </div>

                  {/* Close handle */}
                  <div
                    style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "16px", cursor: "pointer" }}
                    onClick={() => setOpen(false)}
                  >
                    <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)" }} />
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {toast && (
              <motion.div
                key="manifesto-toast"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{
                  position: "fixed", bottom: 112,
                  left: "50%", transform: "translateX(-50%)",
                  zIndex: 220, pointerEvents: "none", whiteSpace: "nowrap",
                }}
                className="glass rounded-full px-4 py-2 text-sm"
              >
                {toast}
              </motion.div>
            )}
          </AnimatePresence>
        </>,
        document.body
      )}
    </>
  );
}

// -----------------------------------------------------------------------
// Single view card
// -----------------------------------------------------------------------
function ViewCard({
  view,
  editingId,
  editText,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
  onConfidenceChange,
  onDelete,
  onSubmit,
}: {
  view: UserView;
  editingId: string | null;
  editText: string;
  onEditStart: () => void;
  onEditChange: (t: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onConfidenceChange: (score: number) => void;
  onDelete: () => void;
  onSubmit: () => void;
}) {
  const isEditing = editingId === view.id;
  const pct = Math.round(view.confidence_score * 100);
  const isLocked = view.submitted_to_arena;

  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(14,10,40,0.6)",
        display: "flex",
      }}
    >
      {/* Confidence bar (left edge) */}
      <div style={{ width: 4, background: "rgba(255,255,255,0.05)", position: "relative", flexShrink: 0, borderRadius: "16px 0 0 16px", overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: `${pct}%`,
            background: pct > 70 ? "#FFBF00" : pct > 40 ? "#888780" : "#6B4FBB",
            transition: "height 0.3s",
          }}
        />
      </div>

      <div className="flex-1 p-4 space-y-2.5">
        {/* Topic pill */}
        <div className="flex items-center justify-between">
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#FFBF00",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            {view.topic_label}
          </span>
          {isLocked && (
            <div className="flex items-center gap-1">
              <span style={{ fontSize: 11 }}>🔒</span>
              <span style={{ fontSize: 10, color: "rgba(245,245,245,0.3)" }}>submitted</span>
            </div>
          )}
        </div>

        {/* Position statement */}
        {isEditing ? (
          <textarea
            value={editText}
            onChange={e => onEditChange(e.target.value)}
            onBlur={onEditSave}
            autoFocus
            rows={3}
            className="w-full bg-navy-800 rounded-lg px-3 py-2 text-sm outline-none resize-none"
            style={{
              border: "1px solid rgba(255,191,0,0.3)",
              color: "rgba(245,245,245,0.9)",
              background: "rgba(0,0,50,0.5)",
            }}
          />
        ) : (
          <p style={{ fontSize: 13, color: "rgba(245,245,245,0.82)", lineHeight: 1.55 }}>
            {view.summary || <span style={{ color: "rgba(245,245,245,0.3)", fontStyle: "italic" }}>No summary yet</span>}
          </p>
        )}

        {/* Confidence slider */}
        {!isLocked && (
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 10, color: "rgba(245,245,245,0.3)", width: 28 }}>{pct}%</span>
            <input
              type="range"
              min={0}
              max={100}
              value={pct}
              onChange={e => onConfidenceChange(parseInt(e.target.value, 10) / 100)}
              className="flex-1 h-1 rounded-full appearance-none"
              style={{ accentColor: "#FFBF00" }}
            />
          </div>
        )}

        {/* Submitted note */}
        {isLocked && (
          <p style={{ fontSize: 10, color: "rgba(245,245,245,0.2)", fontStyle: "italic" }}>
            To remove from the arena, contact support.
          </p>
        )}

        {/* Actions */}
        {!isLocked && (
          <div className="flex items-center justify-between pt-0.5">
            <div className="flex items-center gap-3">
              {!isEditing && (
                <button
                  onClick={onEditStart}
                  style={{ fontSize: 11, color: "rgba(245,245,245,0.4)" }}
                  className="hover:text-secondary transition-colors"
                >
                  Edit
                </button>
              )}
              {isEditing && (
                <button
                  onClick={onEditCancel}
                  style={{ fontSize: 11, color: "rgba(245,245,245,0.4)" }}
                >
                  Cancel
                </button>
              )}
              <button
                onClick={onSubmit}
                style={{ fontSize: 11, color: "rgba(255,191,0,0.6)" }}
                className="hover:text-amber transition-colors"
              >
                Submit to arena
              </button>
            </div>
            <button
              onClick={onDelete}
              style={{ fontSize: 11, color: "rgba(255,90,106,0.5)" }}
              className="hover:opacity-80 transition-opacity"
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
