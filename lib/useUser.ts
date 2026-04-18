"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "./supabase/browser";
import type { User } from "@supabase/supabase-js";

// Ensures we always have a Supabase user. Falls back to anonymous sign-in
// so the app is usable from the first tap.
export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let unsub: (() => void) | undefined;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setUser(data.user);
      } else {
        const { data: signed, error } = await supabase.auth.signInAnonymously();
        if (!error && signed.user) setUser(signed.user);
      }
      setReady(true);

      const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
        setUser(session?.user ?? null);
      });
      unsub = () => sub.subscription.unsubscribe();
    })();

    return () => unsub?.();
  }, []);

  return { user, ready };
}
