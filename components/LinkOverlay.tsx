"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Link } from "@/lib/types";
import { colorForRelationship } from "@/lib/relationship";

export default function LinkOverlay({
  link,
  onClose,
}: {
  link: Link | null;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Tight summary view first, full detail only when asked. Keeps the overlay
  // readable on a phone without scrolling or awkward line wraps.
  const color = link?.arc_color || colorForRelationship(link?.relationship_label);
  const summary = (link?.link_summary || "").replace(/^"|"$/g, "");
  const sim = link ? Math.round((link.similarity_score ?? 0) * 100) : 0;
  const rel = (link?.relationship_label || "related").toUpperCase();

  return (
    <AnimatePresence>
      {link && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[250] bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 28 }}
            className="fixed inset-x-0 bottom-0 md:top-1/2 md:bottom-auto md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 z-[260] p-4 pointer-events-none"
          >
            <div
              className="glass mx-auto w-full max-w-md rounded-[1.75rem] p-5 md:p-6 shadow-2xl pointer-events-auto relative overflow-hidden"
              style={{ borderColor: `${color}44`, borderWidth: 1, borderStyle: "solid" }}
            >
              <div
                className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-20"
                style={{ background: color, filter: "blur(60px)" }}
              />

              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <p
                    className="text-[9px] font-display font-extrabold tracking-[0.28em] uppercase"
                    style={{ color }}
                  >
                    {rel}
                  </p>
                  <p className="text-[10px] font-mono text-secondary/40 mt-1">
                    Similarity {sim}%
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                  aria-label="Close"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              <p
                className="relative mt-4 text-base md:text-lg leading-relaxed italic"
                style={{ color: `${color}e6` }}
              >
                {summary || "Analysing the link between these viewpoints."}
              </p>

              <div className="relative mt-4">
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="text-[10px] font-bold tracking-[0.22em] uppercase text-secondary/50 hover:text-secondary transition-colors"
                >
                  {expanded ? "- Hide details" : "+ More details"}
                </button>
                <AnimatePresence>
                  {expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                        <DetailRow label="Relationship" value={rel.toLowerCase()} />
                        <DetailRow label="Similarity" value={`${sim}%`} />
                        {link.is_user_confirmed && (
                          <DetailRow label="Origin" value="You confirmed this link" />
                        )}
                        {link.last_seen_at && (
                          <DetailRow
                            label="Last reinforced"
                            value={new Date(link.last_seen_at).toLocaleString()}
                          />
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-[11px]">
      <span className="text-secondary/40 uppercase tracking-[0.2em] font-bold">{label}</span>
      <span className="text-secondary/80">{value}</span>
    </div>
  );
}
