"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/browser";

/*
  Layered manifesto explorer. Reads /api/manifesto which returns:
    Category -> Section -> Clause (agreement + grouped for/against reasons)

  Agreement percentages come from real user_stances submissions only.
  Draft stances collected mid-chat never affect these numbers until the
  user clicks Submit, so the graph the viewer sees here always reflects
  intentional public positions.
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

export default function ManifestoBar() {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

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
    // Live refresh: any new user_stances row (real user submitting, or
    // the simulator promoting drafts) recomputes clause agreement via a
    // trigger. Listen on manifesto_clauses so the drawer animates when
    // new submissions land.
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

  const totalClauses = categories.reduce((n, c) => n + c.sections.reduce((m, s) => m + s.clauses.length, 0), 0);
  const totalStances = categories.reduce((n, c) => n + c.sections.reduce((m, s) => m + s.clauses.reduce((k, cl) => k + (cl.stance_count ?? 0), 0), 0), 0);

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="absolute top-4 left-1/2 -translate-x-1/2 z-[170] glass px-6 py-2.5 rounded-full font-display text-xs uppercase tracking-widest shadow-xl transition-all active:scale-95 flex items-center gap-2 group border border-white/10 hover:border-amber/50 text-secondary"
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
              className="fixed inset-0 z-[180] bg-black/40 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 z-[190] flex items-center justify-center p-4 md:p-12 pointer-events-none"
            >
              <div className="w-full max-w-5xl h-full max-h-[85vh] glass rounded-[2.5rem] p-8 md:p-12 shadow-card flex flex-col pointer-events-auto relative overflow-hidden text-secondary">
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight">The Nexus Manifesto</h2>
                    <p className="text-secondary/50 mt-2 font-medium tracking-wide">Live agreement built from real user stances. Expand a clause to see the reasons people gave.</p>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="w-12 h-12 flex items-center justify-center rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto pr-4 scrollbar-hide space-y-12">
                  {categories.length === 0 && (
                    <p className="text-center py-20 text-secondary/40 italic">
                      No clauses seeded yet. Run migration 20260422 and POST /api/simulate.
                    </p>
                  )}

                  {categories.map((cat) => (
                    <CategoryBlock
                      key={cat.category_id}
                      category={cat}
                      expanded={expanded}
                      onToggle={(id) => setExpanded((prev) => (prev === id ? null : id))}
                    />
                  ))}
                </div>

                <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] font-bold text-secondary/30">
                  <div className="flex gap-8">
                    <span>Clauses: {totalClauses}</span>
                    <span>Stances: {totalStances}</span>
                  </div>
                  <span>Updated live on submit</span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function CategoryBlock({
  category,
  expanded,
  onToggle,
}: {
  category: Category;
  expanded: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <section>
      <header className="mb-4 flex items-baseline justify-between gap-4">
        <div>
          <h3 className="font-display text-2xl md:text-3xl font-bold tracking-tight text-amber">
            {category.title}
          </h3>
          {category.blurb && (
            <p className="text-secondary/50 text-sm mt-1">{category.blurb}</p>
          )}
        </div>
      </header>
      <div className="space-y-6">
        {category.sections.map((sec) => (
          <div key={sec.section}>
            <p className="text-[10px] uppercase tracking-[0.25em] text-secondary/40 font-bold mb-3">
              {sec.section}
            </p>
            <ul className="space-y-2">
              {sec.clauses.map((cl) => (
                <ClauseRow
                  key={cl.clause_id}
                  clause={cl}
                  expanded={expanded === cl.clause_id}
                  onToggle={() => onToggle(cl.clause_id)}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function ClauseRow({
  clause,
  expanded,
  onToggle,
}: {
  clause: Clause;
  expanded: boolean;
  onToggle: () => void;
}) {
  const pct = Math.round(clause.agreement_pct);
  const status =
    clause.stance_count < 3
      ? "Forming"
      : pct >= 80
      ? "High Synergy"
      : pct >= 60
      ? "Building"
      : pct >= 40
      ? "Split"
      : "Contested";

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

  return (
    <li className="rounded-2xl border border-white/5 bg-white/[0.02] transition-all hover:border-amber/20">
      <button
        onClick={onToggle}
        className="w-full text-left p-4 md:p-5 flex flex-col gap-3"
      >
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm md:text-base text-secondary/80 leading-relaxed">
            {clause.statement}
          </p>
          <div className="flex flex-col items-end shrink-0 min-w-[90px]">
            <span className="text-lg font-bold text-amber tabular-nums">{pct}%</span>
            <span className="text-[9px] uppercase font-bold tracking-widest text-secondary/40">
              {status}
            </span>
          </div>
        </div>
        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber shadow-[0_0_10px_rgba(255,191,0,0.5)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] font-bold text-secondary/30">
          <span>{clause.stance_count} stances</span>
          <span className="text-secondary/50 group-hover:text-amber">
            {expanded ? "Hide arguments" : "Show arguments"}
          </span>
        </div>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-white/5"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 md:p-5">
              <ArgColumn title="For" tone="amber" items={forArgs} />
              <ArgColumn title="Against" tone="cyan" items={againstArgs} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function ArgColumn({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "amber" | "cyan";
}) {
  const color = tone === "amber" ? "text-amber" : "text-[#00DCFF]";
  return (
    <div>
      <p className={`text-[10px] uppercase tracking-[0.25em] font-bold mb-3 ${color}`}>
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-secondary/30 italic">No reasons given yet.</p>
      ) : (
        <ul className="space-y-2 text-sm text-secondary/80 leading-relaxed">
          {items.map((text, i) => (
            <li key={i} className="before:content-['—'] before:mr-2 before:text-secondary/30">
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
