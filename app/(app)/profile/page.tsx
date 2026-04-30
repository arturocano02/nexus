"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";
import { useUserStore } from "@/lib/stores/userStore";
import type { UserView } from "@/lib/types";

// -----------------------------------------------------------------------
// Country list (abbreviated for brevity — top countries)
// -----------------------------------------------------------------------
const COUNTRIES = [
  "Afghanistan","Albania","Algeria","Argentina","Australia","Austria","Belgium",
  "Brazil","Canada","Chile","China","Colombia","Croatia","Czech Republic","Denmark",
  "Egypt","Finland","France","Germany","Greece","Hungary","India","Indonesia","Iran",
  "Iraq","Ireland","Israel","Italy","Japan","Jordan","Kenya","South Korea","Malaysia",
  "Mexico","Morocco","Netherlands","New Zealand","Nigeria","Norway","Pakistan","Peru",
  "Philippines","Poland","Portugal","Romania","Russia","Saudi Arabia","South Africa",
  "Spain","Sweden","Switzerland","Taiwan","Thailand","Turkey","Ukraine","United Arab Emirates",
  "United Kingdom","United States","Venezuela","Vietnam","Other",
];

const STANCE_COLOR: Record<string, string> = {
  yes: "#00DCFF",
  no: "#FF5A6A",
  abstain: "#888780",
  unclear: "#FFBF00",
};

export default function ProfilePage() {
  const { user, ready } = useUser();
  const { profile, setProfile } = useUserStore();
  const router = useRouter();
  const supa = supabaseBrowser();
  const fileRef = useRef<HTMLInputElement>(null);

  // Profile fields
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [country, setCountry] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Submitted arguments (legacy inferred_positions)
  const [arguments_, setArguments] = useState<SubmittedArgument[]>([]);
  const [loadingArgs, setLoadingArgs] = useState(false);

  // User views
  const [userViews, setUserViews] = useState<UserView[]>([]);
  const [loadingViews, setLoadingViews] = useState(false);
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [editingViewText, setEditingViewText] = useState("");

  // Toast + delete confirm
  const [toast, setToast] = useState<{ msg: string; action?: () => void; actionLabel?: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

  // Pending soft-delete (with undo window)
  const pendingDeleteRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -----------------------------------------------------------------------
  // Load profile data
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? "");
    setUsername(profile.username ?? "");
    setCountry(profile.country ?? "");
    setAvatarUrl(profile.avatar_url ?? null);
  }, [profile]);

  // -----------------------------------------------------------------------
  // Load submitted arguments
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoadingArgs(true);
      try {
        const { data: positions } = await supa
          .from("inferred_positions")
          .select("id, category_id, subtopic_id, stance, arguments_json, deployed_at, retracted_at")
          .eq("user_id", user.id)
          .not("deployed_at", "is", null)
          .order("deployed_at", { ascending: false });

        if (positions && positions.length > 0) {
          const catIds = [...new Set(positions.map((p: any) => p.category_id).filter(Boolean))];
          const subIds = [...new Set(positions.map((p: any) => p.subtopic_id).filter(Boolean))];
          const [{ data: cats }, { data: subs }] = await Promise.all([
            supa.from("taxonomy_categories").select("id, name").in("id", catIds),
            supa.from("taxonomy_subtopics").select("id, name, latent_question_text").in("id", subIds),
          ]);
          const catMap = new Map((cats ?? []).map((c: any) => [c.id, c.name]));
          const subMap = new Map((subs ?? []).map((s: any) => [s.id, s]));
          const rows: SubmittedArgument[] = positions
            .filter((p: any) => p.subtopic_id)
            .map((p: any) => {
              const sub = subMap.get(p.subtopic_id) as any;
              return {
                id: p.id,
                category_name: catMap.get(p.category_id) ?? "Unknown",
                subtopic_name: sub?.name ?? "Unknown",
                question_text: sub?.latent_question_text ?? sub?.name ?? "Unknown",
                stance: p.stance ?? "unclear",
                argument: Array.isArray(p.arguments_json) && p.arguments_json.length > 0
                  ? p.arguments_json[0].text ?? "" : "",
                deployed_at: p.deployed_at,
                retracted_at: p.retracted_at,
              };
            });
          setArguments(rows);
        }
      } catch { /* ok */ }
      setLoadingArgs(false);
    })();
  }, [user]);

  // -----------------------------------------------------------------------
  // Load user_views
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoadingViews(true);
      try {
        const { data } = await supa
          .from("user_views")
          .select("*")
          .eq("user_id", user.id)
          .eq("is_deleted", false)
          .order("updated_at", { ascending: false });
        if (data) setUserViews(data as UserView[]);
      } catch { /* table may not exist yet */ }
      setLoadingViews(false);
    })();
  }, [user]);

  // -----------------------------------------------------------------------
  // Save profile
  // -----------------------------------------------------------------------
  async function saveProfile() {
    if (!user || !profile) return;
    setSaving(true);
    const updates = {
      display_name: displayName.trim(),
      username: username.trim().toLowerCase(),
      country: country || null,
      avatar_url: avatarUrl,
    };
    const { data: updated, error } = await supa
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select()
      .maybeSingle();

    if (error) {
      showToast(error.message.includes("unique") ? "Username already taken" : "Save failed");
    } else {
      if (updated) setProfile(updated);
      // Sync legacy users table
      try { await supa.from("users").upsert({ id: user.id, username: updates.username, avatar_url: avatarUrl }); } catch { /* ok */ }
      showToast("Profile saved");
    }
    setSaving(false);
  }

  // -----------------------------------------------------------------------
  // Avatar upload
  // -----------------------------------------------------------------------
  async function onAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    if (!user || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${user.id}/avatar.${ext}`;
    const { error } = await supa.storage.from("avatars").upload(path, file, { upsert: true });
    if (!error) {
      const { data } = supa.storage.from("avatars").getPublicUrl(path);
      setAvatarUrl(data.publicUrl + `?t=${Date.now()}`);
    } else {
      showToast("Avatar upload failed — ensure the 'avatars' bucket exists in Supabase Storage");
    }
  }

  // -----------------------------------------------------------------------
  // Retract / restore argument
  // -----------------------------------------------------------------------
  async function retract(id: string, currentlyRetracted: boolean) {
    try {
      const res = await fetch("/api/retract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position_id: id, retract: !currentlyRetracted }),
      });
      if (res.ok) {
        setArguments(prev =>
          prev.map(a => a.id === id
            ? { ...a, retracted_at: !currentlyRetracted ? new Date().toISOString() : null }
            : a
          )
        );
        showToast(!currentlyRetracted ? "Retracted from future tallies" : "Restored to collective");
      }
    } catch { /* ignore */ }
  }

  // -----------------------------------------------------------------------
  // User view: edit summary
  // -----------------------------------------------------------------------
  function startEditView(view: UserView) {
    if (view.submitted_to_arena) return;
    setEditingViewId(view.id);
    setEditingViewText(view.summary);
  }

  async function saveViewSummary(viewId: string) {
    const { data: updated } = await supa
      .from("user_views")
      .update({ summary: editingViewText })
      .eq("id", viewId)
      .select()
      .maybeSingle();
    if (updated) {
      setUserViews(prev => prev.map(v => v.id === viewId ? { ...v, summary: editingViewText } : v));
    }
    setEditingViewId(null);
  }

  // -----------------------------------------------------------------------
  // User view: soft-delete with undo
  // -----------------------------------------------------------------------
  function requestDeleteView(viewId: string) {
    showToast("Remove this view? This cannot be undone.", () => {
      commitDeleteView(viewId);
    }, "Remove");

    // Mark as visually deleted immediately; revert on undo
    setUserViews(prev => prev.map(v => v.id === viewId ? { ...v, _pendingDelete: true } as any : v));

    pendingDeleteRef.current = setTimeout(() => {
      commitDeleteView(viewId);
    }, 4000);
  }

  async function commitDeleteView(viewId: string) {
    if (pendingDeleteRef.current) clearTimeout(pendingDeleteRef.current);
    await supa.from("user_views").update({ is_deleted: true }).eq("id", viewId);
    setUserViews(prev => prev.filter(v => v.id !== viewId));
  }

  function undoDeleteView(viewId: string) {
    if (pendingDeleteRef.current) clearTimeout(pendingDeleteRef.current);
    setUserViews(prev => prev.map(v => v.id === viewId ? { ...v, _pendingDelete: false } as any : v));
    setToast(null);
  }

  // -----------------------------------------------------------------------
  // Toast helper
  // -----------------------------------------------------------------------
  function showToast(msg: string, action?: () => void, actionLabel?: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, action, actionLabel });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      action?.(); // commit pending action after timeout
    }, 4000);
  }

  // -----------------------------------------------------------------------
  // Danger zone: change password
  // -----------------------------------------------------------------------
  async function handleChangePassword() {
    if (!user?.email) return;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
    await supa.auth.resetPasswordForEmail(user.email, { redirectTo: `${appUrl}/login` });
    showToast("Password reset email sent");
    logEvent("password_reset_requested");
  }

  // -----------------------------------------------------------------------
  // Danger zone: delete account
  // -----------------------------------------------------------------------
  async function handleDeleteAccount() {
    if (deleteConfirmText !== "DELETE") return;
    setDeletingAccount(true);

    logEvent("account_deletion_initiated");

    const res = await fetch("/api/auth/delete-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "DELETE" }),
    });

    if (res.ok) {
      await supa.auth.signOut();
      router.replace("/login");
    } else {
      const { error } = await res.json();
      showToast(error ?? "Deletion failed");
      setDeletingAccount(false);
    }
  }

  function logEvent(event_type: string) {
    fetch("/api/auth/log-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type }),
    }).catch(() => { /* non-blocking */ });
  }

  async function handleSignOut() {
    logEvent("logout");
    await supa.auth.signOut();
    router.replace("/login");
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  if (!ready) return null;

  const activeArgs = arguments_.filter(a => !a.retracted_at);
  const retractedArgs = arguments_.filter(a => !!a.retracted_at);

  // Group user_views by topic_label
  const viewsByTopic = userViews.reduce<Record<string, UserView[]>>((acc, v) => {
    if (!(v as any)._pendingDelete) {
      acc[v.topic_label] = [...(acc[v.topic_label] ?? []), v];
    }
    return acc;
  }, {});

  return (
    <main className="min-h-dvh pb-28 pt-10 px-4">
      <div className="mx-auto max-w-xl">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-3xl font-semibold">Profile</h1>
          <button
            onClick={handleSignOut}
            className="text-xs text-secondary/40 hover:text-secondary/70 transition"
          >
            Sign out
          </button>
        </div>
        <p className="text-secondary/60 mt-1">How you appear in the Arena.</p>

        {/* ----------------------------------------------------------------
            Profile section
        ---------------------------------------------------------------- */}
        <section className="card p-5 mt-6">
          <h2 className="font-display text-base font-semibold mb-4">Account</h2>

          {/* Avatar */}
          <div className="flex items-center gap-4 mb-5">
            <button
              onClick={() => fileRef.current?.click()}
              className="w-16 h-16 rounded-full bg-navy-700 ring-1 ring-white/10 overflow-hidden flex items-center justify-center text-secondary/40 hover:ring-amber/40 transition shrink-0"
              title="Change avatar"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xl">{(displayName || username || "?").slice(0, 1).toUpperCase()}</span>
              )}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onAvatar} />
            <p className="text-xs text-secondary/40">Tap to change avatar</p>
          </div>

          {/* Display name */}
          <div className="mb-3">
            <label className="block text-[10px] uppercase tracking-widest font-bold text-secondary/30 mb-1">
              Display name
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="w-full bg-navy-800 rounded-xl px-4 py-2.5 text-sm outline-none ring-1 ring-white/5 focus:ring-amber/60 transition placeholder:text-secondary/30"
            />
          </div>

          {/* Username */}
          <div className="mb-3">
            <label className="block text-[10px] uppercase tracking-widest font-bold text-secondary/30 mb-1">
              Username
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              className="w-full bg-navy-800 rounded-xl px-4 py-2.5 text-sm outline-none ring-1 ring-white/5 focus:ring-amber/60 transition placeholder:text-secondary/30"
            />
          </div>

          {/* Country */}
          <div className="mb-5">
            <label className="block text-[10px] uppercase tracking-widest font-bold text-secondary/30 mb-1">
              Country
            </label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full bg-navy-800 rounded-xl px-4 py-2.5 text-sm outline-none ring-1 ring-white/5 focus:ring-amber/60 transition text-secondary/80"
            >
              <option value="">Select country</option>
              {COUNTRIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <button className="btn-primary" onClick={saveProfile} disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </button>
        </section>

        {/* ----------------------------------------------------------------
            Your views section
        ---------------------------------------------------------------- */}
        <section className="mt-8">
          <h2 className="font-display text-xl font-semibold">Your views</h2>
          <p className="text-secondary/50 text-sm mt-1">
            The positions extracted from your conversations. Edit or remove views you haven't submitted yet.
          </p>

          <div className="mt-4 space-y-2">
            {loadingViews && (
              <p className="text-secondary/30 text-sm animate-pulse">Loading views...</p>
            )}
            {!loadingViews && Object.keys(viewsByTopic).length === 0 && (
              <div className="card p-5 text-center">
                <p className="text-secondary/40 text-sm">No views yet.</p>
                <p className="text-secondary/25 text-xs mt-1">
                  Have a conversation on Your View to start building your political map.
                </p>
              </div>
            )}
            {Object.entries(viewsByTopic).map(([topic, views]) => (
              <div key={topic} className="card p-4 space-y-3">
                <p className="text-[9px] font-bold tracking-[0.3em] uppercase text-amber/60">{topic}</p>
                {views.map(view => (
                  <ViewRow
                    key={view.id}
                    view={view}
                    editingId={editingViewId}
                    editingText={editingViewText}
                    onEditStart={() => startEditView(view)}
                    onEditTextChange={setEditingViewText}
                    onEditSave={() => saveViewSummary(view.id)}
                    onEditCancel={() => setEditingViewId(null)}
                    onDelete={() => requestDeleteView(view.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* ----------------------------------------------------------------
            Submitted arguments (legacy)
        ---------------------------------------------------------------- */}
        <section className="mt-8">
          <h2 className="font-display text-xl font-semibold">Submitted arguments</h2>
          <p className="text-secondary/50 text-sm mt-1">
            Retracting removes your weight from future tallies.
          </p>
          <div className="mt-4 space-y-3">
            {loadingArgs && <p className="text-secondary/30 text-sm animate-pulse">Loading...</p>}
            {!loadingArgs && arguments_.length === 0 && (
              <div className="card p-5 text-center">
                <p className="text-secondary/40 text-sm">Nothing submitted yet.</p>
              </div>
            )}
            {activeArgs.map(arg => (
              <ArgumentCard key={arg.id} arg={arg} onRetract={() => retract(arg.id, false)} />
            ))}
            {retractedArgs.length > 0 && (
              <div className="mt-6">
                <p className="text-[9px] uppercase tracking-[0.3em] text-secondary/25 font-bold mb-3">Retracted</p>
                {retractedArgs.map(arg => (
                  <ArgumentCard key={arg.id} arg={arg} retracted onRetract={() => retract(arg.id, true)} />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ----------------------------------------------------------------
            Danger zone
        ---------------------------------------------------------------- */}
        <section className="mt-8">
          <h2 className="font-display text-xl font-semibold">Danger zone</h2>
          <div className="card p-4 mt-2 space-y-3">
            {/* Change password */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Change password</p>
                <p className="text-xs text-secondary/50 mt-0.5">We'll email you a reset link.</p>
              </div>
              <button onClick={handleChangePassword} className="text-sm text-secondary/50 hover:text-secondary transition">
                Send link
              </button>
            </div>

            <div className="border-t border-white/5" />

            {/* Delete account */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Delete account</p>
                <p className="text-xs text-secondary/50 mt-0.5 max-w-xs">
                  Removes your profile and all unsubmitted views. Submitted views remain anonymised.
                </p>
              </div>
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-sm hover:underline transition"
                style={{ color: "rgba(255,90,106,0.7)" }}
              >
                Delete
              </button>
            </div>
          </div>
        </section>

        <section className="mt-6 text-xs text-secondary/40 space-y-1">
          <p>Privacy policy · coming soon</p>
          <p>Terms of service · coming soon</p>
        </section>
      </div>

      {/* ----------------------------------------------------------------
          Delete account modal
      ---------------------------------------------------------------- */}
      <AnimatePresence>
        {confirmDelete && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/70"
              onClick={() => !deletingAccount && setConfirmDelete(false)}
            />
            <motion.div
              initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }}
              className="fixed inset-x-4 top-1/4 z-50 mx-auto max-w-md"
            >
              <div className="glass rounded-3xl p-6 shadow-card">
                <h3 className="font-display text-lg font-semibold">Delete account?</h3>
                <p className="text-sm text-secondary/70 mt-2 leading-relaxed">
                  This will permanently delete your account, profile, and all views that have not been submitted to the arena.
                  Submitted views will remain anonymised in the arena.
                </p>
                <p className="text-sm text-secondary/70 mt-2">
                  Type <span className="font-mono text-secondary/90">DELETE</span> to confirm.
                </p>
                <input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  className="mt-3 w-full bg-navy-800 rounded-xl px-4 py-2.5 text-sm outline-none ring-1 ring-white/10 focus:ring-red-500/60 transition font-mono placeholder:text-secondary/20"
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    className="btn-outline"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deletingAccount}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirmText !== "DELETE" || deletingAccount}
                    className="px-4 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-40"
                    style={{ background: "rgba(255,90,106,0.2)", color: "#FF5A6A", border: "1px solid rgba(255,90,106,0.3)" }}
                  >
                    {deletingAccount ? "Deleting..." : "Yes, delete everything"}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
            className="fixed bottom-28 left-1/2 -translate-x-1/2 z-40 glass rounded-pill px-4 py-2 text-sm flex items-center gap-3"
          >
            <span>{toast.msg}</span>
            {toast.action && toast.actionLabel && (
              <button
                onClick={() => {
                  if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
                  setToast(null);
                  toast.action!();
                }}
                className="text-amber text-xs font-bold"
              >
                {toast.actionLabel}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

// -----------------------------------------------------------------------
// UserView row component
// -----------------------------------------------------------------------
function ViewRow({
  view,
  editingId,
  editingText,
  onEditStart,
  onEditTextChange,
  onEditSave,
  onEditCancel,
  onDelete,
}: {
  view: UserView;
  editingId: string | null;
  editingText: string;
  onEditStart: () => void;
  onEditTextChange: (t: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onDelete: () => void;
}) {
  const isEditing = editingId === view.id;
  const confidencePct = Math.round(view.confidence_score * 100);

  return (
    <div className="space-y-2">
      {/* Summary */}
      {isEditing ? (
        <textarea
          value={editingText}
          onChange={(e) => onEditTextChange(e.target.value)}
          onBlur={onEditSave}
          autoFocus
          rows={2}
          className="w-full bg-navy-800 rounded-lg px-3 py-2 text-sm outline-none ring-1 ring-amber/40 resize-none"
        />
      ) : (
        <p className="text-sm text-secondary/70 leading-snug line-clamp-2">
          {view.summary || <span className="text-secondary/30 italic">No summary yet</span>}
        </p>
      )}

      {/* Confidence bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${confidencePct}%`,
              background: confidencePct > 70 ? "#FFBF00" : confidencePct > 40 ? "#888780" : "#6868a0",
            }}
          />
        </div>
        <span className="text-[10px] text-secondary/30 shrink-0">{confidencePct}%</span>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        {view.submitted_to_arena ? (
          <div className="flex items-center gap-1.5">
            <span className="text-amber text-[10px]">🔒</span>
            <span className="text-[10px] text-secondary/30">submitted · read only</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {!isEditing && (
              <button onClick={onEditStart} className="text-[10px] text-secondary/40 hover:text-secondary/70 transition">
                Edit
              </button>
            )}
            {isEditing && (
              <button onClick={onEditCancel} className="text-[10px] text-secondary/40 hover:text-secondary/70 transition">
                Cancel
              </button>
            )}
            <button
              onClick={onDelete}
              className="text-[10px] hover:underline transition"
              style={{ color: "rgba(255,90,106,0.5)" }}
            >
              Remove
            </button>
          </div>
        )}
        {view.submitted_to_arena && (
          <p className="text-[9px] text-secondary/25">
            To remove from arena, contact support.
          </p>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Submitted argument card (unchanged from original)
// -----------------------------------------------------------------------
interface SubmittedArgument {
  id: string;
  category_name: string;
  subtopic_name: string;
  question_text: string;
  stance: "yes" | "no" | "abstain" | "unclear";
  argument: string;
  deployed_at: string;
  retracted_at: string | null;
}

function ArgumentCard({
  arg,
  retracted = false,
  onRetract,
}: {
  arg: SubmittedArgument;
  retracted?: boolean;
  onRetract: () => void;
}) {
  const color = STANCE_COLOR[arg.stance] ?? "#888";
  return (
    <div className={`card p-4 space-y-2 ${retracted ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-amber/60">{arg.category_name}</span>
          <span className="text-secondary/20 text-[9px]">›</span>
          <span className="text-[9px] tracking-[0.15em] uppercase text-secondary/35">{arg.subtopic_name}</span>
        </div>
        <span
          className="text-[10px] font-bold tracking-[0.15em] px-2.5 py-1 rounded-full shrink-0"
          style={{ color, background: color + "18", border: `1px solid ${color}33` }}
        >
          {arg.stance.toUpperCase()}
        </span>
      </div>
      <p className={`text-sm leading-snug ${retracted ? "line-through text-secondary/30" : "text-secondary/80"}`}>
        {arg.question_text}
      </p>
      {arg.argument && (
        <p className="text-xs text-secondary/45 leading-relaxed pl-3 border-l border-white/10">{arg.argument}</p>
      )}
      <div className="flex justify-end pt-1">
        <button
          onClick={onRetract}
          className="text-[9px] uppercase tracking-widest font-bold transition-colors"
          style={{ color: retracted ? "rgba(34,197,94,0.6)" : "rgba(255,90,106,0.5)" }}
        >
          {retracted ? "Restore" : "Retract"}
        </button>
      </div>
    </div>
  );
}
