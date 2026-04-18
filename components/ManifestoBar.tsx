"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function ManifestoBar() {
  const [open, setOpen] = useState(false);

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
              <div className="w-full max-w-6xl h-full max-h-[85vh] glass rounded-[2.5rem] p-8 md:p-12 shadow-card flex flex-col pointer-events-auto relative overflow-hidden text-secondary">
                <div className="flex justify-between items-start mb-12">
                  <div>
                    <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight">The Nexus Manifesto</h2>
                    <p className="text-secondary/50 mt-2 font-medium tracking-wide">Live consensus on the future of sovereignty and automation.</p>
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

                <div className="flex-1 overflow-y-auto pr-4 scrollbar-hide">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                    <ManifestoColumn title="Topic" />
                    <ManifestoColumn title="Consensus Summary" />
                    <ManifestoColumn title="Status & Score" />
                  </div>

                  <div className="mt-8 space-y-px">
                    <ManifestoRow
                      topic="AI Governance"
                      summary="82% agreement that algorithmic bias audits must be public-domain. Conflict remains on centralized vs decentralized enforcement."
                      score="82%"
                      status="High Synergy"
                    />
                    <ManifestoRow
                      topic="Universal Income"
                      summary="Extreme polarization. 40% view it as economic survival; 60% as social dependency. No consensus detected on funding sources."
                      score="40%"
                      status="In Conflict"
                    />
                    <ManifestoRow
                      topic="Digital Citizenship"
                      summary="Emerging consensus that physical geography is obsolete for digital rights. 72% support cloud-sovereignty concepts."
                      score="72%"
                      status="Building"
                    />
                  </div>
                </div>

                <div className="mt-8 pt-8 border-t border-white/5 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] font-bold text-secondary/30">
                  <div className="flex gap-8">
                    <span>Active Agents: 1,284</span>
                    <span>Total Debates: 4,092</span>
                  </div>
                  <span>Last Update: Just Now</span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function ManifestoColumn({ title }: { title: string }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-secondary/30 pb-4 border-b border-white/5">
      {title}
    </div>
  );
}

function ManifestoRow({ topic, summary, score, status }: { topic: string; summary: string; score: string; status: string }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-12 py-8 border-b border-white/5 group hover:bg-white/[0.02] transition-all -mx-4 px-4 rounded-xl">
      <div className="font-display text-xl font-bold text-amber">{topic}</div>
      <div className="text-secondary/70 leading-relaxed text-sm font-medium">{summary}</div>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-end">
          <span className="text-[10px] uppercase font-bold tracking-widest text-secondary/40">{status}</span>
          <span className="text-lg font-bold">{score}</span>
        </div>
        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full bg-amber shadow-[0_0_10px_rgba(255,191,0,0.5)]" style={{ width: score }} />
        </div>
      </div>
    </div>
  );
}
