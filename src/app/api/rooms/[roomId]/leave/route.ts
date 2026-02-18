import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const participantId = body?.participantId as string | undefined;

  if (!participantId) {
    return fail("missing_fields", "participantId required");
  }

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, createdByParticipantId: true },
  });
  if (!room) return fail("room_not_found", "Room not found", 404);

  const participant = await prisma.participant.findFirst({
    where: { id: participantId, roomId },
  });
  if (!participant) return fail("participant_not_found", "Participant not found", 404);

  const wasCreator = room.createdByParticipantId === participant.id;

  await prisma.participant.delete({ where: { id: participant.id } });

  if (wasCreator) {
    const nextAdmin = await prisma.participant.findFirst({
      where: { roomId },
      orderBy: { joinedAt: "asc" },
    });
    if (nextAdmin) {
      await prisma.participant.update({
        where: { id: nextAdmin.id },
        data: { role: "ADMIN" },
      });
      await prisma.room.update({
        where: { id: roomId },
        data: { createdByParticipantId: nextAdmin.id },
      });
    } else {
      await prisma.room.update({
        where: { id: roomId },
        data: { createdByParticipantId: null },
      });
    }
  }

  return ok({ left: true });
}
