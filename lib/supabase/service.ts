import { createClient } from "@supabase/supabase-js";

// Service-role client. Server-only. Used by debate engine + submit flow
// when we need to bypass RLS to mutate public_nodes / agents / manifesto.
export function supabaseService() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
