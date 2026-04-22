import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { ensureOnlineAdmin } from "@/server/room-admin";
import {
  clearRoomParticipantSession,
  resolveRoomParticipantAccess,
} from "@/server/room-participant-session";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const participantId = body?.participantId as string | undefined;
  const access = await resolveRoomParticipantAccess({ request, roomId, participantId });
  if ("error" in access) {
    return access.error;
  }

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, createdByParticipantId: true },
  });
  if (!room) return fail("room_not_found", "Room not found", 404);

  const participant = access.participant;
  const wasCreator = room.createdByParticipantId === participant.id;

  await prisma.participant.delete({ where: { id: participant.id } });

  if (wasCreator) {
    // Clear the dangling admin pointer so ensureOnlineAdmin can pick a fresh
    // online participant (or leave it null if no one is online).
    await prisma.room.update({
      where: { id: roomId },
      data: { createdByParticipantId: null },
    });
    await ensureOnlineAdmin(roomId);
  }

  const response = ok({ left: true });
  return clearRoomParticipantSession(response, roomId);
}
