import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { mapPrivacy, mapSessionState } from "@/server/room-mappers";
import { resolveRoomParticipantAccess } from "@/server/room-participant-session";

const MAX_ROOM_NAME_LENGTH = 120;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: {
      id: true,
      name: true,
      type: true,
      privacy: true,
      inviteCode: true,
      sessionState: true,
      gmParticipantId: true,
      recap: true,
      backgroundMusicUrl: true,
      createdByParticipantId: true,
      _count: { select: { participants: true } },
    },
  });
  if (!room) {
    return fail("room_not_found", "Room not found", 404);
  }

  return ok({
    id: room.id,
    name: room.name,
    type: room.type,
    privacy: mapPrivacy(room.privacy),
    inviteCode: room.inviteCode,
    sessionState: mapSessionState(room.sessionState),
    gmId: room.gmParticipantId,
    createdByParticipantId: room.createdByParticipantId ?? null,
    participantCount: room._count.participants,
    recap: room.recap ?? null,
    backgroundMusicUrl: room.backgroundMusicUrl ?? null,
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

  const participantId = body?.participantId as string | undefined;
  const rawName = body?.name as string | undefined;
  const trimmedName = rawName?.trim();

  if (trimmedName === undefined) {
    return fail("missing_fields", "No fields to update");
  }
  if (!trimmedName) {
    return fail("invalid_name", "Room name cannot be empty");
  }
  if (trimmedName.length > MAX_ROOM_NAME_LENGTH) {
    return fail("invalid_name", `Room name must be at most ${MAX_ROOM_NAME_LENGTH} characters`);
  }

  const [access, existing] = await Promise.all([
    resolveRoomParticipantAccess({ request, roomId, participantId }),
    prisma.room.findUnique({
      where: { id: roomId },
      select: { createdByParticipantId: true },
    }),
  ]);
  if ("error" in access) {
    return access.error;
  }
  if (!existing) {
    return fail("room_not_found", "Room not found", 404);
  }

  const requester = access.participant;
  const isAdmin = requester.role === "ADMIN";
  const isRoomCreator = existing.createdByParticipantId === requester.id;
  if (!isAdmin && !isRoomCreator) {
    return fail("forbidden", "Only admin or room creator can rename the room", 403);
  }

  const updated = await prisma.room.update({
    where: { id: roomId },
    data: { name: trimmedName },
    select: { id: true, name: true },
  });

  return ok({ id: updated.id, name: updated.name });
}
