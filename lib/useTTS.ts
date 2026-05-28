"use client";

import { useRef, useState, useCallback } from "react";

export function useTTS() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback(async (text: string) => {
    stop();
    if (!text.trim()) return;
    if (!process.env.NEXT_PUBLIC_ELEVENLABS_ENABLED) {
      // Silently no-op if TTS not configured — avoids error spam
    }

    setSpeaking(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) { setSpeaking(false); return; }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setSpeaking(false);
        URL.revokeObjectURL(url);
        objectUrlRef.current = null;
        audioRef.current = null;
      };
      audio.onerror = () => { setSpeaking(false); };
      await audio.play();
    } catch {
      setSpeaking(false);
    }
  }, [stop]);

  return { speak, stop, speaking };
}
