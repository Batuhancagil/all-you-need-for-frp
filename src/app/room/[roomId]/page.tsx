"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

type ApiResponse<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

type Participant = {
  id: string;
  name: string;
  role: "gm" | "player" | "admin";
  inCall: boolean;
  micOn: boolean;
  camOn: boolean;
};

type Roll = {
  id: string;
  participantName: string;
  sides: number;
  count: number;
  results: number[];
  total: number;
  createdAt: string;
};

export default function RoomPage() {
  const params = useParams();
  const search = useSearchParams();
  const roomId = params.roomId as string;
  const [room, setRoom] = useState<{
    id: string;
    name: string;
    inviteCode: string;
    sessionState: "waiting" | "active" | "ended";
    gmId: string;
    recap: string | null;
  } | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [role, setRole] = useState<"gm" | "player" | "admin">("player");
  const [callJoined, setCallJoined] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [diceSides, setDiceSides] = useState(20);
  const [diceCount, setDiceCount] = useState(1);
  const [diceError, setDiceError] = useState<string | null>(null);
  const [recapText, setRecapText] = useState("");
  const [recapError, setRecapError] = useState<string | null>(null);

  const canManageSession = role === "gm" || role === "admin";

  useEffect(() => {
    const storedName = localStorage.getItem("aynfrp:lastName");
    if (storedName) {
      setDisplayName(storedName);
    }

    const storedParticipant = localStorage.getItem(`aynfrp:room:${roomId}:participant`);
    if (storedParticipant) {
      setParticipantId(storedParticipant);
    }
    const storedRole = localStorage.getItem(`aynfrp:room:${roomId}:role`);
    if (storedRole === "gm" || storedRole === "admin" || storedRole === "player") {
      setRole(storedRole);
    }
  }, [roomId]);

  useEffect(() => {
    const queryParticipant = search.get("pid");
    const queryRole = search.get("role");
    if (queryParticipant) {
      setParticipantId(queryParticipant);
      localStorage.setItem(`aynfrp:room:${roomId}:participant`, queryParticipant);
    }
    if (queryRole === "gm" || queryRole === "admin" || queryRole === "player") {
      setRole(queryRole);
      localStorage.setItem(`aynfrp:room:${roomId}:role`, queryRole);
    }
  }, [roomId, search]);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    async function loadRoom() {
      const res = await fetch(`/api/rooms/${roomId}`);
      const payload = (await res.json()) as ApiResponse<typeof room>;
      if (payload.error || !payload.data) {
        setError(payload.error?.message ?? "Room not found");
        return;
      }
      setRoom(payload.data);
      setRecapText(payload.data.recap ?? "");
    }

    async function loadParticipants() {
      const res = await fetch(`/api/rooms/${roomId}/participants`);
      const payload = (await res.json()) as ApiResponse<{
        participants: Participant[];
        sessionState: "waiting" | "active" | "ended";
      }>;
      if (payload.data) {
        setParticipants(payload.data.participants);
        setRoom((prev) => (prev ? { ...prev, sessionState: payload.data!.sessionState } : prev));
      }
    }

    async function loadRolls() {
      const res = await fetch(`/api/rooms/${roomId}/rolls`);
      const payload = (await res.json()) as ApiResponse<{ rolls: Roll[] }>;
      if (payload.data) {
        setRolls(payload.data.rolls);
      }
    }

    loadRoom();
    loadParticipants();
    loadRolls();

    interval = setInterval(() => {
      loadParticipants();
      loadRolls();
      if (participantId) {
        fetch(`/api/rooms/${roomId}/ping`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId }),
        }).catch(() => null);
      }
    }, 5000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [roomId, participantId]);

  async function joinViaInvite() {
    setError(null);
    const invite = search.get("invite");
    if (!invite) return;
    if (!displayName.trim()) {
      setError("Enter a display name to join");
      return;
    }

    const res = await fetch("/api/rooms/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode: invite, displayName: displayName.trim() }),
    });
    const payload = (await res.json()) as ApiResponse<{
      roomId: string;
      participant: { id: string; role: "gm" | "player" | "admin" };
    }>;
    if (payload.error || !payload.data) {
      setError(payload.error?.message ?? "Unable to join");
      return;
    }
    setParticipantId(payload.data.participant.id);
    setRole(payload.data.participant.role);
    localStorage.setItem("aynfrp:lastName", displayName.trim());
    localStorage.setItem(`aynfrp:room:${roomId}:participant`, payload.data.participant.id);
    localStorage.setItem(`aynfrp:room:${roomId}:role`, payload.data.participant.role);
    window.history.replaceState({}, "", `/room/${roomId}?pid=${payload.data.participant.id}`);
  }

  async function startSession() {
    if (!participantId) return;
    await fetch(`/api/rooms/${roomId}/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId }),
    });
  }

  async function endSession() {
    if (!participantId) return;
    await fetch(`/api/rooms/${roomId}/session/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId }),
    });
  }

  async function rollDice() {
    setDiceError(null);
    if (!participantId) return;
    if (!Number.isFinite(diceSides) || diceSides <= 1 || diceCount <= 0) {
      setDiceError("Invalid dice roll. Choose sides and count.");
      return;
    }
    await fetch(`/api/rooms/${roomId}/roll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantId,
        sides: diceSides,
        count: diceCount,
      }),
    });
  }

  async function clearRollLog() {
    if (!participantId) return;
    await fetch(`/api/rooms/${roomId}/rolls/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId }),
    });
  }

  async function saveRecap() {
    setRecapError(null);
    if (!participantId) return;
    const res = await fetch(`/api/rooms/${roomId}/recap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, recap: recapText }),
    });
    const payload = (await res.json()) as ApiResponse<{ recap: string }>;
    if (payload.error) {
      setRecapError(payload.error.message);
    }
  }

  async function handleJoinCall() {
    setCallError(null);
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      }
      setCallJoined(true);
    } catch (err) {
      setCallError("Camera/mic permissions denied. You can still roll dice.");
    }
  }

  const invitePrompt = useMemo(() => search.get("invite"), [search]);

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50 p-6 text-zinc-900">
        <p className="text-sm text-red-600">{error}</p>
        <Link className="mt-4 inline-flex text-sm text-zinc-600" href="/join">
          Back to join
        </Link>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-zinc-50 p-6 text-zinc-900">
        <p className="text-sm text-zinc-600">Loading room...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Room</p>
            <h1 className="text-2xl font-semibold">{room.name}</h1>
            <p className="text-sm text-zinc-500">Session: {room.sessionState}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600">
              Invite: {room.inviteCode}
            </span>
            <Link className="text-sm text-zinc-500 underline" href="/join">
              Back to join
            </Link>
          </div>
        </header>

        {invitePrompt && !participantId ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
            <p className="font-semibold">Enter a display name to join</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                className="w-full rounded-lg border border-amber-200 px-3 py-2 text-sm"
                placeholder="Display name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <button
                className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-900 px-4 text-sm font-semibold text-white"
                onClick={joinViaInvite}
              >
                Join
              </button>
            </div>
          </div>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-lg font-semibold">Session controls</h2>
                {canManageSession ? (
                  <div className="flex gap-2">
                    <button
                      className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white"
                      onClick={startSession}
                    >
                      Start session
                    </button>
                    <button
                      className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white"
                      onClick={endSession}
                    >
                      End session
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">Only GM/admin can start/end.</p>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold"
                  onClick={handleJoinCall}
                >
                  {callJoined ? "In call" : "Join call"}
                </button>
                <button
                  className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold"
                  onClick={() => setMicOn((prev) => !prev)}
                >
                  {micOn ? "Mic on" : "Mic off"}
                </button>
                <button
                  className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold"
                  onClick={() => setCamOn((prev) => !prev)}
                >
                  {camOn ? "Cam on" : "Cam off"}
                </button>
              </div>
              {callError ? (
                <p className="mt-3 text-xs text-amber-600">{callError}</p>
              ) : null}
              {!callJoined ? (
                <p className="mt-3 text-xs text-zinc-500">
                  Call UI is ready; media wiring will follow in real-time implementation.
                </p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Dice</h2>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <select
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  value={diceSides}
                  onChange={(event) => setDiceSides(Number(event.target.value))}
                >
                  {[4, 6, 8, 10, 12, 20].map((side) => (
                    <option key={side} value={side}>
                      d{side}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={10}
                  className="w-20 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  value={diceCount}
                  onChange={(event) => setDiceCount(Number(event.target.value))}
                />
                <button
                  className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white"
                  onClick={rollDice}
                >
                  Roll
                </button>
                {canManageSession ? (
                  <button
                    className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold"
                    onClick={clearRollLog}
                  >
                    Clear log
                  </button>
                ) : null}
              </div>
              <div className="mt-4 space-y-2 text-sm">
                {diceError ? <p className="text-xs text-amber-600">{diceError}</p> : null}
                {rolls.length === 0 ? (
                  <p className="text-zinc-500">No rolls yet.</p>
                ) : (
                  rolls.map((roll) => (
                    <div key={roll.id} className="rounded-lg border border-zinc-200 px-3 py-2">
                      <p className="font-semibold">{roll.participantName}</p>
                      <p className="text-xs text-zinc-500">
                        d{roll.sides} × {roll.count} → {roll.results.join(", ")} (total {roll.total})
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Recap</h2>
              <p className="text-sm text-zinc-500">Capture a short recap after the session.</p>
              <textarea
                className="mt-3 w-full rounded-lg border border-zinc-200 p-3 text-sm"
                rows={4}
                value={recapText}
                onChange={(event) => setRecapText(event.target.value)}
              />
              {recapError ? <p className="mt-2 text-xs text-amber-600">{recapError}</p> : null}
              {canManageSession ? (
                <button
                  className="mt-3 rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white"
                  onClick={saveRecap}
                >
                  Save recap
                </button>
              ) : (
                <p className="mt-2 text-xs text-zinc-500">Only GM/admin can save recap.</p>
              )}
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Participants</h2>
              <div className="mt-4 space-y-2 text-sm">
                {participants.length === 0 ? (
                  <p className="text-zinc-500">No participants yet.</p>
                ) : (
                  participants.map((person) => (
                    <div key={person.id} className="flex items-center justify-between">
                      <span>{person.name}</span>
                      <span className="text-xs text-zinc-500">
                        {person.role === "gm" ? "GM" : person.role === "admin" ? "Admin" : "Player"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Admin</h2>
              <p className="text-sm text-zinc-500">Room defaults and organization.</p>
              <Link
                className="mt-3 inline-flex text-sm font-semibold text-zinc-900 underline"
                href="/admin"
              >
                Go to admin view
              </Link>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Account</h2>
              <p className="text-sm text-zinc-500">Optional magic-link account.</p>
              <Link
                className="mt-3 inline-flex text-sm font-semibold text-zinc-900 underline"
                href="/account"
              >
                Create account
              </Link>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
