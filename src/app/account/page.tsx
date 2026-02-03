"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type RecentRoom = {
  roomId: string;
  inviteCode: string;
  name: string;
};

const RECENT_KEY = "aynfrp:recentRooms";
const ACCOUNT_KEY = "aynfrp:accountEmail";

export default function AccountPage() {
  const [email, setEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(ACCOUNT_KEY);
    if (stored) {
      setEmail(stored);
      setConfirmed(true);
    }
    const storedRooms = localStorage.getItem(RECENT_KEY);
    if (storedRooms) {
      setRecentRooms(JSON.parse(storedRooms));
    }
  }, []);

  function sendMagicLink() {
    setLinkSent(true);
  }

  function confirmMagicLink() {
    if (!email.trim()) return;
    localStorage.setItem(ACCOUNT_KEY, email.trim());
    setConfirmed(true);
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-16">
        <header>
          <h1 className="text-3xl font-semibold">Account</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Create an optional account to keep your recent sessions.
          </p>
        </header>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Magic link sign-in</h2>
          <div className="mt-4 flex flex-col gap-3">
            <input
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button
              className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white"
              onClick={sendMagicLink}
            >
              Send magic link
            </button>
            {linkSent ? (
              <button
                className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold"
                onClick={confirmMagicLink}
              >
                Confirm magic link
              </button>
            ) : null}
            {confirmed ? (
              <p className="text-xs text-emerald-600">Account linked to {email}.</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Recent sessions</h2>
          {recentRooms.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">No recent sessions yet.</p>
          ) : (
            <div className="mt-3 space-y-2 text-sm">
              {recentRooms.map((room) => (
                <div key={room.roomId} className="flex items-center justify-between">
                  <span>{room.name}</span>
                  <Link className="text-xs text-zinc-500 underline" href={`/room/${room.roomId}`}>
                    Open
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
