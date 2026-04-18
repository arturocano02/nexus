"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import type { PersonalArgument } from "@/lib/types";

export default function NodeOverlay({
  node,
  onClose,
}: {
  node: PersonalArgument | null;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AnimatePresence>
      {node && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[190] bg-black/40"
          />
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 28 }}
            className="fixed left-0 right-0 bottom-0 z-[200] px-4 pb-24"
          >
            <div className="glass mx-auto max-w-xl rounded-3xl p-6 shadow-card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-widest text-amber/80">Topic</p>
                  <h3 className="font-display text-2xl font-semibold text-secondary mt-1">{node.topic_label}</h3>
                </div>
                <button onClick={onClose} className="btn-ghost">Close</button>
              </div>

              <p className="mt-4 text-secondary/85 leading-relaxed">{node.summary}</p>

              <div className="mt-5">
                <p className="text-xs uppercase tracking-widest text-secondary/60 mb-2">Confidence</p>
                <div className="h-2 rounded-pill bg-navy-700 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.round(node.confidence_score * 100)}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className="h-full bg-amber shadow-amber"
                  />
                </div>
                <p className="text-xs text-secondary/60 mt-1">{Math.round(node.confidence_score * 100)}%</p>
              </div>

              <button
                onClick={() => setOpen((v) => !v)}
                className="mt-5 text-sm text-amber/90 hover:text-amber flex items-center gap-2"
              >
                <span>{open ? "Hide excerpts" : `Show ${node.raw_excerpts.length} source excerpts`}</span>
                <motion.span animate={{ rotate: open ? 180 : 0 }}>▾</motion.span>
              </button>
              <AnimatePresence>
                {open && (
                  <motion.ul
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mt-3 space-y-2 overflow-hidden"
                  >
                    {node.raw_excerpts.map((e, i) => (
                      <li key={i} className="text-sm text-secondary/80 card p-3">
                        <p>{e.text}</p>
                        <p className="text-[10px] uppercase tracking-wider text-secondary/40 mt-1">
                          {new Date(e.ts).toLocaleString()}
                        </p>
                      </li>
                    ))}
                    {node.raw_excerpts.length === 0 && (
                      <li className="text-sm text-secondary/50">No excerpts captured yet.</li>
                    )}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
