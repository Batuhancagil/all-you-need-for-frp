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
  callChannelSlug?: string | null;
  lastSeen?: string;
};

type Roll = {
  id: string;
  participantName: string;
  rollName?: string | null;
  sides: number;
  count: number;
  expression?: string | null;
  modifier?: number | null;
  results: number[];
  total: number;
  createdAt: string;
};

type Channel = {
  id: string;
  name: string;
  slug: string;
  type: "text" | "voice" | "dice";
};

type InitiativeEntry = {
  id: string;
  participantId: string | null;
  participantName: string | null;
  creatureName: string | null;
  expression: string;
  result: number;
  results?: number[];
  sortOrder: number;
  isAlive?: boolean;
};

type InitiativeState = {
  currentTurnEntryId: string | null;
  turnCount: number;
  roundCount: number;
};

/** Unified reveal data for dice overlay (main roll or initiative). */
type RollRevealData = {
  expression: string;
  total: number;
  results: number[];
  participantName: string;
  rollName?: string | null;
};

type ChatMessage = {
  id: string;
  channelId: string;
  content: string;
  createdAt: string;
  participant: {
    id: string;
    name: string;
    role: "gm" | "player" | "admin";
  };
};

const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "";
const CALL_STALE_MS = 3 * 60 * 1000; // 3 min - hide from call if no ping
const ONLINE_MS = 90 * 1000; // 1.5 min - show as "online"

function formatLastSeen(iso: string | undefined): { label: string; online: boolean } {
  if (!iso) return { label: "—", online: false };
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < ONLINE_MS) return { label: "Online", online: true };
  if (ms < 60 * 1000) return { label: `${Math.floor(ms / 1000)}s ago`, online: false };
  if (ms < 60 * 60 * 1000) return { label: `${Math.floor(ms / 60000)}m ago`, online: false };
  if (ms < 24 * 60 * 60 * 1000) return { label: `${Math.floor(ms / 3600000)}h ago`, online: false };
  return { label: `${Math.floor(ms / 86400000)}d ago`, online: false };
}

/** Parse expression to get sides per die for overlay tumbling (e.g. "2d6+3" → [6,6]). */
function parseExpressionSides(expr: string): number[] {
  const out: number[] = [];
  const regex = /(\d*)d(\d+)/gi;
  let m;
  while ((m = regex.exec(expr)) !== null) {
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const sides = parseInt(m[2], 10);
    for (let i = 0; i < count; i++) out.push(sides);
  }
  return out.length ? out : [20];
}

/** Get sides for each die in order from expression, or [sides×count] for legacy. */
function getTermSides(roll: Roll): number[] {
  if (roll.expression?.trim()) {
    const expr = roll.expression.trim().replace(/\s+/g, "");
    const out: number[] = [];
    const regex = /(\d*)d(\d+)/gi;
    let m;
    while ((m = regex.exec(expr)) !== null) {
      const count = m[1] ? parseInt(m[1], 10) : 1;
      const sides = parseInt(m[2], 10);
      for (let i = 0; i < count; i++) out.push(sides);
    }
    return out.length > 0 ? out : Array(roll.count).fill(roll.sides);
  }
  return Array(roll.count).fill(roll.sides);
}

/** Red (1) to green (max) for value on a die with given sides. Returns bg + text classes. */
function diceColor(value: number, sides: number): string {
  if (sides <= 1) return "bg-zinc-200 text-zinc-800";
  const t = (value - 1) / (sides - 1); // 0..1
  if (t <= 0) return "bg-red-100 text-red-700 font-bold";
  if (t >= 1) return "bg-emerald-100 text-emerald-700 font-bold";
  if (t < 0.25) return "bg-amber-100 text-amber-800";
  if (t < 0.5) return "bg-yellow-100 text-yellow-800";
  if (t < 0.75) return "bg-lime-100 text-lime-800";
  return "bg-emerald-50 text-emerald-700";
}

/** Tumbling die face during roll – cycles numbers for tension. */
function TumblingDie({
  sides,
  finalValue,
  isRevealing,
  colorClass,
}: {
  sides: number;
  finalValue: number;
  isRevealing: boolean;
  colorClass: string;
}) {
  const [display, setDisplay] = useState(finalValue);
  useEffect(() => {
    if (isRevealing) {
      setDisplay(finalValue);
      return;
    }
    const id = setInterval(() => {
      setDisplay((prev) => (prev % sides) + 1);
    }, 60 + Math.random() * 40);
    return () => clearInterval(id);
  }, [sides, finalValue, isRevealing]);
  return (
    <span
      className={`inline-flex h-12 w-12 items-center justify-center rounded-xl text-xl font-bold tabular-nums shadow-md transition-all ${colorClass} ${isRevealing ? "animate-dice-reveal-pop" : "animate-dice-shake"}`}
    >
      {display}
    </span>
  );
}

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
    <div className="absolute bottom-16 left-2 z-40 flex items-center gap-2">
      <div className="pointer-events-none rounded-lg bg-black/60 px-2 py-1 text-[10px] text-white">
        <span>Input {Math.round(inputLevel * 100)}</span>
        <span className="mx-2">|</span>
        {mode === "ptt" ? (
          <span>{pttActive ? "PTT live" : `Hold ${getPttKeyLabel(pttKeyCode)}`}</span>
        ) : (
          <span>{isNoiseOpen ? "Mic open" : "Noise gate closed"}</span>
        )}
      </div>
      {mode === "ptt" ? (
        <button
          type="button"
          className="pointer-events-auto rounded-lg bg-zinc-800 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-700 active:bg-emerald-600"
          onMouseDown={() => setPttActive(true)}
          onMouseUp={() => setPttActive(false)}
          onMouseLeave={() => setPttActive(false)}
          onTouchStart={(e) => { e.preventDefault(); setPttActive(true); }}
          onTouchEnd={(e) => { e.preventDefault(); setPttActive(false); }}
        >
          Hold to talk
        </button>
      ) : null}
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
    createdByParticipantId: string | null;
    recap: string | null;
    backgroundMusicUrl: string | null;
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
  const [channelCreateOpen, setChannelCreateOpen] = useState(false);
  const [channelCreateType, setChannelCreateType] = useState<"text" | "voice" | "dice">("text");
  const [channelCreateName, setChannelCreateName] = useState("");
  const [channelCreateError, setChannelCreateError] = useState<string | null>(null);
  const [channelCreating, setChannelCreating] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({});
  const chatCursorRef = useRef<string>(new Date(0).toISOString());
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const [audioMode, setAudioMode] = useState<"always" | "ptt">("always");
  const [pttKeyCode, setPttKeyCode] = useState<string>("Space");
  const [noiseThreshold, setNoiseThreshold] = useState(5);
  const [diceExpression, setDiceExpression] = useState("d20");
  const [diceError, setDiceError] = useState<string | null>(null);
  const [rollingDice, setRollingDice] = useState(false);
  const [lastRoll, setLastRoll] = useState<Roll | null>(null);
  const [previousRoll, setPreviousRoll] = useState<Roll | null>(null);
  const [rollOverlay, setRollOverlay] = useState<
    | { phase: "rolling"; expression: string }
    | { phase: "reveal"; data: RollRevealData }
    | null
  >(null);
  const [namedRolls, setNamedRolls] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem("aynfrp:namedRolls");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [namedRollInput, setNamedRollInput] = useState<string | null>(null);
  const [initiativeEntries, setInitiativeEntries] = useState<InitiativeEntry[]>([]);
  const [initiativeState, setInitiativeState] = useState<InitiativeState>({
    currentTurnEntryId: null,
    turnCount: 0,
    roundCount: 0,
  });
  const [initiativeTurnCountInput, setInitiativeTurnCountInput] = useState("");
  const [initiativeCreatureName, setInitiativeCreatureName] = useState("");
  const [initiativeExpression, setInitiativeExpression] = useState("d20");
  const [initiativeAdding, setInitiativeAdding] = useState(false);
  const [initiativeError, setInitiativeError] = useState<string | null>(null);
  const [musicUrl, setMusicUrl] = useState("");
  const [musicError, setMusicError] = useState<string | null>(null);
  const [recapText, setRecapText] = useState("");
  const [recapError, setRecapError] = useState<string | null>(null);
  const [gmAssignId, setGmAssignId] = useState<string>("");
  const [gmAssignError, setGmAssignError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteCopyError, setInviteCopyError] = useState<string | null>(null);
  const [floatVideos, setFloatVideos] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("aynfrp:floatVideos") === "1";
  });

  const queryParticipantId = search.get("pid");
  const participantId = queryParticipantId ?? storedParticipantId;
  const currentParticipant = useMemo(
    () => participants.find((person) => person.id === participantId) ?? null,
    [participantId, participants]
  );
  const role: "gm" | "player" | "admin" = currentParticipant?.role ?? "player";
  const canManageSession = role === "gm" || role === "admin";
  const isRoomAdmin =
    currentParticipant?.id != null && room?.createdByParticipantId === currentParticipant.id;
  const canKick = role === "admin" || isRoomAdmin;
  const gmCandidates = useMemo(() => participants, [participants]);
  const callParticipants = useMemo(() => {
    const now = Date.now();
    return participants.filter((person) => {
      if (!person.inCall) return false;
      if (!person.lastSeen) return true;
      return now - new Date(person.lastSeen).getTime() < CALL_STALE_MS;
    });
  }, [participants]);
  const textChannels = useMemo(() => channels.filter((channel) => channel.type === "text"), [channels]);
  const voiceChannels = useMemo(() => channels.filter((channel) => channel.type === "voice"), [channels]);
  const diceChannels = useMemo(() => channels.filter((channel) => channel.type === "dice"), [channels]);
  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId) ?? channels[0] ?? null,
    [channels, selectedChannelId]
  );
  const selectedTextChannelId = selectedChannel?.type === "text" ? selectedChannel.id : null;
  const selectedDiceChannelId = selectedChannel?.type === "dice" ? selectedChannel.id : null;
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
  const joinedVoiceSlug = currentParticipant?.callChannelSlug ?? null;
  const joinedInSelectedVoice =
    !!callJoined && !!activeVoiceChannel && joinedVoiceSlug === activeVoiceChannel.slug;
  const voiceMembersBySlug = useMemo(() => {
    const now = Date.now();
    const grouped: Record<string, Participant[]> = {};
    participants.forEach((person) => {
      if (!person.inCall || !person.callChannelSlug) return;
      if (person.lastSeen && now - new Date(person.lastSeen).getTime() >= CALL_STALE_MS) return;
      grouped[person.callChannelSlug] = grouped[person.callChannelSlug]
        ? [...grouped[person.callChannelSlug], person]
        : [person];
    });
    return grouped;
  }, [participants]);

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
      if (payload.data.backgroundMusicUrl) {
        setMusicUrl(payload.data.backgroundMusicUrl);
      }
    }

    async function loadParticipants() {
      const res = await fetch(`/api/rooms/${roomId}/participants`);
      const payload = (await res.json()) as ApiResponse<{
        participants: Participant[];
        sessionState: "waiting" | "active" | "ended";
      }>;
      if (payload.data) {
        if (participantId && !payload.data.participants.some((p) => p.id === participantId)) {
          localStorage.removeItem(`aynfrp:room:${roomId}:participant`);
          router.replace("/");
          return;
        }
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
      const nextChannels = payload.data.channels;
      setChannels(nextChannels);
      setSelectedChannelId((prev) => {
        if (prev) return prev;
        const firstText = nextChannels.find((channel) => channel.type === "text");
        const firstVoice = nextChannels.find((channel) => channel.type === "voice");
        return firstText?.id ?? firstVoice?.id ?? null;
      });
    }

    async function loadInitiative() {
      const res = await fetch(`/api/rooms/${roomId}/initiative`);
      const payload = (await res.json()) as ApiResponse<{
        entries: InitiativeEntry[];
        currentTurnEntryId: string | null;
        turnCount: number;
        roundCount: number;
      }>;
      if (payload.data) {
        setInitiativeEntries(payload.data.entries);
        setInitiativeState({
          currentTurnEntryId: payload.data.currentTurnEntryId ?? null,
          turnCount: payload.data.turnCount ?? 0,
          roundCount: payload.data.roundCount ?? 0,
        });
      }
    }
    void loadInitiative();

    loadRoom();
    loadParticipants();
    loadRolls();
    loadChannels();

    interval = setInterval(async () => {
      loadParticipants();
      loadRolls();
      const roomRes = await fetch(`/api/rooms/${roomId}`);
      const roomPayload = (await roomRes.json()) as ApiResponse<{
        id: string;
        name: string;
        inviteCode: string;
        sessionState: string;
        gmId: string | null;
        createdByParticipantId: string | null;
        recap: string | null;
        backgroundMusicUrl: string | null;
      }>;
      if (roomPayload.data) {
        const d = roomPayload.data;
        setRoom((prev) =>
          prev
            ? {
                ...prev,
                name: d.name,
                inviteCode: d.inviteCode,
                sessionState: d.sessionState as "waiting" | "active" | "ended",
                gmId: d.gmId,
                createdByParticipantId: d.createdByParticipantId,
                recap: d.recap,
                backgroundMusicUrl: d.backgroundMusicUrl,
              }
            : prev
        );
        if (d.backgroundMusicUrl) setMusicUrl(d.backgroundMusicUrl);
      }
      const initRes = await fetch(`/api/rooms/${roomId}/initiative`);
      const initPayload = (await initRes.json()) as ApiResponse<{
        entries: InitiativeEntry[];
        currentTurnEntryId: string | null;
        turnCount: number;
        roundCount: number;
      }>;
      if (initPayload.data) {
        setInitiativeEntries(initPayload.data.entries);
        setInitiativeState({
          currentTurnEntryId: initPayload.data.currentTurnEntryId ?? null,
          turnCount: initPayload.data.turnCount ?? 0,
          roundCount: initPayload.data.roundCount ?? 0,
        });
      }
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
    if (!selectedTextChannelId) return;
    fetch(`/api/rooms/${roomId}/chat/messages?channelId=${selectedTextChannelId}`)
      .then((res) => res.json())
      .then((payload: ApiResponse<{ messages: ChatMessage[] }>) => {
        if (payload.error || !payload.data) {
          setChatError(payload.error?.message ?? "Could not load chat");
          return;
        }
        setChatError(null);
        setChatMessages(payload.data.messages);
        const latest = payload.data.messages[payload.data.messages.length - 1]?.createdAt;
        if (latest && latest > chatCursorRef.current) {
          chatCursorRef.current = latest;
        }
        shouldStickToBottomRef.current = true;
      });
  }, [roomId, selectedTextChannelId]);

  useEffect(() => {
    if (!participantId) return;

    let stopped = false;
    async function pollUpdates() {
      try {
        const res = await fetch(
          `/api/rooms/${roomId}/chat/updates?since=${encodeURIComponent(chatCursorRef.current)}`
        );
        const payload = (await res.json()) as ApiResponse<{ cursor: string; messages: ChatMessage[] }>;
        if (stopped || payload.error || !payload.data) return;
        chatCursorRef.current = payload.data.cursor;
        if (payload.data.messages.length === 0) return;

        if (selectedTextChannelId) {
          const selectedNew = payload.data.messages.filter(
            (message) => message.channelId === selectedTextChannelId
          );
          if (selectedNew.length > 0) {
            setChatMessages((prev) => {
              const seen = new Set(prev.map((message) => message.id));
              const merged = [...prev];
              selectedNew.forEach((message) => {
                if (!seen.has(message.id)) merged.push(message);
              });
              return merged.slice(-200);
            });
          }
        }

        const unreadDeltas: Record<string, number> = {};
        payload.data.messages.forEach((message) => {
          if (message.channelId === selectedTextChannelId) return;
          unreadDeltas[message.channelId] = (unreadDeltas[message.channelId] ?? 0) + 1;
        });
        if (Object.keys(unreadDeltas).length > 0) {
          setUnreadByChannel((prev) => {
            const next = { ...prev };
            Object.entries(unreadDeltas).forEach(([channelId, count]) => {
              next[channelId] = (next[channelId] ?? 0) + count;
            });
            return next;
          });
        }
      } catch {
        return;
      }
    }

    void pollUpdates();
    const interval = setInterval(() => {
      void pollUpdates();
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [participantId, roomId, selectedTextChannelId]);

  useEffect(() => {
    if (!selectedTextChannelId) return;
    setUnreadByChannel((prev) => {
      if (!prev[selectedTextChannelId]) return prev;
      return { ...prev, [selectedTextChannelId]: 0 };
    });
  }, [selectedTextChannelId]);

  useEffect(() => {
    if (!selectedTextChannelId) return;
    if (!shouldStickToBottomRef.current) return;
    const element = chatContainerRef.current;
    if (!element) return;
    requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
  }, [chatMessages, selectedTextChannelId]);

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

  const ROLL_TENSION_MS = 1200;
  const REVEAL_DISPLAY_MS = 1800;

  async function rollDice(expressionOverride?: string, rollNameOverride?: string) {
    setDiceError(null);
    if (!participantId) return;
    const expr = (expressionOverride ?? diceExpression).trim() || "d20";
    setRollingDice(true);
    setRollOverlay({ phase: "rolling", expression: expr });
    try {
      const res = await fetch(`/api/rooms/${roomId}/roll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, expression: expr, rollName: rollNameOverride || undefined }),
      });
      const payload = (await res.json()) as ApiResponse<{ roll: Roll }>;
      if (payload.error) {
        setRollOverlay(null);
        setDiceError(payload.error.message);
        return;
      }
      if (payload.data?.roll) {
        const newRoll = payload.data.roll;
        // Build tension: hold result, show tumbling a bit longer
        await new Promise((r) => setTimeout(r, ROLL_TENSION_MS));
        setRollOverlay({
          phase: "reveal",
          data: {
            expression: newRoll.expression ?? "",
            total: newRoll.total,
            results: newRoll.results,
            participantName: newRoll.participantName,
            rollName: newRoll.rollName ?? null,
          },
        });
        setTimeout(() => {
          setRolls((prev) => [newRoll, ...prev].slice(0, 50));
          setLastRoll((prev) => {
            if (prev) setPreviousRoll(prev);
            return newRoll;
          });
          setRollOverlay(null);
          setRollingDice(false);
        }, REVEAL_DISPLAY_MS);
      } else {
        setRollOverlay(null);
        setRollingDice(false);
      }
    } catch {
      setRollOverlay(null);
      setRollingDice(false);
    }
  }

  function saveNamedRoll(name: string) {
    const trimmed = name.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmed) return;
    const next = { ...namedRolls, [trimmed]: diceExpression.trim() || "d20" };
    setNamedRolls(next);
    localStorage.setItem("aynfrp:namedRolls", JSON.stringify(next));
    setNamedRollInput(null);
  }

  function removeNamedRoll(name: string) {
    const next = { ...namedRolls };
    delete next[name];
    setNamedRolls(next);
    localStorage.setItem("aynfrp:namedRolls", JSON.stringify(next));
  }

  async function clearRollLog() {
    if (!participantId) return;
    const res = await fetch(`/api/rooms/${roomId}/rolls/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId }),
    });
    if (res.ok) setRolls([]);
  }

  async function startInitiative() {
    if (!participantId) return;
    setInitiativeError(null);
    const res = await fetch(`/api/rooms/${roomId}/initiative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, action: "start" }),
    });
    const payload = (await res.json()) as ApiResponse<{ started?: boolean }>;
    if (payload.error) {
      setInitiativeError(payload.error.message);
    } else {
      setInitiativeEntries([]);
      setInitiativeState({ currentTurnEntryId: null, turnCount: 0, roundCount: 0 });
    }
  }

  async function removeInitiativeEntry(entryId: string) {
    if (!participantId) return;
    setInitiativeError(null);
    const res = await fetch(`/api/rooms/${roomId}/initiative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, action: "remove", entryId }),
    });
    const payload = (await res.json()) as ApiResponse<{ removed?: boolean }>;
    if (payload.error) {
      setInitiativeError(payload.error.message);
    } else {
      void (async () => {
        const initRes = await fetch(`/api/rooms/${roomId}/initiative`);
        const initPayload = (await initRes.json()) as ApiResponse<{
          entries: InitiativeEntry[];
          currentTurnEntryId: string | null;
          turnCount: number;
          roundCount: number;
        }>;
        if (initPayload.data) {
          setInitiativeEntries(initPayload.data.entries);
          setInitiativeState({
            currentTurnEntryId: initPayload.data.currentTurnEntryId ?? null,
            turnCount: initPayload.data.turnCount ?? 0,
            roundCount: initPayload.data.roundCount ?? 0,
          });
        }
      })();
    }
  }

  async function toggleInitiativeAlive(entryId: string) {
    if (!participantId) return;
    setInitiativeError(null);
    const res = await fetch(`/api/rooms/${roomId}/initiative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, action: "toggleAlive", entryId }),
    });
    const payload = (await res.json()) as ApiResponse<{ isAlive?: boolean }>;
    if (payload.error) {
      setInitiativeError(payload.error.message);
    } else {
      setInitiativeEntries((prev) =>
        prev.map((e) =>
          e.id === entryId ? { ...e, isAlive: payload.data?.isAlive ?? !e.isAlive } : e
        )
      );
    }
  }

  async function nextTurn() {
    if (!participantId) return;
    setInitiativeError(null);
    const res = await fetch(`/api/rooms/${roomId}/initiative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, action: "nextTurn" }),
    });
    const payload = (await res.json()) as ApiResponse<{
      currentTurnEntryId?: string;
      turnCount?: number;
      roundCount?: number;
    }>;
    if (payload.error) {
      setInitiativeError(payload.error.message);
    } else if (payload.data) {
      setInitiativeState({
        currentTurnEntryId: payload.data.currentTurnEntryId ?? null,
        turnCount: payload.data.turnCount ?? 0,
        roundCount: payload.data.roundCount ?? 0,
      });
    }
  }

  async function setInitiativeTurnCount(count: number) {
    if (!participantId) return;
    setInitiativeError(null);
    const res = await fetch(`/api/rooms/${roomId}/initiative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, action: "setTurnCount", turnCount: count }),
    });
    const payload = (await res.json()) as ApiResponse<{ turnCount?: number; roundCount?: number }>;
    if (payload.error) {
      setInitiativeError(payload.error.message);
    } else if (payload.data) {
      const { turnCount: newCount, roundCount: newRound } = payload.data;
      setInitiativeState((prev) => ({
        ...prev,
        ...(typeof newCount === "number" && { turnCount: newCount }),
        ...(typeof newRound === "number" && { roundCount: newRound }),
      }));
    }
  }

  async function addInitiativeEntry(isCreature: boolean, expr?: string, creatureName?: string) {
    if (!participantId) return;
    setInitiativeError(null);
    const expression = (expr ?? initiativeExpression).trim() || "d20";
    setInitiativeAdding(true);
    setRollOverlay({ phase: "rolling", expression });
    try {
      const body: Record<string, unknown> = {
        participantId,
        action: "add",
        expression,
      };
      if (isCreature && creatureName?.trim()) {
        body.creatureName = creatureName.trim();
      } else if (!isCreature) {
        body.targetParticipantId = participantId;
      }
      const res = await fetch(`/api/rooms/${roomId}/initiative`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as ApiResponse<{
        entry: InitiativeEntry & { results?: number[] };
      }>;
      if (payload.error) {
        setRollOverlay(null);
        setInitiativeError(payload.error.message);
        setInitiativeAdding(false);
        return;
      }
      if (payload.data?.entry) {
        setInitiativeCreatureName("");
        const entry = payload.data.entry;
        const results = entry.results ?? [entry.result];
        await new Promise((r) => setTimeout(r, ROLL_TENSION_MS));
        setRollOverlay({
          phase: "reveal",
          data: {
            expression: entry.expression,
            total: entry.result,
            results,
            participantName: entry.creatureName ?? entry.participantName ?? "—",
          },
        });
        setTimeout(async () => {
          const initRes = await fetch(`/api/rooms/${roomId}/initiative`);
          const initPayload = (await initRes.json()) as ApiResponse<{ entries: InitiativeEntry[] }>;
          if (initPayload.data) setInitiativeEntries(initPayload.data.entries);
          setRollOverlay(null);
          setInitiativeAdding(false);
        }, REVEAL_DISPLAY_MS);
      } else {
        setRollOverlay(null);
        setInitiativeAdding(false);
      }
    } catch {
      setRollOverlay(null);
      setInitiativeAdding(false);
    }
  }

  async function setBackgroundMusic(urlOverride?: string) {
    if (!participantId) return;
    setMusicError(null);
    const url = urlOverride ?? musicUrl;
    const res = await fetch(`/api/rooms/${roomId}/music`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, url }),
    });
    const payload = (await res.json()) as ApiResponse<{ url: string | null }>;
    if (payload.error) {
      setMusicError(payload.error.message);
    } else if (payload.data) {
      setRoom((prev) => (prev ? { ...prev, backgroundMusicUrl: payload.data!.url } : prev));
    }
  }

  async function leaveRoom() {
    if (!participantId) return;
    await fetch(`/api/rooms/${roomId}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId }),
    });
    router.replace("/join");
  }

  async function kickParticipant(targetId: string) {
    if (!participantId) return;
    const res = await fetch(`/api/rooms/${roomId}/kick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, targetParticipantId: targetId }),
    });
    if (res.ok) void refreshParticipants();
  }

  async function refreshParticipants() {
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

  async function refreshRoom() {
    const res = await fetch(`/api/rooms/${roomId}`);
    const payload = (await res.json()) as ApiResponse<typeof room>;
    if (payload.data) {
      setRoom(payload.data);
    }
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
    } else {
      void refreshRoom();
      void refreshParticipants();
    }
  }

  async function updateCallState(updates: {
    inCall?: boolean;
    micOn?: boolean;
    camOn?: boolean;
    channelSlug?: string | null;
  }) {
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
      await updateCallState({
        inCall: true,
        micOn: true,
        camOn: true,
        channelSlug: activeVoiceChannel?.slug ?? null,
      });
    } catch {
      setCallError("Could not connect to video room. Check your connection and try again.");
    }
  }

  async function handleQuitCall() {
    setCallError(null);
    setCallJoined(false);
    setCallFrameReady(false);
    setCallToken(null);
    await updateCallState({ inCall: false, micOn: false, camOn: false, channelSlug: null });
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

  async function createChannel() {
    setChannelCreateError(null);
    if (!participantId) {
      setChannelCreateError("Join room first to create channels.");
      return;
    }
    if (!channelCreateName.trim()) {
      setChannelCreateError("Please enter a channel name.");
      return;
    }
    setChannelCreating(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId,
          type: channelCreateType,
          name: channelCreateName.trim(),
        }),
      });
      const payload = (await res.json()) as ApiResponse<{ channel: Channel }>;
      if (payload.error || !payload.data) {
        setChannelCreateError(payload.error?.message ?? "Could not create channel");
        return;
      }
      setChannels((prev) =>
        [...prev, payload.data!.channel].sort((a, b) => {
          if (a.type !== b.type) {
            const order = { text: 0, dice: 1, voice: 2 };
            return (order[a.type] ?? 3) - (order[b.type] ?? 3);
          }
          return a.name.localeCompare(b.name);
        })
      );
      setSelectedChannelId(payload.data.channel.id);
      setChannelCreateName("");
      setChannelCreateOpen(false);
    } finally {
      setChannelCreating(false);
    }
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
        body: JSON.stringify({
          participantId,
          inCall: false,
          micOn: false,
          camOn: false,
          channelSlug: null,
        }),
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
    <>
      {rollOverlay ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-roll-overlay-in backdrop-blur-sm"
          aria-modal
          role="dialog"
          aria-label="Dice roll"
        >
          <div className="mx-4 flex max-w-md flex-col items-center rounded-2xl border-2 border-amber-200/50 bg-gradient-to-b from-amber-50 to-amber-100/80 px-8 py-10 shadow-2xl">
            {rollOverlay.phase === "rolling" ? (
              <>
                <p className="mb-6 text-lg font-semibold uppercase tracking-widest text-amber-900/80">
                  Rolling…
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  {parseExpressionSides(rollOverlay.expression).map((sides, i) => (
                    <TumblingDie
                      key={i}
                      sides={sides}
                      finalValue={1}
                      isRevealing={false}
                      colorClass="bg-amber-100 text-amber-900 border-2 border-amber-300/60"
                    />
                  ))}
                </div>
                <p className="mt-6 text-xs text-amber-800/70">The dice tumble through fate…</p>
              </>
            ) : (
              (() => {
                const { data } = rollOverlay;
                const termSides = parseExpressionSides(data.expression);
                const isNat20 = data.results.some((r, i) => (termSides[i] ?? 20) === 20 && r === 20);
                const isNat1 = data.results.some((r, i) => (termSides[i] ?? 20) === 20 && r === 1);
                const label = data.rollName
                  ? `${data.participantName} · ${data.rollName}`
                  : data.participantName;
                return (
                  <div className="flex flex-col items-center">
                    <div className="flex flex-wrap justify-center gap-2">
                      {termSides.map((sides, i) => (
                        <TumblingDie
                          key={i}
                          sides={sides}
                          finalValue={data.results[i] ?? 0}
                          isRevealing
                          colorClass={diceColor(data.results[i] ?? 0, sides)}
                        />
                      ))}
                    </div>
                    <div
                      className={`mt-4 flex flex-col items-center ${
                        isNat20 ? "animate-crit-glow rounded-2xl px-8 py-3" : ""
                      }`}
                    >
                      <span
                        className={`font-bold tabular-nums ${
                          isNat20
                            ? "text-5xl text-amber-600"
                            : isNat1
                              ? "text-5xl text-rose-600 animate-fumble-shake"
                              : "text-5xl text-zinc-800"
                        }`}
                      >
                        {data.total}
                      </span>
                      <p className="mt-2 text-sm font-medium text-amber-800/90">{label}</p>
                    </div>
                    {isNat20 ? (
                      <p className="mt-4 text-lg font-bold text-amber-600">★ Critical! ★</p>
                    ) : isNat1 ? (
                      <p className="mt-4 text-lg font-bold text-rose-600">… Fumble …</p>
                    ) : null}
                  </div>
                );
              })()
            )}
          </div>
        </div>
      ) : null}

      <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Room</p>
            <h1 className="text-2xl font-semibold">{room.name}</h1>
            <p className="text-sm text-zinc-500">Session: {room.sessionState}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-lg border-2 border-zinc-200 bg-zinc-50 px-4 py-2 font-mono text-sm font-semibold tracking-wider text-zinc-800 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
              onClick={handleCopyInviteCode}
              title="Click to copy"
            >
              {room.inviteCode}
            </button>
            {inviteCopied ? (
              <span className="text-xs font-medium text-emerald-600">Copied!</span>
            ) : (
              <span className="text-[11px] text-zinc-500">Click to copy</span>
            )}
            {inviteCopyError ? <span className="text-xs text-amber-600">{inviteCopyError}</span> : null}
            <button
              className="rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
              onClick={leaveRoom}
            >
              Leave room
            </button>
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
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Channels</p>
              <button
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-200 text-sm font-semibold text-zinc-700 hover:bg-zinc-100"
                onClick={() => {
                  setChannelCreateOpen((prev) => !prev);
                  setChannelCreateError(null);
                }}
                aria-label="Add channel"
              >
                +
              </button>
            </div>
            {channelCreateOpen ? (
              <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2">
                <select
                  className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs"
                  value={channelCreateType}
                  onChange={(event) => setChannelCreateType(event.target.value as "text" | "voice" | "dice")}
                >
                  <option value="text">Text channel</option>
                  <option value="voice">Voice channel</option>
                  <option value="dice">Dice channel</option>
                </select>
                <input
                  className="mt-2 w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs"
                  placeholder="Channel name"
                  value={channelCreateName}
                  onChange={(event) => setChannelCreateName(event.target.value)}
                />
                <div className="mt-2 flex gap-2">
                  <button
                    className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                    onClick={createChannel}
                    disabled={channelCreating}
                  >
                    {channelCreating ? "Adding..." : "Add"}
                  </button>
                  <button
                    className="rounded-full border border-zinc-200 px-3 py-1 text-[11px] font-semibold text-zinc-700"
                    onClick={() => setChannelCreateOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
                {channelCreateError ? (
                  <p className="mt-2 text-[11px] text-amber-600">{channelCreateError}</p>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Text Channels</p>
              <div className="mt-2 space-y-1">
                {textChannels.map((channel) => (
                  <button
                    key={channel.id}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm ${
                      selectedChannel?.id === channel.id ? "bg-zinc-900 text-white" : "hover:bg-zinc-100"
                    }`}
                    onClick={() => setSelectedChannelId(channel.id)}
                  >
                    <span>#{channel.name}</span>
                    {(unreadByChannel[channel.id] ?? 0) > 0 ? (
                      <span
                        className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          selectedChannel?.id === channel.id
                            ? "bg-white text-zinc-900"
                            : "bg-zinc-900 text-white"
                        }`}
                      >
                        {unreadByChannel[channel.id]}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
            {diceChannels.length > 0 ? (
              <div className="mt-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Dice</p>
                <div className="mt-2 space-y-1">
                  {diceChannels.map((channel) => (
                    <button
                      key={channel.id}
                      className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm ${
                        selectedChannel?.id === channel.id ? "bg-zinc-900 text-white" : "hover:bg-zinc-100"
                      }`}
                      onClick={() => setSelectedChannelId(channel.id)}
                    >
                      🎲 {channel.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Voice Channels</p>
              <div className="mt-2 space-y-1">
                {voiceChannels.map((channel) => (
                  <div key={channel.id}>
                    <button
                      className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm ${
                        selectedChannel?.id === channel.id ? "bg-zinc-900 text-white" : "hover:bg-zinc-100"
                      }`}
                      onClick={() => setSelectedChannelId(channel.id)}
                    >
                      🔊 {channel.name}
                    </button>
                    {(voiceMembersBySlug[channel.slug] ?? []).length > 0 ? (
                      <div className="ml-4 mt-1 space-y-1">
                        {(voiceMembersBySlug[channel.slug] ?? []).map((member) => (
                          <p key={member.id} className="text-[11px] text-zinc-500">
                            {member.name}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            {channelsError ? <p className="mt-3 text-xs text-amber-600">{channelsError}</p> : null}
          </aside>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            {selectedChannel?.type === "dice" ? (
              <div>
                <h3 className="text-base font-semibold">🎲 {selectedChannel.name}</h3>
                <p className="mt-1 text-xs text-zinc-500">Full roll history for this room</p>
                <div
                  ref={chatContainerRef}
                  className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3"
                >
                  {rolls.length === 0 ? (
                    <p className="text-xs text-zinc-500">No rolls yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {rolls.map((roll) => {
                        const termSides = getTermSides(roll);
                        const hasNat20 = termSides.some((s, i) => s === 20 && (roll.results[i] ?? 0) === 20);
                        const hasNat1 = termSides.some((s, i) => s === 20 && (roll.results[i] ?? 0) === 1);
                        return (
                          <div
                            key={roll.id}
                            className={`rounded-xl border-2 bg-gradient-to-br from-white to-amber-50/30 p-4 shadow-sm transition hover:shadow-md ${
                              hasNat20 ? "border-amber-300 shadow-amber-100/50" : hasNat1 ? "border-rose-200" : "border-amber-200/60"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex flex-wrap gap-2">
                                {termSides.map((sides, i) => (
                                  <span
                                    key={i}
                                    className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-base font-bold shadow-sm ${diceColor(roll.results[i] ?? 0, sides)}`}
                                  >
                                    {roll.results[i]}
                                  </span>
                                ))}
                              </div>
                              <span className="text-2xl font-bold tabular-nums text-zinc-800">
                                {roll.total}
                              </span>
                            </div>
                            <p className="mt-2 text-xs font-medium text-zinc-600">
                              {roll.rollName ? (
                                <>
                                  <span className="text-amber-700">{roll.rollName}</span>
                                  <span className="mx-1.5">·</span>
                                  {roll.participantName}
                                </>
                              ) : (
                                roll.participantName
                              )}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : selectedChannel?.type === "text" ? (
              <div>
                <h3 className="text-base font-semibold">#{selectedChannel.name}</h3>
                <div
                  ref={chatContainerRef}
                  className="mt-3 h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3"
                  onScroll={(event) => {
                    const target = event.currentTarget;
                    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
                    shouldStickToBottomRef.current = distanceToBottom < 24;
                  }}
                >
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
                  Configure audio mode, then join this selected voice channel.
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
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {joinedInSelectedVoice ? (
                    <button
                      className="rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white"
                      onClick={handleQuitCall}
                    >
                      Leave this channel
                    </button>
                  ) : (
                    <button
                      className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white"
                      onClick={handleJoinCall}
                    >
                      {callJoined ? "Switch to this channel" : "Join this channel"}
                    </button>
                  )}
                  <span className="text-xs text-zinc-500">
                    {callJoined
                      ? joinedInSelectedVoice
                        ? "You are connected to this voice channel."
                        : `Currently connected in ${joinedVoiceSlug ?? "another channel"}.`
                      : "Not connected to voice yet."}
                  </span>
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
                {/* Start/End session: marks room as active/ended, records timestamps for admin metrics. Hidden for now. */}
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
                <>
                  <div className="mt-2 flex items-center gap-2">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={floatVideos}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setFloatVideos(v);
                          localStorage.setItem("aynfrp:floatVideos", v ? "1" : "0");
                        }}
                      />
                      <span>Float videos on right</span>
                    </label>
                  </div>
                  <div
                    className={`mt-4 rounded-xl border border-zinc-200 ${
                      floatVideos ? "fixed right-4 top-24 z-50 w-[min(420px,calc(100vw-2rem))] shadow-xl" : ""
                    }`}
                  >
                    {callToken ? (
                      <div className={`w-full bg-zinc-100 ${floatVideos ? "aspect-video min-h-[280px]" : "h-[70vh] min-h-[520px]"}`}>
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
                        <div className={`flex items-center justify-center text-sm text-zinc-500 ${floatVideos ? "min-h-[200px]" : "h-[70vh] min-h-[520px]"}`}>
                          Connecting to room {callRoomName}...
                        </div>
                      )}
                  </div>
                </>
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

            <div className="rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-6 shadow-md">
              <h2 className="text-lg font-bold text-amber-900">⚔ Initiative tracker</h2>
              <p className="text-xs text-amber-700/80">Roll to see who strikes first. GM rolls for monsters, you roll for you.</p>
              {canManageSession ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    className="rounded-full bg-amber-600 px-4 py-2 text-xs font-semibold text-white"
                    onClick={startInitiative}
                  >
                    Start initiative
                  </button>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <input
                  className="w-24 rounded-lg border border-zinc-200 px-2 py-1.5 text-sm"
                  value={initiativeExpression}
                  onChange={(e) => setInitiativeExpression(e.target.value)}
                  placeholder="1d20"
                />
                {canManageSession ? (
                  <>
                    <input
                      className="w-28 rounded-lg border border-zinc-200 px-2 py-1.5 text-sm"
                      placeholder="Creature name"
                      value={initiativeCreatureName}
                      onChange={(e) => setInitiativeCreatureName(e.target.value)}
                    />
                    <button
                      className="rounded-full bg-zinc-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      onClick={() => addInitiativeEntry(true, undefined, initiativeCreatureName)}
                      disabled={initiativeAdding || !initiativeCreatureName.trim()}
                    >
                      Add creature
                    </button>
                  </>
                ) : null}
                <button
                  className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  onClick={() => addInitiativeEntry(false)}
                  disabled={initiativeAdding}
                >
                  Add me
                </button>
              </div>
              {initiativeEntries.length > 0 ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
                      {initiativeState.currentTurnEntryId ? (
                        <span className="rounded-full bg-amber-400/80 px-1.5 text-amber-900" title="Current turn">⚔</span>
                      ) : null}
                      Round {initiativeState.roundCount + 1} · Turn {initiativeState.turnCount}
                    </span>
                    {canManageSession ? (
                      <span className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          className="w-14 rounded border border-zinc-200 px-2 py-0.5 text-xs"
                          placeholder="Turn #"
                          value={initiativeTurnCountInput}
                          onChange={(e) => setInitiativeTurnCountInput(e.target.value)}
                          onKeyDown={(e) =>
                            e.key === "Enter" && (() => {
                              const n = parseInt(initiativeTurnCountInput, 10);
                              if (!isNaN(n) && n >= 0) {
                                setInitiativeTurnCount(n);
                                setInitiativeTurnCountInput("");
                              }
                            })()
                          }
                        />
                        <button
                          className="rounded border border-zinc-200 px-2 py-0.5 text-[10px] hover:bg-zinc-100"
                          onClick={() => {
                            const n = parseInt(initiativeTurnCountInput, 10);
                            if (!isNaN(n) && n >= 0) {
                              setInitiativeTurnCount(n);
                              setInitiativeTurnCountInput("");
                            }
                          }}
                        >
                          Set
                        </button>
                      </span>
                    ) : null}
                  </div>
                  <button
                    className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={nextTurn}
                    disabled={
                      initiativeEntries.filter((e) => e.isAlive !== false).length === 0 ||
                      (!canManageSession &&
                        initiativeEntries.find((e) => e.id === initiativeState.currentTurnEntryId)?.participantId !==
                          participantId)
                    }
                    title={
                      canManageSession
                        ? "Advance to next turn (GM can pass anytime)"
                        : "Pass to next (only when it's your turn)"
                    }
                  >
                    Next turn
                  </button>
                </div>
              ) : null}
              {initiativeError ? <p className="mt-2 text-xs text-amber-600">{initiativeError}</p> : null}
              <div className="mt-4 space-y-1">
                {initiativeEntries.length === 0 ? (
                  <p className="text-xs text-zinc-500">No initiative yet.</p>
                ) : (
                  initiativeEntries.map((e, i) => {
                    const isCurrentTurn = e.id === initiativeState.currentTurnEntryId;
                    const isCreature = !!e.creatureName;
                    const displayName = e.creatureName ?? e.participantName ?? "—";
                    const isDead = e.isAlive === false;
                    const isCrit = e.result === 20;
                    const isFumble = e.result === 1;
                    return (
                      <div
                        key={e.id}
                        className={`flex items-center justify-between gap-2 rounded-xl border-2 px-3 py-2.5 text-sm transition-all ${
                          isCurrentTurn
                            ? "border-amber-500 bg-gradient-to-r from-amber-100 to-yellow-100 shadow-md ring-2 ring-amber-300/50"
                            : "border-amber-200/80 bg-white/80"
                        } ${isDead ? "opacity-55 grayscale-[0.3]" : ""}`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="flex shrink-0 items-center gap-1 font-bold text-amber-900">
                            {i + 1}.
                            {isCurrentTurn ? (
                              <span className="rounded bg-amber-400 p-0.5 text-amber-900" title="Your turn!">⚔</span>
                            ) : null}
                            {displayName}
                          </span>
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-0.5 font-mono text-sm font-bold ${
                              isCrit
                                ? "bg-amber-200/90 text-amber-900"
                                : isFumble
                                  ? "bg-rose-200/90 text-rose-900"
                                  : "bg-zinc-200/90 text-zinc-800"
                            }`}
                            title={`${e.expression} = ${e.result}`}
                          >
                            <span className="text-[10px] opacity-75">{e.expression}</span>
                            <span className="tabular-nums">{e.result}</span>
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            className="rounded-lg p-1.5 text-base transition hover:scale-110 hover:bg-zinc-200/80"
                            onClick={() => toggleInitiativeAlive(e.id)}
                            title={isDead ? "Mark alive" : "Mark dead"}
                          >
                            {isDead ? <span title="Mark alive">❤️</span> : <span title="Mark dead">💀</span>}
                          </button>
                          {canManageSession && isCreature ? (
                            <button
                              className="rounded px-2 py-1 text-[10px] font-medium text-rose-600 hover:bg-rose-100"
                              onClick={() => removeInitiativeEntry(e.id)}
                              title="Remove creature"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Dice</h2>
              {previousRoll ? (
                <p className="mt-3 text-xs text-zinc-500">
                  Previous: {previousRoll.participantName} → {previousRoll.total}
                  {previousRoll.expression ? ` (${previousRoll.expression})` : ""}
                </p>
              ) : null}
              {lastRoll ? (
                <div className="mt-4 rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-center">
                  <p className="text-xs font-medium text-amber-800">{lastRoll.participantName}</p>
                  <p className="mt-1 text-4xl font-bold tabular-nums text-amber-900">
                    {lastRoll.total}
                  </p>
                  <p className="mt-1 flex flex-wrap justify-center gap-1 text-sm">
                    {getTermSides(lastRoll).map((sides, i) => (
                      <span
                        key={i}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-md font-bold tabular-nums ${diceColor(lastRoll.results[i] ?? 0, sides)}`}
                        title={`d${sides}`}
                      >
                        {lastRoll.results[i]}
                      </span>
                    ))}
                  </p>
                </div>
              ) : null}
              <div className="mt-6 space-y-4">
                <div className="rounded-xl border-2 border-amber-200/60 bg-amber-50/50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700/80">
                    Ready to roll
                  </p>
                  <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-amber-900">
                    {(diceExpression.trim() || "d20")}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <input
                      className="min-w-[160px] rounded-lg border-2 border-amber-200/80 bg-white px-4 py-2.5 font-mono text-sm"
                      value={diceExpression}
                      onChange={(e) => setDiceExpression(e.target.value)}
                      placeholder="d20, 2d6+3, d100"
                    />
                    <button
                      className={`rounded-xl px-8 py-3 text-base font-bold text-white shadow-md transition ${rollingDice ? "animate-bounce bg-amber-500" : "bg-amber-600 hover:bg-amber-500"}`}
                      onClick={() => rollDice()}
                      disabled={rollingDice}
                    >
                      {rollingDice ? "Rolling…" : "Roll"}
                    </button>
                    {namedRollInput !== null ? (
                      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2">
                        <input
                          className="w-28 rounded border border-zinc-200 px-2 py-1.5 text-sm"
                          placeholder="e.g. damage"
                          value={namedRollInput}
                          onChange={(e) => setNamedRollInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && saveNamedRoll(namedRollInput)}
                          autoFocus
                        />
                        <button
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                          onClick={() => saveNamedRoll(namedRollInput)}
                        >
                          Save
                        </button>
                        <button
                          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium"
                          onClick={() => setNamedRollInput(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="rounded-lg border-2 border-dashed border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-600 hover:border-amber-300 hover:text-amber-700"
                        onClick={() => setNamedRollInput("")}
                        title="Save this roll with a name for quick access"
                      >
                        + Save as…
                      </button>
                    )}
                  </div>
                </div>
                {Object.keys(namedRolls).length > 0 ? (
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Saved rolls
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(namedRolls).map(([name, expr]) => (
                        <button
                          key={name}
                          className="group flex items-center gap-2 rounded-xl border-2 border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-medium transition hover:border-amber-300 hover:bg-amber-50"
                          onClick={() => { setDiceExpression(expr); rollDice(expr, name); }}
                          title={`${name}: ${expr} — click to roll`}
                        >
                          <span className="text-zinc-800">{name}</span>
                          <span className="font-mono text-xs text-zinc-500">{expr}</span>
                          <span
                            className="ml-1 rounded-full p-1 text-zinc-400 opacity-0 transition hover:bg-zinc-200 hover:text-rose-600 group-hover:opacity-100"
                            onClick={(e) => { e.stopPropagation(); removeNamedRoll(name); }}
                            title="Remove"
                          >
                            ×
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Quick:</span>
                  {["d20", "d12", "d100", "2d6+3"].map((expr) => (
                    <button
                      key={expr}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-sm font-medium hover:bg-amber-50 hover:border-amber-200"
                      onClick={() => { setDiceExpression(expr); rollDice(expr); }}
                    >
                      {expr}
                    </button>
                  ))}
                  {canManageSession ? (
                    <button
                      className="ml-4 rounded-lg border border-rose-200 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                      onClick={clearRollLog}
                      title="Only GM/admin can clear"
                    >
                      Clear log
                    </button>
                  ) : null}
                </div>
              </div>
              {diceError ? <p className="mt-3 text-xs text-amber-600">{diceError}</p> : null}
              <p className="mt-3 text-[11px] text-zinc-500">
                Roll again if wrong — previous stays visible. Full history in 🎲 dice channel.
              </p>
              <div className="mt-3 space-y-3 max-h-48 overflow-y-auto">
                {rolls.length === 0 ? (
                  <p className="text-xs text-zinc-500">No rolls yet.</p>
                ) : (
                  rolls.slice(0, 8).map((roll) => {
                    const termSides = getTermSides(roll);
                    const hasNat20 = termSides.some((s, i) => s === 20 && (roll.results[i] ?? 0) === 20);
                    const hasNat1 = termSides.some((s, i) => s === 20 && (roll.results[i] ?? 0) === 1);
                    return (
                      <div
                        key={roll.id}
                        className={`rounded-xl border-2 bg-gradient-to-br from-white to-amber-50/30 p-4 shadow-sm transition hover:shadow-md ${
                          hasNat20 ? "border-amber-300 shadow-amber-100/50" : hasNat1 ? "border-rose-200" : "border-amber-200/60"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex flex-wrap gap-1.5">
                            {termSides.map((sides, i) => (
                              <span
                                key={i}
                                className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold shadow-sm ${diceColor(roll.results[i] ?? 0, sides)}`}
                              >
                                {roll.results[i]}
                              </span>
                            ))}
                          </div>
                          <span className="text-xl font-bold tabular-nums text-zinc-800">
                            {roll.total}
                          </span>
                        </div>
                        <p className="mt-2 text-[11px] font-medium text-zinc-600">
                          {roll.rollName ? (
                            <>
                              <span className="text-amber-700">{roll.rollName}</span>
                              <span className="mx-1">·</span>
                              {roll.participantName}
                            </>
                          ) : (
                            roll.participantName
                          )}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {canManageSession ? (
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold">Background music</h2>
                <p className="text-xs text-zinc-500">YouTube URL (admin/GM only)</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    className="min-w-[200px] flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                    value={musicUrl}
                    onChange={(e) => setMusicUrl(e.target.value)}
                    placeholder="https://youtube.com/watch?v=..."
                  />
                  <button
                    className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white"
                    onClick={() => void setBackgroundMusic()}
                  >
                    Set
                  </button>
                  <button
                    className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold"
                    onClick={() => { setMusicUrl(""); void setBackgroundMusic(""); }}
                  >
                    Clear
                  </button>
                </div>
                {musicError ? <p className="mt-2 text-xs text-amber-600">{musicError}</p> : null}
                {room?.backgroundMusicUrl ? (
                  <div className="mt-3 aspect-video max-w-md overflow-hidden rounded-lg">
                    <iframe
                      className="h-full w-full"
                      src={room.backgroundMusicUrl}
                      title="Background music"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    />
                  </div>
                ) : null}
              </div>
            ) : room?.backgroundMusicUrl ? (
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold">Background music</h2>
                <div className="mt-3 aspect-video max-w-md overflow-hidden rounded-lg">
                  <iframe
                    className="h-full w-full"
                    src={room.backgroundMusicUrl}
                    title="Background music"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  />
                </div>
              </div>
            ) : null}

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
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Participants</h2>
                <button
                  className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
                  onClick={() => void refreshParticipants()}
                  title="Refresh"
                  aria-label="Refresh participants"
                >
                  ↻
                </button>
              </div>
              <div className="mt-4 space-y-2 text-sm">
                {participants.length === 0 ? (
                  <p className="text-zinc-500">No participants yet.</p>
                ) : (
                  participants.map((person) => {
                    const { label: lastSeenLabel, online } = formatLastSeen(person.lastSeen);
                    return (
                      <div key={person.id} className="flex items-center justify-between gap-2">
                        <div>
                          <span>{person.name}</span>
                          <span className="ml-2 text-xs text-zinc-500">
                            {person.role === "gm" ? "GM" : person.role === "admin" ? "Admin" : "Player"}
                          </span>
                          <span className={`ml-2 text-[10px] ${online ? "text-emerald-600 font-medium" : "text-zinc-400"}`}>
                            {online ? "● Online" : lastSeenLabel}
                          </span>
                        </div>
                        {canKick && person.id !== participantId ? (
                          <button
                            className="rounded px-2 py-1 text-[10px] font-semibold text-rose-600 hover:bg-rose-100"
                            onClick={() => kickParticipant(person.id)}
                          >
                            Kick
                          </button>
                        ) : null}
                      </div>
                    );
                  })
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
            {(currentParticipant?.role === "admin" || isRoomAdmin) ? (
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
    </>
  );
}
