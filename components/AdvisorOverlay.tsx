"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSpeech } from "@/lib/useSpeech";
import { useTTS } from "@/lib/useTTS";
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
type Phase = "choose" | "chat";

// ─── Markdown link renderer ────────────────────────────────────────────────
function renderMessage(text: string): React.ReactNode {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (match) {
      return (
        <a key={i} href={match[2]} target="_blank" rel="noopener noreferrer"
          className="underline decoration-dotted" style={{ color: "#FFBF00" }}>
          {match[1]}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ─── Topic tag pill ────────────────────────────────────────────────────────
function TopicTagPill({ tag, onDismiss }: { tag: string; onDismiss: () => void }) {
  return (
    <span
      onClick={onDismiss}
      title="Tap to dismiss"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] cursor-pointer transition-opacity hover:opacity-70"
      style={{ border: "1px solid rgba(255,255,255,0.12)", color: "rgba(245,245,245,0.45)", background: "rgba(255,255,255,0.03)" }}
    >
      {tag}
      <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 9 }}>✕</span>
    </span>
  );
}

// ─── Message bubble ────────────────────────────────────────────────────────
function MessageBubble({
  msg, onDismissTag,
}: {
  msg: ConversationMessage & { _dismissed?: string[] };
  onDismissTag: (tag: string) => void;
}) {
  const isAI = msg.role === "assistant";
  const isStreaming = msg.content === "__thinking__";
  const visibleTags = (msg.topic_tags ?? []).filter(t => !(msg._dismissed ?? []).includes(t));

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`flex flex-col ${isAI ? "items-start" : "items-end"} gap-1`}
    >
      {isAI && visibleTags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1">
          {visibleTags.map(tag => (
            <TopicTagPill key={tag} tag={tag} onDismiss={() => onDismissTag(tag)} />
          ))}
        </div>
      )}
      <div
        className="max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
        style={isAI
          ? { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", color: "rgba(245,245,245,0.92)" }
          : { background: "rgba(255,191,0,0.13)", border: "1px solid rgba(255,191,0,0.25)", color: "rgba(245,245,245,0.95)" }}
      >
        {isStreaming ? (
          <span className="flex gap-1.5 py-0.5">
            {[0, 1, 2].map(j => (
              <motion.span key={j} className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ background: "rgba(255,191,0,0.5)" }}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: j * 0.2 }} />
            ))}
          </span>
        ) : renderMessage(msg.content)}
      </div>
    </motion.div>
  );
}

// ─── Voice blob ────────────────────────────────────────────────────────────
function VoiceBlob({ isActive, isSpeaking }: { isActive: boolean; isSpeaking: boolean }) {
  return (
    <div
      className={isActive || isSpeaking ? "blob-active" : "blob-idle"}
      style={{
        width: 160, height: 160,
        background: isSpeaking
          ? "radial-gradient(circle at 40% 35%, #a78bfa, #7c3aed)"
          : "radial-gradient(circle at 40% 35%, #FFD84D, #FFBF00)",
        boxShadow: isActive || isSpeaking
          ? `0 0 80px ${isSpeaking ? "rgba(124,58,237,0.45)" : "rgba(255,191,0,0.55)"}`
          : "0 0 40px rgba(255,191,0,0.2)",
        transition: "background 0.4s ease, box-shadow 0.3s ease",
      }}
    />
  );
}

// ─── Starter choice screen ────────────────────────────────────────────────
function StarterChoiceScreen({
  advisorName,
  onUserStarts,
  onAIStarts,
  loading,
}: {
  advisorName: string;
  onUserStarts: () => void;
  onAIStarts: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 pb-8 gap-6">
      <div className="text-center mb-2">
        <p className="text-[10px] uppercase tracking-[0.35em] font-bold mb-1" style={{ color: "rgba(255,191,0,0.4)" }}>
          {advisorName}
        </p>
        <h2 className="font-display text-xl font-bold" style={{ color: "rgba(245,245,245,0.9)" }}>
          How do you want to start?
        </h2>
      </div>

      {/* You start card */}
      <motion.button
        onClick={onUserStarts}
        disabled={loading}
        whileTap={{ scale: 0.97 }}
        whileHover={{ scale: 1.02 }}
        className="w-full max-w-sm rounded-2xl p-6 text-left transition-all"
        style={{
          background: "rgba(255,191,0,0.07)",
          border: "1px solid rgba(255,191,0,0.22)",
          boxShadow: "0 0 40px rgba(255,191,0,0.06)",
        }}
      >
        <div className="flex items-start gap-4">
          {/* Pulsing mic icon */}
          <div className="shrink-0 relative mt-0.5">
            <motion.div
              className="w-11 h-11 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,191,0,0.15)", border: "1px solid rgba(255,191,0,0.35)" }}
              animate={{ boxShadow: ["0 0 0px rgba(255,191,0,0)", "0 0 18px rgba(255,191,0,0.35)", "0 0 0px rgba(255,191,0,0)"] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="#FFBF00" strokeWidth="2.2" strokeLinecap="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8" />
              </svg>
            </motion.div>
          </div>
          <div>
            <p className="font-semibold text-sm mb-1" style={{ color: "rgba(245,245,245,0.9)" }}>
              I'll start
            </p>
            <p className="text-xs leading-relaxed" style={{ color: "rgba(245,245,245,0.4)" }}>
              Mic turns on. Say whatever's on your mind — {advisorName} will pick it up and run with it.
            </p>
          </div>
        </div>
      </motion.button>

      {/* AI starts card */}
      <motion.button
        onClick={onAIStarts}
        disabled={loading}
        whileTap={{ scale: 0.97 }}
        whileHover={{ scale: 1.02 }}
        className="w-full max-w-sm rounded-2xl p-6 text-left transition-all relative overflow-hidden"
        style={{
          background: "rgba(124,58,237,0.07)",
          border: "1px solid rgba(124,58,237,0.22)",
          boxShadow: "0 0 40px rgba(124,58,237,0.06)",
        }}
      >
        <div className="flex items-start gap-4">
          {/* Waveform / spark icon */}
          <div className="shrink-0 mt-0.5">
            <div className="w-11 h-11 rounded-full flex items-center justify-center"
              style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.35)" }}>
              {loading ? (
                <motion.div
                  className="w-4 h-4 rounded-full border-2"
                  style={{ borderColor: "rgba(167,139,250,0.6)", borderTopColor: "#a78bfa" }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="#a78bfa" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L15 9H22L16.5 13.5L18.5 21L12 17L5.5 21L7.5 13.5L2 9H9L12 2Z" />
                </svg>
              )}
            </div>
          </div>
          <div>
            <p className="font-semibold text-sm mb-1" style={{ color: "rgba(245,245,245,0.9)" }}>
              {advisorName} starts
            </p>
            <p className="text-xs leading-relaxed" style={{ color: "rgba(245,245,245,0.4)" }}>
              {loading
                ? "Checking today's news..."
                : `${advisorName} pulls something from today's news and asks what you think.`}
            </p>
          </div>
        </div>
      </motion.button>
    </div>
  );
}

// ─── Main overlay ──────────────────────────────────────────────────────────
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
  const tts = useTTS();

  const [phase, setPhase] = useState<Phase>("choose");
  const [mode, setMode] = useState<Mode>("voice");
  const [messages, setMessages] = useState<(ConversationMessage & { _dismissed?: string[] })[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [newsLoading, setNewsLoading] = useState(false);
  const [initiated, setInitiated] = useState(false);
  const [newsTopic, setNewsTopic] = useState<string | null>(null);
  const [newsContext, setNewsContext] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const voiceScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoSendRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset when overlay closes
  useEffect(() => {
    if (!open) {
      setPhase("choose");
      setInitiated(false);
      setMessages([]);
      setInput("");
      setNewsLoading(false);
      setNewsTopic(null);
      setNewsContext(null);
      tts.stop();
      speech.stop();
    }
  }, [open]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    if (voiceScrollRef.current) {
      voiceScrollRef.current.scrollTo({ top: voiceScrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  // Focus input when switching to text mode
  useEffect(() => {
    if (mode === "text" && open && phase === "chat") {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [mode, open, phase]);

  // Voice auto-send on final speech
  useEffect(() => {
    if (mode !== "voice" || !speech.finalText || phase !== "chat") return;
    const text = speech.finalText.trim();
    if (!text) return;
    speech.setFinalText("");
    tts.stop(); // stop AI speech when user speaks
    if (autoSendRef.current) clearTimeout(autoSendRef.current);
    autoSendRef.current = setTimeout(() => sendMessage(text), 800);
  }, [speech.finalText, mode, phase]);

  // Stop mic when overlay closes
  useEffect(() => {
    if (!open && speech.listening) speech.stop();
  }, [open]);

  // ── API call ─────────────────────────────────────────────────────────────
  const callAdvisor = useCallback(async (userMessage: string | null) => {
    setLoading(true);

    if (userMessage !== null) {
      setMessages(prev => [...prev, {
        role: "user" as const,
        content: userMessage,
        timestamp: new Date().toISOString(),
      }]);
    }

    setMessages(prev => [...prev, {
      role: "assistant" as const,
      content: "__thinking__",
      timestamp: new Date().toISOString(),
    }]);

    try {
      const res = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          initial_topic: newsTopic ?? initialTopic,
          news_context: newsContext,
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

      // Speak via ElevenLabs
      if (!muted && data.message) {
        tts.speak(data.message);
      }
    } catch {
      setMessages(prev => prev.filter(m => m.content !== "__thinking__"));
    } finally {
      setLoading(false);
    }
  }, [initialTopic, arenaContext, muted, newsTopic, tts]);

  // ── "I'll start" handler ──────────────────────────────────────────────────
  function handleUserStarts() {
    tts.unlock(); // unlock AudioContext in user-gesture handler
    setPhase("chat");
    setMode("voice");
    setTimeout(() => speech.start(), 500);
  }

  // ── "AI starts" handler ───────────────────────────────────────────────────
  async function handleAIStarts() {
    tts.unlock(); // unlock AudioContext in user-gesture handler
    setNewsLoading(true);
    try {
      const res = await fetch("/api/news-hook");
      const data = await res.json();
      const openingText: string = data.text;
      const topic: string | null = data.topic ?? null;
      const context: string | null = data.context ?? null;

      setNewsTopic(topic);
      setNewsContext(context);
      setMessages([{
        role: "assistant",
        content: openingText,
        topic_tags: topic ? [topic] : [],
        timestamp: new Date().toISOString(),
        _dismissed: [],
      }]);
      setInitiated(true);
      setPhase("chat");
      setMode("voice");

      // Small delay so React state settles before playing audio
      if (!muted) {
        setTimeout(() => tts.speak(openingText), 120);
      }
    } catch {
      // Fallback to normal opening
      setPhase("chat");
      setInitiated(true);
      callAdvisor(null);
    } finally {
      setNewsLoading(false);
    }
  }

  // ── Send message ──────────────────────────────────────────────────────────
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
      tts.stop(); // stop AI voice when user starts speaking
      speech.start();
    }
  }

  const isListening = mode === "voice" && speech.listening;
  const lastAIMsg = [...messages].reverse().find(m => m.role === "assistant" && m.content !== "__thinking__");
  const sessionHasUserMessage = messages.some(m => m.role === "user");
  const displaySubmitCount = sessionHasUserMessage ? unsubmittedCount : 0;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
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
            <div className="w-full flex justify-center pt-3 pb-1 shrink-0 cursor-pointer" onClick={onClose}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)" }} />
            </div>

            {/* Header */}
            <div className="shrink-0 px-4 pb-2 flex items-center justify-between gap-3">
              <span style={{ fontSize: 14, fontWeight: 500, color: "#FFBF00", letterSpacing: "0.02em", flexShrink: 0 }}>
                {advisorName}
              </span>

              {phase === "chat" && (
                <div className="flex items-center gap-1 shrink-0">
                  {/* Mute toggle */}
                  <button
                    onClick={() => { setMuted(m => !m); if (!muted) tts.stop(); }}
                    className="w-9 h-9 flex items-center justify-center rounded-full transition-all"
                    title={muted ? "Unmute voice" : "Mute voice"}
                    style={{
                      background: muted ? "rgba(255,255,255,0.06)" : "rgba(167,139,250,0.15)",
                      border: muted ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(167,139,250,0.4)",
                    }}
                  >
                    {muted ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                        stroke="rgba(255,255,255,0.3)" strokeWidth="2.2" strokeLinecap="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <line x1="23" y1="9" x2="17" y2="15" />
                        <line x1="17" y1="9" x2="23" y2="15" />
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                        stroke="#a78bfa" strokeWidth="2.2" strokeLinecap="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
                      </svg>
                    )}
                  </button>

                  {/* Voice mode */}
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

                  {/* Text mode */}
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
              )}
            </div>

            {/* Submit views bar (only in chat phase) */}
            {phase === "chat" && (
              <div className="shrink-0 px-4 pb-2 flex justify-end">
                <button
                  onClick={() => { onOpenManifesto?.(); onClose(); }}
                  className={displaySubmitCount > 0 ? "submit-pill-pulse" : ""}
                  style={{
                    borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 500,
                    border: displaySubmitCount > 0 ? "1px solid rgba(255,191,0,0.5)" : "1px solid rgba(255,255,255,0.08)",
                    background: displaySubmitCount > 0 ? "rgba(255,191,0,0.12)" : "transparent",
                    color: displaySubmitCount > 0 ? "#FFBF00" : "rgba(245,245,245,0.18)",
                    cursor: "pointer", transition: "all 0.3s", whiteSpace: "nowrap",
                  }}
                >
                  Submit views{displaySubmitCount > 0 ? ` (${displaySubmitCount})` : ""}
                </button>
              </div>
            )}

            {/* ── Starter choice screen ─────────────────────────────────────── */}
            <AnimatePresence mode="wait">
              {phase === "choose" && (
                <motion.div
                  key="choose"
                  className="flex-1 flex flex-col"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22 }}
                >
                  <StarterChoiceScreen
                    advisorName={advisorName}
                    onUserStarts={handleUserStarts}
                    onAIStarts={handleAIStarts}
                    loading={newsLoading}
                  />
                </motion.div>
              )}

              {/* ── Voice chat ──────────────────────────────────────────────── */}
              {phase === "chat" && mode === "voice" && (
                <motion.div
                  key="voice"
                  className="flex-1 min-h-0 flex flex-col items-center px-5"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  {/* Orb */}
                  <div className="shrink-0 pt-2 pb-4">
                    <VoiceBlob isActive={isListening} isSpeaking={tts.speaking} />
                  </div>

                  {/* AI message + user transcript */}
                  <div
                    ref={voiceScrollRef}
                    className="flex-1 min-h-0 overflow-y-auto w-full text-center space-y-4 scrollbar-hide"
                  >
                    {/* AI text — stays visible until AI is generating its next reply */}
                    {lastAIMsg && !loading && (
                      <motion.p
                        key={lastAIMsg.timestamp}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-sm leading-relaxed px-2"
                        style={{ color: "rgba(245,245,245,0.88)" }}
                      >
                        {renderMessage(lastAIMsg.content)}
                      </motion.p>
                    )}

                    {/* Thinking dots — replace AI text while generating */}
                    {loading && (
                      <div className="flex justify-center gap-1.5 py-1">
                        {[0, 1, 2].map(j => (
                          <motion.div key={j} className="w-1.5 h-1.5 rounded-full"
                            style={{ background: "rgba(255,191,0,0.5)" }}
                            animate={{ opacity: [0.3, 1, 0.3] }}
                            transition={{ duration: 1, repeat: Infinity, delay: j * 0.2 }} />
                        ))}
                      </div>
                    )}

                    {/* User's live interim speech — shown below AI text */}
                    {speech.interim && !loading && (
                      <p className="text-xs italic px-2" style={{ color: "rgba(255,191,0,0.6)" }}>
                        {speech.interim}
                      </p>
                    )}
                  </div>

                  {/* Mic + status */}
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
                          transition={{ duration: 0.7, repeat: Infinity }}>
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
                    <p className="text-[10px] tracking-widest uppercase" style={{ color: "rgba(245,245,245,0.2)" }}>
                      {tts.speaking ? "Speaking..." : isListening ? "Listening..." : loading ? "Thinking..." : "Tap to speak"}
                    </p>
                  </div>
                </motion.div>
              )}

              {/* ── Text chat ───────────────────────────────────────────────── */}
              {phase === "chat" && mode === "text" && (
                <motion.div
                  key="text"
                  className="flex-1 min-h-0 flex flex-col"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-3 scrollbar-hide">
                    {messages.map((msg, i) => (
                      <MessageBubble
                        key={`${msg.timestamp}-${i}`}
                        msg={msg}
                        onDismissTag={tag => dismissTag(msg.timestamp!, tag)}
                      />
                    ))}
                    <div ref={bottomRef} />
                  </div>

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
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
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
                      {speech.supported && (
                        <button
                          onClick={toggleMic}
                          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full transition-all"
                          style={{
                            background: speech.listening ? "rgba(255,191,0,0.18)" : "rgba(255,191,0,0.08)",
                            border: speech.listening ? "1px solid rgba(255,191,0,0.55)" : "1px solid rgba(255,191,0,0.2)",
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
                      <button
                        onClick={() => sendMessage()}
                        disabled={!input.trim() || loading}
                        className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full transition-all"
                        style={{
                          background: input.trim() && !loading ? "rgba(255,191,0,0.22)" : "rgba(255,255,255,0.04)",
                          border: input.trim() && !loading ? "1px solid rgba(255,191,0,0.45)" : "1px solid rgba(255,255,255,0.08)",
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
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
