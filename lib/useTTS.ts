"use client";

import { useRef, useState, useCallback } from "react";

export function useTTS() {
  // Per-component AudioContext stored in a ref so it survives re-renders
  // but is created fresh per component mount (no HMR / module-level issues)
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const fetchingRef = useRef(false); // prevents double-calls while a fetch is in flight
  const [speaking, setSpeaking] = useState(false);

  function getOrCreateCtx(): AudioContext {
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctxRef.current = new Ctor();
      console.log("[tts] AudioContext created, state:", ctxRef.current.state);
    }
    return ctxRef.current;
  }

  // Call this synchronously inside a user-gesture handler to unlock audio
  const unlock = useCallback(() => {
    const ctx = getOrCreateCtx();
    console.log("[tts] unlock() called, ctx state:", ctx.state);
    if (ctx.state === "suspended") {
      ctx.resume().then(() =>
        console.log("[tts] AudioContext resumed →", ctx.state)
      );
    }
  }, []);

  const stop = useCallback(() => {
    fetchingRef.current = false;
    try {
      sourceRef.current?.stop();
    } catch {
      /* already stopped */
    }
    sourceRef.current = null;
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (fetchingRef.current) {
        console.log("[tts] already fetching, ignoring duplicate call");
        return;
      }
      stop();
      if (!text?.trim()) {
        console.log("[tts] speak() called with empty text, skipping");
        return;
      }
      console.log("[tts] speak() called, text length:", text.length);
      fetchingRef.current = true;
      setSpeaking(true);

      try {
        // Fetch audio from our API
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        console.log("[tts] /api/tts response:", res.status, res.ok);
        if (!res.ok) {
          const err = await res.text();
          console.error("[tts] API error:", err);
          setSpeaking(false);
          return;
        }

        const arrayBuf = await res.arrayBuffer();
        console.log("[tts] arrayBuffer size:", arrayBuf.byteLength);

        const ctx = getOrCreateCtx();
        console.log("[tts] AudioContext state before decode:", ctx.state);

        if (ctx.state === "suspended") {
          await ctx.resume();
          console.log("[tts] resumed, new state:", ctx.state);
        }

        const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
        console.log("[tts] decoded, duration:", audioBuf.duration);

        const source = ctx.createBufferSource();
        source.buffer = audioBuf;
        source.connect(ctx.destination);
        source.onended = () => {
          console.log("[tts] playback ended");
          fetchingRef.current = false;
          setSpeaking(false);
          sourceRef.current = null;
        };
        sourceRef.current = source;
        fetchingRef.current = false; // fetch done, now playing
        source.start(0);
        console.log("[tts] source.start(0) called ✓");
      } catch (e) {
        console.error("[tts] error in speak():", e);
        fetchingRef.current = false;
        setSpeaking(false);
      }
    },
    [stop]
  );

  return { speak, stop, speaking, unlock };
}
