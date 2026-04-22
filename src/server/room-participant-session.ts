import { createHmac, timingSafeEqual } from "node:crypto";

import { Prisma } from "@prisma/client";
import { type NextRequest, NextResponse } from "next/server";

import { fail } from "@/server/api";
import { getCurrentUserRecord } from "@/server/current-user";
import { prisma } from "@/server/db";

const ROOM_PARTICIPANT_COOKIE_PREFIX = "aynfrp-room-participant";
const ROOM_PARTICIPANT_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 30;

const ROOM_PARTICIPANT_SELECT = {
  id: true,
  roomId: true,
  userId: true,
  name: true,
  role: true,
  joinedAt: true,
  lastSeen: true,
  inCall: true,
  micOn: true,
  camOn: true,
  callChannelSlug: true,
} as const;

type RoomParticipantRecord = Prisma.ParticipantGetPayload<{
  select: typeof ROOM_PARTICIPANT_SELECT;
}>;

type RoomParticipantSession = {
  roomId: string;
  participantId: string;
};

type ResolveRoomParticipantResult =
  | {
      participant: NonNullable<RoomParticipantRecord>;
      currentUser: Awaited<ReturnType<typeof getCurrentUserRecord>>;
    }
  | {
      error: NextResponse;
    };

function getSessionSecret() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV !== "production") {
    return "aynfrp-dev-room-participant-secret";
  }
  throw new Error("AUTH_SECRET or NEXTAUTH_SECRET must be configured");
}

function getRoomParticipantCookieName(roomId: string) {
  return `${ROOM_PARTICIPANT_COOKIE_PREFIX}:${roomId}`;
}

function signRoomParticipantSession(session: RoomParticipantSession) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyRoomParticipantSession(value: string | undefined | null) {
  if (!value) {
    return null;
  }

  const [payload, signature] = value.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<RoomParticipantSession>;
    if (typeof parsed.roomId !== "string" || typeof parsed.participantId !== "string") {
      return null;
    }
    return {
      roomId: parsed.roomId,
      participantId: parsed.participantId,
    };
  } catch {
    return null;
  }
}

export function attachRoomParticipantSession(
  response: NextResponse,
  session: RoomParticipantSession
) {
  response.cookies.set({
    name: getRoomParticipantCookieName(session.roomId),
    value: signRoomParticipantSession(session),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ROOM_PARTICIPANT_COOKIE_TTL_SECONDS,
  });
  return response;
}

export function clearRoomParticipantSession(response: NextResponse, roomId: string) {
  response.cookies.set({
    name: getRoomParticipantCookieName(roomId),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function resolveRoomParticipantAccess(params: {
  request: NextRequest;
  roomId: string;
  participantId?: string | null;
  allowAnonymous?: boolean;
}): Promise<ResolveRoomParticipantResult> {
  const requestedParticipantId = params.participantId?.trim() || null;
  const currentUser = await getCurrentUserRecord();

  if (currentUser) {
    const participant = await prisma.participant.findFirst({
      where: {
        roomId: params.roomId,
        userId: currentUser.id,
        ...(requestedParticipantId ? { id: requestedParticipantId } : {}),
      },
      orderBy: { lastSeen: "desc" },
      select: ROOM_PARTICIPANT_SELECT,
    });

    if (!participant) {
      return {
        error: fail(
          requestedParticipantId ? "forbidden" : "participant_not_found",
          requestedParticipantId
            ? "You do not have access to that participant in this room"
            : "Join the room first to perform this action",
          requestedParticipantId ? 403 : 404
        ),
      };
    }

    return { participant, currentUser };
  }

  if (params.allowAnonymous === false) {
    return {
      error: fail("unauthorized", "Sign in is required for this action", 401),
    };
  }

  const session = verifyRoomParticipantSession(
    params.request.cookies.get(getRoomParticipantCookieName(params.roomId))?.value
  );
  if (!session || session.roomId !== params.roomId) {
    return {
      error: fail("unauthorized", "Join the room first to perform this action", 401),
    };
  }

  if (requestedParticipantId && requestedParticipantId !== session.participantId) {
    return {
      error: fail("forbidden", "Active room session does not match the requested participant", 403),
    };
  }

  const participant = await prisma.participant.findFirst({
    where: {
      id: session.participantId,
      roomId: params.roomId,
      userId: null,
    },
    select: ROOM_PARTICIPANT_SELECT,
  });
  if (!participant) {
    return {
      error: fail("participant_not_found", "Participant not found", 404),
    };
  }

  return { participant, currentUser: null };
}
