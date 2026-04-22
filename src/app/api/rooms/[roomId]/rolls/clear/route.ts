import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { resolveRoomParticipantAccess } from "@/server/room-participant-session";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true },
  });
  if (!room) {
    return fail("room_not_found", "Room not found", 404);
  }

  const body = await request.json().catch(() => null);
  const participantId = body?.participantId as string | undefined;
  const access = await resolveRoomParticipantAccess({ request, roomId, participantId });
  if ("error" in access) {
    return access.error;
  }

  const participant = access.participant;
  if (participant.role !== "GM" && participant.role !== "ADMIN") {
    return fail("forbidden", "Only GM or admin can clear rolls", 403);
  }

  await prisma.roll.deleteMany({ where: { roomId } });
  return ok({ cleared: true });
}
