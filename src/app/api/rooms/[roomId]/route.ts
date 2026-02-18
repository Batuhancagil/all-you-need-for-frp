import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { mapPrivacy, mapSessionState } from "@/server/room-mappers";

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
