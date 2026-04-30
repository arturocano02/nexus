"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { GoogleIcon } from "@/components/icons/GoogleIcon";

export default function LoginPage() {
  const router = useRouter();
  const supa = supabaseBrowser();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});

  // Pre-fill email from expired session hint
  useEffect(() => {
    const hint = sessionStorage.getItem("nexus_email_hint");
    if (hint) {
      setEmail(hint);
      sessionStorage.removeItem("nexus_email_hint");
    }
  }, []);

  function validate() {
    const e: typeof errors = {};
    if (!email.trim()) e.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Enter a valid email";
    if (!password) e.password = "Password is required";
    return e;
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setLoading(true);
    setErrors({});

    // If "remember me" is unchecked, mark session as non-persistent
    if (!rememberMe) sessionStorage.setItem("nexus_session_tab_only", "1");
    else sessionStorage.removeItem("nexus_session_tab_only");

    const { error } = await supa.auth.signInWithPassword({ email, password });

    if (error) {
      setErrors({ form: error.message });
      setLoading(false);
      return;
    }

    // Log auth event (best-effort)
    try {
      const { data: { user } } = await supa.auth.getUser();
      if (user) {
        await fetch("/api/auth/log-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_type: "login", metadata: { provider: "email" } }),
        });
      }
    } catch { /* non-blocking */ }

    router.push("/your-view");
  }

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

  async function handleForgotPassword() {
    if (!email.trim()) {
      setErrors({ email: "Enter your email first to reset password" });
      return;
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
    const { error } = await supa.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl}/login`,
    });
    if (error) {
      setErrors({ form: error.message });
    } else {
      setErrors({ form: undefined });
      alert("Password reset email sent — check your inbox.");
    }
  }

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

        <form onSubmit={handleSignIn} noValidate className="space-y-4">
          {/* Email */}
          <div>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErrors(prev => ({ ...prev, email: undefined })); }}
              autoComplete="email"
              className="w-full bg-navy-800 rounded-xl px-4 py-3 text-sm outline-none ring-1 ring-white/10 focus:ring-amber/60 transition placeholder:text-secondary/30"
            />
            {errors.email && (
              <p className="mt-1 text-[12px]" style={{ color: "#FF5A6A" }}>{errors.email}</p>
            )}
            <button
              type="button"
              onClick={handleForgotPassword}
              className="mt-1.5 text-[11px] text-secondary/40 hover:text-secondary/70 transition"
            >
              Forgot password?
            </button>
          </div>

          {/* Password */}
          <div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrors(prev => ({ ...prev, password: undefined })); }}
                autoComplete="current-password"
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
            {errors.password && (
              <p className="mt-1 text-[12px]" style={{ color: "#FF5A6A" }}>{errors.password}</p>
            )}
          </div>

          {/* Remember me */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="w-4 h-4 rounded accent-amber"
            />
            <span className="text-xs text-secondary/50">Remember me</span>
          </label>

          {/* Form error */}
          {errors.form && (
            <p className="text-[12px]" style={{ color: "#FF5A6A" }}>{errors.form}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3 text-sm font-semibold disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
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

        {/* Sign up link */}
        <p className="mt-6 text-center text-xs text-secondary/40">
          Don't have an account?{" "}
          <Link href="/signup" className="text-amber hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
