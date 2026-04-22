"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";

type RecentRoom = {
  roomId: string;
  inviteCode: string;
  name: string;
};

type ApiResponse<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

type PublicRoom = {
  id: string;
  name: string;
  inviteCode: string;
  sessionState: "waiting" | "active" | "ended";
  participantCount: number;
  createdAt: string;
};

const RECENT_KEY = "aynfrp:recentRooms";
const NAME_KEY = "aynfrp:lastName";

const sessionStateLabel: Record<PublicRoom["sessionState"], { label: string; cls: string }> = {
  waiting: { label: "Waiting", cls: "app-badge" },
  active: { label: "Live", cls: "app-badge app-badge--success" },
  ended: { label: "Ended", cls: "app-badge app-badge--warning" },
};

function deriveAccountName(session: {
  user?: { name?: string | null; email?: string | null } | null;
} | null | undefined): string {
  const name = session?.user?.name?.trim();
  if (name) return name;
  const email = session?.user?.email ?? "";
  const prefix = email.split("@")[0]?.trim() ?? "";
  return prefix || "Player";
}

export default function JoinPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteFromUrl = (searchParams.get("code") ?? searchParams.get("invite") ?? "").trim().toUpperCase();
  const { data: session, status } = useSession();
  const [inviteCode, setInviteCode] = useState(inviteFromUrl);
  const [roomName, setRoomName] = useState("");
  const [privacy, setPrivacy] = useState<"private" | "public">("private");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [publicRoomsLoading, setPublicRoomsLoading] = useState(false);
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
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [displayName, setDisplayName] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(NAME_KEY) ?? "";
  });
  const [displayNameTouched, setDisplayNameTouched] = useState(false);

  const accountName = useMemo(() => deriveAccountName(session), [session]);

  useEffect(() => {
    if (displayNameTouched) return;
    if (displayName.trim()) return;
    if (!accountName) return;
    setDisplayName(accountName);
  }, [accountName, displayName, displayNameTouched]);

  const canJoin = useMemo(
    () => inviteCode.trim().length > 0 && displayName.trim().length > 0,
    [inviteCode, displayName]
  );
  const canCreate = useMemo(
    () => roomName.trim().length > 0 && displayName.trim().length > 0,
    [roomName, displayName]
  );

  useEffect(() => {
    if (!inviteFromUrl) return;
    setInviteCode((prev) => (prev === inviteFromUrl ? prev : inviteFromUrl));
  }, [inviteFromUrl]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;

    async function loadPublicRooms() {
      setPublicRoomsLoading(true);
      try {
        const res = await fetch("/api/rooms");
        const payload = (await res.json()) as ApiResponse<{ rooms: PublicRoom[] }>;
        if (!cancelled && payload.data) {
          setPublicRooms(payload.data.rooms);
        }
      } finally {
        if (!cancelled) setPublicRoomsLoading(false);
      }
    }

    void loadPublicRooms();
    return () => {
      cancelled = true;
    };
  }, [status]);

  function updateRecent(room: RecentRoom) {
    const next = [room, ...recentRooms.filter((r) => r.roomId !== room.roomId)].slice(0, 5);
    setRecentRooms(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  }

  async function joinByInviteCode(code: string, nameOverride?: string) {
    setError(null);
    if (status !== "authenticated") return;
    const joinName = nameOverride?.trim() || displayName.trim() || accountName;
    if (!joinName) {
      setError("Please enter a display name");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inviteCode: code.trim(),
          displayName: joinName,
        }),
      });
      const payload = (await res.json()) as ApiResponse<{
        roomId: string;
        participant: { id: string; role: "gm" | "player" | "admin" };
      }>;
      if (payload.error || !payload.data) {
        throw new Error(payload.error?.message ?? "Unable to join");
      }
      localStorage.setItem(NAME_KEY, joinName);
      updateRecent({
        roomId: payload.data.roomId,
        inviteCode: code.trim().toUpperCase(),
        name: joinName,
      });
      localStorage.setItem(
        `aynfrp:room:${payload.data.roomId}:participant`,
        payload.data.participant.id
      );
      localStorage.setItem(
        `aynfrp:room:${payload.data.roomId}:role`,
        payload.data.participant.role
      );
      router.push(`/room/${payload.data.roomId}`);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Unable to join room");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    if (!canJoin) return;
    await joinByInviteCode(inviteCode);
  }

  async function handleJoinPublic(room: PublicRoom) {
    setInviteCode(room.inviteCode);
    await joinByInviteCode(room.inviteCode);
  }

  async function handleCreate() {
    setError(null);
    if (!canCreate || status !== "authenticated") return;
    const adminName = displayName.trim() || accountName;
    setLoading(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: roomName.trim(),
          privacy,
          adminName,
        }),
      });
      const payload = (await res.json()) as ApiResponse<{
        roomId: string;
        inviteCode: string;
        adminParticipantId: string;
      }>;
      if (payload.error || !payload.data) {
        throw new Error(payload.error?.message ?? "Unable to create room");
      }
      localStorage.setItem(NAME_KEY, adminName);
      updateRecent({
        roomId: payload.data.roomId,
        inviteCode: payload.data.inviteCode,
        name: roomName.trim(),
      });
      localStorage.setItem(
        `aynfrp:room:${payload.data.roomId}:participant`,
        payload.data.adminParticipantId
      );
      localStorage.setItem(`aynfrp:room:${payload.data.roomId}:role`, "admin");
      router.push(`/room/${payload.data.roomId}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create room");
    } finally {
      setLoading(false);
    }
  }

  async function handleRejoin(room: RecentRoom) {
    const preferredName = displayName.trim() || room.name || accountName;
    await joinByInviteCode(room.inviteCode, preferredName);
  }

  if (status === "loading") {
    return (
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col gap-8 px-6 py-16">
        <p className="text-sm text-[color:var(--foreground-muted)]">Checking sign-in status…</p>
      </main>
    );
  }

  if (status !== "authenticated") {
    const callbackUrl = inviteFromUrl ? `/join?code=${encodeURIComponent(inviteFromUrl)}` : "/join";
    return (
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-2xl flex-col gap-8 px-6 py-16">
        <header>
          <span className="app-badge">Sign in required</span>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {inviteFromUrl ? "Sign in to accept the invite" : "Sign in to join a session"}
          </h1>
          <p className="mt-2 text-sm text-[color:var(--foreground-muted)]">
            {inviteFromUrl
              ? `You've been invited to room ${inviteFromUrl}. Sign in with Google to continue — we'll bring you right back.`
              : "Use your Google account to continue. We only keep your email and name to identify your rooms."}
          </p>
        </header>
        {error ? (
          <div className="app-card border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}
        <section className="app-card p-6">
          <h2 className="text-base font-semibold">Continue with Google</h2>
          <p className="mt-1 text-sm text-[color:var(--foreground-muted)]">
            You&apos;ll come back to this page afterwards.
          </p>
          <button
            type="button"
            className="app-btn app-btn--primary mt-4 w-full sm:w-auto"
            onClick={() => signIn("google", { callbackUrl })}
          >
            Continue with Google
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col gap-10 px-6 py-12 md:py-16">
      <header className="flex flex-col gap-2">
        <span className="app-badge w-fit">Rooms</span>
        <h1 className="text-3xl font-semibold tracking-tight">Join or start a session</h1>
        <p className="max-w-xl text-sm text-[color:var(--foreground-muted)]">
          Jump in with an invite code, create a new room, or rejoin one of your recent
          sessions.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[color:var(--foreground-muted)]">
          <span>Signed in as {session.user?.email ?? "account"}.</span>
          <button
            type="button"
            className="underline underline-offset-2 hover:text-[color:var(--foreground)]"
            onClick={() => signOut({ callbackUrl: "/join" })}
          >
            Sign out
          </button>
        </div>
      </header>

      {error ? (
        <div className="app-card border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {inviteFromUrl ? (
        <div className="app-card border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          You&apos;ve been invited to room <span className="font-mono font-semibold">{inviteFromUrl}</span>.
          {" "}Confirm your display name below, then tap{" "}
          <span className="font-semibold">Join room</span>. You can change it again inside the room.
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className={`app-card p-6 ${inviteFromUrl ? "ring-2 ring-amber-300 dark:ring-amber-600" : ""}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Join with invite</h2>
            <span className="app-badge">{inviteFromUrl ? "From link" : "Fastest"}</span>
          </div>
          <div className="mt-4 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--foreground-muted)]">
              Invite code
              <input
                className="app-input font-mono tracking-[0.3em]"
                placeholder="AB12CD"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                maxLength={12}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--foreground-muted)]">
              Display name in room
              <input
                className="app-input"
                placeholder={accountName || "Your name"}
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setDisplayNameTouched(true);
                }}
                maxLength={40}
              />
            </label>
            <p className="text-xs text-[color:var(--foreground-muted)]">
              This is how others will see you in the room. You can change it again from the
              Participants panel.
            </p>
            <button
              type="button"
              className="app-btn app-btn--primary mt-1"
              onClick={handleJoin}
              disabled={!canJoin || loading}
            >
              {loading ? "Joining…" : "Join room"}
            </button>
          </div>
        </div>

        <div className="app-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Create a room</h2>
            <span className="app-badge">New session</span>
          </div>
          <div className="mt-4 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--foreground-muted)]">
              Room name
              <input
                className="app-input"
                placeholder="Friday Night Campaign"
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--foreground-muted)]">
              Host display name
              <input
                className="app-input"
                placeholder={accountName || "Your name"}
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setDisplayNameTouched(true);
                }}
                maxLength={40}
              />
            </label>
            <p className="text-xs text-[color:var(--foreground-muted)]">
              Every room comes with chat, voice, video, dice and a shared collaborative document built in.
            </p>
            <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--foreground-muted)]">
              Privacy
              <select
                className="app-select"
                value={privacy}
                onChange={(event) =>
                  setPrivacy(event.target.value as "private" | "public")
                }
              >
                <option value="private">Private (invite-only)</option>
                <option value="public">Public (listed)</option>
              </select>
            </label>
            <button
              type="button"
              className="app-btn app-btn--accent mt-1"
              onClick={handleCreate}
              disabled={!canCreate || loading}
            >
              {loading ? "Creating…" : "Create room"}
            </button>
          </div>
        </div>
      </section>

      <section className="app-card p-6">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Recent sessions</h2>
            <p className="text-sm text-[color:var(--foreground-muted)]">
              Rejoin quickly with one click.
            </p>
          </div>
        </div>
        {recentRooms.length === 0 ? (
          <p className="mt-4 text-sm text-[color:var(--foreground-muted)]">
            No recent sessions yet — join or create a room to populate this list.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {recentRooms.map((room) => (
              <button
                key={room.roomId}
                type="button"
                className="rounded-xl border app-divider px-4 py-3 text-left transition hover:bg-[color:var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => handleRejoin(room)}
                disabled={loading}
              >
                <p className="text-sm font-semibold">{room.name}</p>
                <p className="mt-1 text-xs text-[color:var(--foreground-muted)]">
                  Invite: <span className="font-mono">{room.inviteCode}</span>
                </p>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="app-card p-6">
        <div>
          <h2 className="text-base font-semibold">Public rooms</h2>
          <p className="text-sm text-[color:var(--foreground-muted)]">
            Open rooms anyone can jump into. Set privacy to Public when creating to be
            listed here.
          </p>
        </div>
        {publicRoomsLoading ? (
          <p className="mt-4 text-sm text-[color:var(--foreground-muted)]">
            Loading public rooms…
          </p>
        ) : publicRooms.length === 0 ? (
          <p className="mt-4 text-sm text-[color:var(--foreground-muted)]">
            No public rooms right now.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {publicRooms.map((room) => {
              const badge = sessionStateLabel[room.sessionState];
              return (
                <button
                  key={room.id}
                  type="button"
                  className="rounded-xl border app-divider px-4 py-3 text-left transition hover:bg-[color:var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => handleJoinPublic(room)}
                  disabled={loading || displayName.trim().length === 0}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{room.name}</p>
                    <span className={badge.cls}>{badge.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-[color:var(--foreground-muted)]">
                    <span className="font-mono">{room.inviteCode}</span> •{" "}
                    {room.participantCount} player{room.participantCount === 1 ? "" : "s"}
                  </p>
                  {displayName.trim().length === 0 ? (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      Enter a display name above first.
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
