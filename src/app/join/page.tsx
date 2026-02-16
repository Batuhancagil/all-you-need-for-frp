"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

export default function JoinPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [inviteCode, setInviteCode] = useState("");
  const [displayName, setDisplayName] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(NAME_KEY) ?? "";
  });
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

  const canJoin = useMemo(() => {
    return inviteCode.trim().length > 0 && displayName.trim().length > 0;
  }, [inviteCode, displayName]);

  const canCreate = useMemo(() => {
    return roomName.trim().length > 0 && displayName.trim().length > 0;
  }, [roomName, displayName]);

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

  async function joinByInviteCode(code: string) {
    setError(null);
    if (!displayName.trim() || status !== "authenticated") return;
    setLoading(true);
    try {
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inviteCode: code.trim(),
          displayName: displayName.trim(),
        }),
      });
      const payload = (await res.json()) as ApiResponse<{
        roomId: string;
        participant: { id: string; role: "gm" | "player" | "admin" };
      }>;
      if (payload.error || !payload.data) {
        throw new Error(payload.error?.message ?? "Unable to join");
      }
      localStorage.setItem(NAME_KEY, displayName.trim());
      updateRecent({
        roomId: payload.data.roomId,
        inviteCode: code.trim().toUpperCase(),
        name: displayName.trim(),
      });
      localStorage.setItem(
        `aynfrp:room:${payload.data.roomId}:participant`,
        payload.data.participant.id
      );
      localStorage.setItem(
        `aynfrp:room:${payload.data.roomId}:role`,
        payload.data.participant.role
      );
      router.push(`/room/${payload.data.roomId}?pid=${payload.data.participant.id}`);
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
    setLoading(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: roomName.trim(),
          privacy,
          adminName: displayName.trim(),
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
      localStorage.setItem(NAME_KEY, displayName.trim());
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
      router.push(`/room/${payload.data.roomId}?pid=${payload.data.adminParticipantId}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create room");
    } finally {
      setLoading(false);
    }
  }

  function handleRejoin(room: RecentRoom) {
    router.push(`/room/${room.roomId}?invite=${room.inviteCode}`);
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900">
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-16">
          <p className="text-sm text-zinc-600">Checking sign-in status...</p>
        </main>
      </div>
    );
  }

  if (status !== "authenticated") {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900">
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-16">
          <header>
            <h1 className="text-3xl font-semibold">Sign in to join</h1>
            <p className="mt-2 text-sm text-zinc-600">
              Use Google to continue.
            </p>
          </header>
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Google sign-in</h2>
            <div className="mt-4 flex flex-col gap-3">
              <button
                className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-4 text-sm font-semibold text-white"
                onClick={() => signIn("google", { callbackUrl: "/join" })}
              >
                Continue with Google
              </button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16">
        <header>
          <h1 className="text-3xl font-semibold">Join a session</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Enter an invite code or create a room to get started.
          </p>
          <div className="mt-3 flex items-center gap-3 text-xs text-zinc-500">
            <span>Signed in as {session.user?.email ?? "account"}.</span>
            <button className="underline" onClick={() => signOut({ callbackUrl: "/join" })}>
              Sign out
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <section className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Join with invite</h2>
            <div className="mt-4 flex flex-col gap-4">
              <label className="text-sm font-semibold text-zinc-600">
                Invite code
                <input
                  className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  placeholder="AB12CD"
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                />
              </label>
              <label className="text-sm font-semibold text-zinc-600">
                Display name
                <input
                  className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  placeholder="Your name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <button
                className="mt-2 inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                onClick={handleJoin}
                disabled={!canJoin || loading}
              >
                {loading ? "Joining..." : "Join room"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Create a room</h2>
            <div className="mt-4 flex flex-col gap-4">
              <label className="text-sm font-semibold text-zinc-600">
                Room name
                <input
                  className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  placeholder="Friday Night Campaign"
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                />
              </label>
              <label className="text-sm font-semibold text-zinc-600">
                Your name
                <input
                  className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  placeholder="Host name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label className="text-sm font-semibold text-zinc-600">
                Privacy
                <select
                  className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  value={privacy}
                  onChange={(event) => setPrivacy(event.target.value as "private" | "public")}
                >
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                </select>
              </label>
              <button
                className="mt-2 inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                onClick={handleCreate}
                disabled={!canCreate || loading}
              >
                {loading ? "Creating..." : "Create room"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">Recent sessions</h2>
            <p className="text-sm text-zinc-600">Rejoin quickly with one click.</p>
          </div>
          {recentRooms.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">
              No recent sessions yet. Join a room to populate this list.
            </p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {recentRooms.map((room) => (
                <button
                  key={room.roomId}
                  className="rounded-xl border border-zinc-200 px-4 py-3 text-left text-sm transition hover:border-zinc-300 hover:bg-zinc-50"
                  onClick={() => handleRejoin(room)}
                >
                  <p className="font-semibold text-zinc-900">{room.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">Invite: {room.inviteCode}</p>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">Public rooms</h2>
            <p className="text-sm text-zinc-600">Discover open rooms and join with one click.</p>
          </div>
          {publicRoomsLoading ? (
            <p className="mt-4 text-sm text-zinc-500">Loading public rooms...</p>
          ) : publicRooms.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">
              No public rooms right now. Create one and set Privacy to Public.
            </p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {publicRooms.map((room) => (
                <button
                  key={room.id}
                  className="rounded-xl border border-zinc-200 px-4 py-3 text-left text-sm transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100"
                  onClick={() => handleJoinPublic(room)}
                  disabled={loading || displayName.trim().length === 0}
                >
                  <p className="font-semibold text-zinc-900">{room.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Invite: {room.inviteCode} • {room.participantCount} players • {room.sessionState}
                  </p>
                  {displayName.trim().length === 0 ? (
                    <p className="mt-2 text-xs text-amber-600">
                      Enter your display name above to join this public room.
                    </p>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
