"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useTheme } from "@/components/ThemeProvider";

type RecentRoom = {
  roomId: string;
  inviteCode: string;
  name: string;
};

const RECENT_KEY = "aynfrp:recentRooms";

function readRecent(): RecentRoom[] {
  if (typeof window === "undefined") return [];
  const storedRooms = localStorage.getItem(RECENT_KEY);
  if (!storedRooms) return [];
  try {
    return JSON.parse(storedRooms) as RecentRoom[];
  } catch {
    return [];
  }
}

export default function TopNav() {
  const { data: session, status } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>(() => readRecent());
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(event: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  function handleToggleMenu() {
    setMenuOpen((open) => {
      const next = !open;
      if (next) setRecentRooms(readRecent());
      return next;
    });
  }

  return (
    <header className="sticky top-0 z-40 border-b app-divider bg-[color:var(--surface)]/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 md:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-[9px] font-bold tracking-tight text-white shadow-sm">
            AYNFF
          </span>
          <span className="hidden sm:inline">AllYouNeedForFRP</span>
        </Link>

        <div ref={menuRef} className="relative flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border app-divider text-[color:var(--foreground-muted)] transition hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <Link
            href="/join"
            className="hidden sm:inline-flex h-9 items-center rounded-full border app-divider px-3 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-muted)]"
          >
            Rooms
          </Link>
          {status === "authenticated" ? (
            <button
              type="button"
              className="inline-flex h-9 max-w-[160px] items-center truncate rounded-full border app-divider px-3 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-muted)]"
              onClick={handleToggleMenu}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="truncate">
                {session?.user?.name || session?.user?.email || "Profile"}
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="app-btn app-btn--primary h-9 px-3 text-xs"
              onClick={() => signIn("google", { callbackUrl: "/join" })}
            >
              Sign in
            </button>
          )}

          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border app-divider bg-[color:var(--surface-elevated)] p-3 shadow-xl"
            >
              <p className="truncate text-xs font-semibold">
                {session?.user?.name || session?.user?.email || "Account"}
              </p>
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--foreground-muted)]">
                My rooms
              </p>
              <div className="mt-1.5 max-h-56 space-y-1 overflow-y-auto">
                {recentRooms.length === 0 ? (
                  <p className="rounded-lg border app-divider px-2 py-2 text-xs text-[color:var(--foreground-muted)]">
                    No joined rooms yet.
                  </p>
                ) : (
                  recentRooms.map((room) => (
                    <Link
                      key={room.roomId}
                      href={`/room/${room.roomId}?invite=${room.inviteCode}`}
                      className="block rounded-lg border app-divider px-2 py-2 text-xs transition hover:bg-[color:var(--surface-muted)]"
                      onClick={() => setMenuOpen(false)}
                    >
                      <p className="font-semibold">{room.name}</p>
                      <p className="text-[color:var(--foreground-muted)]">
                        Invite: {room.inviteCode}
                      </p>
                    </Link>
                  ))
                )}
              </div>
              <div className="mt-3 grid gap-1.5">
                <Link
                  href="/account"
                  className="app-btn app-btn--ghost h-9 w-full text-xs"
                  onClick={() => setMenuOpen(false)}
                >
                  Account
                </Link>
                <button
                  type="button"
                  className="app-btn app-btn--ghost h-9 w-full text-xs"
                  onClick={() => signOut({ callbackUrl: "/join" })}
                >
                  Sign out
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
