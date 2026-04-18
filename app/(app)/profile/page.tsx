"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useUser } from "@/lib/useUser";
import HelpButton from "@/components/HelpButton";

interface SubmittedRow {
  id: string;
  topic_label: string;
  summary: string;
  public_node_id: string | null;
  is_active: boolean;
}

export default function ProfilePage() {
  const { user, ready } = useUser();
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [submitted, setSubmitted] = useState<SubmittedRow[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    const supa = supabaseBrowser();
    (async () => {
      const { data: u } = await supa.from("users").select("*").eq("id", user.id).maybeSingle();
      if (u) {
        setUsername(u.username ?? "");
        setAvatarUrl(u.avatar_url ?? null);
        setIsPublic(!!u.is_public);
      }
      const { data: rows } = await supa
        .from("agents")
        .select("id, is_active, public_node_id, argument_set")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (rows) {
        setSubmitted(
          rows.map((r: any) => ({
            id: r.id,
            is_active: r.is_active,
            public_node_id: r.public_node_id,
            topic_label: r.argument_set?.topic_label ?? "(untitled)",
            summary: r.argument_set?.text ?? "",
          })),
        );
      }
    })();
  }, [user]);

  async function save() {
    if (!user) return;
    setSaving(true);
    const supa = supabaseBrowser();
    const { error } = await supa
      .from("users")
      .upsert({ id: user.id, username: username || null, avatar_url: avatarUrl, is_public: isPublic });
    setSaving(false);
    setToast(error ? "Save failed" : "Saved");
    setTimeout(() => setToast(null), 1600);
  }

  async function onAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    if (!user || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    const supa = supabaseBrowser();
    const path = `${user.id}/${Date.now()}-${file.name}`;
    const { error } = await supa.storage.from("avatars").upload(path, file, { upsert: true });
    if (!error) {
      const { data } = supa.storage.from("avatars").getPublicUrl(path);
      setAvatarUrl(data.publicUrl);
    } else {
      setToast("Create a public 'avatars' bucket in Supabase Storage first.");
      setTimeout(() => setToast(null), 2400);
    }
  }

  async function retract(id: string) {
    const supa = supabaseBrowser();
    await supa.from("agents").update({ is_active: false }).eq("id", id);
    setSubmitted((prev) => prev.map((r) => (r.id === id ? { ...r, is_active: false } : r)));
  }

  async function exportData() {
    if (!user) return;
    const supa = supabaseBrowser();
    const [{ data: u }, { data: pa }, { data: ag }] = await Promise.all([
      supa.from("users").select("*").eq("id", user.id).maybeSingle(),
      supa.from("personal_arguments").select("*").eq("user_id", user.id),
      supa.from("agents").select("*").eq("user_id", user.id),
    ]);
    const blob = new Blob([JSON.stringify({ user: u, personal_arguments: pa, agents: ag }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nexus-export-${user.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deleteAccount() {
    if (!user) return;
    const supa = supabaseBrowser();
    // Delete cascades from public.users to personal_arguments + agents via schema.
    await supa.from("users").delete().eq("id", user.id);
    await supa.auth.signOut();
    window.location.href = "/";
  }

  return (
    <main className="min-h-dvh pb-28 pt-10 px-4">
      <div className="mx-auto max-w-xl">
        <h1 className="font-display text-3xl font-semibold">Profile</h1>
        <p className="text-secondary/60 mt-1">How you appear in the Arena.</p>

        <section className="card p-5 mt-6">
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-full bg-navy-700 ring-1 ring-white/10 overflow-hidden flex items-center justify-center text-secondary/40"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span>{(username || "?").slice(0, 1).toUpperCase()}</span>
              )}
            </div>
            <div className="flex-1">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                className="w-full bg-navy-800 rounded-pill px-4 py-2 outline-none ring-1 ring-white/5 focus:ring-amber/60"
              />
              <div className="mt-2 flex gap-2">
                <button className="btn-outline text-sm" onClick={() => fileRef.current?.click()}>Upload avatar</button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onAvatar} />
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <div>
              <p className="font-medium">{isPublic ? "Public" : "Anonymous"}</p>
              <p className="text-xs text-secondary/60 mt-1 max-w-sm">
                {isPublic
                  ? "Your username and avatar appear next to your arguments in the debate log."
                  : "Your arguments appear as a generated codename. Nothing links them to your identity."}
              </p>
            </div>
            <button
              onClick={() => setIsPublic((v) => !v)}
              className={`relative w-12 h-6 rounded-pill transition ${isPublic ? "bg-amber" : "bg-navy-700"}`}
              aria-label="toggle public"
            >
              <motion.span
                animate={{ x: isPublic ? 24 : 2 }}
                className="absolute top-0.5 w-5 h-5 bg-secondary rounded-full"
              />
            </button>
          </div>

          <div className="mt-5 flex gap-2">
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button className="btn-outline" onClick={exportData}>Export data</button>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="font-display text-xl font-semibold">Submitted arguments</h2>
          <p className="text-secondary/60 text-sm">
            Retracting removes a point from future debates but preserves the existing consensus it shaped.
          </p>
          <div className="mt-3 space-y-3">
            {submitted.length === 0 && <p className="text-secondary/50 text-sm">Nothing submitted yet.</p>}
            {submitted.map((r) => (
              <div key={r.id} className="card p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-widest text-amber/80">{r.topic_label}</span>
                  {r.is_active ? (
                    <button className="btn-ghost text-xs" onClick={() => retract(r.id)}>Retract</button>
                  ) : (
                    <span className="text-xs text-secondary/40">Retracted</span>
                  )}
                </div>
                <p className={`mt-2 text-sm ${r.is_active ? "text-secondary/85" : "text-secondary/40 line-through"}`}>
                  {r.summary}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="font-display text-xl font-semibold">Danger zone</h2>
          <div className="card p-4 mt-2 flex items-center justify-between">
            <div>
              <p className="font-medium">Delete account</p>
              <p className="text-xs text-secondary/60">Wipes your profile, personal view, and retracts all arguments.</p>
            </div>
            <button onClick={() => setConfirmDelete(true)} className="text-cyan hover:underline text-sm">
              Delete
            </button>
          </div>
        </section>

        <section className="mt-6 text-xs text-secondary/40 space-y-1">
          <p>Privacy policy . coming soon.</p>
          <p>Terms of service . coming soon.</p>
        </section>
      </div>

      <AnimatePresence>
        {confirmDelete && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60"
              onClick={() => setConfirmDelete(false)}
            />
            <motion.div
              initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }}
              className="fixed inset-x-4 top-1/3 z-50 mx-auto max-w-md"
            >
              <div className="glass rounded-3xl p-6 shadow-card">
                <h3 className="font-display text-lg">Delete account?</h3>
                <p className="text-sm text-secondary/70 mt-1">This cannot be undone.</p>
                <div className="mt-4 flex justify-end gap-2">
                  <button className="btn-outline" onClick={() => setConfirmDelete(false)}>Cancel</button>
                  <button className="btn-primary" onClick={deleteAccount}>Yes, delete</button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
            className="fixed bottom-28 left-1/2 -translate-x-1/2 z-40 glass rounded-pill px-4 py-2 text-sm"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Consistent legend access across all screens. */}
      <HelpButton corner="bottom-right" />
    </main>
  );
}
