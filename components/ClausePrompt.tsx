"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/*
  Casual mid-chat clause prompt.

  When the chat endpoint writes a draft_stance (inferred from the user's
  free-form turn), it returns the clause id. We show a small card here:

    "Sounds like you lean for / against this. Confirm?"
    [ For ] [ Against ] [ Skip ]  + optional reason

  Nothing public moves on submit of this card. We only upsert a draft
  stance. The public graph stays frozen until the user clicks Submit
  on the main review screen, which promotes drafts into user_stances.
*/

export interface ClausePromptData {
  clause_id: string;
  statement: string;
  section: string;
  inferred_stance: "for" | "against" | "skip" | null;
  reasoning?: string | null;
}

interface Props {
  prompts: ClausePromptData[];
  onResolve: (clauseId: string) => void;
  onSaved?: () => void;
}

export default function ClausePromptCard({ prompts, onResolve, onSaved }: Props) {
  const current = prompts[0] ?? null;
  const [stance, setStance] = useState<"for" | "against" | "skip" | null>(null);
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!current) return;
    setStance(current.inferred_stance ?? null);
    setReason(current.reasoning ?? "");
    setShowReason(false);
  }, [current?.clause_id]);

  if (!current) return null;

  const save = async (picked: "for" | "against" | "skip") => {
    setSaving(true);
    setStance(picked);
    try {
      await fetch("/api/stances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stances: [
            {
              clause_id: current.clause_id,
              stance: picked,
              reasoning: reason.trim() || null,
              confidence: 0.9,
              source: "direct",
            },
          ],
        }),
      });
      onSaved?.();
    } catch (err) {
      console.warn("clause stance save failed", err);
    } finally {
      setSaving(false);
      // Small beat so the user sees confirmation before the card swaps.
      setTimeout(() => onResolve(current.clause_id), 280);
    }
  };

  const inferLine = current.inferred_stance === "for"
    ? "Sounds like you're for this."
    : current.inferred_stance === "against"
    ? "Sounds like you're against this."
    : "Want to take a stance on this?";

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={current.clause_id}
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="rounded-2xl border border-white/10 bg-[#14162080] backdrop-blur p-4 my-3"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/40">
            {current.section} · quick check
          </span>
          <button
            onClick={() => onResolve(current.clause_id)}
            className="text-white/30 hover:text-white/70 text-xs"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
        <p className="text-white text-sm leading-relaxed mb-3">
          {current.statement}
        </p>
        <p className="text-white/50 text-xs mb-3">{inferLine}</p>

        <div className="flex gap-2 mb-3">
          <Choice
            label="For"
            tone="for"
            picked={stance === "for"}
            disabled={saving}
            onClick={() => save("for")}
          />
          <Choice
            label="Against"
            tone="against"
            picked={stance === "against"}
            disabled={saving}
            onClick={() => save("against")}
          />
          <Choice
            label="Skip"
            tone="skip"
            picked={stance === "skip"}
            disabled={saving}
            onClick={() => save("skip")}
          />
        </div>

        {!showReason ? (
          <button
            onClick={() => setShowReason(true)}
            className="text-[11px] text-white/40 hover:text-white/70"
          >
            + add a reason (optional)
          </button>
        ) : (
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="One sentence, in your own words."
            rows={2}
            maxLength={400}
            className="w-full resize-none rounded-lg border border-white/10 bg-black/30 text-white text-sm p-2 placeholder-white/30 focus:outline-none focus:border-white/30"
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function Choice({
  label,
  tone,
  picked,
  disabled,
  onClick,
}: {
  label: string;
  tone: "for" | "against" | "skip";
  picked: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const base = "flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-all";
  const styles = picked
    ? {
        for: "bg-emerald-500/20 text-emerald-200 border-emerald-500/50",
        against: "bg-rose-500/20 text-rose-200 border-rose-500/50",
        skip: "bg-white/15 text-white border-white/30",
      }[tone]
    : {
        for: "border-emerald-700/30 text-emerald-300/80 hover:bg-emerald-500/10",
        against: "border-rose-700/30 text-rose-300/80 hover:bg-rose-500/10",
        skip: "border-white/10 text-white/60 hover:bg-white/5",
      }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles} disabled:opacity-50`}
    >
      {label}
    </button>
  );
}
