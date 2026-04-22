import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { mapParticipantRole, mapSessionState } from "@/server/room-mappers";
import { resolveRoomParticipantAccess } from "@/server/room-participant-session";
import { ensureOnlineAdmin } from "@/server/room-admin";

const CALL_STALE_MS = 3 * 60 * 1000;
const DISPLAY_NAME_MAX = 40;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;

  await prisma.participant.updateMany({
    where: {
      roomId,
      inCall: true,
      lastSeen: { lt: new Date(Date.now() - CALL_STALE_MS) },
    },
    data: { inCall: false, micOn: false, camOn: false, callChannelSlug: null },
  });

  // Make sure an online user always holds the admin role. This runs on every
  // participants poll so that if the admin disconnects (closes browser,
  // network drop, sleeps laptop) the role is handed off to another online
  // participant automatically.
  await ensureOnlineAdmin(roomId);

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: {
      sessionState: true,
      participants: {
        orderBy: { joinedAt: "asc" },
      },
    },
  });
  if (!room) {
    return fail("room_not_found", "Room not found", 404);
  }

  return ok({
    participants: room.participants.map((participant: (typeof room.participants)[number]) => ({
      id: participant.id,
      name: participant.name,
      role: mapParticipantRole(participant.role),
      joinedAt: participant.joinedAt.toISOString(),
      lastSeen: participant.lastSeen.toISOString(),
      inCall: participant.inCall,
      micOn: participant.micOn,
      camOn: participant.camOn,
      callChannelSlug: participant.callChannelSlug,
    })),
    sessionState: mapSessionState(room.sessionState),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  if (!body) {
    return fail("invalid_body", "Request body must be JSON");
  }

  const { participantId, displayName } = body as {
    participantId?: string;
    displayName?: string;
  };
  const trimmedName = displayName?.trim() ?? "";
  if (!trimmedName) {
    return fail("missing_fields", "Display name is required");
  }
  if (trimmedName.length > DISPLAY_NAME_MAX) {
    return fail(
      "name_too_long",
      `Display name must be ${DISPLAY_NAME_MAX} characters or fewer`
    );
  }

  const access = await resolveRoomParticipantAccess({ request, roomId, participantId });
  if ("error" in access) {
    return access.error;
  }

  const updated = await prisma.participant.update({
    where: { id: access.participant.id },
    data: { name: trimmedName, lastSeen: new Date() },
  });

  return ok({
    participant: {
      id: updated.id,
      name: updated.name,
      role: mapParticipantRole(updated.role),
    },
  });
}
