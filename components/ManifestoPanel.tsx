"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";

interface ManifestoPanelProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onDeployed?: (count: number) => void;
}

interface PendingCard {
  id: string;
  question_id: string;
  category_id: string | null;
  question_text: string;
  stance: "yes" | "no" | "abstain";
  core_argument: string;
  confidence: number; // 0..1
  _excluded?: boolean;
}

export default function ManifestoPanel({ open, onOpen, onClose, onDeployed }: ManifestoPanelProps) {
  const [cards, setCards] = useState<PendingCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { user } = useUser();
  const supa = supabaseBrowser();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open || !user) return;
    setCards([]);
    setDeployed(false);
    loadPending();
  }, [open, user?.id]);

  async function loadPending() {
    setLoading(true);
    try {
      // Fetch undeployed inferred positions that have a question_id
      const { data: positions } = await supa
        .from("inferred_positions")
        .select("id, question_id, category_id, stance, confidence, core_argument")
        .eq("user_id", user!.id)
        .is("deployed_at", null)
        .not("question_id", "is", null)
        .order("confidence", { ascending: false });

      if (!positions?.length) { setLoading(false); return; }

      // Fetch question texts in one query
      const questionIds = positions.map((p: any) => p.question_id);
      const { data: questions } = await supa
        .from("questions")
        .select("id, question_text")
        .in("id", questionIds);

      const qMap = new Map((questions ?? []).map((q: any) => [q.id, q.question_text]));

      const loaded: PendingCard[] = positions.map((p: any) => ({
        id: p.id,
        question_id: p.question_id,
        category_id: p.category_id ?? null,
        question_text: qMap.get(p.question_id) ?? "Unknown question",
        stance: (p.stance as "yes" | "no" | "abstain") ?? "abstain",
        core_argument: p.core_argument ?? "",
        confidence: Math.max(0, Math.min(1, Number(p.confidence ?? 0.5))),
      }));

      setCards(loaded);
    } catch { /* ok */ }
    setLoading(false);
  }

  function updateCard(id: string, patch: Partial<PendingCard>) {
    setCards(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  }

  function excludeCard(id: string) {
    setCards(prev => prev.map(c => c.id === id ? { ...c, _excluded: true } : c));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {}, 0);
  }

  async function deployAll() {
    const active = cards.filter(c => !c._excluded);
    if (!active.length || deploying) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/submit-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positions: active.map(c => ({
            id: c.id,
            question_id: c.question_id,
            category_id: c.category_id,
            stance: c.stance,
            core_argument: c.core_argument,
            confidence: c.confidence,
          })),
        }),
      });
      if (res.ok) {
        setDeployed(true);
        onDeployed?.(active.length);
        setTimeout(() => { onClose(); setDeployed(false); }, 2200);
      }
    } catch { /* ok */ }
    setDeploying(false);
  }

  const activeCards = cards.filter(c => !c._excluded);
  const hasAny = cards.length > 0;

  const panel = (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: "fixed", inset: 0, zIndex: 195, background: "rgba(0,0,20,0.55)", backdropFilter: "blur(4px)" }}
            onClick={onClose}
          />

          <motion.div
            initial={{ y: "-100%" }} animate={{ y: 0 }} exit={{ y: "-100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            style={{
              position: "fixed", top: 0, left: 0, right: 0,
              zIndex: 205, margin: "0 auto", maxWidth: "42rem", width: "100%",
              height: "84dvh", display: "flex", flexDirection: "column",
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
                    Review your inferred positions before deploying to the arena.
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

              {!loading && !hasAny && (
                <div style={{ textAlign: "center", paddingTop: 56 }}>
                  <p style={{ fontSize: 16, marginBottom: 8 }}>🎯</p>
                  <p style={{ fontSize: 14, color: "rgba(245,245,245,0.55)", marginBottom: 6 }}>
                    No positions inferred yet.
                  </p>
                  <p style={{ fontSize: 12, color: "rgba(245,245,245,0.25)" }}>
                    Keep talking to your advisor.
                  </p>
                  <button onClick={onClose} style={{ marginTop: 24, fontSize: 12, color: "rgba(255,191,0,0.6)", background: "none", border: "none", cursor: "pointer" }}>
                    Close
                  </button>
                </div>
              )}

              {!loading && hasAny && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4, paddingBottom: 8 }}>
                  <AnimatePresence>
                    {activeCards.map(card => (
                      <PositionCard
                        key={card.id}
                        card={card}
                        onChange={patch => updateCard(card.id, patch)}
                        onExclude={() => excludeCard(card.id)}
                      />
                    ))}
                  </AnimatePresence>
                  {activeCards.length === 0 && hasAny && (
                    <p style={{ textAlign: "center", fontSize: 13, color: "rgba(245,245,245,0.25)", paddingTop: 32 }}>
                      All removed. Nothing to deploy.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Deploy button */}
            {hasAny && !loading && (
              <div style={{ flexShrink: 0, padding: "12px 16px", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
                <button
                  onClick={deployAll}
                  disabled={deploying || activeCards.length === 0 || deployed}
                  style={{
                    width: "100%",
                    padding: "14px",
                    borderRadius: 14,
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: "0.02em",
                    border: "none",
                    cursor: activeCards.length === 0 ? "default" : "pointer",
                    background: deployed
                      ? "rgba(255,191,0,0.15)"
                      : activeCards.length === 0
                        ? "rgba(255,255,255,0.06)"
                        : "#FFBF00",
                    color: deployed || activeCards.length === 0 ? "rgba(255,191,0,0.5)" : "#1a0e00",
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
                  ) : `Deploy ${activeCards.length} position${activeCards.length !== 1 ? "s" : ""} to arena`}
                </button>
              </div>
            )}

            <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", paddingBottom: 10 }} onClick={onClose}>
              <div style={{ width: 36, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.12)", cursor: "pointer" }} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return (
    <>
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

      {mounted && createPortal(panel, document.body)}
    </>
  );
}

// -----------------------------------------------------------------------
// Single position card
// -----------------------------------------------------------------------
function PositionCard({
  card,
  onChange,
  onExclude,
}: {
  card: PendingCard;
  onChange: (patch: Partial<PendingCard>) => void;
  onExclude: () => void;
}) {
  const pct = Math.round(card.confidence * 100);

  const STANCES: { value: "yes" | "no" | "abstain"; label: string; color: string; bg: string }[] = [
    { value: "yes",     label: "Yes",     color: "#FFBF00", bg: "rgba(255,191,0,0.15)" },
    { value: "no",      label: "No",      color: "#FF5A6A", bg: "rgba(255,90,106,0.15)" },
    { value: "abstain", label: "Abstain", color: "#888780", bg: "rgba(136,135,128,0.15)" },
  ];

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
      {/* Question text + remove */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "rgba(245,245,245,0.9)", lineHeight: 1.45, flex: 1 }}>
          {card.question_text}
        </p>
        <button
          onClick={onExclude}
          style={{ fontSize: 11, color: "rgba(255,90,106,0.55)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px", flexShrink: 0 }}
        >
          Remove
        </button>
      </div>

      {/* Stance toggle */}
      <div style={{ display: "flex", gap: 6 }}>
        {STANCES.map(s => {
          const active = card.stance === s.value;
          return (
            <button
              key={s.value}
              onClick={() => onChange({ stance: s.value })}
              style={{
                flex: 1,
                padding: "6px 0",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                border: `1px solid ${active ? s.color + "60" : "rgba(255,255,255,0.08)"}`,
                background: active ? s.bg : "transparent",
                color: active ? s.color : "rgba(245,245,245,0.3)",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {s.label.toUpperCase()}
            </button>
          );
        })}
      </div>

      {/* Editable core argument */}
      <textarea
        value={card.core_argument}
        onChange={e => onChange({ core_argument: e.target.value })}
        rows={2}
        placeholder="Your argument (edit or leave as-is)..."
        style={{
          width: "100%", fontSize: 12, lineHeight: 1.5,
          color: "rgba(245,245,245,0.78)", background: "rgba(0,0,40,0.4)",
          border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8,
          padding: "8px 10px", outline: "none", resize: "none",
          fontFamily: "inherit",
        }}
      />

      {/* Confidence slider */}
      <div>
        <input
          type="range"
          min={0}
          max={100}
          value={pct}
          onChange={e => onChange({ confidence: parseInt(e.target.value, 10) / 100 })}
          className="confidence-slider"
          style={{
            background: `linear-gradient(to right, #FFBF00 ${pct}%, rgba(255,255,255,0.1) ${pct}%)`,
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
          <span style={{ fontSize: 9, color: "rgba(245,245,245,0.25)" }}>Less sure</span>
          <span style={{ fontSize: 9, color: "rgba(245,245,245,0.25)" }}>{pct}%</span>
          <span style={{ fontSize: 9, color: "rgba(245,245,245,0.25)" }}>Very sure</span>
        </div>
      </div>
    </motion.div>
  );
}
