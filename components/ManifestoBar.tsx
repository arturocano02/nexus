"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/browser";

/*
  Layered manifesto explorer. Reads /api/manifesto which returns:
    Category (Immigration)
      -> Section (Border and enforcement, Economic migration, ...)
         -> Clause (statement + agreement_pct + grouped reasons)

  Rendering mirrors the product mock: each section is a single expandable
  row with a status pill on the right. Expanding it reveals the clauses
  inside, each with a percentage bar and a coloured FOR / AGAINST block.

  Graph-wise the only source of truth here is user_stances. Mid-chat
  draft stances never touch agreement_pct, so what this drawer renders
  always reflects deliberate, submitted opinions only.
*/

interface Clause {
  clause_id: string;
  statement: string;
  agreement_pct: number;
  stance_count: number;
  for_arguments: string[];
  against_arguments: string[];
  for_argument_seed: string | null;
  against_argument_seed: string | null;
}

interface Section {
  section: string;
  clauses: Clause[];
}

interface Category {
  category_id: string;
  slug: string;
  title: string;
  blurb: string | null;
  sections: Section[];
}

type StatusTone = "agreed" | "mostly" | "mixed" | "disputed" | "forming";

interface Status {
  tone: StatusTone;
  label: string;
}

export default function ManifestoBar() {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/manifesto", { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data.categories)) setCategories(data.categories);
    } catch (err) {
      console.warn("manifesto load failed", err);
    }
  }, []);

  useEffect(() => {
    load();
    // Live refresh: submit-time aggregates fire on manifesto_clauses via
    // the recompute trigger. We subscribe there so the drawer updates
    // only when real opinions land, not when someone is typing.
    const supa = supabaseBrowser();
    const ch = supa
      .channel("manifesto-bar")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manifesto_clauses" },
        () => load(),
      )
      .subscribe();
    return () => {
      supa.removeChannel(ch);
    };
  }, [load]);

  const totalClauses = categories.reduce(
    (n, c) => n + c.sections.reduce((m, s) => m + s.clauses.length, 0),
    0,
  );
  const totalStances = categories.reduce(
    (n, c) =>
      n +
      c.sections.reduce(
        (m, s) => m + s.clauses.reduce((k, cl) => k + (cl.stance_count ?? 0), 0),
        0,
      ),
    0,
  );

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="absolute top-4 left-1/2 -translate-x-1/2 z-[170] glass px-6 py-2.5 rounded-full font-display text-xs uppercase tracking-widest shadow-xl transition-all active:scale-95 flex items-center gap-2 group border border-white/10 hover:border-emerald-400/50 text-secondary"
      >
        <span>Manifesto</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-[10px]">▼</motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[180] bg-black/50 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 12 }}
              className="fixed inset-0 z-[190] flex items-center justify-center p-4 md:p-10 pointer-events-none"
            >
              <div className="w-full max-w-4xl h-full max-h-[88vh] rounded-[2rem] p-6 md:p-10 shadow-2xl flex flex-col pointer-events-auto relative overflow-hidden bg-[#0f111a] border border-white/5 text-white">
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-white">
                      {categories[0]?.title ?? "Manifesto"} <span className="text-white/40 text-xl font-normal">· layered manifesto explorer</span>
                    </h2>
                    <p className="text-white/45 mt-2 text-sm">
                      Click any section to expand clauses and arguments
                    </p>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                    aria-label="Close"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 scrollbar-hide">
                  {categories.length === 0 && (
                    <p className="text-center py-20 text-white/40 italic">
                      No clauses seeded yet. Run migration 20260422 then POST /api/simulate.
                    </p>
                  )}

                  {categories.map((cat) => (
                    <div key={cat.category_id} className="mb-10">
                      {cat.blurb && (
                        <p className="text-white/40 text-sm mb-4">{cat.blurb}</p>
                      )}
                      <ul className="space-y-3">
                        {cat.sections.map((sec) => {
                          const key = `${cat.category_id}:${sec.section}`;
                          return (
                            <SectionRow
                              key={key}
                              section={sec}
                              expanded={!!expanded[key]}
                              onToggle={() =>
                                setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
                              }
                            />
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>

                <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] font-bold text-white/30">
                  <div className="flex gap-8">
                    <span>Clauses: {totalClauses}</span>
                    <span>Stances: {totalStances}</span>
                  </div>
                  <span>Updated on submit</span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function SectionRow({
  section,
  expanded,
  onToggle,
}: {
  section: Section;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = useMemo(() => statusFromClauses(section.clauses), [section.clauses]);
  const clauseWord = section.clauses.length === 1 ? "clause" : "clauses";

  return (
    <li className="rounded-2xl bg-[#1a1c26] border border-white/5 overflow-hidden transition-all hover:border-white/10">
      <button
        onClick={onToggle}
        className="w-full text-left px-5 md:px-6 py-4 flex items-center justify-between gap-4"
      >
        <div className="flex items-baseline gap-3">
          <span className="font-semibold text-white text-base md:text-lg">
            {section.section}
          </span>
          <span className="text-white/40 text-sm">
            {section.clauses.length} {clauseWord}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <StatusPill status={status} />
          <motion.span animate={{ rotate: expanded ? 90 : 0 }} className="text-white/40 text-xs">
            ▶
          </motion.span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="border-t border-white/5"
          >
            <div className="px-5 md:px-6 py-5 space-y-6">
              {section.clauses.map((cl, idx) => (
                <ClauseCard key={cl.clause_id} clause={cl} showDivider={idx > 0} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function ClauseCard({ clause, showDivider }: { clause: Clause; showDivider: boolean }) {
  const pct = Math.round(clause.agreement_pct);
  const barColor = colorForPct(pct);
  const forArgs = clause.for_arguments.length > 0
    ? clause.for_arguments
    : clause.for_argument_seed
    ? [clause.for_argument_seed]
    : [];
  const againstArgs = clause.against_arguments.length > 0
    ? clause.against_arguments
    : clause.against_argument_seed
    ? [clause.against_argument_seed]
    : [];
  const forText = forArgs[0] ?? "No reasons shared yet.";
  const againstText = againstArgs[0] ?? "No reasons shared yet.";

  return (
    <div className={showDivider ? "pt-6 border-t border-white/5" : ""}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <p className="text-white text-base leading-relaxed flex-1">
          {clause.statement}
        </p>
        <span
          className="text-2xl font-bold tabular-nums shrink-0"
          style={{ color: barColor }}
        >
          {pct}%
        </span>
      </div>

      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mb-4">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="h-full rounded-full"
          style={{ backgroundColor: barColor }}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ArgBox tone="for" text={forText} />
        <ArgBox tone="against" text={againstText} />
      </div>

      {(forArgs.length > 1 || againstArgs.length > 1) && (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-[10px] uppercase tracking-[0.2em] font-bold text-white/30 hover:text-white/50">
            More arguments ({forArgs.length + againstArgs.length - 2})
          </summary>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <ExtraList tone="for" items={forArgs.slice(1)} />
            <ExtraList tone="against" items={againstArgs.slice(1)} />
          </div>
        </details>
      )}
    </div>
  );
}

function ArgBox({ tone, text }: { tone: "for" | "against"; text: string }) {
  const isFor = tone === "for";
  const label = isFor ? "FOR" : "AGAINST";
  const bg = isFor ? "bg-emerald-900/25" : "bg-rose-900/25";
  const border = isFor ? "border-emerald-700/30" : "border-rose-700/30";
  const labelColor = isFor ? "text-emerald-700" : "text-rose-700";
  const textColor = isFor ? "text-emerald-200/90" : "text-rose-200/90";
  return (
    <div className={`rounded-xl border ${border} ${bg} p-4`}>
      <div className={`text-[10px] font-bold tracking-[0.2em] mb-2 ${labelColor}`}>
        {label}
      </div>
      <p className={`text-sm leading-relaxed ${textColor}`}>{text}</p>
    </div>
  );
}

function ExtraList({ tone, items }: { tone: "for" | "against"; items: string[] }) {
  if (items.length === 0) return <div />;
  const color = tone === "for" ? "text-emerald-200/70" : "text-rose-200/70";
  return (
    <ul className={`space-y-2 text-sm ${color}`}>
      {items.map((t, i) => (
        <li key={i} className="leading-relaxed">
          <span className="text-white/30 mr-2">•</span>
          {t}
        </li>
      ))}
    </ul>
  );
}

function StatusPill({ status }: { status: Status }) {
  const styles: Record<StatusTone, string> = {
    agreed: "bg-emerald-900/40 text-emerald-300 border-emerald-600/30",
    mostly: "bg-emerald-900/30 text-emerald-300 border-emerald-700/30",
    mixed: "bg-amber-900/30 text-amber-300 border-amber-700/30",
    disputed: "bg-rose-900/25 text-rose-300 border-rose-700/30",
    forming: "bg-white/5 text-white/50 border-white/10",
  };
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${styles[status.tone]}`}
    >
      {status.label}
    </span>
  );
}

/*
  Section status is derived from its clauses:
    forming  - not enough stances yet to call it
    agreed   - high avg + tight spread
    mostly   - decent avg
    mixed    - mid avg OR wide spread
    disputed - low avg
*/
function statusFromClauses(clauses: Clause[]): Status {
  if (clauses.length === 0) return { tone: "forming", label: "Forming" };
  const counted = clauses.filter((c) => c.stance_count > 0);
  if (counted.length === 0) return { tone: "forming", label: "Forming" };

  const pcts = counted.map((c) => c.agreement_pct);
  const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
  const spread = Math.max(...pcts) - Math.min(...pcts);

  if (spread > 45) return { tone: "mixed", label: "Mixed" };
  if (avg >= 85) return { tone: "agreed", label: "Agreed" };
  if (avg >= 65) return { tone: "mostly", label: "Mostly agreed" };
  if (avg >= 45) return { tone: "mixed", label: "Mixed" };
  return { tone: "disputed", label: "Deeply disputed" };
}

function colorForPct(pct: number): string {
  // Emerald -> amber -> rose spectrum that matches the status pills.
  if (pct >= 65) return "#4ade80"; // emerald-400
  if (pct >= 45) return "#fbbf24"; // amber-400
  return "#fb7185"; // rose-400
}
