"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ApiResponse<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

type Room = {
  id: string;
  name: string;
  privacy: "public" | "private";
  inviteCode: string;
  sessionState: "waiting" | "active" | "ended";
};

export default function AdminPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [metrics, setMetrics] = useState<{ sessionsStarted: number; sessionsEnded: number; uniqueParticipants: number } | null>(null);
  const [roomNamePrefix, setRoomNamePrefix] = useState("");
  const [privacy, setPrivacy] = useState<"private" | "public">("private");
  const [isAdmin] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("aynfrp:isAdmin") === "true";
  });

  useEffect(() => {
    async function loadRooms() {
      const res = await fetch("/api/admin/rooms");
      const payload = (await res.json()) as ApiResponse<{ rooms: Room[] }>;
      if (payload.data) {
        setRooms(payload.data.rooms);
      }
    }

    async function loadDefaults() {
      const res = await fetch("/api/admin/defaults");
      const payload = (await res.json()) as ApiResponse<{
        defaults: { roomNamePrefix?: string; privacy?: "private" | "public" };
      }>;
      if (payload.data) {
        setRoomNamePrefix(payload.data.defaults.roomNamePrefix ?? "");
        setPrivacy(payload.data.defaults.privacy ?? "private");
      }
    }

    async function loadMetrics() {
      const res = await fetch("/api/metrics");
      const payload = (await res.json()) as ApiResponse<{
        metrics: { sessionsStarted: number; sessionsEnded: number; uniqueParticipants: number };
      }>;
      if (payload.data) {
        setMetrics(payload.data.metrics);
      }
    }

    loadRooms();
    loadDefaults();
    loadMetrics();
  }, []);

  async function saveDefaults() {
    await fetch("/api/admin/defaults", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomNamePrefix, privacy }),
    });
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
        <h1 className="text-2xl font-semibold">Admin access required</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Enable admin mode from the Join page to access admin tools.
        </p>
        <Link className="mt-4 inline-flex text-sm text-zinc-600 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300" href="/join">
          Back to join
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16">
        <header>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">Admin</p>
          <h1 className="text-3xl font-semibold">Room organization</h1>
        </header>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="text-lg font-semibold">Defaults</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
              Room name prefix
              <input
                className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                value={roomNamePrefix}
                onChange={(event) => setRoomNamePrefix(event.target.value)}
              />
            </label>
            <label className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
              Default privacy
              <select
                className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                value={privacy}
                onChange={(event) => setPrivacy(event.target.value as "private" | "public")}
              >
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
            </label>
          </div>
          <button
            className="mt-4 rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
            onClick={saveDefaults}
          >
            Save defaults
          </button>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="text-lg font-semibold">Rooms</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {rooms.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No rooms created yet.</p>
            ) : (
              rooms.map((room) => (
                <div
                  key={room.id}
                  className="rounded-xl border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-600"
                >
                  <p className="font-semibold">{room.name}</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Invite: {room.inviteCode}</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">State: {room.sessionState}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="text-lg font-semibold">Metrics</h2>
          {metrics ? (
            <div className="mt-3 space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
              <p>Sessions started: {metrics.sessionsStarted}</p>
              <p>Sessions ended: {metrics.sessionsEnded}</p>
              <p>Unique participants: {metrics.uniqueParticipants}</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No metrics yet.</p>
          )}
        </section>
      </main>
    </div>
  );
}
