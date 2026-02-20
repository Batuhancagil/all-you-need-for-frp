import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { mapParticipantRole, mapSessionState } from "@/server/room-mappers";

const CALL_STALE_MS = 3 * 60 * 1000;

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
