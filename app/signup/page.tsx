"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { GoogleIcon } from "@/components/icons/GoogleIcon";

const RESERVED_USERNAMES = new Set([
  "admin", "nexus", "manifesto", "arena", "support",
  "help", "moderator", "null", "undefined", "root",
]);

type AvailStatus = "idle" | "checking" | "available" | "taken" | "invalid";

export default function SignupPage() {
  const router = useRouter();
  const supa = supabaseBrowser();

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [age, setAge] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [usernameStatus, setUsernameStatus] = useState<AvailStatus>("idle");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -----------------------------------------------------------------------
  // Username availability check (debounced 600ms)
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
    const { data } = await supa
      .from("profiles")
      .select("id")
      .eq("username", raw)
      .maybeSingle();
    setUsernameStatus(data ? "taken" : "available");
  }, [supa]);

  function onUsernameChange(val: string) {
    setUsername(val);
    setErrors(prev => ({ ...prev, username: "" }));

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) { setUsernameStatus("idle"); return; }
    debounceRef.current = setTimeout(() => checkUsername(val), 600);
  }

  function onUsernameBlur() {
    setTouched(prev => ({ ...prev, username: true }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    checkUsername(username);
  }

  function setFieldError(field: string, msg: string) {
    setErrors(prev => ({ ...prev, [field]: msg }));
  }

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------
  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!displayName.trim()) e.displayName = "Display name is required";
    const uRaw = username.trim().toLowerCase();
    if (!uRaw) {
      e.username = "Username is required";
    } else if (uRaw.length < 3) {
      e.username = "At least 3 characters";
    } else if (uRaw.length > 20) {
      e.username = "Max 20 characters";
    } else if (!/^[a-z0-9_]+$/.test(uRaw)) {
      e.username = "Lowercase letters, numbers, and underscores only";
    } else if (RESERVED_USERNAMES.has(uRaw)) {
      e.username = "That username is reserved";
    } else if (usernameStatus === "taken") {
      e.username = "Username already taken";
    }
    const ageNum = parseInt(age, 10);
    if (!age) e.age = "Age is required";
    else if (isNaN(ageNum) || ageNum < 16 || ageNum > 120) e.age = "Must be between 16 and 120";
    if (!email.trim()) e.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Enter a valid email";
    if (!password) e.password = "Password is required";
    else if (password.length < 8) e.password = "At least 8 characters";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // -----------------------------------------------------------------------
  // Sign up with email + password
  // -----------------------------------------------------------------------
  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ displayName: true, username: true, age: true, email: true, password: true });
    if (!validate()) return;
    if (usernameStatus === "checking") return;

    setLoading(true);
    const uRaw = username.trim().toLowerCase();

    // Create auth user
    const { data: authData, error: authErr } = await supa.auth.signUp({ email, password });
    if (authErr) {
      if (authErr.message.toLowerCase().includes("already")) {
        setErrors({ email: "An account with this email already exists. Sign in instead?" });
      } else {
        setErrors({ form: authErr.message });
      }
      setLoading(false);
      return;
    }

    if (!authData.user) {
      setErrors({ form: "Sign-up failed. Try again." });
      setLoading(false);
      return;
    }

    const userId = authData.user.id;

    // Insert profile row
    const { error: profileErr } = await supa.from("profiles").insert({
      id: userId,
      username: uRaw,
      display_name: displayName.trim(),
      age: parseInt(age, 10),
    });

    if (profileErr) {
      if (profileErr.message.includes("unique")) {
        setErrors({ username: "Username just got taken — choose another" });
      } else {
        setErrors({ form: profileErr.message });
      }
      setLoading(false);
      return;
    }

    // Also insert into legacy users table (for backward-compat)
    try {
      await supa.from("users").upsert({ id: userId, username: uRaw });
    } catch { /* table may not exist */ }

    // Log auth event
    try {
      await fetch("/api/auth/log-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: "signup", metadata: { provider: "email" } }),
      });
    } catch { /* non-blocking */ }

    router.push("/your-view");
  }

  // -----------------------------------------------------------------------
  // Google OAuth
  // -----------------------------------------------------------------------
  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
    const { error } = await supa.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${appUrl}/signup/complete` },
    });
    if (error) {
      setErrors({ form: error.message });
      setGoogleLoading(false);
    }
  }

  // Username status indicator
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
        {/* Wordmark */}
        <h1
          className="font-display text-4xl font-bold text-center mb-2"
          style={{ color: "#FFBF00", textShadow: "0 0 40px rgba(255,191,0,0.4)" }}
        >
          Nexus
        </h1>
        <p className="text-center text-secondary/50 text-sm mb-8">
          Your argument. The world's debate.
        </p>

        <form onSubmit={handleSignUp} noValidate className="space-y-4">
          {/* Display name */}
          <div>
            <input
              type="text"
              placeholder="Your name"
              value={displayName}
              onChange={(e) => { setDisplayName(e.target.value); setErrors(prev => ({ ...prev, displayName: "" })); }}
              onBlur={() => setTouched(prev => ({ ...prev, displayName: true }))}
              className="w-full bg-navy-800 rounded-xl px-4 py-3 text-sm outline-none ring-1 ring-white/10 focus:ring-amber/60 transition placeholder:text-secondary/30"
            />
            {touched.displayName && errors.displayName && (
              <p className="mt-1 text-[12px]" style={{ color: "#FF5A6A" }}>{errors.displayName}</p>
            )}
          </div>

          {/* Username */}
          <div>
            <div className="relative">
              <input
                type="text"
                placeholder="Choose a username"
                value={username}
                onChange={(e) => onUsernameChange(e.target.value)}
                onBlur={onUsernameBlur}
                className="w-full bg-navy-800 rounded-xl px-4 py-3 pr-10 text-sm outline-none ring-1 ring-white/10 focus:ring-amber/60 transition placeholder:text-secondary/30"
              />
              {usernameIndicator}
            </div>
            <p className="mt-1 text-[10px] text-secondary/25">Lowercase letters, numbers, underscores · 3–20 chars</p>
            {(touched.username && errors.username) && (
              <p className="mt-0.5 text-[12px]" style={{ color: "#FF5A6A" }}>{errors.username}</p>
            )}
            {touched.username && !errors.username && usernameStatus === "taken" && (
              <p className="mt-0.5 text-[12px]" style={{ color: "#FF5A6A" }}>Username already taken</p>
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

          {/* Email */}
          <div>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErrors(prev => ({ ...prev, email: "" })); }}
              onBlur={() => setTouched(prev => ({ ...prev, email: true }))}
              autoComplete="email"
              className="w-full bg-navy-800 rounded-xl px-4 py-3 text-sm outline-none ring-1 ring-white/10 focus:ring-amber/60 transition placeholder:text-secondary/30"
            />
            {touched.email && errors.email && (
              <p className="mt-1 text-[12px]" style={{ color: "#FF5A6A" }}>
                {errors.email}{" "}
                {errors.email.includes("already") && (
                  <Link href="/login" className="underline">Sign in</Link>
                )}
              </p>
            )}
          </div>

          {/* Password */}
          <div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrors(prev => ({ ...prev, password: "" })); }}
                onBlur={() => setTouched(prev => ({ ...prev, password: true }))}
                autoComplete="new-password"
                className="w-full bg-navy-800 rounded-xl px-4 py-3 pr-12 text-sm outline-none ring-1 ring-white/10 focus:ring-amber/60 transition placeholder:text-secondary/30"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary/40 hover:text-secondary/70 text-xs select-none"
                tabIndex={-1}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {touched.password && errors.password && (
              <p className="mt-1 text-[12px]" style={{ color: "#FF5A6A" }}>{errors.password}</p>
            )}
          </div>

          {/* Form-level error */}
          {errors.form && (
            <p className="text-[12px]" style={{ color: "#FF5A6A" }}>{errors.form}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || usernameStatus === "checking"}
            className="btn-primary w-full py-3 text-sm font-semibold disabled:opacity-60"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-xs text-secondary/30">or</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Google */}
        <button
          onClick={handleGoogleSignIn}
          disabled={googleLoading}
          className="w-full flex items-center justify-center gap-3 bg-white text-gray-700 rounded-xl px-4 py-3 text-sm font-medium hover:bg-gray-50 transition disabled:opacity-60"
        >
          <GoogleIcon className="w-5 h-5 shrink-0" />
          {googleLoading ? "Redirecting..." : "Continue with Google"}
        </button>

        {/* Sign in link */}
        <p className="mt-6 text-center text-xs text-secondary/40">
          Already have an account?{" "}
          <Link href="/login" className="text-amber hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
