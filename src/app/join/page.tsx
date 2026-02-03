"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type RecentRoom = {
  roomId: string;
  inviteCode: string;
  name: string;
  role?: "gm" | "player" | "admin";
};

type ApiResponse<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

const RECENT_KEY = "aynfrp:recentRooms";
const NAME_KEY = "aynfrp:lastName";
const ROLE_KEY = "aynfrp:isAdmin";

export default function JoinPage() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [gmName, setGmName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [privacy, setPrivacy] = useState<"private" | "public">("private");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>([]);
  const [isAdminMode, setIsAdminMode] = useState(false);

  useEffect(() => {
    const storedName = localStorage.getItem(NAME_KEY);
    if (storedName) {
      setDisplayName(storedName);
      setGmName(storedName);
    }
    const storedRooms = localStorage.getItem(RECENT_KEY);
    if (storedRooms) {
      setRecentRooms(JSON.parse(storedRooms));
    }
    setIsAdminMode(localStorage.getItem(ROLE_KEY) === "true");
  }, []);

  const canJoin = useMemo(() => {
    return inviteCode.trim().length > 0 && displayName.trim().length > 0;
  }, [inviteCode, displayName]);

  const canCreate = useMemo(() => {
    return roomName.trim().length > 0 && gmName.trim().length > 0;
  }, [roomName, gmName]);

  function updateRecent(room: RecentRoom) {
    const next = [room, ...recentRooms.filter((r) => r.roomId !== room.roomId)].slice(0, 5);
    setRecentRooms(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  }

  async function handleJoin() {
    setError(null);
    if (!canJoin) return;
    setLoading(true);
    try {
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inviteCode: inviteCode.trim(),
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
        inviteCode: inviteCode.trim().toUpperCase(),
        name: displayName.trim(),
        role: payload.data.participant.role,
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

  async function handleCreate() {
    setError(null);
    if (!canCreate) return;
    setLoading(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: roomName.trim(),
          privacy,
          gmName: gmName.trim(),
        }),
      });
      const payload = (await res.json()) as ApiResponse<{
        roomId: string;
        inviteCode: string;
        gmParticipantId: string;
      }>;
      if (payload.error || !payload.data) {
        throw new Error(payload.error?.message ?? "Unable to create room");
      }
      localStorage.setItem(NAME_KEY, gmName.trim());
      updateRecent({
        roomId: payload.data.roomId,
        inviteCode: payload.data.inviteCode,
        name: roomName.trim(),
        role: "gm",
      });
      localStorage.setItem(
        `aynfrp:room:${payload.data.roomId}:participant`,
        payload.data.gmParticipantId
      );
      localStorage.setItem(`aynfrp:room:${payload.data.roomId}:role`, "gm");
      router.push(
        `/room/${payload.data.roomId}?pid=${payload.data.gmParticipantId}&role=gm`
      );
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create room");
    } finally {
      setLoading(false);
    }
  }

  function handleRejoin(room: RecentRoom) {
    router.push(`/room/${room.roomId}?invite=${room.inviteCode}`);
  }

  function toggleAdminMode() {
    const next = !isAdminMode;
    setIsAdminMode(next);
    localStorage.setItem(ROLE_KEY, next ? "true" : "false");
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16">
        <header>
          <h1 className="text-3xl font-semibold">Join a session</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Enter an invite code or create a room to get started.
          </p>
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
                Your name (GM)
                <input
                  className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  placeholder="GM name"
                  value={gmName}
                  onChange={(event) => setGmName(event.target.value)}
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
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Recent sessions</h2>
              <p className="text-sm text-zinc-600">Rejoin quickly with one click.</p>
            </div>
            <button
              className="text-xs font-semibold uppercase tracking-wide text-zinc-500"
              onClick={toggleAdminMode}
              type="button"
            >
              {isAdminMode ? "Admin mode on" : "Enable admin mode"}
            </button>
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
      </main>
    </div>
  );
}
