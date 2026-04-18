"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/*
  Tiny floating "?" button that explains what the colors, sizes, and arcs
  on the map mean. Used on every screen with a NodeMap so a first-time user
  can decode the visual language without being taught elsewhere.
  Mobile: opens a bottom sheet. Desktop: opens a popover anchored near the button.
*/
export default function HelpButton({
  corner = "bottom-right",
}: {
  corner?: "bottom-right" | "top-right" | "bottom-left" | "top-left";
}) {
  const [open, setOpen] = useState(false);

  const pos =
    corner === "bottom-right"
      ? "bottom-4 right-4"
      : corner === "top-right"
      ? "top-4 right-4"
      : corner === "bottom-left"
      ? "bottom-4 left-4"
      : "top-4 left-4";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Help: what do the colors and sizes mean?"
        className={`fixed ${pos} z-[120] w-10 h-10 rounded-full glass border border-white/10 text-secondary/70 hover:text-white hover:bg-white/10 transition-all shadow-xl flex items-center justify-center font-display text-base font-bold pointer-events-auto`}
      >
        ?
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 240, damping: 28 }}
              className="fixed inset-x-0 bottom-0 md:top-1/2 md:bottom-auto md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 z-[310] p-4 pointer-events-none flex items-end md:items-center justify-center max-h-[100dvh]"
            >
              {/* Cap at 85dvh so the sheet never runs past the viewport on
                  short phones. Inner div scrolls on its own. Sticky header
                  keeps the close button reachable while scrolling. */}
              <div className="glass mx-auto w-full max-w-md rounded-[1.75rem] shadow-2xl pointer-events-auto relative border border-white/10 max-h-[85dvh] flex flex-col overflow-hidden">
                <div className="flex items-start justify-between gap-4 p-5 md:p-6 pb-3 shrink-0 border-b border-white/5 bg-black/20 backdrop-blur-sm">
                  <div>
                    <p className="text-[9px] font-display font-extrabold tracking-[0.28em] uppercase text-amber">
                      Map Legend
                    </p>
                    <p className="text-[10px] font-mono text-secondary/40 mt-1">
                      What the blobs and arcs mean
                    </p>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors shrink-0"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>

                {/* Scrollable body so content never gets clipped off-screen.
                    overscroll-contain so scrolling the legend doesn't bubble
                    up and scroll the map behind it. */}
                <div className="flex-1 overflow-y-auto overscroll-contain p-5 md:p-6 pt-4">
                  <Section title="Blob color: conviction">
                    <LegendRow swatch="#FFBF00" label="Amber" desc="High consensus. Lots of people agree." />
                    <LegendRow swatch="#00DCFF" label="Cyan" desc="Active disagreement. Still contested." />
                    <LegendRow swatch="#888780" label="Gray" desc="Quiet. Barely discussed yet." />
                  </Section>

                  <Section title="Blob size: volume">
                    <p className="text-[12px] text-secondary/70 leading-relaxed">
                      Bigger blob means more conversation on that topic. Size grows with every message that touches it.
                    </p>
                  </Section>

                  <Section title="Blob glow">
                    <p className="text-[12px] text-secondary/70 leading-relaxed">
                      Brighter halo means higher confidence. Dim blobs are tentative, bright blobs are certain.
                    </p>
                  </Section>

                  <Section title="Blob motion">
                    <p className="text-[12px] text-secondary/70 leading-relaxed">
                      High-disagreement blobs jitter and wobble harder. Calm blobs sit still.
                    </p>
                  </Section>

                  <Section title="Arcs between blobs">
                    <LegendRow swatch="#FFBF00" label="Amber" desc="Builds on or deepens the other topic." />
                    <LegendRow swatch="#00DCFF" label="Cyan" desc="Contradicts or challenges it." />
                    <LegendRow swatch="#B892FF" label="Violet" desc="Clarifies or reframes." />
                    <LegendRow swatch="#888780" label="Gray" desc="Tangent. Related but not opposed." />
                    <p className="text-[11px] text-secondary/50 leading-relaxed mt-2">
                      Thicker arcs mean stronger similarity. Tap any arc for details.
                    </p>
                  </Section>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="text-[10px] uppercase tracking-[0.22em] text-secondary/50 font-bold mb-2">
        {title}
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function LegendRow({ swatch, label, desc }: { swatch: string; label: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 text-[12px]">
      <span
        className="mt-1 w-3 h-3 rounded-full shrink-0"
        style={{ backgroundColor: swatch, boxShadow: `0 0 8px ${swatch}` }}
      />
      <div className="flex-1 leading-snug">
        <span className="text-secondary font-semibold">{label}.</span>{" "}
        <span className="text-secondary/70">{desc}</span>
      </div>
    </div>
  );
}
