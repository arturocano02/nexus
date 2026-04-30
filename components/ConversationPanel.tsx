"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSpeech } from "@/lib/useSpeech";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";
import type { TaxonomyCategory, ChatMessage } from "@/lib/types";

interface ConversationPanelProps {
  open: boolean;
  category: TaxonomyCategory | null;
  sessionId: string;
  initialMessage?: string | null;
  onClose: () => void;
  onReview: () => void;
  /** Called when the user has enough turns and wants to close — parent should open ReviewPanel */
  onCloseWithReview?: () => void;
  /** Fires whenever canReview changes, so parent can light up the Review button */
  onCanReviewChange?: (canReview: boolean) => void;
}

const MIN_TURNS_FOR_REVIEW = 2;

export default function ConversationPanel({
  open,
  category,
  sessionId,
  initialMessage,
  onClose,
  onReview,
  onCloseWithReview,
  onCanReviewChange,
}: ConversationPanelProps) {
  const { user } = useUser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [initiated, setInitiated] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const speech = useSpeech();
  const supa = supabaseBrowser();

  const userTurns = messages.filter(m => m.role === "user").length;
  const canReview = userTurns >= MIN_TURNS_FOR_REVIEW;

  // Notify parent whenever review-readiness changes
  useEffect(() => {
    onCanReviewChange?.(canReview);
  }, [canReview]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open && !streaming) setTimeout(() => inputRef.current?.focus(), 350);
  }, [open, streaming]);

  // Load persistent conversation history when category changes
  useEffect(() => {
    if (!category?.id || !user) return;
    setMessages([]);
    setInitiated(false);
    setHistoryLoaded(false);
    setInput("");
    setError(null);
    speech.stop();

    async function loadHistory() {
      if (!category?.id || !user) return;
      try {
        const { data } = await supa
          .from("messages")
          .select("role, content")
          .eq("user_id", user.id)
          .eq("category_id", category.id)
          .order("created_at", { ascending: true })
          .limit(200);

        if (data && data.length > 0) {
          setMessages(data as ChatMessage[]);
          setInitiated(true); // don't re-kick — history is already here
        }
      } catch { /* messages table may not exist yet */ }
      setHistoryLoaded(true);
    }
    loadHistory();
  }, [category?.id, user?.id]);

  // Auto-kick conversation once history check is done
  useEffect(() => {
    if (!open || !category || !historyLoaded || initiated) return;
    setInitiated(true);
    if (initialMessage) {
      const userMsg: ChatMessage = { role: "user", content: initialMessage };
      setMessages([userMsg]);
      streamReply([userMsg], category);
    } else {
      streamReply([], category);
    }
  }, [open, category, historyLoaded, initiated]);

  // Merge speech transcript into input
  useEffect(() => {
    if (speech.finalText) {
      setInput(prev => {
        const base = prev.trim();
        return base ? base + " " + speech.finalText : speech.finalText;
      });
      speech.setFinalText("");
    }
  }, [speech.finalText]);

  // -----------------------------------------------------------------------
  // Stream reply from API
  // -----------------------------------------------------------------------
  const streamReply = useCallback(async (history: ChatMessage[], cat: TaxonomyCategory) => {
    setStreaming(true);
    setError(null);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const PLACEHOLDER = "__streaming__";
    setMessages(prev => [...prev, { role: "assistant", content: PLACEHOLDER }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          session_id: sessionId,
          category_id: cat.id,
          category_slug: cat.slug,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) throw new Error("Stream failed");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let accum = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "delta") {
              accum += evt.text;
              setMessages(prev => {
                const copy = [...prev];
                const idx = copy.findLastIndex(m => m.content === PLACEHOLDER);
                if (idx >= 0) copy[idx] = { role: "assistant", content: accum };
                return copy;
              });
            }
          } catch { /* ignore parse errors */ }
        }
      }

      // Finalise placeholder
      setMessages(prev => {
        const copy = [...prev];
        const idx = copy.findLastIndex(m => m.content === PLACEHOLDER);
        if (idx >= 0 && accum) copy[idx] = { role: "assistant", content: accum };
        else if (idx >= 0) copy.splice(idx, 1);
        return copy;
      });
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      setError("Connection error — please try again.");
      setMessages(prev => prev.filter(m => m.content !== "__streaming__"));
    } finally {
      setStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [sessionId]);

  // -----------------------------------------------------------------------
  // Send user message
  // -----------------------------------------------------------------------
  async function handleSend() {
    const text = (input + (speech.interim ? " " + speech.interim : "")).trim();
    if (!text || streaming || !category) return;
    if (speech.listening) speech.stop();

    const userMsg: ChatMessage = { role: "user", content: text };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput("");
    await streamReply(newHistory, category);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function toggleMic() {
    speech.listening ? speech.stop() : speech.start();
  }

  // -----------------------------------------------------------------------
  // Render — transparent overlay, no backdrop blur, floats on globe
  // -----------------------------------------------------------------------
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="conv-panel"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ type: "spring", stiffness: 280, damping: 28 }}
          className="fixed inset-x-0 bottom-0 z-[190] flex flex-col mx-auto max-w-2xl w-full"
          style={{ maxHeight: "72dvh", pointerEvents: "none" }}
        >
          {/* Header bar — pill floated above messages */}
          <div
            className="shrink-0 flex items-center justify-between mx-4 mb-2 px-4 py-2 rounded-2xl"
            style={{
              pointerEvents: "auto",
              background: "rgba(4,4,24,0.72)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 2px 24px rgba(0,0,0,0.4)",
            }}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse" />
              <div>
                <span className="text-[8px] uppercase tracking-[0.3em] text-amber/50 font-bold mr-2">
                  {category?.name}
                </span>
                {canReview && (
                  <button
                    onClick={onReview}
                    className="text-[8px] uppercase tracking-[0.2em] font-bold px-2.5 py-1 rounded-full border transition-all"
                    style={{ color: "#FFBF00", borderColor: "rgba(255,191,0,0.5)", background: "rgba(255,191,0,0.13)" }}
                  >
                    Submit views
                  </button>
                )}
              </div>
            </div>
            {/* Close — if review-ready, routes through onCloseWithReview so the
                ReviewPanel opens automatically instead of just dismissing. */}
            <button
              onClick={canReview && onCloseWithReview ? onCloseWithReview : onClose}
              className="w-7 h-7 flex items-center justify-center rounded-full transition-colors"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Messages — scrollable, transparent background */}
          <div
            className="flex-1 overflow-y-auto px-4 pb-2 space-y-2 scrollbar-hide"
            style={{ pointerEvents: "auto" }}
          >
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}

            {/* Typing indicator */}
            {streaming && messages[messages.length - 1]?.content === "__streaming__" && (
              <div className="flex gap-1.5 pl-2 py-1">
                {[0, 1, 2].map(j => (
                  <motion.div
                    key={j}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "rgba(255,191,0,0.5)" }}
                    animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
                    transition={{ duration: 1.1, repeat: Infinity, delay: j * 0.18 }}
                  />
                ))}
              </div>
            )}

            {error && (
              <p className="text-red-400/80 text-xs text-center py-1">{error}</p>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Mic interim preview */}
          <AnimatePresence>
            {speech.listening && speech.interim && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mx-4 mb-1"
                style={{ pointerEvents: "auto" }}
              >
                <p className="text-xs italic px-3 py-1.5 rounded-xl"
                   style={{ color: "rgba(255,191,0,0.65)", background: "rgba(4,4,24,0.6)", border: "1px solid rgba(255,191,0,0.15)" }}>
                  {speech.interim}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input bar */}
          <div
            className="shrink-0 mx-4 mb-5"
            style={{ pointerEvents: "auto" }}
          >
            <div
              className="flex items-end gap-2 rounded-2xl px-4 py-3"
              style={{
                background: "rgba(4,4,24,0.82)",
                backdropFilter: "blur(24px)",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 4px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,191,0,0.06)",
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={streaming}
                rows={1}
                placeholder={speech.listening ? "Listening..." : "Your thoughts..."}
                className="flex-1 bg-transparent text-sm text-secondary placeholder-secondary/25 outline-none resize-none leading-relaxed"
                style={{ maxHeight: "100px" }}
                onInput={e => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                }}
              />

              {speech.supported && (
                <motion.button
                  onClick={toggleMic}
                  whileTap={{ scale: 0.88 }}
                  className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all"
                  style={{
                    background: speech.listening ? "rgba(255,90,106,0.18)" : "rgba(255,255,255,0.06)",
                    border: speech.listening ? "1px solid rgba(255,90,106,0.45)" : "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  {speech.listening ? (
                    <motion.svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                      stroke="#FF5A6A" strokeWidth="2.2"
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 0.75, repeat: Infinity }}
                    >
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8" strokeLinecap="round" />
                    </motion.svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                         stroke="rgba(255,255,255,0.4)" strokeWidth="2.2">
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8" strokeLinecap="round" />
                    </svg>
                  )}
                </motion.button>
              )}

              <motion.button
                onClick={handleSend}
                disabled={(!input.trim() && !speech.interim) || streaming}
                whileTap={{ scale: 0.88 }}
                className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all"
                style={{
                  background: (input.trim() || speech.interim) && !streaming
                    ? "rgba(255,191,0,0.22)" : "rgba(255,255,255,0.04)",
                  border: (input.trim() || speech.interim) && !streaming
                    ? "1px solid rgba(255,191,0,0.45)" : "1px solid rgba(255,255,255,0.08)",
                  opacity: (!input.trim() && !speech.interim) || streaming ? 0.3 : 1,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                     stroke="#FFBF00" strokeWidth="2.5">
                  <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </motion.button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// -----------------------------------------------------------------------
// Message bubble — minimal, mostly transparent
// -----------------------------------------------------------------------
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isAI = msg.role === "assistant";
  const isStreaming = msg.content === "__streaming__";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      className={`flex ${isAI ? "justify-start" : "justify-end"}`}
    >
      <div
        className="max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
        style={
          isAI
            ? {
                background: "rgba(8,8,32,0.75)",
                backdropFilter: "blur(16px)",
                border: "1px solid rgba(255,255,255,0.09)",
                color: "rgba(245,245,245,0.9)",
                boxShadow: "0 2px 16px rgba(0,0,0,0.3)",
              }
            : {
                background: "rgba(255,191,0,0.14)",
                backdropFilter: "blur(16px)",
                border: "1px solid rgba(255,191,0,0.2)",
                color: "rgba(245,245,245,0.95)",
                boxShadow: "0 2px 16px rgba(0,0,0,0.25)",
              }
        }
      >
        {isStreaming ? <span className="opacity-0">...</span> : msg.content}
      </div>
    </motion.div>
  );
}
