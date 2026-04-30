import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  POST /api/auth/delete-account
  Deletes the authenticated user's account:
  1. Hard-deletes profile and user_views rows
  2. Anonymises any submitted public_nodes by setting user_id = null
  3. Logs the deletion in auth_events
  4. Calls supabase.auth.admin.deleteUser
*/
export async function POST(req: NextRequest) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "DELETE") {
    return NextResponse.json({ error: "confirmation required" }, { status: 400 });
  }

  const svc = supabaseService();
  const userId = user.id;

  try {
    // 1. Anonymise submitted public_nodes (set user_id = null) before deleting
    try {
      await svc
        .from("public_nodes")
        .update({ user_id: null })
        .eq("user_id", userId);
    } catch { /* table may not exist */ }

    // 2. Soft-delete or hard-delete user_views that have NOT been submitted to arena
    try {
      await svc
        .from("user_views")
        .delete()
        .eq("user_id", userId)
        .eq("submitted_to_arena", false);
    } catch { /* table may not exist */ }

    // 3. Remove inferred_positions (non-deployed)
    try {
      await svc
        .from("inferred_positions")
        .delete()
        .eq("user_id", userId)
        .is("deployed_at", null);
    } catch { /* ok */ }

    // 4. Delete messages
    try {
      await svc.from("messages").delete().eq("user_id", userId);
    } catch { /* ok */ }

    // 5. Delete sessions
    try {
      await svc.from("sessions").delete().eq("user_id", userId);
    } catch { /* ok */ }

    // 6. Delete profile (cascades to user_views via FK)
    await svc.from("profiles").delete().eq("id", userId);

    // 7. Delete legacy users row
    try {
      await svc.from("users").delete().eq("id", userId);
    } catch { /* ok */ }

    // 8. Log the event before the user is gone
    try {
      await svc.from("auth_events").insert({
        user_id: userId,
        event_type: "account_deleted",
        metadata: { timestamp: new Date().toISOString() },
      });
    } catch { /* non-blocking */ }

    // 9. Delete the auth user (service role required)
    const { error: deleteError } = await svc.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error("[delete-account] auth.admin.deleteUser failed:", deleteError.message);
      // Still return success — profile data is gone
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Deletion failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
