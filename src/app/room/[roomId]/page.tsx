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
    gmId: string | null;
    recap: string | null;
  } | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("aynfrp:lastName") ?? "";
  });
  const [storedParticipantId, setStoredParticipantId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(`aynfrp:room:${roomId}:participant`);
  });
  const [storedRole, setStoredRole] = useState<"gm" | "player" | "admin">(() => {
    if (typeof window === "undefined") return "player";
    const roleValue = localStorage.getItem(`aynfrp:room:${roomId}:role`);
    return roleValue === "gm" || roleValue === "admin" || roleValue === "player" ? roleValue : "player";
  });
  const [callJoined, setCallJoined] = useState(false);
  const [callFrameReady, setCallFrameReady] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [diceSides, setDiceSides] = useState(20);
  const [diceCount, setDiceCount] = useState(1);
  const [diceError, setDiceError] = useState<string | null>(null);
  const [recapText, setRecapText] = useState("");
  const [recapError, setRecapError] = useState<string | null>(null);
  const [gmAssignId, setGmAssignId] = useState<string>("");
  const [gmAssignError, setGmAssignError] = useState<string | null>(null);

  const queryParticipantId = search.get("pid");
  const queryRole = search.get("role");
  const participantId = queryParticipantId ?? storedParticipantId;
  const role: "gm" | "player" | "admin" =
    queryRole === "gm" || queryRole === "admin" || queryRole === "player" ? queryRole : storedRole;
  const canManageSession = role === "gm" || role === "admin";
  const gmCandidates = useMemo(() => participants, [participants]);
  const callParticipants = useMemo(
    () => participants.filter((person) => person.inCall),
    [participants]
  );
  const callRoomName = useMemo(() => {
    // Jitsi room names should be simple alphanumeric tokens.
    const safeRoomId = roomId.replace(/[^a-zA-Z0-9]/g, "");
    return `AllYouNeedForFRP${safeRoomId || "Room"}`;
  }, [roomId]);

  useEffect(() => {
    if (queryParticipantId) {
      localStorage.setItem(`aynfrp:room:${roomId}:participant`, queryParticipantId);
    }
    if (queryRole === "gm" || queryRole === "admin" || queryRole === "player") {
      localStorage.setItem(`aynfrp:room:${roomId}:role`, queryRole);
    }
  }, [roomId, queryParticipantId, queryRole]);

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
    setStoredParticipantId(payload.data.participant.id);
    setStoredRole(payload.data.participant.role);
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

  async function assignGm() {
    setGmAssignError(null);
    if (!participantId || !gmAssignId) return;
    const res = await fetch(`/api/rooms/${roomId}/gm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, gmParticipantId: gmAssignId }),
    });
    const payload = (await res.json()) as ApiResponse<{ gmId: string }>;
    if (payload.error) {
      setGmAssignError(payload.error.message);
    }
  }

  async function updateCallState(updates: { inCall?: boolean; micOn?: boolean; camOn?: boolean }) {
    if (!participantId) return;
    await fetch(`/api/rooms/${roomId}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, ...updates }),
    }).catch(() => null);
  }

  async function handleJoinCall() {
    setCallError(null);
    setCallFrameReady(false);
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      }
      setCallJoined(true);
      await updateCallState({ inCall: true, micOn: true, camOn: true });
    } catch {
      setCallError("Camera/mic permissions denied. You can still roll dice.");
      await updateCallState({ inCall: true, micOn: false, camOn: false });
      setCallJoined(true);
    }
  }

  async function handleQuitCall() {
    setCallError(null);
    setCallJoined(false);
    setCallFrameReady(false);
    await updateCallState({ inCall: false, micOn: false, camOn: false });
  }

  useEffect(() => {
    return () => {
      if (!participantId) return;
      void fetch(`/api/rooms/${roomId}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, inCall: false, micOn: false, camOn: false }),
      }).catch(() => null);
    };
  }, [participantId, roomId]);

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
                {callJoined ? (
                  <button
                    className="rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white"
                    onClick={handleQuitCall}
                  >
                    Quit call
                  </button>
                ) : (
                  <button
                    className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold"
                    onClick={handleJoinCall}
                  >
                    Join call
                  </button>
                )}
                <span className="text-xs text-zinc-500">
                  {callJoined ? "Use call controls inside the video window." : "Join to open live call."}
                </span>
                {callJoined ? (
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                      callFrameReady ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {callFrameReady ? "Connected to video room" : "Connecting to video..."}
                  </span>
                ) : null}
              </div>
              {callError ? (
                <p className="mt-3 text-xs text-amber-600">{callError}</p>
              ) : null}
              {callJoined ? (
                <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
                  <iframe
                    title="Room video call"
                    src={`https://meet.jit.si/${callRoomName}#config.prejoinPageEnabled=false`}
                    allow="camera; microphone; fullscreen; display-capture; autoplay"
                    className="h-[420px] w-full bg-zinc-100"
                    onLoad={() => setCallFrameReady(true)}
                  />
                </div>
              ) : null}
              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
                  In call now
                </h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {callParticipants.length === 0 ? (
                    <p className="text-xs text-zinc-500">No one has joined the call yet.</p>
                  ) : (
                    callParticipants.map((person) => (
                        <div
                          key={person.id}
                          className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
                        >
                          {person.camOn ? (
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-900 text-xs font-semibold text-white">
                              Video
                            </div>
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700">
                              {person.name
                                .split(" ")
                                .map((chunk) => chunk[0])
                                .join("")
                                .slice(0, 2)
                                .toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="text-xs font-semibold">{person.name}</p>
                            <p className="text-[11px] text-zinc-500">
                              {person.camOn ? "Camera on" : "Camera off"} •{" "}
                              {person.micOn ? "Mic on" : "Mic off"}
                            </p>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </div>
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
              {room.gmId ? (
                <p className="mt-3 text-xs text-zinc-500">
                  Current GM: {participants.find((person) => person.id === room.gmId)?.name ?? "—"}
                </p>
              ) : (
                <p className="mt-3 text-xs text-zinc-500">GM not assigned yet.</p>
              )}
            </div>
            {role === "admin" ? (
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold">Assign GM</h2>
                <p className="text-sm text-zinc-500">
                  Select a participant to act as DM/GM for this room.
                </p>
                <div className="mt-4 flex flex-col gap-3">
                  <select
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                    value={gmAssignId}
                    onChange={(event) => setGmAssignId(event.target.value)}
                    disabled={gmCandidates.length === 0}
                  >
                    <option value="">
                      {gmCandidates.length === 0 ? "No eligible participants yet" : "Choose GM"}
                    </option>
                    {gmCandidates.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                    onClick={assignGm}
                    disabled={!gmAssignId}
                  >
                    Assign GM
                  </button>
                  {gmAssignError ? (
                    <p className="text-xs text-amber-600">{gmAssignError}</p>
                  ) : null}
                </div>
              </div>
            ) : null}

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
