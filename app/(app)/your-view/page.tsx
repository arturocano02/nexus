"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";
import { useSpeech } from "@/lib/useSpeech";
import NodeOverlay from "@/components/NodeOverlay";
import SubmitReview from "@/components/SubmitReview";
import LinkOverlay from "@/components/LinkOverlay";
import HelpButton from "@/components/HelpButton";
import ClausePromptCard, { ClausePromptData } from "@/components/ClausePrompt";
import type { PersonalArgument, ChatMessage, Link as NodeLink } from "@/lib/types";

const NodeMap = dynamic(() => import("@/components/NodeMap"), { ssr: false });

export default function YourViewPage() {
  const router = useRouter();
  const { user, ready } = useUser();
  const [nodes, setNodes] = useState<PersonalArgument[]>([]);
  const [links, setLinks] = useState<NodeLink[]>([]);
  const [selected, setSelected] = useState<PersonalArgument | null>(null);
  const [selectedLink, setSelectedLink] = useState<NodeLink | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showHud, setShowHud] = useState(true);
  const [transitionPhase, setTransitionPhase] = useState<"idle" | "vortex" | "merge" | "done">("idle");
  // Draft clause stances inferred from chat. Queued so we can surface them
  // one card at a time under the latest assistant bubble. Confirmed cards
  // drop out of the queue but stay in draft_stances until Submit promotes
  // them into user_stances (see /api/stances/submit).
  const [clausePrompts, setClausePrompts] = useState<ClausePromptData[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  // Stick-to-bottom lock. When the user has scrolled up to read history we
  // stop force-scrolling them back down. Resets the moment they return to the
  // bottom or send a new message.
  const stickBottom = useRef(true);
  const speech = useSpeech();

  // Live link engine batching. We queue up each user turn with the topic ids
  // the server just updated, then flush the batch every 3 turns or every 5s
  // so embeddings + labelling happen in one call, not per message. That is
  // what keeps token cost flat during a fast conversation.
  const linkQueue = useRef<{ text: string; topic_id?: string }[]>([]);
  const linkFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushLinks = useCallback(async () => {
    if (linkFlushTimer.current) {
      clearTimeout(linkFlushTimer.current);
      linkFlushTimer.current = null;
    }
    const batch = linkQueue.current;
    if (batch.length === 0) return;
    linkQueue.current = [];
    try {
      await fetch("/api/links/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statements: batch }),
      });
    } catch (err) {
      // Re-queue on failure so we don't lose the statements.
      linkQueue.current = [...batch, ...linkQueue.current];
      console.warn("link batch failed, re-queued", err);
    }
  }, []);
  const scheduleLinkFlush = useCallback(() => {
    if (linkFlushTimer.current) return;
    linkFlushTimer.current = setTimeout(() => {
      flushLinks();
    }, 5000);
  }, [flushLinks]);
  useEffect(() => {
    // The "Brain Scan" Heartbeat: Every 15 seconds, ping the link engine
    // even if the user hasn't typed anything. The server intercepts empty
    // batches and performs a background scan of old, unlinked topics to wire
    // them up, ensuring the graph feels completely alive and self-organizing.
    const brainPing = setInterval(() => {
      fetch("/api/links/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statements: [] }),
      }).catch(() => { });
    }, 15000);

    return () => {
      if (linkFlushTimer.current) clearTimeout(linkFlushTimer.current);
      clearInterval(brainPing);
    };
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input, speech.interim]);

  // Pulls current draft stances for the clauses Nexus just inferred on and
  // stages them as cards. Deduped against whatever is already in the
  // queue so the same clause never shows up twice in a row.
  const enqueueClausePrompts = useCallback(async (clauseIds: string[]) => {
    if (clauseIds.length === 0) return;
    try {
      const res = await fetch("/api/stances", { cache: "no-store" });
      const body = await res.json();
      const drafts: any[] = Array.isArray(body?.drafts) ? body.drafts : [];
      const pending: ClausePromptData[] = drafts
        .filter((d) => clauseIds.includes(d.clause_id) && d.clause)
        .map((d) => ({
          clause_id: d.clause_id,
          statement: d.clause.statement,
          section: d.clause.section,
          inferred_stance: d.stance,
          reasoning: d.reasoning,
        }));
      setClausePrompts((prev) => {
        const existing = new Set(prev.map((p) => p.clause_id));
        const next = pending.filter((p) => !existing.has(p.clause_id));
        return [...prev, ...next];
      });
    } catch (err) {
      console.warn("enqueueClausePrompts failed", err);
    }
  }, []);

  const fetchNodes = useCallback(async () => {
    if (!user) return;
    const supa = supabaseBrowser();
    const { data } = await supa.from("personal_arguments").select("*").eq("user_id", user.id).order("updated_at", { ascending: true });
    if (data) setNodes(data as PersonalArgument[]);
    const { data: lks } = await supa.from("links").select("*");
    if (lks) setLinks(lks as NodeLink[]);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchNodes();
    const supa = supabaseBrowser();
    // Subscribe to both personal_arguments (so blobs grow as the user talks)
    // and links (so newly discovered semantic arcs draw instantly).
    const ch = supa
      .channel(`pa:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "personal_arguments", filter: `user_id=eq.${user.id}` },
        () => fetchNodes(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "links" }, () => fetchNodes())
      .subscribe();
    return () => { supa.removeChannel(ch); };
  }, [user, fetchNodes]);

  useEffect(() => {
    if (speech.finalText) {
      setInput((prev) => (prev ? prev + " " : "") + speech.finalText);
      speech.setFinalText("");
    }
  }, [speech.finalText, speech]);

  // Auto-scroll the chat panel to the bottom on new content, but only when
  // the user is already at the bottom. If they've scrolled up to reread
  // something, we respect that and leave them there until they scroll back.
  useEffect(() => {
    if (!stickBottom.current) return;
    const el = chatScrollRef.current;
    if (!el) return;
    // rAF so we scroll after React has committed the new message DOM.
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages, streamText]);

  const displayValue = speech.listening && speech.interim ? (input ? input + " " : "") + speech.interim : input;

  const mapData = useMemo(() => nodes.map((n) => ({
    id: n.id,
    label: n.topic_label,
    weight: Math.max(1, n.raw_excerpts.length),
    conviction: n.confidence_score,
  })), [nodes]);

  async function sendMessage() {
    const text = (input + (speech.interim ? " " + speech.interim : "")).trim();
    if (!text || streaming) return;
    if (speech.listening) speech.stop();
    // The user sending a message means "show me the latest", so re-arm the
    // stick-bottom lock regardless of where they had scrolled to.
    stickBottom.current = true;
    setInput(""); setStreamText("");
    const newMsgs: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(newMsgs);
    setStreaming(true);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: newMsgs }),
    });
    if (!res.body) return setStreaming(false);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = ""; let finalMsg = ""; let finalNodeIds: string[] = [];
    let touchedClauseIds: string[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === "delta") setStreamText((prev) => prev + evt.text);
          else if (evt.type === "final") {
            finalMsg = evt.message;
            finalNodeIds = Array.isArray(evt.updated_node_ids) ? evt.updated_node_ids : [];
            touchedClauseIds = Array.isArray(evt.touched_clause_ids) ? evt.touched_clause_ids : [];
          }
        } catch { }
      }
    }
    // If the server inferred any clause stances this turn, enqueue a casual
    // confirmation card. We read the draft back (rather than guessing) so
    // the stance shown matches what got saved server-side.
    if (touchedClauseIds.length > 0) {
      enqueueClausePrompts(touchedClauseIds);
    }
    setStreamText("");
    setMessages((prev) => [...prev, { role: "assistant", content: finalMsg || "..." }]);
    setStreaming(false);
    // Explicit refetch so the blob map updates even if Realtime lags.
    fetchNodes();

    // Queue this turn for the live link engine. One entry per topic id so the
    // server can anchor each statement to the right personal_argument. If no
    // topic id came back (e.g. Nexus asked a question with no new belief), we
    // still queue the raw text so arcs can form off future neighbours.
    if (finalNodeIds.length === 0) {
      linkQueue.current.push({ text });
    } else {
      for (const id of finalNodeIds) {
        linkQueue.current.push({ text, topic_id: id });
      }
    }
    // Spec: flush every 3 user turns OR every 5 seconds, whichever first.
    if (linkQueue.current.length >= 3) {
      flushLinks();
    } else {
      scheduleLinkFlush();
    }
  }

  function handleDoSubmit() {
    if (nodes.length === 0) return;
    flushLinks().catch(() => {});
    setChatCollapsed(true);
    setSubmitting(true);
    
    // Slight pause so the user can clearly see their nodes physically merge
    // and reposition themselves on the map before the vortex blast-off sequence.
    setTimeout(() => {
      setTransitionPhase("vortex");
      setTimeout(() => {
        setTransitionPhase("merge");
        setTimeout(() => { router.push("/arena"); }, 500);
      }, 1600);
    }, 1500);
  }

  const hasNodes = nodes.length > 0;

  return (
    <main className="relative h-dvh w-dvw overflow-hidden bg-[#080a18]">
      <motion.div
        animate={{
          scale: transitionPhase === "merge" ? 1.8 : 1,
          opacity: transitionPhase === "merge" ? 0 : 1,
          filter: transitionPhase === "merge" ? "blur(40px) brightness(1.8)" : "blur(0px)"
        }}
        transition={{ duration: 1.5, ease: "easeInOut" }}
        className="absolute inset-0"
      >
        <NodeMap
          nodes={mapData}
          links={links}
          onSelect={(id) => setSelected(nodes.find((n) => n.id === id) ?? null)}
          onSelectLink={setSelectedLink}
          physicsBoost={submitting}
        />
      </motion.div>

      <AnimatePresence>
        {transitionPhase === "idle" && (
          <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 pointer-events-none">
            {/* Top HUD */}
            <div className="absolute top-6 left-6 z-20 flex items-center gap-2 pointer-events-auto">
              <button
                onClick={() => setShowHud(!showHud)}
                className="glass rounded-full px-5 py-2 border border-white/5 font-display text-[10px] tracking-widest font-bold text-secondary/50 hover:text-white transition-all shadow-lg"
              >
                {showHud ? "[ HIDE CONVO ]" : "[ SHOW CONVO ]"}
              </button>
            </div>

            <div className="absolute top-6 right-6 z-20 pointer-events-auto">
              <button
                onClick={() => hasNodes && setReviewOpen(true)}
                className={`px-8 py-3 rounded-full text-[10px] font-bold uppercase tracking-[0.2em] transition-all active:scale-95 ${hasNodes
                  ? "bg-amber text-black shadow-[0_0_30px_rgba(255,191,0,0.4)] border-2 border-amber hover:scale-105"
                  : "glass text-secondary/30 border border-white/5 cursor-not-allowed"
                  }`}
                disabled={submitting || !hasNodes}
              >
                {submitting ? "SHARING..." : "SHARE THOUGHTS"}
              </button>
            </div>

            {/* Chat Overlay
                Scrollable, stick-to-bottom. Capped at ~60dvh so new turns
                are always visible and long replies can be scrolled up to
                read. pointer-events-auto on the scroll container so the
                user can actually drag inside it; the outer motion wrapper
                stays click-through everywhere else. */}
            <AnimatePresence>
              {showHud && !chatCollapsed && (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="absolute top-24 left-6 z-50 max-w-sm w-[calc(100vw-3rem)] pointer-events-none"
                  style={{ maxHeight: "min(60dvh, calc(100dvh - 240px))" }}
                >
                  <div
                    ref={chatScrollRef}
                    onScroll={(e) => {
                      const el = e.currentTarget;
                      // Within 32px of the bottom counts as "at bottom" so
                      // tiny bounces don't break the stick lock.
                      stickBottom.current =
                        el.scrollHeight - el.scrollTop - el.clientHeight < 32;
                    }}
                    className="h-full max-h-full overflow-y-auto overscroll-contain flex flex-col gap-3 pr-1 pointer-events-auto scrollbar-hide"
                    style={{ maxHeight: "min(60dvh, calc(100dvh - 240px))" }}
                  >
                    {[...messages, streamText ? { role: "assistant", content: extractStreamMessage(streamText) } : null]
                      .filter(Boolean)
                      .map((m: any, i) => (
                        <div
                          key={i}
                          className={`glass px-5 py-4 text-[13px] leading-relaxed border-l-2 shadow-2xl rounded-[1.2rem] shrink-0 ${m.role === "user" ? "border-white/20 text-secondary/70" : "border-amber text-amber"}`}
                        >
                          <span className="block text-[8px] uppercase tracking-widest opacity-40 mb-1">
                            {m.role === "user" ? "You" : "Nexus"}
                          </span>
                          {m.content}
                        </div>
                      ))}

                    {/* Casual yes/no prompt rides under the latest bubble.
                        Resolving a card removes it from the queue; nothing
                        public moves until the user hits Submit. */}
                    <ClausePromptCard
                      prompts={clausePrompts}
                      onResolve={(id) =>
                        setClausePrompts((prev) => prev.filter((p) => p.clause_id !== id))
                      }
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* INPUT HUD */}
            {!submitting && (
              <div className="absolute bottom-[84px] left-4 right-4 z-[100] flex justify-center pointer-events-auto">
                <div className="w-full max-w-xl glass rounded-[2.5rem] p-1.5 flex items-end gap-2 border border-white/10 shadow-2xl backdrop-blur-3xl bg-black/30">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={displayValue}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Whisper to the machine..."
                    className="flex-1 bg-transparent text-secondary px-6 py-4 outline-none resize-none min-h-[44px] max-h-[180px] text-base scrollbar-hide placeholder:text-secondary/20"
                  />
                  <div className="flex items-center gap-2 mb-1.5 pr-1.5">
                    <button onClick={sendMessage} className="w-11 h-11 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-amber hover:bg-amber hover:text-black hover:scale-105 transition-all shadow-xl">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    <button onClick={() => (speech.listening ? speech.stop() : speech.start())} className={`w-11 h-11 flex items-center justify-center rounded-full transition-all shadow-xl ${speech.listening ? "bg-amber text-black scale-110 shadow-[0_0_20px_rgba(255,191,0,0.6)]" : "bg-white/5 border border-white/10 text-white hover:bg-white/20"}`}>
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <SubmitReview open={reviewOpen} onClose={() => setReviewOpen(false)} onConfirm={handleDoSubmit} anonymous />
      <NodeOverlay node={selected} onClose={() => setSelected(null)} />
      <LinkOverlay link={selectedLink} onClose={() => setSelectedLink(null)} />

      {/* Legend. Hidden during the exit transition so it doesn't pop out
          while the map is collapsing. */}
      {transitionPhase === "idle" && <HelpButton corner="bottom-right" />}
    </main>
  );
}

function extractStreamMessage(raw: string): string {
  const key = '"message"';
  const idx = raw.indexOf(key);
  if (idx < 0) return "";
  const colon = raw.indexOf(":", idx);
  const firstQuote = raw.indexOf('"', colon + 1);
  if (firstQuote < 0) return "";
  let out = "";
  for (let i = firstQuote + 1; i < raw.length; i++) {
    if (raw[i] === "\\" && i + 1 < raw.length) { out += raw[i + 1]; i++; continue; }
    if (raw[i] === '"') break;
    out += raw[i];
  }
  return out;
}
