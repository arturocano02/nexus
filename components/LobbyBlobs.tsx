"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { TaxonomyCategory } from "@/lib/types";

interface LobbyBlobsProps {
  categories: TaxonomyCategory[];
  onSelect: (cat: TaxonomyCategory) => void;
}

// Each blob gets a fixed colour, size, and gentle float offset so they look
// organic and 3-dimensional using only CSS gradients + box-shadow.
const BLOB_DEFS = [
  { color: "#00DCFF", size: 130, delay: 0.0,  floatY: 10 },
  { color: "#FFBF00", size: 150, delay: 0.15, floatY: -8 },
  { color: "#A78BFA", size: 120, delay: 0.3,  floatY: 12 },
  { color: "#34D399", size: 140, delay: 0.08, floatY: -10 },
  { color: "#F97316", size: 135, delay: 0.22, floatY: 8  },
  { color: "#60A5FA", size: 128, delay: 0.38, floatY: -12 },
  { color: "#FB923C", size: 145, delay: 0.12, floatY: 14 },
  { color: "#A3E635", size: 125, delay: 0.28, floatY: -9 },
];

export default function LobbyBlobs({ categories, onSelect }: LobbyBlobsProps) {
  const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order);

  // Layout: two rows of 4 in a centered grid
  const rows = [sorted.slice(0, 4), sorted.slice(4, 8)];

  return (
    <div className="w-full h-full flex flex-col items-center justify-center select-none overflow-hidden">
      {/* Heading */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center mb-10 px-4"
      >
        <p className="text-[10px] uppercase tracking-[0.4em] text-amber/60 font-bold mb-1">
          Your political map
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-secondary">
          What do you want to<br />talk about today?
        </h1>
        <p className="mt-2 text-sm text-secondary/35">
          Pick a topic. The AI will open the conversation.
        </p>
      </motion.div>

      {/* Blob rows */}
      <div className="flex flex-col gap-6 items-center">
        {rows.map((row, ri) => (
          <div key={ri} className="flex gap-6 items-center">
            {row.map((cat, ci) => {
              const idx = ri * 4 + ci;
              const def = BLOB_DEFS[idx % BLOB_DEFS.length];
              return (
                <Blob
                  key={cat.id}
                  category={cat}
                  color={def.color}
                  size={def.size}
                  delay={def.delay}
                  floatY={def.floatY}
                  onSelect={onSelect}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Individual blob — CSS radial gradient + box-shadow gives the 3D sphere look
// -----------------------------------------------------------------------
function Blob({
  category,
  color,
  size,
  delay,
  floatY,
  onSelect,
}: {
  category: TaxonomyCategory;
  color: string;
  size: number;
  delay: number;
  floatY: number;
  onSelect: (c: TaxonomyCategory) => void;
}) {
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, type: "spring", stiffness: 180, damping: 16 }}
      whileHover={{ scale: 1.12 }}
      whileTap={{ scale: 0.94 }}
      onClick={() => onSelect(category)}
      className="relative flex items-center justify-center cursor-pointer"
      style={{ width: size, height: size }}
    >
      {/* Floating animation wrapper */}
      <motion.div
        className="absolute inset-0 rounded-full"
        animate={{ y: [0, floatY, 0] }}
        transition={{
          duration: 3.5 + delay * 2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        {/* Outer glow */}
        <div
          className="absolute inset-0 rounded-full blur-xl opacity-40"
          style={{ background: color }}
        />
        {/* Main sphere — radial gradient fakes a 3D light source */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `
              radial-gradient(
                circle at 35% 30%,
                ${color}ff 0%,
                ${color}cc 30%,
                ${color}66 60%,
                ${color}22 85%,
                transparent 100%
              )
            `,
            boxShadow: `
              0 0 ${size * 0.4}px ${color}60,
              inset 0 2px ${size * 0.15}px rgba(255,255,255,0.25),
              inset 0 -4px ${size * 0.2}px ${color}40
            `,
          }}
        />
        {/* Specular highlight — small bright spot upper-left */}
        <div
          className="absolute rounded-full"
          style={{
            width: size * 0.22,
            height: size * 0.14,
            top: "18%",
            left: "22%",
            background: "radial-gradient(ellipse, rgba(255,255,255,0.7) 0%, transparent 100%)",
            filter: "blur(2px)",
          }}
        />
      </motion.div>

      {/* Label */}
      <span
        className="relative z-10 text-[11px] font-bold tracking-[0.1em] uppercase text-center leading-tight px-2 drop-shadow-md"
        style={{ color: "#000033", textShadow: `0 1px 4px rgba(255,255,255,0.4)` }}
      >
        {category.name}
      </span>
    </motion.button>
  );
}
