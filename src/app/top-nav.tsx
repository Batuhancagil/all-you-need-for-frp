"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useTheme } from "@/components/ThemeProvider";

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

  const { theme, toggleTheme } = useTheme();

  return (
    <header className="border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/90">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900">
            A
          </span>
          <span>AllYouNeedForFRP</span>
        </Link>

        <div className="relative">
          <button
            className="mr-2 flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          {status === "authenticated" ? (
            <button
              className="inline-flex items-center rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              onClick={handleToggleMenu}
            >
              {session.user?.name || session.user?.email || "Profile"}
            </button>
          ) : (
            <button
              className="inline-flex items-center rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
              onClick={() => signIn("google", { callbackUrl: "/join" })}
            >
              Continue with Google
            </button>
          )}

          {menuOpen ? (
            <div className="absolute right-0 top-10 z-50 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {session?.user?.name || session?.user?.email || "Account"}
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">My rooms</p>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {recentRooms.length === 0 ? (
                  <p className="rounded-lg border border-zinc-200 px-2 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                    No joined rooms yet.
                  </p>
                ) : (
                  recentRooms.map((room) => (
                    <Link
                      key={room.roomId}
                      href={`/room/${room.roomId}?invite=${room.inviteCode}`}
                      className="block rounded-lg border border-zinc-200 px-2 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      onClick={() => setMenuOpen(false)}
                    >
                      <p className="font-semibold text-zinc-800 dark:text-zinc-200">{room.name}</p>
                      <p className="text-zinc-500 dark:text-zinc-400">Invite: {room.inviteCode}</p>
                    </Link>
                  ))
                )}
              </div>
              <button
                className="mt-3 w-full rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
