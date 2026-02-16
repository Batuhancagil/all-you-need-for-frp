"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

type RecentRoom = {
  roomId: string;
  inviteCode: string;
  name: string;
};

const RECENT_KEY = "aynfrp:recentRooms";

export default function TopNav() {
  const { data: session, status } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>(() => {
    if (typeof window === "undefined") return [];
    const storedRooms = localStorage.getItem(RECENT_KEY);
    if (!storedRooms) return [];
    try {
      return JSON.parse(storedRooms) as RecentRoom[];
    } catch {
      return [];
    }
  });

  function handleToggleMenu() {
    const next = !menuOpen;
    setMenuOpen(next);
    if (!next) return;
    const storedRooms = localStorage.getItem(RECENT_KEY);
    if (!storedRooms) {
      setRecentRooms([]);
      return;
    }
    try {
      setRecentRooms(JSON.parse(storedRooms) as RecentRoom[]);
    } catch {
      setRecentRooms([]);
    }
  }

  return (
    <header className="border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-xs text-white">
            A
          </span>
          <span>AllYouNeedForFRP</span>
        </Link>

        <div className="relative">
          {status === "authenticated" ? (
            <button
              className="inline-flex items-center rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100"
              onClick={handleToggleMenu}
            >
              {session.user?.name || session.user?.email || "Profile"}
            </button>
          ) : (
            <button
              className="inline-flex items-center rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white"
              onClick={() => signIn("google", { callbackUrl: "/join" })}
            >
              Continue with Google
            </button>
          )}

          {menuOpen ? (
            <div className="absolute right-0 top-10 z-50 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg">
              <p className="text-xs font-semibold text-zinc-900">
                {session?.user?.name || session?.user?.email || "Account"}
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.08em] text-zinc-400">My rooms</p>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {recentRooms.length === 0 ? (
                  <p className="rounded-lg border border-zinc-200 px-2 py-2 text-xs text-zinc-500">
                    No joined rooms yet.
                  </p>
                ) : (
                  recentRooms.map((room) => (
                    <Link
                      key={room.roomId}
                      href={`/room/${room.roomId}?invite=${room.inviteCode}`}
                      className="block rounded-lg border border-zinc-200 px-2 py-2 text-xs hover:bg-zinc-50"
                      onClick={() => setMenuOpen(false)}
                    >
                      <p className="font-semibold text-zinc-800">{room.name}</p>
                      <p className="text-zinc-500">Invite: {room.inviteCode}</p>
                    </Link>
                  ))
                )}
              </div>
              <button
                className="mt-3 w-full rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100"
                onClick={() => signOut({ callbackUrl: "/join" })}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
