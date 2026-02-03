export type RoomPrivacy = "public" | "private";
export type SessionState = "waiting" | "active" | "ended";
export type ParticipantRole = "gm" | "player" | "admin";

export type Participant = {
  id: string;
  name: string;
  role: ParticipantRole;
  joinedAt: string;
  lastSeen: string;
  inCall: boolean;
  micOn: boolean;
  camOn: boolean;
};

export type Roll = {
  id: string;
  participantId: string;
  participantName: string;
  sides: number;
  count: number;
  results: number[];
  total: number;
  createdAt: string;
};

export type Room = {
  id: string;
  name: string;
  privacy: RoomPrivacy;
  inviteCode: string;
  gmId: string;
  participants: Record<string, Participant>;
  sessionState: SessionState;
  rolls: Roll[];
  recap?: string;
  createdAt: string;
  sessionStartedAt?: string;
  sessionEndedAt?: string;
};

type AdminDefaults = {
  roomNamePrefix?: string;
  privacy?: RoomPrivacy;
};

type Metrics = {
  sessionsStarted: number;
  sessionsEnded: number;
  uniqueParticipants: Set<string>;
};

type Store = {
  rooms: Map<string, Room>;
  invites: Map<string, string>;
  adminDefaults: AdminDefaults;
  metrics: Metrics;
};

const STORE_KEY = "__aynfrpStore" as const;

function getStore(): Store {
  const globalAny = globalThis as typeof globalThis & { [STORE_KEY]?: Store };
  if (!globalAny[STORE_KEY]) {
    globalAny[STORE_KEY] = {
      rooms: new Map(),
      invites: new Map(),
      adminDefaults: {},
      metrics: {
        sessionsStarted: 0,
        sessionsEnded: 0,
        uniqueParticipants: new Set(),
      },
    };
  }

  return globalAny[STORE_KEY];
}

function nowIso() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function generateInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function createRoom(params: { name: string; privacy?: RoomPrivacy; gmName: string }) {
  const store = getStore();
  const defaults = store.adminDefaults;
  const privacy = params.privacy ?? defaults.privacy ?? "private";
  const namePrefix = defaults.roomNamePrefix ?? "";
  const room: Room = {
    id: id(),
    name: `${namePrefix}${params.name}`.trim(),
    privacy,
    inviteCode: generateInviteCode(),
    gmId: "",
    participants: {},
    sessionState: "waiting",
    rolls: [],
    createdAt: nowIso(),
  };

  const gmParticipant = createParticipant({
    name: params.gmName,
    role: "gm",
  });
  room.gmId = gmParticipant.id;
  room.participants[gmParticipant.id] = gmParticipant;

  store.rooms.set(room.id, room);
  store.invites.set(room.inviteCode, room.id);
  store.metrics.uniqueParticipants.add(gmParticipant.id);

  return room;
}

export function getRoom(roomId: string) {
  return getStore().rooms.get(roomId) ?? null;
}

export function getRoomByInvite(inviteCode: string) {
  const store = getStore();
  const roomId = store.invites.get(inviteCode.toUpperCase());
  if (!roomId) return null;
  return store.rooms.get(roomId) ?? null;
}

export function createInvite(roomId: string) {
  const store = getStore();
  const room = store.rooms.get(roomId);
  if (!room) return null;
  if (!room.inviteCode) {
    room.inviteCode = generateInviteCode();
  }
  store.invites.set(room.inviteCode, room.id);
  return room.inviteCode;
}

export function createParticipant(params: { name: string; role: ParticipantRole }) {
  const participant: Participant = {
    id: id(),
    name: params.name,
    role: params.role,
    joinedAt: nowIso(),
    lastSeen: nowIso(),
    inCall: false,
    micOn: false,
    camOn: false,
  };
  return participant;
}

export function joinRoom(room: Room, name: string) {
  const participant = createParticipant({ name, role: "player" });
  room.participants[participant.id] = participant;
  getStore().metrics.uniqueParticipants.add(participant.id);
  return participant;
}

export function touchParticipant(room: Room, participantId?: string) {
  if (!participantId) return;
  const participant = room.participants[participantId];
  if (!participant) return;
  participant.lastSeen = nowIso();
}

export function setSessionState(room: Room, state: SessionState) {
  if (state === room.sessionState) return;
  room.sessionState = state;

  if (state === "active") {
    room.sessionStartedAt = nowIso();
    getStore().metrics.sessionsStarted += 1;
  }

  if (state === "ended") {
    room.sessionEndedAt = nowIso();
    getStore().metrics.sessionsEnded += 1;
  }
}

export function addRoll(room: Room, participant: Participant, sides: number, count: number) {
  const results = Array.from({ length: count }, () => Math.ceil(Math.random() * sides));
  const roll: Roll = {
    id: id(),
    participantId: participant.id,
    participantName: participant.name,
    sides,
    count,
    results,
    total: results.reduce((sum, value) => sum + value, 0),
    createdAt: nowIso(),
  };
  room.rolls.unshift(roll);
  room.rolls = room.rolls.slice(0, 50);
  return roll;
}

export function clearRolls(room: Room) {
  room.rolls = [];
}

export function setRecap(room: Room, recap: string) {
  room.recap = recap;
}

export function getMetrics() {
  const metrics = getStore().metrics;
  return {
    sessionsStarted: metrics.sessionsStarted,
    sessionsEnded: metrics.sessionsEnded,
    uniqueParticipants: metrics.uniqueParticipants.size,
  };
}

export function getAdminDefaults() {
  return getStore().adminDefaults;
}

export function setAdminDefaults(defaults: AdminDefaults) {
  const store = getStore();
  store.adminDefaults = {
    ...store.adminDefaults,
    ...defaults,
  };
  return store.adminDefaults;
}

export function listRooms() {
  return Array.from(getStore().rooms.values());
}
