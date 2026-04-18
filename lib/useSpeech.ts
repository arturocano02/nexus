"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal Web Speech API wrapper with a mic amplitude read-out for the blob.
export function useSpeech() {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [finalText, setFinalText] = useState("");
  const [supported, setSupported] = useState(true);
  const ampRef = useRef(0);

  const recognitionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const SR = (typeof window !== "undefined") && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    setSupported(!!SR);
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop?.();
    recognitionRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    ampRef.current = 0;
    setListening(false);
  }, []);

  const start = useCallback(async () => {
    setInterim("");
    setFinalText("");
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
    // Mic stream -> AnalyserNode for amplitude
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        ampRef.current = Math.min(1, rms * 4);
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      // mic permission denied. Recognition can still run in some browsers
    }

    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e: any) => {
      let interimStr = "";
      let finalStr = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalStr += res[0].transcript;
        else interimStr += res[0].transcript;
      }
      if (interimStr) setInterim(interimStr);
      if (finalStr) setFinalText((prev) => (prev ? prev + " " : "") + finalStr.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.start();
    recognitionRef.current = r;
    setListening(true);
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { start, stop, listening, interim, finalText, setFinalText, supported, ampRef };
}
