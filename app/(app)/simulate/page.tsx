"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/*
  Dev trigger for the 10-user consensus simulator.

  Hitting Run POSTs /api/simulate which does four things:
    1. Ensures 10 persona accounts exist (auth + public.users).
    2. Asks Claude, once per persona, for a short chat + a list of clause
       stances the persona would take.
    3. Upserts those into draft_stances.
    4. Promotes drafts -> user_stances, which fires the clause recompute
       trigger so manifesto_clauses.agreement_pct updates.

  The post-run view shows, per section, what the 10 personas landed on
  so we can sanity-check the consensus output without opening the drawer.
*/

interface RunSummary {
  ok: boolean;
  personas: number;
  stances_total: number;
  promoted_total: number;
  runs: { slug: string; user_id: string; turns: number; stances: number }[];
  consensus: Category[];
}

interface Category {
  category_id: string;
  slug: string;
  title: string;
  blurb: string | null;
  sections: {
    section: string;
    clauses: {
      clause_id: string;
      statement: string;
      agreement_pct: number;
      stance_count: number;
      for_arguments: string[];
      against_arguments: string[];
    }[];
  }[];
}

export default function SimulatePage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [consensus, setConsensus] = useState<Category[]>([]);

  useEffect(() => {
    fetch("/api/simulate", { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => setConsensus(body?.consensus ?? []))
      .catch(() => {});
  }, []);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/simulate", { method: "POST" });
      const body = await res.json();
      if (!body?.ok) {
        setError(body?.error ?? "run_failed");
      } else {
        setSummary(body);
        setConsensus(body.consensus ?? []);
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  const showConsensus = consensus.length > 0 ? consensus : summary?.consensus ?? [];

  return (
    <main className="min-h-dvh bg-[#080a18] text-white p-8 md:p-12">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
              Consensus simulation
            </h1>
            <p className="text-white/50 mt-2 text-sm max-w-xl">
              Spawns 10 synthetic users, each has a short conversation, infers their
              stances on the immigration clauses, and pushes them through the same
              submit path a real user would.
            </p>
          </div>
          <Link
            href="/arena"
            className="text-xs uppercase tracking-[0.2em] text-white/50 hover:text-white"
          >
            Arena →
          </Link>
        </header>

        <div className="flex items-center gap-3 mb-10">
          <button
            onClick={run}
            disabled={loading}
            className="px-6 py-3 rounded-full bg-emerald-500 text-black font-semibold text-sm hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-wait"
          >
            {loading ? "Running 10 personas..." : "Run 10-user simulation"}
          </button>
          {summary && (
            <div className="text-xs text-white/50">
              {summary.promoted_total} stances promoted across {summary.personas} personas
            </div>
          )}
          {error && <div className="text-rose-400 text-xs">{error}</div>}
        </div>

        {showConsensus.length === 0 ? (
          <p className="text-white/40 italic">
            No consensus yet. Run the simulator or seed real stances via Submit on /your-view.
          </p>
        ) : (
          showConsensus.map((cat) => (
            <section key={cat.category_id} className="mb-8">
              <h2 className="font-display text-xl font-bold mb-4">{cat.title}</h2>
              <div className="space-y-4">
                {cat.sections.map((sec) => (
                  <div
                    key={sec.section}
                    className="rounded-2xl border border-white/10 bg-[#1a1c26] p-5"
                  >
                    <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/40 mb-3">
                      {sec.section}
                    </div>
                    <ul className="space-y-4">
                      {sec.clauses.map((cl) => {
                        const pct = Math.round(cl.agreement_pct);
                        const color = pct >= 65 ? "#4ade80" : pct >= 45 ? "#fbbf24" : "#fb7185";
                        return (
                          <li key={cl.clause_id}>
                            <div className="flex items-start justify-between gap-4 mb-2">
                              <p className="text-sm text-white/90 flex-1">{cl.statement}</p>
                              <span className="text-sm font-bold tabular-nums" style={{ color }}>
                                {pct}%
                              </span>
                            </div>
                            <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-2">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${pct}%`, backgroundColor: color }}
                              />
                            </div>
                            <div className="flex gap-6 text-[11px] text-white/50">
                              <span>{cl.stance_count} stances</span>
                              <span>For args: {cl.for_arguments.length}</span>
                              <span>Against args: {cl.against_arguments.length}</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}

        {summary && (
          <details className="mt-10 text-xs text-white/40">
            <summary className="cursor-pointer hover:text-white/70">Per-persona breakdown</summary>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              {summary.runs.map((r) => (
                <div key={r.user_id} className="rounded-lg border border-white/5 p-3">
                  <div className="font-semibold text-white/70">{r.slug}</div>
                  <div>turns: {r.turns} · stances: {r.stances}</div>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </main>
  );
}
