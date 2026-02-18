import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const requesterId = body?.participantId as string | undefined;
  const targetParticipantId = body?.targetParticipantId as string | undefined;

  if (!requesterId || !targetParticipantId) {
    return fail("missing_fields", "participantId and targetParticipantId required");
  }

  const [requester, room, target] = await Promise.all([
    prisma.participant.findFirst({
      where: { id: requesterId, roomId },
      select: { id: true, role: true },
    }),
    prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, createdByParticipantId: true },
    }),
    prisma.participant.findFirst({
      where: { id: targetParticipantId, roomId },
      select: { id: true },
    }),
  ]);

  if (!requester || !room || !target) {
    return fail("participant_not_found", "Participant or room not found", 404);
  }

  const isAdmin = requester.role === "ADMIN";
  const isCreator = room.createdByParticipantId === requester.id;
  if (!isAdmin && !isCreator) {
    return fail("forbidden", "Only admin/room creator can kick", 403);
  }

  if (target.id === requester.id) {
    return fail("invalid_target", "Cannot kick yourself");
  }

  await prisma.participant.delete({ where: { id: target.id } });

  return ok({ kicked: target.id });
}
