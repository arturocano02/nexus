"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "./supabase/browser";
import { useUserStore } from "./stores/userStore";
import type { User } from "@supabase/supabase-js";

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const { setProfile, setLoadingProfile, clearProfile } = useUserStore();

  useEffect(() => {
    const supabase = supabaseBrowser();
    let unsub: (() => void) | undefined;

    (async () => {
      // Try to restore from existing session first
      const { data: sessionData } = await supabase.auth.getSession();

      if (sessionData.session?.user) {
        setUser(sessionData.session.user);
        await fetchProfile(sessionData.session.user.id, supabase, setProfile, setLoadingProfile);
      } else {
        // Try silent refresh; if expired pre-fill email hint is handled in /login
        const { data: refreshed } = await supabase.auth.refreshSession();
        if (refreshed.session?.user) {
          setUser(refreshed.session.user);
          await fetchProfile(refreshed.session.user.id, supabase, setProfile, setLoadingProfile);
        } else {
          clearProfile();
        }
      }

      setReady(true);

      const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchProfile(session.user.id, supabase, setProfile, setLoadingProfile);
        } else {
          clearProfile();
        }
      });

      unsub = () => sub.subscription.unsubscribe();
    })();

    return () => unsub?.();
  }, []);

  return { user, ready };
}

async function fetchProfile(
  userId: string,
  supabase: ReturnType<typeof supabaseBrowser>,
  setProfile: ReturnType<typeof useUserStore.getState>["setProfile"],
  setLoadingProfile: ReturnType<typeof useUserStore.getState>["setLoadingProfile"],
) {
  setLoadingProfile(true);
  try {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    setProfile(data ?? null);
  } catch {
    setProfile(null);
  }
}
