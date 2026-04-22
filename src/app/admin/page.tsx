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

type Metrics = {
  sessionsStarted: number;
  sessionsEnded: number;
  uniqueParticipants: number;
};

export default function AdminPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [roomNamePrefix, setRoomNamePrefix] = useState("");
  const [privacy, setPrivacy] = useState<"private" | "public">("private");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [isAdmin] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("aynfrp:isAdmin") === "true";
  });

  useEffect(() => {
    async function loadRooms() {
      const res = await fetch("/api/admin/rooms");
      const payload = (await res.json()) as ApiResponse<{ rooms: Room[] }>;
      if (payload.data) setRooms(payload.data.rooms);
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
      const payload = (await res.json()) as ApiResponse<{ metrics: Metrics }>;
      if (payload.data) setMetrics(payload.data.metrics);
    }

    void loadRooms();
    void loadDefaults();
    void loadMetrics();
  }, []);

  async function saveDefaults() {
    setSaveStatus("saving");
    await fetch("/api/admin/defaults", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomNamePrefix, privacy }),
    });
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 1500);
  }

  if (!isAdmin) {
    return (
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-2xl flex-col gap-4 px-6 py-16">
        <span className="app-badge w-fit">Admin</span>
        <h1 className="text-3xl font-semibold tracking-tight">Admin access required</h1>
        <p className="text-sm text-[color:var(--foreground-muted)]">
          Enable admin mode from the Join page to access admin tools.
        </p>
        <Link href="/join" className="app-btn app-btn--ghost w-fit">
          Back to join
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col gap-10 px-6 py-12 md:py-16">
      <header className="flex flex-col gap-2">
        <span className="app-badge w-fit">Admin</span>
        <h1 className="text-3xl font-semibold tracking-tight">Room organization</h1>
        <p className="text-sm text-[color:var(--foreground-muted)]">
          Global defaults, active rooms and quick metrics.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="app-card p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--foreground-muted)]">
            Sessions started
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">
            {metrics?.sessionsStarted ?? "—"}
          </p>
        </div>
        <div className="app-card p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--foreground-muted)]">
            Sessions ended
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">
            {metrics?.sessionsEnded ?? "—"}
          </p>
        </div>
        <div className="app-card p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--foreground-muted)]">
            Unique participants
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">
            {metrics?.uniqueParticipants ?? "—"}
          </p>
        </div>
      </section>

      <section className="app-card p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Defaults</h2>
            <p className="text-xs text-[color:var(--foreground-muted)]">
              Applied when a new room is created.
            </p>
          </div>
          {saveStatus === "saved" ? (
            <span className="app-badge app-badge--success">Saved</span>
          ) : null}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--foreground-muted)]">
            Room name prefix
            <input
              className="app-input"
              value={roomNamePrefix}
              onChange={(event) => setRoomNamePrefix(event.target.value)}
              placeholder="Friday Night —"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--foreground-muted)]">
            Default privacy
            <select
              className="app-select"
              value={privacy}
              onChange={(event) => setPrivacy(event.target.value as "private" | "public")}
            >
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          className="app-btn app-btn--primary mt-4"
          onClick={saveDefaults}
          disabled={saveStatus === "saving"}
        >
          {saveStatus === "saving" ? "Saving…" : "Save defaults"}
        </button>
      </section>

      <section className="app-card p-6">
        <h2 className="text-base font-semibold">Rooms</h2>
        {rooms.length === 0 ? (
          <p className="mt-3 text-sm text-[color:var(--foreground-muted)]">
            No rooms created yet.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {rooms.map((room) => (
              <div
                key={room.id}
                className="rounded-xl border app-divider p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{room.name}</p>
                  <span
                    className={`app-badge ${
                      room.sessionState === "active"
                        ? "app-badge--success"
                        : room.sessionState === "ended"
                          ? "app-badge--warning"
                          : ""
                    }`}
                  >
                    {room.sessionState}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[color:var(--foreground-muted)]">
                  Invite <span className="font-mono">{room.inviteCode}</span> •{" "}
                  {room.privacy}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
