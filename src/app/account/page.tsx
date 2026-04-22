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
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col gap-8 px-6 py-12 md:py-16">
      <header className="flex flex-col gap-2">
        <span className="app-badge w-fit">Account</span>
        <h1 className="text-3xl font-semibold tracking-tight">Your account</h1>
        <p className="text-sm text-[color:var(--foreground-muted)]">
          Manage your sign-in and jump back into recent sessions.
        </p>
      </header>

      <section className="app-card p-6">
        <h2 className="text-base font-semibold">Google sign-in</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {status === "loading" ? (
            <p className="text-xs text-[color:var(--foreground-muted)]">
              Checking session…
            </p>
          ) : status === "authenticated" ? (
            <>
              <p className="app-badge app-badge--success">
                Signed in as {session?.user?.email ?? "account"}
              </p>
              <button
                type="button"
                className="app-btn app-btn--ghost"
                onClick={() => signOut({ callbackUrl: "/account" })}
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              className="app-btn app-btn--primary"
              onClick={() => signIn("google", { callbackUrl: "/account" })}
            >
              Continue with Google
            </button>
          )}
        </div>
      </section>

      <section className="app-card p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Recent sessions</h2>
          <Link href="/join" className="app-btn app-btn--ghost h-9 px-4 text-xs">
            Find a room
          </Link>
        </div>
        {recentRooms.length === 0 ? (
          <p className="mt-4 text-sm text-[color:var(--foreground-muted)]">
            No recent sessions yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y app-divider">
            {recentRooms.map((room) => (
              <li
                key={room.roomId}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{room.name}</p>
                  <p className="text-xs text-[color:var(--foreground-muted)]">
                    Invite <span className="font-mono">{room.inviteCode}</span>
                  </p>
                </div>
                <Link
                  className="app-btn app-btn--ghost h-9 px-4 text-xs"
                  href={`/room/${room.roomId}?invite=${room.inviteCode}`}
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
