import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { mapParticipantRole, mapSessionState } from "@/server/room-mappers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
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
    })),
    sessionState: mapSessionState(room.sessionState),
  });
}
