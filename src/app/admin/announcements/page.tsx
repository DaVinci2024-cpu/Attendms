"use client";

import { useEffect, useState } from "react";
import { Loader2, Megaphone, Send, Trash2 } from "lucide-react";
import { RequireAdmin, usePermissions } from "@/components/RequireAdmin";
import {
  deleteAnnouncement,
  fetchAnnouncements,
  postAnnouncement,
} from "@/lib/firestoreRepo";
import type { Announcement } from "@/lib/types";

export default function AdminAnnouncementsPage() {
  return (
    <RequireAdmin>
      <AnnouncementsManager />
    </RequireAdmin>
  );
}

function AnnouncementsManager() {
  const { has, uid, email } = usePermissions();
  const canPost = has("manage_announcements");
  const posterName = email ?? uid;

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const list = await fetchAnnouncements();
        if (!cancelled) setAnnouncements(list);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load announcements");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handlePost() {
    const trimmed = message.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    try {
      const announcement: Announcement = {
        announcementId: `ann_${crypto.randomUUID()}`,
        message: trimmed,
        postedBy: uid,
        postedByName: posterName,
        postedAt: new Date().toISOString(),
      };
      await postAnnouncement(announcement);
      setAnnouncements((prev) => [announcement, ...prev]);
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post announcement");
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(announcementId: string) {
    if (!window.confirm("Delete this announcement? Employees will no longer see it.")) {
      return;
    }
    try {
      await deleteAnnouncement(announcementId);
      setAnnouncements((prev) => prev.filter((a) => a.announcementId !== announcementId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete announcement");
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Announcements</h1>
        <p className="text-sm text-neutral-400">
          Posted here shows up in every employee&apos;s portal, newest first.
        </p>
      </div>

      {!canPost && (
        <p className="rounded-lg bg-neutral-900 px-3 py-2 text-sm text-neutral-400">
          You have read-only access to announcements.
        </p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {canPost && (
        <div className="flex flex-col gap-2 rounded-xl bg-neutral-900 p-4">
          <textarea
            className="min-h-20 rounded-lg bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-600"
            placeholder="e.g. Staff meeting Friday at 3pm"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button
            type="button"
            onClick={handlePost}
            disabled={sending || !message.trim()}
            className="flex items-center justify-center gap-2 self-end rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Post
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : announcements.length === 0 ? (
        <p className="text-sm text-neutral-500">No announcements posted yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {announcements.map((a) => (
            <div
              key={a.announcementId}
              className="flex items-start gap-3 rounded-xl bg-neutral-900 p-4"
            >
              <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div className="flex-1">
                <p className="text-sm">{a.message}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {a.postedByName} · {new Date(a.postedAt).toLocaleString()}
                </p>
              </div>
              {canPost && (
                <button
                  type="button"
                  onClick={() => handleDelete(a.announcementId)}
                  className="text-neutral-500 hover:text-red-400"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
