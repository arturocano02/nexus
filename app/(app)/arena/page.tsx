"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";
import ManifestoBar from "@/components/ManifestoBar";
import ArenaNodeOverlay from "@/components/ArenaNodeOverlay";
import LinkOverlay from "@/components/LinkOverlay";
import HelpButton from "@/components/HelpButton";
import type { PublicNode, Link as NodeLink } from "@/lib/types";

const NodeMap = dynamic(() => import("@/components/NodeMap"), { ssr: false });

export default function ArenaPage() {
  const { user } = useUser();
  const [nodes, setNodes] = useState<PublicNode[]>([]);
  const [links, setLinks] = useState<NodeLink[]>([]);
  const [selected, setSelected] = useState<PublicNode | null>(null);
  const [selectedLink, setSelectedLink] = useState<NodeLink | null>(null);
  const [totalAgents, setTotalAgents] = useState(0);
  const [debatingAgents, setDebatingAgents] = useState(0);
  const [ownNodeIds, setOwnNodeIds] = useState<Set<string>>(new Set());
  // Arena used to have a multi-step arrival (merging -> landing -> settled)
  // with blur+scale keyframes which felt like a second animation tacked on
  // after the Your View vortex. We now run a single short fade-in so the
  // handoff reads as one continuous motion from the vortex's whiteout.
  const [arrivalStage, setArrivalStage] = useState<"arriving" | "settled">("arriving");

  useEffect(() => {
    const supa = supabaseBrowser();
    let cancelled = false;

    (async () => {
      const { data: nd } = await supa.from("public_nodes").select("*").limit(500);
      if (!cancelled && nd) setNodes(nd as PublicNode[]);

      const { data: lks } = await supa.from("links").select("*");
      if (!cancelled && lks) setLinks(lks as NodeLink[]);

      await refreshCounters();
      if (user) {
        const { data: mine } = await supa.from("agents").select("public_node_id").eq("user_id", user.id);
        if (!cancelled && mine) setOwnNodeIds(new Set(mine.map((m: any) => m.public_node_id)));
      }
    })();

    // Single short fade-in so the arena appears as the vortex dissolves,
    // not as its own separate entrance. HUD unlocks right after.
    setTimeout(() => setArrivalStage("settled"), 600);

    // Kick the arc/merge sweep immediately on arrival, then every 45s.
    // Keyword-based so it always produces arcs even when the LLM discovery
    // path above silently fails (rate-limit, bad JSON, missing key). The
    // realtime subscription below picks up the new links without a refetch.
    const triggerSweep = () => {
      fetch("/api/arena/sweep", { method: "POST", cache: "no-store" }).catch(() => {});
    };
    triggerSweep();
    const sweepTimer = setInterval(triggerSweep, 45_000);

    async function refreshCounters() {
      const { count: all } = await supa.from("agents").select("*", { count: "exact", head: true }).eq("is_active", true);
      const { data: active } = await supa.from("public_nodes").select("id").eq("is_debating", true);
      if (!cancelled) {
        setTotalAgents(all ?? 0);
        setDebatingAgents(active?.length ?? 0);
      }
    }

    const ch = supa
      .channel("arena")
      .on("postgres_changes", { event: "*", schema: "public", table: "public_nodes" }, (payload) => {
        setNodes((prev) => {
          if (payload.eventType === "INSERT") return [...prev, payload.new as PublicNode];
          if (payload.eventType === "UPDATE") return prev.map((n) => (n.id === (payload.new as any).id ? (payload.new as PublicNode) : n));
          return prev;
        });
        refreshCounters();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "links" }, async () => {
        // Cheapest option: refetch. Link volume here is bounded and the cost is
        // ~1 round-trip every time arcs change. Works fine up to a few hundred.
        const { data: lks } = await supa.from("links").select("*");
        if (lks) setLinks(lks as NodeLink[]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "manifesto" }, () => {
        // ManifestoBar reads manifesto on its own, but this forces a re-render
        // of any counters tied to shared state when manifesto changes.
      })
      .subscribe();

    return () => {
      cancelled = true;
      supa.removeChannel(ch);
      clearInterval(sweepTimer);
    };
  }, [user]);

  const mapData = useMemo(() => nodes.map((n) => {
    const agreement = Math.max(0, Math.min(1, Number(n.agreement_pct) / 100));
    // Explicit tension_coefficient wins when supplied, otherwise fall back
    // to "anything under strong consensus is at least a bit contested".
    const rawTension = Number(n.tension_coefficient);
    const tension = Number.isFinite(rawTension)
      ? Math.max(0, Math.min(1, rawTension))
      : Math.max(0, 1 - agreement);
    return {
      id: n.id,
      label: n.topic_label,
      weight: Math.max(1, (n.debate_log?.length ?? 0) + n.top_points.length),
      // Arena color spectrum: amber when consensus is high, cyan when low.
      conviction: agreement,
      // High-disagreement blobs jitter and distort harder.
      tension,
      pulsing: n.is_debating,
      isOwn: ownNodeIds.has(n.id),
    };
  }), [nodes, ownNodeIds]);

  return (
    <main className="relative h-dvh w-dvw overflow-hidden bg-[#080a18]">
      <motion.div
        initial={{ opacity: 0, scale: 1.05, filter: "blur(8px)" }}
        animate={{
          opacity: 1,
          scale: 1,
          filter: "blur(0px)",
        }}
        transition={{ duration: 0.9, ease: "easeOut" }}
        className="absolute inset-0"
      >
        <NodeMap
          nodes={mapData}
          links={links}
          onSelect={(id) => setSelected(nodes.find((n) => n.id === id) ?? null)}
          onSelectLink={setSelectedLink}
          highlightIds={ownNodeIds}
          isArena={true}
        />
      </motion.div>

      <AnimatePresence>
        {arrivalStage === "settled" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 pointer-events-none">
            {/* HUD Content */}
            <div className="absolute top-6 left-6 z-20 font-display text-[10px] tracking-widest text-[#00DCFF] flex flex-col gap-1 pointer-events-auto">
              <div className="glass px-4 py-2 border border-white/5 uppercase">
                Global_Arena | Population: {totalAgents} | Active: {debatingAgents}
              </div>
            </div>

            <div className="pointer-events-auto">
              <ManifestoBar />
            </div>

            <div className="absolute bottom-24 left-0 right-0 z-20 flex justify-center pointer-events-auto">
              <Link href="/your-view" className="glass px-10 py-4 rounded-full text-[10px] font-bold uppercase tracking-[0.25em] text-amber border-2 border-amber/40 hover:bg-amber hover:text-black transition-all shadow-[0_0_20px_rgba(255,191,0,0.2)]">
                Inject Perspective
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ArenaNodeOverlay node={selected} currentUserId={user?.id} onClose={() => setSelected(null)} />
      <LinkOverlay link={selectedLink} onClose={() => setSelectedLink(null)} />

      {/* Legend: only shows once the arena has landed so it doesn't clash
          with the entry animation. */}
      {arrivalStage === "settled" && <HelpButton corner="bottom-right" />}
    </main>
  );
}
