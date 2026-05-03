"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useParams } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PositionEntry {
  subtopic_id: string;
  subtopic_name: string;
  stance: "yes" | "no" | "abstain";
  argument: string | null;
  weight_total: number | null;
  weight_d: number | null;
  weight_q: number | null;
  weight_c: number | null;
  deployed_at: string | null;
}

interface CategorySection {
  category_id: string;
  category_name: string;
  category_slug: string;
  positions: PositionEntry[];
}

interface ProfileData {
  user: { id: string; display_name: string | null; created_at: string | null };
  categories: CategorySection[];
  total_positions: number;
}

// ---------------------------------------------------------------------------
// Stance config
// ---------------------------------------------------------------------------
const STANCE_CFG = {
  yes:     { label: "YES",     color: "#00DCFF", bg: "rgba(0,220,255,0.10)",  border: "rgba(0,220,255,0.30)"  },
  no:      { label: "NO",      color: "#FF5A6A", bg: "rgba(255,90,106,0.10)", border: "rgba(255,90,106,0.30)" },
  abstain: { label: "ABSTAIN", color: "#888780", bg: "rgba(136,135,128,0.08)", border: "rgba(136,135,128,0.20)" },
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function IndividualManifestoPage() {
  const params = useParams<{ user_id: string }>();
  const userId = params.user_id;

  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetch(`/api/profile/${encodeURIComponent(userId)}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setError("Could not load this profile."))
      .finally(() => setLoading(false));
  }, [userId]);

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="font-mono text-[10px] tracking-[0.5em] text-secondary/20 uppercase animate-pulse">
          Loading manifesto...
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-4">
        <p className="text-red-400/70 text-sm">{error ?? "Profile not found."}</p>
        <Link href="/arena" className="text-[10px] uppercase tracking-widest text-secondary/30 hover:text-secondary/60 transition-colors">
          Back to arena
        </Link>
      </div>
    );
  }

  const displayName = data.user.display_name ?? "Anonymous";
  const hasPositions = data.total_positions > 0;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="min-h-screen" style={{ background: "#060616" }}>

      {/* Nav bar */}
      <div
        className="fixed top-0 inset-x-0 z-30 flex items-center gap-4 px-6 py-4"
        style={{
          background: "rgba(6,6,22,0.90)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <Link
          href="/arena"
          className="text-[9px] uppercase tracking-[0.3em] text-secondary/40 hover:text-secondary/70 transition-colors font-bold flex items-center gap-1.5"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Arena
        </Link>
        <div className="flex-1" />
        <p className="text-[9px] uppercase tracking-[0.3em] font-bold" style={{ color: "rgba(255,191,0,0.5)" }}>
          Individual Manifesto
        </p>
        <div className="flex-1" />
        <div className="w-20" />
      </div>

      <div className="max-w-2xl mx-auto px-5 pt-20 pb-24">

        {/* Profile header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="pt-10 pb-10"
        >
          {/* Avatar placeholder */}
          <div
            className="w-14 h-14 rounded-full mb-5 flex items-center justify-center text-lg font-bold"
            style={{
              background: "linear-gradient(135deg, rgba(255,191,0,0.15), rgba(0,220,255,0.10))",
              border: "1px solid rgba(255,255,255,0.10)",
              color: "rgba(255,191,0,0.8)",
            }}
          >
            {displayName.slice(0, 1).toUpperCase()}
          </div>

          <h1 className="font-display text-3xl font-bold tracking-tight mb-1">
            {displayName}
          </h1>

          {data.user.created_at && (
            <p className="text-[10px] uppercase tracking-[0.25em] text-secondary/25 font-bold mb-4">
              Member since {new Date(data.user.created_at).getFullYear()}
            </p>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-6 mt-5">
            <Stat value={data.total_positions} label="Deployed positions" />
            <Stat value={data.categories.length} label="Categories covered" />
            <Stat
              value={data.categories.reduce((sum, c) =>
                sum + c.positions.filter(p => p.weight_total != null).reduce((s, p) => s + (p.weight_total ?? 0), 0), 0
              ).toFixed(1)}
              label="Total vote weight"
            />
          </div>

          {/* Stance breakdown pill row */}
          {hasPositions && (
            <div className="flex items-center gap-2 mt-6 flex-wrap">
              {(["yes", "no", "abstain"] as const).map(s => {
                const count = data.categories.reduce((sum, c) =>
                  sum + c.positions.filter(p => p.stance === s).length, 0
                );
                if (count === 0) return null;
                const cfg = STANCE_CFG[s];
                return (
                  <span
                    key={s}
                    className="text-[9px] font-bold uppercase tracking-[0.2em] px-3 py-1.5 rounded-full"
                    style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
                  >
                    {count} {cfg.label}
                  </span>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* Divider */}
        <div className="h-px w-full mb-10" style={{ background: "rgba(255,255,255,0.07)" }} />

        {/* Empty state */}
        {!hasPositions && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <p className="text-secondary/30 text-sm mb-2">No deployed positions yet.</p>
            <p className="text-secondary/20 text-xs">
              Positions appear here after a user deploys views to the manifesto.
            </p>
          </motion.div>
        )}

        {/* Categories */}
        {data.categories.map((cat, ci) => (
          <motion.section
            key={cat.category_id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: ci * 0.08, duration: 0.4 }}
            className="mb-12"
          >
            <h2
              className="text-[10px] uppercase tracking-[0.35em] font-bold mb-4"
              style={{ color: "rgba(255,191,0,0.65)" }}
            >
              {cat.category_name}
            </h2>

            <div className="space-y-3">
              {cat.positions.map((pos) => (
                <PositionCard
                  key={pos.subtopic_id}
                  pos={pos}
                  expanded={expandedId === `${cat.category_id}:${pos.subtopic_id}`}
                  onToggle={() =>
                    setExpandedId(
                      expandedId === `${cat.category_id}:${pos.subtopic_id}`
                        ? null
                        : `${cat.category_id}:${pos.subtopic_id}`
                    )
                  }
                />
              ))}
            </div>
          </motion.section>
        ))}

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat block
// ---------------------------------------------------------------------------
function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <p className="font-display text-xl font-bold tracking-tight">{value}</p>
      <p className="text-[9px] uppercase tracking-[0.2em] text-secondary/30 font-bold mt-0.5">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Position card
// ---------------------------------------------------------------------------
function PositionCard({
  pos,
  expanded,
  onToggle,
}: {
  pos: PositionEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cfg = STANCE_CFG[pos.stance];
  const wD = pos.weight_d?.toFixed(1) ?? null;
  const wQ = pos.weight_q?.toFixed(2) ?? null;
  const wC = pos.weight_c?.toFixed(1) ?? null;
  const wTotal = pos.weight_total?.toFixed(1) ?? null;

  return (
    <div
      className="rounded-[1.5rem] border overflow-hidden transition-all"
      style={{
        borderColor: expanded ? cfg.border : "rgba(255,255,255,0.06)",
        background: expanded ? cfg.bg : "rgba(255,255,255,0.02)",
      }}
    >
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Stance badge */}
          <span
            className="text-[9px] font-bold uppercase tracking-[0.2em] px-2.5 py-1 rounded-full shrink-0"
            style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
          >
            {cfg.label}
          </span>
          <span className="text-sm font-medium text-secondary/85 truncate">
            {pos.subtopic_name}
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0 ml-3">
          {wTotal && (
            <span className="text-[9px] uppercase tracking-widest text-secondary/30 font-bold">
              W {wTotal}
            </span>
          )}
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2"
            className="text-secondary/20 transition-transform"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      {/* Expanded detail */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="px-5 pb-5 pt-1 space-y-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              {/* Argument */}
              {pos.argument && (
                <div>
                  <p className="text-[9px] uppercase tracking-[0.25em] font-bold text-secondary/25 mb-1.5">
                    Their argument
                  </p>
                  <p className="text-sm text-secondary/70 leading-relaxed italic">
                    &ldquo;{pos.argument}&rdquo;
                  </p>
                </div>
              )}

              {/* Weight breakdown */}
              {wD && wQ && wC && wTotal && (
                <div>
                  <p className="text-[9px] uppercase tracking-[0.25em] font-bold text-secondary/25 mb-2">
                    Vote weight breakdown
                  </p>
                  <div className="flex items-center gap-4 text-[10px]">
                    <WeightPill label="Depth D" value={wD} />
                    <span className="text-secondary/20">×</span>
                    <WeightPill label="Quality Q" value={wQ} />
                    <span className="text-secondary/20">×</span>
                    <WeightPill label="Confidence C" value={wC} />
                    <span className="text-secondary/20">=</span>
                    <WeightPill label="Total W" value={wTotal} highlight />
                  </div>
                </div>
              )}

              {/* Deployed timestamp */}
              {pos.deployed_at && (
                <p className="text-[9px] text-secondary/20 uppercase tracking-widest">
                  Deployed {new Date(pos.deployed_at).toLocaleDateString("en-GB", {
                    day: "numeric", month: "short", year: "numeric"
                  })}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weight pill
// ---------------------------------------------------------------------------
function WeightPill({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className="text-[10px] font-bold"
        style={{ color: highlight ? "#FFBF00" : "rgba(245,245,245,0.70)" }}
      >
        {value}
      </span>
      <span className="text-[8px] uppercase tracking-widest text-secondary/25">{label}</span>
    </div>
  );
}
