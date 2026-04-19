import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/*
  Next 15+ made `cookies()` async (returns a Promise). This helper must be
  awaited at every call site: `const supa = await supabaseServer()`.

  Using getAll/setAll instead of the legacy get/set because `@supabase/ssr`
  >= 0.5 forwards those directly to the cookie store and avoids the
  "cookieStore.get is not a function" error that happens when the store
  hasn't been unwrapped yet.
*/
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component or other read-only context.
            // Route handlers can set cookies; components can't. Safe to ignore.
          }
        },
      },
    },
  );
}
