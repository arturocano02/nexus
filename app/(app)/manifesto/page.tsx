"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

interface Position {
  subtopic_id: string;
  subtopic_name: string;
  yes_pct: number;
  no_pct: number;
  responses: number;
  top_yes_args: string[];
  top_no_args: string[];
}

interface Section {
  category_id: string;
  category_name: string;
  positions: Position[];
}

export default function ManifestoPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [manifesto, setManifesto] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [noData, setNoData] = useState(false);

  useEffect(() => {
    async function loadPositions() {
      setLoading(true);
      try {
        const res = await fetch("/api/manifesto");
        const body = await res.json();
        if (!body.sections || body.sections.length === 0) {
          setNoData(true);
        } else {
          setSections(body.sections);
        }
      } catch (e) {
        console.error(e);
        setNoData(true);
      } finally {
        setLoading(false);
      }
    }
    loadPositions();
  }, []);

  async function generate() {
    setGenerating(true);
    setManifesto(null);
    try {
      const res = await fetch("/api/manifesto", { method: "POST" });
      const body = await res.json();
      setManifesto(body.manifesto ?? null);
      if (!body.manifesto) setNoData(true);
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="font-mono text-[10px] tracking-[0.5em] text-secondary/20 uppercase animate-pulse">
          Loading agreed positions...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080a18] text-secondary">
      {/* Top nav */}
      <div className="fixed top-0 inset-x-0 z-10 flex items-center gap-4 px-6 py-4"
           style={{ background: "rgba(8,10,24,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <Link href="/arena"
          className="text-[9px] uppercase tracking-[0.3em] text-secondary/40 hover:text-amber transition-colors font-bold flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Arena
        </Link>
        <div className="flex-1" />
        <p className="text-[9px] uppercase tracking-[0.3em] text-amber/50 font-bold">Collective Manifesto</p>
        <div className="flex-1" />
        {manifesto && (
          <button
            onClick={() => {
              const blob = new Blob([manifesto], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "nexo-manifesto.txt";
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="text-[9px] uppercase tracking-[0.25em] font-bold text-secondary/40 hover:text-secondary transition-colors"
          >
            Export
          </button>
        )}
      </div>

      <div className="max-w-2xl mx-auto px-6 pt-24 pb-24">

        {/* No data state */}
        {noData && !generating && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-24"
          >
            <p className="text-amber font-display text-2xl font-bold mb-3">No agreed positions yet</p>
            <p className="text-secondary/40 text-sm leading-relaxed max-w-sm mx-auto">
              The manifesto is built from positions where the collective has reached agreement. Have more conversations and deploy your views to build it.
            </p>
            <Link href="/your-view"
              className="mt-8 inline-block px-8 py-3 rounded-full text-xs font-bold uppercase tracking-widest border border-amber/40 text-amber hover:bg-amber/10 transition-all">
              Start a conversation
            </Link>
          </motion.div>
        )}

        {/* Agreed positions summary */}
        {!noData && sections.length > 0 && !manifesto && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="mb-10">
              <h1 className="font-display text-3xl font-bold tracking-tight mb-2">
                Agreed positions
              </h1>
              <p className="text-secondary/40 text-sm">
                These are the topics where the collective has reached clear agreement. Generate the manifesto to turn them into policy commitments.
              </p>
            </div>

            {sections.map((section) => (
              <div key={section.category_id} className="mb-8">
                <h2 className="text-[10px] uppercase tracking-[0.35em] font-bold text-amber/70 mb-3">
                  {section.category_name}
                </h2>
                <div className="space-y-2">
                  {section.positions.map((pos) => {
                    const direction = pos.yes_pct >= 50 ? "yes" : "no";
                    const pct = direction === "yes" ? pos.yes_pct : pos.no_pct;
                    const args = direction === "yes" ? pos.top_yes_args : pos.top_no_args;
                    return (
                      <div key={pos.subtopic_id}
                        className="rounded-xl border border-white/6 bg-white/[0.02] px-5 py-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium">{pos.subtopic_name}</span>
                          <span className="text-[9px] uppercase tracking-widest font-bold"
                            style={{ color: direction === "yes" ? "#00DCFF" : "#FF5A6A" }}>
                            {pct}% {direction}
                          </span>
                        </div>
                        {args.length > 0 && (
                          <p className="text-xs text-secondary/40 leading-relaxed">
                            {args[0]}
                          </p>
                        )}
                        <p className="text-[9px] text-secondary/20 mt-1.5">
                          {pos.responses} response{pos.responses !== 1 ? "s" : ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="mt-10 text-center">
              <button
                onClick={generate}
                disabled={generating}
                className="px-10 py-4 rounded-full text-sm font-bold uppercase tracking-[0.25em] border-2 border-amber text-amber hover:bg-amber/10 active:scale-95 transition-all disabled:opacity-40"
              >
                Generate manifesto
              </button>
            </div>
          </motion.div>
        )}

        {/* Generating indicator */}
        <AnimatePresence>
          {generating && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-24"
            >
              <p className="font-mono text-[10px] tracking-[0.5em] text-amber/40 uppercase animate-pulse">
                Drafting manifesto...
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The manifesto */}
        <AnimatePresence>
          {manifesto && !generating && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              {/* Header */}
              <div className="mb-12 text-center">
                <p className="text-[9px] uppercase tracking-[0.4em] font-bold text-amber/50 mb-3">
                  Nexo · Collective Manifesto
                </p>
                <div className="h-px bg-gradient-to-r from-transparent via-amber/30 to-transparent" />
              </div>

              {/* Body — render each paragraph */}
              <div className="space-y-5">
                {manifesto.split("\n").map((line, i) => {
                  if (!line.trim()) return <div key={i} className="h-2" />;

                  // Section headings (lines starting with # or ALL CAPS short lines)
                  const isHeading = line.startsWith("#") ||
                    (line.length < 60 && line === line.toUpperCase() && line.trim().length > 3);

                  if (isHeading) {
                    const text = line.replace(/^#+\s*/, "").trim();
                    return (
                      <h2 key={i}
                        className="font-display text-[10px] uppercase tracking-[0.35em] font-bold text-amber/70 pt-4 pb-1">
                        {text}
                      </h2>
                    );
                  }

                  // Bold closing line
                  const isBold = line.startsWith("**") && line.endsWith("**");
                  if (isBold) {
                    return (
                      <p key={i} className="text-secondary font-display font-bold text-lg leading-snug pt-4 border-t border-white/8">
                        {line.replace(/\*\*/g, "")}
                      </p>
                    );
                  }

                  // Normal paragraph
                  return (
                    <p key={i} className="text-secondary/75 text-sm leading-[1.8]">
                      {line}
                    </p>
                  );
                })}
              </div>

              {/* Regenerate button */}
              <div className="mt-14 pt-8 border-t border-white/8 flex items-center justify-between">
                <p className="text-[9px] uppercase tracking-widest text-secondary/20">
                  Generated from collective deliberation
                </p>
                <button
                  onClick={generate}
                  disabled={generating}
                  className="text-[9px] uppercase tracking-[0.2em] font-bold text-secondary/30 hover:text-amber transition-colors"
                >
                  Regenerate
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
