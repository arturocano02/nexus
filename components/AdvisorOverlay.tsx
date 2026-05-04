"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSpeech } from "@/lib/useSpeech";
import { useUserStore } from "@/lib/stores/userStore";
import type { ConversationMessage, AdvisorApiResponse } from "@/lib/types";

interface AdvisorOverlayProps {
  open: boolean;
  onClose: () => void;
  initialTopic?: string | null;
  arenaContext?: { topic: string; for_args: string[]; against_args: string[] } | null;
  unsubmittedCount?: number;
  onOpenManifesto?: () => void;
}

type Mode = "voice" | "text";

// Simple inline link renderer: [text](url) → <a>
function renderMessage(text: string): React.ReactNode {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (match) {
      return (
        <a
          key={i}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted"
          style={{ color: "#FFBF00" }}
        >
          {match[1]}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function TopicTagPill({
  tag,
  onDismiss,
}: {
  tag: string;
  onDismiss: () => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] cursor-pointer transition-opacity hover:opacity-70"
      style={{
        border: "1px solid rgba(255,255,255,0.12)",
        color: "rgba(245,245,245,0.45)",
        background: "rgba(255,255,255,0.03)",
      }}
      onClick={onDismiss}
      title="Tap to dismiss"
    >
      {tag}
      <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 9 }}>✕</span>
    </span>
  );
}

function MessageBubble({
  msg,
  onDismissTag,
}: {
  msg: ConversationMessage & { _dismissed?: string[] };
  onDismissTag: (tag: string) => void;
}) {
  const isAI = msg.role === "assistant";
  const isStreaming = msg.content === "__thinking__";
  const visibleTags = (msg.topic_tags ?? []).filter(
    t => !(msg._dismissed ?? []).includes(t)
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`flex flex-col ${isAI ? "items-start" : "items-end"} gap-1`}
    >
      {/* Topic tags — above AI bubbles only */}
      {isAI && visibleTags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1">
          {visibleTags.map(tag => (
            <TopicTagPill key={tag} tag={tag} onDismiss={() => onDismissTag(tag)} />
          ))}
        </div>
      )}

      {/* Bubble */}
      <div
        className="max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
        style={
          isAI
            ? {
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.05)",
              color: "rgba(245,245,245,0.92)",
            }
            : {
              background: "rgba(255,191,0,0.13)",
              border: "1px solid rgba(255,191,0,0.25)",
              color: "rgba(245,245,245,0.95)",
            }
        }
      >
        {isStreaming ? (
          <span className="flex gap-1.5 py-0.5">
            {[0, 1, 2].map(j => (
              <motion.span
                key={j}
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ background: "rgba(255,191,0,0.5)" }}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: j * 0.2 }}
              />
            ))}
          </span>
        ) : (
          renderMessage(msg.content)
        )}
      </div>
    </motion.div>
  );
}

// CSS morphing blob for voice mode — amber
function VoiceBlob({ isActive }: { isActive: boolean }) {
  return (
    <div
      className={isActive ? "blob-active" : "blob-idle"}
      style={{
        width: 160,
        height: 160,
        background: "radial-gradient(circle at 40% 35%, #FFD84D, #FFBF00)",
        boxShadow: isActive
          ? "0 0 80px rgba(255,191,0,0.55)"
          : "0 0 40px rgba(255,191,0,0.2)",
        transition: "box-shadow 0.3s ease",
      }}
    />
  );
}

export default function AdvisorOverlay({
  open,
  onClose,
  initialTopic,
  arenaContext,
  unsubmittedCount = 0,
  onOpenManifesto,
}: AdvisorOverlayProps) {
  const { profile } = useUserStore();
  const advisorName = profile?.advisor_name || "Nexus";
  const speech = useSpeech();

  const [mode, setMode] = useState<Mode>("voice");
  const [messages, setMessages] = useState<(ConversationMessage & { _dismissed?: string[] })[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [initiated, setInitiated] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const voiceScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoSendRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll to bottom on new messages (text mode + voice scroll)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    if (voiceScrollRef.current) {
      voiceScrollRef.current.scrollTo({ top: voiceScrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  // Focus input when switching to text mode
  useEffect(() => {
    if (mode === "text" && open) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [mode, open]);

  // Load conversation on open
  useEffect(() => {
    if (!open || initiated) return;
    setInitiated(true);
    callAdvisor(null);
  }, [open]);

  // Voice mode: auto-send when speech finalises
  useEffect(() => {
    if (mode !== "voice" || !speech.finalText) return;
    const text = speech.finalText.trim();
    if (!text) return;
    speech.setFinalText("");
    if (autoSendRef.current) clearTimeout(autoSendRef.current);
    // Brief pause so user can see the transcript
    autoSendRef.current = setTimeout(() => {
      sendMessage(text);
    }, 800);
  }, [speech.finalText, mode]);

  // Stop mic when overlay closes
  useEffect(() => {
    if (!open && speech.listening) speech.stop();
  }, [open]);

  // -----------------------------------------------------------------------
  // API call
  // -----------------------------------------------------------------------
  const callAdvisor = useCallback(async (userMessage: string | null) => {
    setLoading(true);

    if (userMessage !== null) {
      const userMsg: ConversationMessage & { _dismissed?: string[] } = {
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, userMsg]);
    }

    // Show thinking indicator
    const thinkingMsg: ConversationMessage & { _dismissed?: string[] } = {
      role: "assistant",
      content: "__thinking__",
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, thinkingMsg]);

    try {
      const res = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          initial_topic: initialTopic,
          arena_context: arenaContext,
        }),
      });

      const data: AdvisorApiResponse = await res.json();

      const assistantMsg: ConversationMessage & { _dismissed?: string[] } = {
        role: "assistant",
        content: data.message,
        topic_tags: data.topic_tags,
        belief_updates: data.belief_updates,
        timestamp: new Date().toISOString(),
        _dismissed: [],
      };

      setMessages(prev => {
        const withoutThinking = prev.filter(m => m.content !== "__thinking__");
        return [...withoutThinking, assistantMsg];
      });
    } catch {
      setMessages(prev => prev.filter(m => m.content !== "__thinking__"));
    } finally {
      setLoading(false);
    }
  }, [initialTopic, arenaContext]);

  // -----------------------------------------------------------------------
  // Send message
  // -----------------------------------------------------------------------
  function sendMessage(text?: string) {
    const msg = text ?? input.trim();
    if (!msg || loading) return;
    setInput("");
    callAdvisor(msg);
  }

  function dismissTag(msgTimestamp: string, tag: string) {
    setMessages(prev =>
      prev.map(m =>
        m.timestamp === msgTimestamp
          ? { ...m, _dismissed: [...(m._dismissed ?? []), tag] }
          : m
      )
    );
  }

  function toggleMic() {
    if (speech.listening) {
      speech.stop();
    } else {
      speech.start();
    }
  }

  const isListening = mode === "voice" && speech.listening;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — subtle, keeps globe visible above */}
          <motion.div
            key="advisor-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200]"
            style={{ background: "rgba(0,0,20,0.55)", backdropFilter: "blur(4px)" }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            key="advisor-sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-[210] flex flex-col mx-auto max-w-2xl w-full"
            style={{
              height: "75dvh",
              background: "rgba(4,4,36,0.72)",
              backdropFilter: "blur(28px) saturate(160%)",
              WebkitBackdropFilter: "blur(28px) saturate(160%)",
              borderRadius: "16px 16px 0 0",
              borderTop: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            {/* Close handle */}
            <div
              className="w-full flex justify-center pt-3 pb-1 shrink-0 cursor-pointer"
              onClick={onClose}
            >
              <div
                style={{
                  width: 40,
                  height: 4,
                  borderRadius: 2,
                  background: "rgba(255,255,255,0.15)",
                }}
              />
            </div>

            {/* Header: advisor name | mode toggle */}
            <div className="shrink-0 px-4 pb-2 flex items-center justify-between gap-3">
              <span style={{ fontSize: 14, fontWeight: 500, color: "#FFBF00", letterSpacing: "0.02em", flexShrink: 0 }}>
                {advisorName}
              </span>

              {/* Mode toggle: mic / chat */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setMode("voice")}
                  className="w-9 h-9 flex items-center justify-center rounded-full transition-all"
                  style={{
                    background: mode === "voice" ? "rgba(255,191,0,0.18)" : "transparent",
                    border: mode === "voice" ? "1px solid rgba(255,191,0,0.4)" : "1px solid rgba(255,255,255,0.1)",
                  }}
                  aria-label="Voice mode"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke={mode === "voice" ? "#FFBF00" : "rgba(255,255,255,0.35)"}
                    strokeWidth="2" strokeLinecap="round">
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8" />
                  </svg>
                </button>
                <button
                  onClick={() => setMode("text")}
                  className="w-9 h-9 flex items-center justify-center rounded-full transition-all"
                  style={{
                    background: mode === "text" ? "rgba(255,191,0,0.18)" : "transparent",
                    border: mode === "text" ? "1px solid rgba(255,191,0,0.4)" : "1px solid rgba(255,255,255,0.1)",
                  }}
                  aria-label="Text mode"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke={mode === "text" ? "#FFBF00" : "rgba(255,255,255,0.35)"}
                    strokeWidth="2" strokeLinecap="round">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Submit views slim bar — always visible above conversation */}
            <div className="shrink-0 px-4 pb-2 flex justify-end">
              <button
                onClick={() => { onOpenManifesto?.(); onClose(); }}
                className={unsubmittedCount > 0 ? "submit-pill-pulse" : ""}
                style={{
                  borderRadius: 999,
                  padding: "5px 14px",
                  fontSize: 12,
                  fontWeight: 500,
                  border: unsubmittedCount > 0
                    ? "1px solid rgba(255,191,0,0.5)"
                    : "1px solid rgba(255,255,255,0.08)",
                  background: unsubmittedCount > 0
                    ? "rgba(255,191,0,0.12)"
                    : "transparent",
                  color: unsubmittedCount > 0
                    ? "#FFBF00"
                    : "rgba(245,245,245,0.18)",
                  cursor: "pointer",
                  transition: "all 0.3s",
                  whiteSpace: "nowrap",
                }}
              >
                Submit views{unsubmittedCount > 0 ? ` (${unsubmittedCount})` : ""}
              </button>
            </div>

            {/* ----------------------------------------------------------------
                Voice mode
            ---------------------------------------------------------------- */}
            {mode === "voice" && (
              <div className="flex-1 min-h-0 flex flex-col items-center px-5">
                {/* Orb — always visible at top */}
                <div className="shrink-0 pt-2 pb-4">
                  <VoiceBlob isActive={isListening} />
                </div>

                {/* Scrollable transcript + AI response */}
                <div
                  ref={voiceScrollRef}
                  className="flex-1 min-h-0 overflow-y-auto w-full text-center space-y-3 scrollbar-hide"
                >
                  {speech.interim && (
                    <p className="text-sm italic px-2" style={{ color: "rgba(255,191,0,0.75)" }}>
                      {speech.interim}
                    </p>
                  )}
                  {(() => {
                    const lastAI = [...messages].reverse().find(m => m.role === "assistant" && m.content !== "__thinking__");
                    return lastAI ? (
                      <p className="text-sm leading-relaxed px-2" style={{ color: "rgba(245,245,245,0.82)" }}>
                        {renderMessage(lastAI.content)}
                      </p>
                    ) : null;
                  })()}
                </div>

                {/* Mic button + status — always at bottom */}
                <div
                  className="shrink-0 flex flex-col items-center gap-3 pt-4"
                  style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}
                >
                  <button
                    onClick={toggleMic}
                    disabled={!speech.supported}
                    className="w-16 h-16 rounded-full flex items-center justify-center transition-all"
                    style={{
                      background: isListening ? "rgba(255,191,0,0.15)" : "rgba(255,191,0,0.08)",
                      border: isListening ? "2px solid rgba(255,191,0,0.6)" : "2px solid rgba(255,191,0,0.25)",
                      boxShadow: isListening ? "0 0 30px rgba(255,191,0,0.25)" : "none",
                    }}
                  >
                    {isListening ? (
                      <motion.svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                        stroke="#FFBF00" strokeWidth="2.2" strokeLinecap="round"
                        animate={{ scale: [1, 1.15, 1] }}
                        transition={{ duration: 0.7, repeat: Infinity }}
                      >
                        <rect x="9" y="2" width="6" height="12" rx="3" />
                        <path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8" />
                      </motion.svg>
                    ) : (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                        stroke="rgba(255,191,0,0.7)" strokeWidth="2.2" strokeLinecap="round">
                        <rect x="9" y="2" width="6" height="12" rx="3" />
                        <path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8" />
                      </svg>
                    )}
                  </button>
                  <p className="text-[10px] tracking-widest uppercase"
                    style={{ color: "rgba(245,245,245,0.2)" }}>
                    {isListening ? "Listening..." : loading ? "Thinking..." : "Tap to speak"}
                  </p>
                </div>
              </div>
            )}

            {/* ----------------------------------------------------------------
                Text mode
            ---------------------------------------------------------------- */}
            {mode === "text" && (
              <div className="flex-1 min-h-0 flex flex-col">
                {/* Messages */}
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-3 scrollbar-hide">
                  {messages.map((msg, i) => (
                    <MessageBubble
                      key={`${msg.timestamp}-${i}`}
                      msg={msg}
                      onDismissTag={tag => dismissTag(msg.timestamp, tag)}
                    />
                  ))}
                  <div ref={bottomRef} />
                </div>

                {/* Input bar */}
                <div className="shrink-0 px-4 pt-2" style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}>
                  <div
                    className="flex items-end gap-2 rounded-2xl px-4 py-3"
                    style={{
                      background: "rgba(8,6,30,0.9)",
                      border: "1px solid rgba(255,255,255,0.09)",
                      backdropFilter: "blur(20px)",
                    }}
                  >
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      disabled={loading}
                      rows={1}
                      placeholder="Your thoughts..."
                      className="flex-1 bg-transparent text-sm text-secondary placeholder-secondary/25 outline-none resize-none leading-relaxed"
                      style={{ maxHeight: 100 }}
                      onInput={e => {
                        const el = e.currentTarget;
                        el.style.height = "auto";
                        el.style.height = `${el.scrollHeight}px`;
                      }}
                    />
                    {/* Mic button in text mode */}
                    {speech.supported && (
                      <button
                        onClick={toggleMic}
                        className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full transition-all"
                        style={{
                          background: speech.listening
                            ? "rgba(255,191,0,0.18)"
                            : "rgba(255,191,0,0.08)",
                          border: speech.listening
                            ? "1px solid rgba(255,191,0,0.55)"
                            : "1px solid rgba(255,191,0,0.2)",
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                          stroke={speech.listening ? "#FFBF00" : "rgba(255,191,0,0.6)"}
                          strokeWidth="2.2" strokeLinecap="round">
                          <rect x="9" y="2" width="6" height="12" rx="3" />
                          <path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8" />
                        </svg>
                      </button>
                    )}
                    {/* Send button */}
                    <button
                      onClick={() => sendMessage()}
                      disabled={!input.trim() || loading}
                      className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full transition-all"
                      style={{
                        background: input.trim() && !loading
                          ? "rgba(255,191,0,0.22)" : "rgba(255,255,255,0.04)",
                        border: input.trim() && !loading
                          ? "1px solid rgba(255,191,0,0.45)" : "1px solid rgba(255,255,255,0.08)",
                        opacity: !input.trim() || loading ? 0.3 : 1,
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                        stroke="#FFBF00" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M12 19V5M5 12l7-7 7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
