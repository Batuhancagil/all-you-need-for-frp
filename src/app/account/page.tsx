"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";

type RecentRoom = {
  roomId: string;
  inviteCode: string;
  name: string;
};

const RECENT_KEY = "aynfrp:recentRooms";

export default function AccountPage() {
  const { data: session, status } = useSession();
  const [recentRooms] = useState<RecentRoom[]>(() => {
    if (typeof window === "undefined") return [];
    const storedRooms = localStorage.getItem(RECENT_KEY);
    if (!storedRooms) return [];
    try {
      return JSON.parse(storedRooms) as RecentRoom[];
    } catch {
      return [];
    }
  });

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-16">
        <header>
          <h1 className="text-3xl font-semibold">Account</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Manage your sign-in and quick links.
          </p>
        </header>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Google sign-in</h2>
          <div className="mt-4 flex flex-col gap-3">
            {status !== "authenticated" ? (
              <button
                className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white"
                onClick={() => signIn("google", { callbackUrl: "/account" })}
              >
                Continue with Google
              </button>
            ) : null}
            {status === "authenticated" ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs text-emerald-600">
                  Signed in as {session.user?.email ?? "account"}.
                </p>
                <button
                  className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold"
                  onClick={() => signOut({ callbackUrl: "/account" })}
                >
                  Sign out
                </button>
              </div>
            ) : null}
            {status === "loading" ? (
              <p className="text-xs text-zinc-500">Checking session...</p>
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
