"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { PublicNode } from "@/lib/types";

function ArcGauge({ pct }: { pct: number }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <svg viewBox="0 0 100 100" className="w-24 h-24">
      <circle cx="50" cy="50" r={r} stroke="rgba(255,255,255,0.08)" strokeWidth="8" fill="none" />
      <motion.circle
        cx="50"
        cy="50"
        r={r}
        stroke="#FFBF00"
        strokeWidth="8"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        transform="rotate(-90 50 50)"
        initial={{ strokeDasharray: `0 ${c}` }}
        animate={{ strokeDasharray: `${dash} ${c - dash}` }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
      <text x="50" y="56" textAnchor="middle" className="fill-secondary font-display text-lg">
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

function TopPointRow({
  point,
  supporting,
}: {
  point: string;
  supporting: { text: string; ts: string; display_name?: string; is_anonymous?: boolean; agent_id: string }[];
}) {
  const [open, setOpen] = useState(false);
  const hasSupport = supporting.length > 0;
  // Tap the row to expand supporting debate lines. Collapsed by default
  // so the list reads scannably on mobile.
  return (
    <li className="card px-3 py-2">
      <button
        type="button"
        onClick={() => hasSupport && setOpen((v) => !v)}
        className={`w-full flex items-start justify-between gap-3 text-left ${hasSupport ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className="flex-1">{point}</span>
        {hasSupport && (
          <span className="text-[10px] uppercase tracking-widest text-secondary/40 shrink-0 mt-0.5">
            {open ? "Hide" : `${supporting.length}`}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && hasSupport && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-2 space-y-1.5 overflow-hidden"
          >
            {supporting.map((s, i) => (
              <li
                key={i}
                className="text-[12px] text-secondary/80 bg-black/30 rounded-md px-2.5 py-1.5 border border-white/5"
              >
                <div className="text-[9px] uppercase tracking-widest text-secondary/40 mb-0.5">
                  {s.is_anonymous ? `Voice-${s.agent_id.slice(0, 4)}` : s.display_name ?? "Public"}
                </div>
                {s.text}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
}

function findSupporting(
  point: string,
  debateLog: { text: string; ts: string; display_name?: string; is_anonymous?: boolean; agent_id: string }[] | null | undefined,
) {
  if (!debateLog || debateLog.length === 0) return [];
  // Cheap keyword overlap: we don't want another LLM call for UI. Pull
  // distinctive words from the point and match debate lines containing at
  // least one. Good enough to connect a point to the lines that seeded it.
  const keywords = point
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 4);
  if (keywords.length === 0) return [];
  return debateLog
    .filter((d) => {
      const t = (d.text ?? "").toLowerCase();
      return keywords.some((k) => t.includes(k));
    })
    .slice(0, 5);
}

function Bar({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs uppercase tracking-widest text-secondary/60 mb-1">
        <span>{label}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <div className="h-1.5 rounded-pill bg-navy-700 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value * 100}%` }}
          transition={{ duration: 0.6 }}
          className="h-full"
          style={{ background: color }}
        />
      </div>
    </div>
  );
}

export default function ArenaNodeOverlay({
  node,
  currentUserId,
  onClose,
}: {
  node: PublicNode | null;
  currentUserId?: string;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {node && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-30 bg-black/40"
          />
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 28 }}
            className="fixed inset-x-0 bottom-0 z-40 px-4 pb-24"
          >
            <div className="glass mx-auto max-w-2xl rounded-3xl p-6 shadow-card relative">
              {/* Explicit X close because the dim backdrop alone wasn't reading
                  as dismissable (especially on mobile). */}
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute top-4 right-4 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-secondary/80 hover:bg-white/15 hover:text-white transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              <div className="flex items-start justify-between gap-4 pr-12">
                <div>
                  <p className="text-xs uppercase tracking-widest text-cyan/80">Topic</p>
                  <h3 className="font-display text-2xl font-semibold mt-1">{node.topic_label}</h3>
                  <p className="text-xs mt-1">
                    <span className={`px-2 py-0.5 rounded-pill ${node.is_resolved ? "bg-amber/15 text-amber" : "bg-cyan/15 text-cyan"}`}>
                      {node.is_resolved ? "Resolved" : "Unresolved"}
                    </span>
                  </p>
                </div>
                <ArcGauge pct={Number(node.agreement_pct)} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4">
                <Bar value={Number(node.tension_coefficient)} label="Tension" color="#FFBF00" />
                <Bar value={Number(node.noise_saturation)} label="Noise" color="#00DCFF" />
              </div>

              <div className="mt-5">
                <p className="text-xs uppercase tracking-widest text-secondary/60 mb-2">Top points</p>
                <ul className="space-y-1 text-sm">
                  {node.top_points.length === 0 && <li className="text-secondary/50">No top points yet.</li>}
                  {node.top_points.map((p, i) => (
                    <TopPointRow
                      key={i}
                      point={p}
                      // Pull debate lines that reference this point's keywords
                      // so a tap reveals who said what in support/against.
                      supporting={findSupporting(p, node.debate_log)}
                    />
                  ))}
                </ul>
              </div>

              <div className="mt-5">
                <p className="text-xs uppercase tracking-widest text-secondary/60 mb-2">Debate log</p>
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {node.debate_log.length === 0 && <p className="text-sm text-secondary/50">Quiet for now.</p>}
                  {node.debate_log.map((d, i) => {
                    const own = currentUserId && d.agent_id === currentUserId;
                    return (
                      <div key={i} className={`card p-3 text-sm ${own ? "ring-1 ring-amber/50" : ""}`}>
                        <div className="flex items-center justify-between text-[10px] uppercase tracking-widest mb-1">
                          <span className={own ? "text-amber" : "text-secondary/60"}>
                            {own ? "You" : d.is_anonymous ? `Voice-${d.agent_id.slice(0, 4)}` : (d.display_name ?? "Public")}
                          </span>
                          <span className="text-secondary/40">{new Date(d.ts).toLocaleString()}</span>
                        </div>
                        <p className={own ? "text-amber/95" : "text-secondary/85"}>{d.text}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
