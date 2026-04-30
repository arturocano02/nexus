"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";
import type { TaxonomyCategory } from "@/lib/types";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface PositionRow {
  id: string;
  subtopic_id: string;
  subtopic_name: string;
  question_text: string;
  stance: "yes" | "no" | "abstain" | "unclear" | null;
  confidence: number;
  reasoning: string | null;
  first_argument: string | null;
  deployed_at: string | null;
  retracted_at: string | null;
  arguments_count: number;
}

interface TopicDetailPanelProps {
  open: boolean;
  category: TaxonomyCategory | null;
  subtopicId?: string | null;
  onClose: () => void;
  onContinue: () => void;
}

// -----------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------

const STANCE_COLOR: Record<string, string> = {
  yes: "#00DCFF",
  no: "#FF5A6A",
  abstain: "#888780",
  unclear: "#FFBF00",
};

const STANCE_LABEL: Record<string, string> = {
  yes: "YES",
  no: "NO",
  abstain: "ABSTAIN",
  unclear: "UNCLEAR",
};

// -----------------------------------------------------------------------
// Loader
// -----------------------------------------------------------------------

async function loadCategoryPositions(
  supa: ReturnType<typeof import("@/lib/supabase/browser").supabaseBrowser>,
  userId: string,
  categoryId: string,
): Promise<PositionRow[]> {
  const { data: positions } = await supa
    .from("inferred_positions")
    .select("id, subtopic_id, stance, confidence, reasoning, deployed_at, retracted_at, arguments_json")
    .eq("user_id", userId)
    .eq("category_id", categoryId)
    .order("created_at", { ascending: false });

  if (!positions || positions.length === 0) return [];

  const subtopicIds = [...new Set(positions.map((p: any) => p.subtopic_id).filter(Boolean))];

  const [{ data: subtopics }, { data: questions }] = await Promise.all([
    supa.from("taxonomy_subtopics").select("id, name, latent_question_text").in("id", subtopicIds),
    supa.from("taxonomy_questions").select("subtopic_id, question_text").in("subtopic_id", subtopicIds).eq("depth_layer", 1),
  ]);

  const subMap = new Map((subtopics ?? []).map((s: any) => [s.id, s]));
  const qMap = new Map((questions ?? []).map((q: any) => [q.subtopic_id, q.question_text]));

  return positions.map((p: any) => {
    const sub = subMap.get(p.subtopic_id) as any;
    const args = Array.isArray(p.arguments_json) ? p.arguments_json : [];
    return {
      id: p.id,
      subtopic_id: p.subtopic_id,
      subtopic_name: sub?.name ?? "Unknown",
      question_text: sub?.latent_question_text ?? qMap.get(p.subtopic_id) ?? sub?.name ?? "",
      stance: p.stance,
      confidence: p.confidence ?? 0.5,
      reasoning: p.reasoning ?? null,
      first_argument: args[0]?.text ?? null,
      deployed_at: p.deployed_at,
      retracted_at: p.retracted_at,
      arguments_count: args.length,
    };
  });
}

// -----------------------------------------------------------------------
// Stance pill
// -----------------------------------------------------------------------

function StancePill({ stance }: { stance: string }) {
  const color = STANCE_COLOR[stance] ?? "#888";
  const label = STANCE_LABEL[stance] ?? stance;
  return (
    <span
      className="text-[10px] font-bold tracking-[0.15em] px-2.5 py-1 rounded-full"
      style={{ color, background: color + "18", border: `1px solid ${color}33` }}
    >
      {label}
    </span>
  );
}

// -----------------------------------------------------------------------
// Inline stance editor row
// -----------------------------------------------------------------------

function InlineStanceEditor({
  row,
  onStanceChange,
}: {
  row: PositionRow;
  onStanceChange: (id: string, stance: "yes" | "no" | "abstain") => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  async function change(s: "yes" | "no" | "abstain") {
    if (s === row.stance || saving) return;
    setSaving(true);
    await onStanceChange(row.id, s);
    setSaving(false);
  }

  return (
    <div className="flex items-center gap-1.5">
      {(["yes", "no", "abstain"] as const).map(s => {
        const color = STANCE_COLOR[s];
        const active = row.stance === s;
        return (
          <button
            key={s}
            disabled={saving}
            onClick={() => change(s)}
            className="px-2.5 py-1 rounded-full text-[9px] font-bold tracking-widest uppercase transition-all active:scale-95 disabled:opacity-40"
            style={{
              color: active ? color : "rgba(255,255,255,0.3)",
              background: active ? color + "18" : "transparent",
              border: `1px solid ${active ? color + "55" : "rgba(255,255,255,0.08)"}`,
            }}
          >
            {STANCE_LABEL[s]}
          </button>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------
// SUBTOPIC VIEW
// -----------------------------------------------------------------------

function SubtopicView({
  category,
  subtopicId,
  rows,
  onStanceChange,
}: {
  category: TaxonomyCategory;
  subtopicId: string;
  rows: PositionRow[];
  onStanceChange: (id: string, stance: "yes" | "no" | "abstain") => Promise<void>;
}) {
  const subtopicRows = rows.filter(r => r.subtopic_id === subtopicId);
  const subtopicName = subtopicRows[0]?.subtopic_name ?? "Subtopic";

  const byQuestion = new Map<string, PositionRow>();
  for (const r of subtopicRows) {
    if (!r.stance || r.stance === "unclear") continue;
    const existing = byQuestion.get(r.question_text);
    if (!existing || r.confidence > existing.confidence) byQuestion.set(r.question_text, r);
  }
  const questions = [...byQuestion.values()];

  return (
    <div className="flex flex-col gap-0 h-full">
      <div className="px-7 pt-7 pb-1 shrink-0">
        <p className="text-[9px] uppercase tracking-[0.35em] font-bold" style={{ color: "rgba(255,191,0,0.4)" }}>
          {category.name} <span style={{ color: "rgba(255,255,255,0.15)" }}>›</span>
        </p>
        <h2 className="font-display text-xl font-bold tracking-tight mt-0.5">{subtopicName}</h2>
        <p className="text-secondary/30 text-xs mt-1">
          {questions.length > 0
            ? `${questions.length} position${questions.length !== 1 ? "s" : ""} inferred`
            : "No clear positions inferred yet"}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-4 space-y-3 scrollbar-hide">
        {questions.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-secondary/30 text-sm leading-relaxed">
              Keep talking — the AI will infer your position as the conversation develops.
            </p>
          </div>
        )}

        {questions.map((row, i) => {
          const color = STANCE_COLOR[row.stance!] ?? "#888";
          const isDeployed = !!row.deployed_at && !row.retracted_at;

          return (
            <motion.div
              key={row.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="rounded-2xl overflow-hidden"
              style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)" }}
            >
              <div className="px-5 pt-5 pb-3">
                <p className="text-sm font-medium text-secondary/85 leading-snug">{row.question_text}</p>
              </div>

              <div className="px-5 py-3 flex items-center gap-3 flex-wrap" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                {/* Editable stance */}
                <InlineStanceEditor row={row} onStanceChange={onStanceChange} />
                <span className="text-[9px] text-secondary/25">{Math.round(row.confidence * 100)}%</span>
                {isDeployed && (
                  <span className="ml-auto text-[9px] uppercase tracking-widest font-bold" style={{ color: "#22C55E99" }}>
                    ✓ In manifesto
                  </span>
                )}
              </div>

              {row.reasoning && (
                <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,191,0,0.03)" }}>
                  <p className="text-[9px] text-amber/35 font-bold uppercase tracking-widest mb-1.5">Why the AI thinks this</p>
                  <p className="text-xs text-secondary/45 leading-relaxed">{row.reasoning}</p>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// CATEGORY SUMMARY VIEW
// -----------------------------------------------------------------------

function CategorySummaryView({
  category,
  rows,
  onStanceChange,
}: {
  category: TaxonomyCategory;
  rows: PositionRow[];
  onStanceChange: (id: string, stance: "yes" | "no" | "abstain") => Promise<void>;
}) {
  // Best position per subtopic (highest confidence, not retracted)
  const bySubtopic = new Map<string, PositionRow>();
  for (const r of rows) {
    if (!r.stance || r.stance === "unclear" || r.retracted_at) continue;
    const existing = bySubtopic.get(r.subtopic_id);
    if (!existing || r.confidence > existing.confidence) bySubtopic.set(r.subtopic_id, r);
  }
  const positions = [...bySubtopic.values()];

  const deployed = positions.filter(p => !!p.deployed_at && !p.retracted_at);
  const yesPositions = positions.filter(p => p.stance === "yes");
  const noPositions = positions.filter(p => p.stance === "no");
  const abstainPositions = positions.filter(p => p.stance === "abstain");

  return (
    <div className="flex flex-col gap-0 h-full">
      {/* Header */}
      <div className="px-7 pt-7 pb-4 shrink-0">
        <p className="text-[9px] uppercase tracking-[0.35em] font-bold mb-1" style={{ color: "rgba(255,191,0,0.4)" }}>Your view</p>
        <h2 className="font-display text-2xl font-bold tracking-tight">{category.name}</h2>

        {positions.length > 0 && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {yesPositions.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold tracking-widest"
                style={{ background: "rgba(0,220,255,0.1)", border: "1px solid rgba(0,220,255,0.25)", color: "#00DCFF" }}>
                {yesPositions.length} YES
              </span>
            )}
            {noPositions.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold tracking-widest"
                style={{ background: "rgba(255,90,106,0.1)", border: "1px solid rgba(255,90,106,0.25)", color: "#FF5A6A" }}>
                {noPositions.length} NO
              </span>
            )}
            {abstainPositions.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold tracking-widest"
                style={{ background: "rgba(136,135,128,0.1)", border: "1px solid rgba(136,135,128,0.25)", color: "#888780" }}>
                {abstainPositions.length} ABSTAIN
              </span>
            )}
            <span className="text-[9px] text-secondary/25 ml-1">
              across {positions.length} subtopic{positions.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {positions.length === 0 ? (
          <div className="px-7 py-12 text-center">
            <p className="text-secondary/30 text-sm">No positions inferred yet. Start talking about this topic.</p>
          </div>
        ) : (
          <div className="px-7 pb-4 space-y-5">

            {/* In the manifesto — shows argument/reason, not the question */}
            {deployed.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#22C55E" }} />
                  <p className="text-[9px] uppercase tracking-[0.3em] font-bold" style={{ color: "#22C55E99" }}>
                    In the manifesto
                  </p>
                </div>
                <div className="space-y-2">
                  {deployed.map((row, i) => (
                    <motion.div
                      key={row.id}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="rounded-2xl overflow-hidden"
                      style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.12)" }}
                    >
                      <div className="px-4 pt-3 pb-1">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-secondary/30">{row.subtopic_name}</span>
                      </div>
                      {/* Show the argument/reason the user gave — not the question */}
                      <div className="px-4 pb-3">
                        <p className="text-xs text-secondary/65 leading-relaxed italic">
                          {row.first_argument ?? row.reasoning ?? row.question_text}
                        </p>
                      </div>
                      <div className="px-4 pb-3 flex items-center gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                        <StancePill stance={row.stance!} />
                        <InlineStanceEditor row={row} onStanceChange={onStanceChange} />
                      </div>
                    </motion.div>
                  ))}
                </div>
              </section>
            )}

            {/* YES answers */}
            {yesPositions.filter(p => !p.deployed_at || p.retracted_at).length > 0 && (
              <StanceSection label="Answered YES" color="#00DCFF" rows={yesPositions.filter(p => !p.deployed_at)} onStanceChange={onStanceChange} />
            )}

            {/* NO answers */}
            {noPositions.filter(p => !p.deployed_at || p.retracted_at).length > 0 && (
              <StanceSection label="Answered NO" color="#FF5A6A" rows={noPositions.filter(p => !p.deployed_at)} onStanceChange={onStanceChange} />
            )}

            {/* ABSTAIN */}
            {abstainPositions.filter(p => !p.deployed_at || p.retracted_at).length > 0 && (
              <StanceSection label="Abstained" color="#888780" rows={abstainPositions.filter(p => !p.deployed_at)} onStanceChange={onStanceChange} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StanceSection({
  label,
  color,
  rows,
  onStanceChange,
}: {
  label: string;
  color: string;
  rows: PositionRow[];
  onStanceChange: (id: string, stance: "yes" | "no" | "abstain") => Promise<void>;
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        <p className="text-[9px] uppercase tracking-[0.3em] font-bold" style={{ color: color + "88" }}>{label}</p>
      </div>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <motion.div
            key={row.id}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className="rounded-xl overflow-hidden"
            style={{ background: color + "08", border: `1px solid ${color}18` }}
          >
            <div className="px-4 pt-3 pb-1">
              <span className="text-[9px] font-bold uppercase tracking-wider text-secondary/30">{row.subtopic_name}</span>
            </div>
            <div className="px-4 pb-2">
              <p className="text-xs text-secondary/55 leading-snug">{row.question_text}</p>
            </div>
            <div className="px-4 pb-3">
              <InlineStanceEditor row={row} onStanceChange={onStanceChange} />
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------
// Main export
// -----------------------------------------------------------------------

export default function TopicDetailPanel({
  open,
  category,
  subtopicId,
  onClose,
  onContinue,
}: TopicDetailPanelProps) {
  const { user } = useUser();
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const supa = supabaseBrowser();

  async function reload() {
    if (!category || !user) return;
    const fresh = await loadCategoryPositions(supa, user.id, category.id);
    setRows(fresh);
  }

  useEffect(() => {
    if (!open || !category || !user) return;
    setRows([]);
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [open, category?.id, user?.id]);

  // Inline stance change — updates directly in Supabase, then reloads
  async function handleStanceChange(positionId: string, stance: "yes" | "no" | "abstain") {
    await supa.from("inferred_positions").update({ stance }).eq("id", positionId);
    await reload();
  }

  const isSubtopicMode = !!subtopicId;

  return (
    <AnimatePresence>
      {open && (
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
            style={{ maxHeight: "82dvh" }}
          >
            <div
              className="rounded-t-[2.5rem] flex flex-col text-secondary overflow-hidden"
              style={{
                maxHeight: "82dvh",
                background: "rgba(6,6,22,0.97)",
                backdropFilter: "blur(32px)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderBottom: "none",
              }}
            >
              {/* Close button */}
              <div className="absolute top-5 right-6 z-10">
                <button
                  onClick={onClose}
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-hidden flex flex-col">
                {loading ? (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="font-mono text-[10px] tracking-[0.4em] text-secondary/20 uppercase animate-pulse">Loading...</p>
                  </div>
                ) : isSubtopicMode && category ? (
                  <SubtopicView
                    category={category}
                    subtopicId={subtopicId!}
                    rows={rows}
                    onStanceChange={handleStanceChange}
                  />
                ) : category ? (
                  <CategorySummaryView
                    category={category}
                    rows={rows}
                    onStanceChange={handleStanceChange}
                  />
                ) : null}
              </div>

              {/* Footer */}
              <div
                className="shrink-0 px-7 pb-7 pt-4 flex gap-3"
                style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
              >
                <button
                  onClick={onClose}
                  className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-secondary/30 hover:text-secondary/55 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={onContinue}
                  className="flex-1 py-4 rounded-full text-xs font-bold uppercase tracking-[0.25em] border-2 transition-all"
                  style={{ borderColor: "rgba(255,191,0,0.5)", color: "#FFBF00" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,191,0,0.08)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  {rows.some(r => r.stance && r.stance !== "unclear")
                    ? "Continue conversation"
                    : "Start talking"}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
