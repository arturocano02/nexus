"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

const RESERVED_USERNAMES = new Set([
  "admin", "nexus", "manifesto", "arena", "support",
  "help", "moderator", "null", "undefined", "root",
]);

type AvailStatus = "idle" | "checking" | "available" | "taken" | "invalid";

export default function SignupCompletePage() {
  const router = useRouter();
  const supa = supabaseBrowser();

  const [checking, setChecking] = useState(true);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [googleDisplayName, setGoogleDisplayName] = useState("");

  const [username, setUsername] = useState("");
  const [age, setAge] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [usernameStatus, setUsernameStatus] = useState<AvailStatus>("idle");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -----------------------------------------------------------------------
  // On mount: check if a profile already exists for the OAuth user
  // -----------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supa.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      setUserId(user.id);
      setGoogleDisplayName(user.user_metadata?.full_name ?? user.user_metadata?.name ?? "");

      const { data: profile } = await supa
        .from("profiles")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

      if (profile) {
        // Profile exists — also backfill legacy users table
        try { await supa.from("users").upsert({ id: user.id, username: "" }); } catch { /* ok */ }
        router.replace("/your-view");
      } else {
        setNeedsProfile(true);
        setChecking(false);
      }
    })();
  }, []);

  // -----------------------------------------------------------------------
  // Username check
  // -----------------------------------------------------------------------
  const checkUsername = useCallback(async (value: string) => {
    const raw = value.trim().toLowerCase();
    if (!raw || raw.length < 3 || raw.length > 20 || !/^[a-z0-9_]+$/.test(raw)) {
      setUsernameStatus("invalid");
      return;
    }
    if (RESERVED_USERNAMES.has(raw)) {
      setUsernameStatus("taken");
      return;
    }
    setUsernameStatus("checking");
    const { data } = await supa.from("profiles").select("id").eq("username", raw).maybeSingle();
    setUsernameStatus(data ? "taken" : "available");
  }, [supa]);

  function onUsernameChange(val: string) {
    setUsername(val);
    setErrors(prev => ({ ...prev, username: "" }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) { setUsernameStatus("idle"); return; }
    debounceRef.current = setTimeout(() => checkUsername(val), 600);
  }

  // -----------------------------------------------------------------------
  // Submit profile completion
  // -----------------------------------------------------------------------
  async function handleComplete(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ username: true, age: true });

    const uRaw = username.trim().toLowerCase();
    const errs: Record<string, string> = {};
    if (!uRaw || uRaw.length < 3) errs.username = "At least 3 characters";
    else if (uRaw.length > 20) errs.username = "Max 20 characters";
    else if (!/^[a-z0-9_]+$/.test(uRaw)) errs.username = "Lowercase letters, numbers, underscores only";
    else if (RESERVED_USERNAMES.has(uRaw)) errs.username = "That username is reserved";
    else if (usernameStatus === "taken") errs.username = "Username already taken";

    const ageNum = parseInt(age, 10);
    if (!age) errs.age = "Age is required";
    else if (isNaN(ageNum) || ageNum < 16 || ageNum > 120) errs.age = "Must be between 16 and 120";

    if (Object.keys(errs).length) { setErrors(errs); return; }
    if (usernameStatus === "checking") return;
    if (!userId) return;

    setLoading(true);

    const { data: { user } } = await supa.auth.getUser();
    const displayName = googleDisplayName || user?.user_metadata?.email?.split("@")[0] || uRaw;

    const { error } = await supa.from("profiles").insert({
      id: userId,
      username: uRaw,
      display_name: displayName,
      age: ageNum,
    });

    if (error) {
      setErrors({ form: error.message });
      setLoading(false);
      return;
    }

    // Backfill legacy users table
    try { await supa.from("users").upsert({ id: userId, username: uRaw }); } catch { /* ok */ }

    // Log auth event
    try {
      await fetch("/api/auth/log-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: "signup", metadata: { provider: "google" } }),
      });
    } catch { /* non-blocking */ }

    router.replace("/your-view");
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  if (checking) {
    return (
      <main className="min-h-dvh bg-navy flex items-center justify-center">
        <p className="font-mono text-[10px] tracking-[0.5em] text-secondary/20 uppercase animate-pulse">
          Loading...
        </p>
      </main>
    );
  }

  if (!needsProfile) return null;

  const usernameIndicator =
    usernameStatus === "available" ? (
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 text-sm">✓</span>
    ) : usernameStatus === "taken" ? (
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-400 text-sm">✗</span>
    ) : usernameStatus === "checking" ? (
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary/30 text-xs animate-pulse">…</span>
    ) : null;

  return (
    <main className="min-h-dvh bg-navy flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1
          className="font-display text-4xl font-bold text-center mb-2"
          style={{ color: "#FFBF00", textShadow: "0 0 40px rgba(255,191,0,0.4)" }}
        >
          Nexus
        </h1>
        <p className="text-center text-secondary/50 text-sm mb-2">Almost there.</p>
        {googleDisplayName && (
          <p className="text-center text-secondary/40 text-xs mb-8">
            Welcome, <span className="text-secondary/70">{googleDisplayName}</span> — just a couple more things.
          </p>
        )}

        <form onSubmit={handleComplete} noValidate className="space-y-4">
          {/* Username */}
          <div>
            <div className="relative">
              <input
                type="text"
                placeholder="Choose a username"
                value={username}
                onChange={(e) => onUsernameChange(e.target.value)}
                onBlur={() => {
                  setTouched(prev => ({ ...prev, username: true }));
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  checkUsername(username);
                }}
                className="w-full bg-navy-800 rounded-xl px-4 py-3 pr-10 text-sm outline-none ring-1 ring-white/10 focus:ring-amber/60 transition placeholder:text-secondary/30"
              />
              {usernameIndicator}
            </div>
            <p className="mt-1 text-[10px] text-secondary/25">Lowercase letters, numbers, underscores · 3–20 chars</p>
            {touched.username && (errors.username || usernameStatus === "taken") && (
              <p className="mt-0.5 text-[12px]" style={{ color: "#FF5A6A" }}>
                {errors.username || "Username already taken"}
              </p>
            )}
          </div>

          {/* Age */}
          <div>
            <input
              type="number"
              placeholder="Your age"
              min={16}
              max={120}
              value={age}
              onChange={(e) => { setAge(e.target.value); setErrors(prev => ({ ...prev, age: "" })); }}
              onBlur={() => setTouched(prev => ({ ...prev, age: true }))}
              className="w-full bg-navy-800 rounded-xl px-4 py-3 text-sm outline-none ring-1 ring-white/10 focus:ring-amber/60 transition placeholder:text-secondary/30"
            />
            {touched.age && errors.age && (
              <p className="mt-1 text-[12px]" style={{ color: "#FF5A6A" }}>{errors.age}</p>
            )}
          </div>

          {errors.form && (
            <p className="text-[12px]" style={{ color: "#FF5A6A" }}>{errors.form}</p>
          )}

          <button
            type="submit"
            disabled={loading || usernameStatus === "checking"}
            className="btn-primary w-full py-3 text-sm font-semibold disabled:opacity-60"
          >
            {loading ? "Setting up your account..." : "Continue"}
          </button>
        </form>
      </div>
    </main>
  );
}
