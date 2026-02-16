"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { LiveKitRoom, VideoConference, useLocalParticipant } from "@livekit/components-react";
import "@livekit/components-styles";
import { Track } from "livekit-client";
import { buildVideoChannelRoomName, buildVideoRoomName } from "@/lib/video-room";

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

type Channel = {
  id: string;
  name: string;
  slug: string;
  type: "text" | "voice";
};

type ChatMessage = {
  id: string;
  content: string;
  createdAt: string;
  participant: {
    id: string;
    name: string;
    role: "gm" | "player" | "admin";
  };
};

const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "";
const PTT_KEY_OPTIONS = [
  { code: "Space", label: "Space" },
  { code: "KeyV", label: "V" },
  { code: "KeyF", label: "F" },
  { code: "KeyT", label: "T" },
  { code: "ShiftLeft", label: "Left Shift" },
] as const;

function getPttKeyLabel(code: string) {
  const found = PTT_KEY_OPTIONS.find((option) => option.code === code);
  if (found) return found.label;
  if (code.startsWith("Key")) return code.slice(3).toUpperCase();
  return code;
}

function VoiceRuntimeControls({
  mode,
  pttKeyCode,
  noiseThreshold,
}: {
  mode: "always" | "ptt";
  pttKeyCode: string;
  noiseThreshold: number;
}) {
  const { localParticipant } = useLocalParticipant();
  const [pttActive, setPttActive] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [isNoiseOpen, setIsNoiseOpen] = useState(true);

  useEffect(() => {
    let analyser: AnalyserNode | null = null;
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let lowFrames = 0;
    let highFrames = 0;

    async function startMeter() {
      const pub = localParticipant.getTrackPublication(Track.Source.Microphone);
      const micTrack = pub?.track;
      if (!micTrack) return;
      const mediaTrack = micTrack.mediaStreamTrack;
      if (!mediaTrack) return;

      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source = context.createMediaStreamSource(new MediaStream([mediaTrack]));
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const threshold = Math.max(0.005, noiseThreshold / 100);

      timer = setInterval(() => {
        if (!analyser) return;
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i += 1) {
          const normalized = (data[i] - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        setInputLevel(rms);

        if (rms >= threshold) {
          highFrames += 1;
          lowFrames = 0;
        } else {
          lowFrames += 1;
          highFrames = 0;
        }

        if (highFrames >= 2) setIsNoiseOpen(true);
        if (lowFrames >= 5) setIsNoiseOpen(false);
      }, 120);
    }

    void startMeter();
    return () => {
      if (timer) clearInterval(timer);
      source?.disconnect();
      if (context && context.state !== "closed") void context.close();
    };
  }, [localParticipant, noiseThreshold]);

  useEffect(() => {
    if (mode !== "ptt") return;

    const isTypingTarget = (eventTarget: EventTarget | null) => {
      const node = eventTarget as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || node.isContentEditable;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== pttKeyCode) return;
      if (isTypingTarget(event.target)) return;
      if (event.repeat) return;
      event.preventDefault();
      setPttActive(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== pttKeyCode) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setPttActive(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [mode, pttKeyCode]);

  useEffect(() => {
    const shouldEnable = mode === "ptt" ? pttActive : isNoiseOpen;
    void localParticipant.setMicrophoneEnabled(shouldEnable);
  }, [isNoiseOpen, localParticipant, mode, pttActive]);

  return (
    <div className="pointer-events-none absolute bottom-16 left-2 z-40 rounded-lg bg-black/60 px-2 py-1 text-[10px] text-white">
      <span>Input {Math.round(inputLevel * 100)}</span>
      <span className="mx-2">|</span>
      {mode === "ptt" ? (
        <span>{pttActive ? "PTT live" : `Hold ${getPttKeyLabel(pttKeyCode)}`}</span>
      ) : (
        <span>{isNoiseOpen ? "Mic open" : "Noise gate closed"}</span>
      )}
    </div>
  );
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { status } = useSession();
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
  const [callJoined, setCallJoined] = useState(false);
  const [callFrameReady, setCallFrameReady] = useState(false);
  const [callToken, setCallToken] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const [audioMode, setAudioMode] = useState<"always" | "ptt">("always");
  const [pttKeyCode, setPttKeyCode] = useState<string>("Space");
  const [noiseThreshold, setNoiseThreshold] = useState(5);
  const [diceSides, setDiceSides] = useState(20);
  const [diceCount, setDiceCount] = useState(1);
  const [diceError, setDiceError] = useState<string | null>(null);
  const [recapText, setRecapText] = useState("");
  const [recapError, setRecapError] = useState<string | null>(null);
  const [gmAssignId, setGmAssignId] = useState<string>("");
  const [gmAssignError, setGmAssignError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteCopyError, setInviteCopyError] = useState<string | null>(null);

  const queryParticipantId = search.get("pid");
  const participantId = queryParticipantId ?? storedParticipantId;
  const currentParticipant = useMemo(
    () => participants.find((person) => person.id === participantId) ?? null,
    [participantId, participants]
  );
  const role: "gm" | "player" | "admin" = currentParticipant?.role ?? "player";
  const canManageSession = role === "gm" || role === "admin";
  const gmCandidates = useMemo(() => participants, [participants]);
  const callParticipants = useMemo(
    () => participants.filter((person) => person.inCall),
    [participants]
  );
  const textChannels = useMemo(() => channels.filter((channel) => channel.type === "text"), [channels]);
  const voiceChannels = useMemo(() => channels.filter((channel) => channel.type === "voice"), [channels]);
  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId) ?? channels[0] ?? null,
    [channels, selectedChannelId]
  );
  const activeVoiceChannel = useMemo(() => {
    if (selectedChannel?.type === "voice") return selectedChannel;
    return voiceChannels[0] ?? null;
  }, [selectedChannel, voiceChannels]);
  const callRoomName = useMemo(() => {
    if (activeVoiceChannel) {
      return buildVideoChannelRoomName(roomId, activeVoiceChannel.slug);
    }
    return buildVideoRoomName(roomId);
  }, [activeVoiceChannel, roomId]);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (queryParticipantId) {
      localStorage.setItem(`aynfrp:room:${roomId}:participant`, queryParticipantId);
    }
  }, [roomId, queryParticipantId, status]);

  useEffect(() => {
    if (!currentParticipant) return;
    localStorage.setItem(`aynfrp:room:${roomId}:role`, currentParticipant.role);
  }, [currentParticipant, roomId]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/join");
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
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

    async function loadChannels() {
      const res = await fetch(`/api/rooms/${roomId}/channels`);
      const payload = (await res.json()) as ApiResponse<{ channels: Channel[] }>;
      if (payload.error || !payload.data) {
        setChannelsError(payload.error?.message ?? "Could not load channels");
        return;
      }
      setChannels(payload.data.channels);
      setSelectedChannelId((prev) => {
        if (prev) return prev;
        const firstText = payload.data.channels.find((channel) => channel.type === "text");
        const firstVoice = payload.data.channels.find((channel) => channel.type === "voice");
        return firstText?.id ?? firstVoice?.id ?? null;
      });
    }

    loadRoom();
    loadParticipants();
    loadRolls();
    loadChannels();

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
  }, [roomId, participantId, status]);

  useEffect(() => {
    if (selectedChannel?.type !== "text") return;
    fetch(`/api/rooms/${roomId}/chat/messages?channelId=${selectedChannel.id}`)
      .then((res) => res.json())
      .then((payload: ApiResponse<{ messages: ChatMessage[] }>) => {
        if (payload.error || !payload.data) {
          setChatError(payload.error?.message ?? "Could not load chat");
          return;
        }
        setChatError(null);
        setChatMessages(payload.data.messages);
      });
  }, [roomId, selectedChannel]);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  useEffect(() => {
    if (selectedChannel?.type !== "text") return;

    const since = chatMessagesRef.current[chatMessagesRef.current.length - 1]?.createdAt ?? new Date().toISOString();
    const stream = new EventSource(
      `/api/rooms/${roomId}/chat/stream?channelId=${selectedChannel.id}&since=${encodeURIComponent(since)}`
    );
    stream.addEventListener("messages", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as ChatMessage[];
      setChatMessages((prev) => {
        const seen = new Set(prev.map((msg) => msg.id));
        const next = [...prev];
        payload.forEach((msg) => {
          if (!seen.has(msg.id)) next.push(msg);
        });
        return next.slice(-200);
      });
    });
    stream.onerror = () => {
      stream.close();
    };
    return () => {
      stream.close();
    };
  }, [roomId, selectedChannel]);

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
    if (!participantId) {
      setCallError("Join the room first before starting the call.");
      return;
    }
    setCallError(null);
    setCallFrameReady(false);

    if (!LIVEKIT_URL) {
      setCallError("Video server URL is missing. Set NEXT_PUBLIC_LIVEKIT_URL in env.");
      return;
    }

    try {
      const res = await fetch(`/api/rooms/${roomId}/video-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, channelSlug: activeVoiceChannel?.slug }),
      });
      const payload = (await res.json()) as ApiResponse<{ token: string }>;
      if (payload.error || !payload.data) {
        setCallError(payload.error?.message ?? "Could not start call");
        return;
      }

      setCallToken(payload.data.token);
      setCallJoined(true);
      await updateCallState({ inCall: true, micOn: true, camOn: true });
    } catch {
      setCallError("Could not connect to video room. Check your connection and try again.");
    }
  }

  async function handleQuitCall() {
    setCallError(null);
    setCallJoined(false);
    setCallFrameReady(false);
    setCallToken(null);
    await updateCallState({ inCall: false, micOn: false, camOn: false });
  }

  async function sendChatMessage() {
    setChatError(null);
    if (!participantId || selectedChannel?.type !== "text") return;
    if (!chatInput.trim()) return;

    const res = await fetch(`/api/rooms/${roomId}/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelId: selectedChannel.id,
        participantId,
        content: chatInput,
      }),
    });
    const payload = (await res.json()) as ApiResponse<{ message: ChatMessage }>;
    if (payload.error || !payload.data) {
      setChatError(payload.error?.message ?? "Could not send message");
      return;
    }
    setChatInput("");
    setChatMessages((prev) => {
      const exists = prev.some((msg) => msg.id === payload.data!.message.id);
      return exists ? prev : [...prev, payload.data!.message].slice(-200);
    });
  }

  async function handleCopyInviteCode() {
    setInviteCopyError(null);
    try {
      await navigator.clipboard.writeText(room?.inviteCode ?? "");
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1800);
    } catch {
      setInviteCopyError("Could not copy automatically. Please copy the code manually.");
    }
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

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-zinc-50 p-6 text-zinc-900">
        <p className="text-sm text-zinc-600">Checking sign-in status...</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen bg-zinc-50 p-6 text-zinc-900">
        <p className="text-sm text-zinc-600">Redirecting to sign-in...</p>
      </div>
    );
  }

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
            <button
              className="inline-flex items-center rounded-full border border-zinc-200 px-3 py-1 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100"
              onClick={handleCopyInviteCode}
            >
              {inviteCopied ? "Copied" : "Copy invite"}
            </button>
            {inviteCopyError ? <span className="text-xs text-amber-600">{inviteCopyError}</span> : null}
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

        <section className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <aside className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Channels</p>
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Text Channels</p>
              <div className="mt-2 space-y-1">
                {textChannels.map((channel) => (
                  <button
                    key={channel.id}
                    className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm ${
                      selectedChannel?.id === channel.id ? "bg-zinc-900 text-white" : "hover:bg-zinc-100"
                    }`}
                    onClick={() => setSelectedChannelId(channel.id)}
                  >
                    #{channel.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Voice Channels</p>
              <div className="mt-2 space-y-1">
                {voiceChannels.map((channel) => (
                  <button
                    key={channel.id}
                    className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm ${
                      selectedChannel?.id === channel.id ? "bg-zinc-900 text-white" : "hover:bg-zinc-100"
                    }`}
                    onClick={() => setSelectedChannelId(channel.id)}
                  >
                    🔊 {channel.name}
                  </button>
                ))}
              </div>
            </div>
            {channelsError ? <p className="mt-3 text-xs text-amber-600">{channelsError}</p> : null}
          </aside>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            {selectedChannel?.type === "text" ? (
              <div>
                <h3 className="text-base font-semibold">#{selectedChannel.name}</h3>
                <div className="mt-3 h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  {chatMessages.length === 0 ? (
                    <p className="text-xs text-zinc-500">No messages yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {chatMessages.map((message) => (
                        <div key={message.id} className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
                          <p className="text-xs font-semibold">
                            {message.participant.name}
                            <span className="ml-2 text-[10px] uppercase text-zinc-400">{message.participant.role}</span>
                          </p>
                          <p className="mt-1 text-sm text-zinc-800">{message.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                    value={chatInput}
                    placeholder={`Message #${selectedChannel.name}`}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendChatMessage();
                      }
                    }}
                  />
                  <button
                    className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white"
                    onClick={sendChatMessage}
                  >
                    Send
                  </button>
                </div>
                {chatError ? <p className="mt-2 text-xs text-amber-600">{chatError}</p> : null}
              </div>
            ) : (
              <div>
                <h3 className="text-base font-semibold">🔊 {activeVoiceChannel?.name ?? "voice"}</h3>
                <p className="mt-2 text-sm text-zinc-500">
                  Selected voice channel. Use Join call below to enter this channel.
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <label className="text-xs font-semibold text-zinc-600">
                    Audio mode
                    <select
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs"
                      value={audioMode}
                      onChange={(event) => setAudioMode(event.target.value as "always" | "ptt")}
                    >
                      <option value="always">Always on + Noise gate</option>
                      <option value="ptt">Push to talk</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-zinc-600">
                    Push-to-talk key
                    <select
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs"
                      value={pttKeyCode}
                      onChange={(event) => setPttKeyCode(event.target.value)}
                    >
                      {PTT_KEY_OPTIONS.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-zinc-600">
                    Noise threshold
                    <input
                      type="range"
                      min={1}
                      max={50}
                      value={noiseThreshold}
                      className="mt-2 w-full"
                      onChange={(event) => setNoiseThreshold(Number(event.target.value))}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        </section>

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
                  {callJoined
                    ? `Use call controls inside the video window (${activeVoiceChannel?.name ?? "voice"}).`
                    : "Join to open live call."}
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
                <div className="mt-4 rounded-xl border border-zinc-200">
                  {callToken ? (
                    <div className="h-[70vh] min-h-[520px] w-full bg-zinc-100">
                      <LiveKitRoom
                        token={callToken}
                        serverUrl={LIVEKIT_URL}
                        connect
                        video
                        audio
                        data-lk-theme="default"
                        options={{ adaptiveStream: true, dynacast: true }}
                        className="call-room h-full w-full"
                        onConnected={() => setCallFrameReady(true)}
                        onDisconnected={() => setCallFrameReady(false)}
                        onError={(liveKitError) => setCallError(liveKitError.message)}
                      >
                        <VoiceRuntimeControls
                          mode={audioMode}
                          pttKeyCode={pttKeyCode}
                          noiseThreshold={noiseThreshold}
                        />
                        <VideoConference />
                      </LiveKitRoom>
                    </div>
                  ) : (
                    <div className="flex h-[70vh] min-h-[520px] items-center justify-center text-sm text-zinc-500">
                      Connecting to room {callRoomName}...
                    </div>
                  )}
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
            {currentParticipant?.role === "admin" ? (
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
