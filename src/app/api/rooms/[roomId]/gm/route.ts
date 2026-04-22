import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { resolveRoomParticipantAccess } from "@/server/room-participant-session";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const participantId = body?.participantId as string | undefined;
  const gmParticipantId = body?.gmParticipantId as string | undefined;
  if (!gmParticipantId) {
    return fail("missing_fields", "gmParticipantId is required");
  }

  const [access, roomCheck] = await Promise.all([
    resolveRoomParticipantAccess({ request, roomId, participantId }),
    prisma.room.findUnique({
      where: { id: roomId },
      select: { createdByParticipantId: true },
    }),
  ]);
  if ("error" in access) {
    return access.error;
  }
  const requester = access.participant;
  const isAdmin = requester.role === "ADMIN";
  const isRoomCreator = roomCheck?.createdByParticipantId === requester.id;
  if (!isAdmin && !isRoomCreator) {
    return fail("forbidden", "Only admin or room creator can assign GM", 403);
  }

  const [room, gmParticipant] = await prisma.$transaction([
    prisma.room.findUnique({
      where: { id: roomId },
      select: { gmParticipantId: true },
    }),
    prisma.participant.findFirst({
      where: { id: gmParticipantId, roomId },
    }),
  ]);

  if (!room || !gmParticipant) {
    return fail("invalid_gm", "Selected participant cannot be set as GM", 400);
  }

  if (room.gmParticipantId && room.gmParticipantId !== gmParticipantId) {
    const previousGm = await prisma.participant.findUnique({
      where: { id: room.gmParticipantId },
    });
    if (previousGm && previousGm.role === "GM") {
      await prisma.participant.update({
        where: { id: previousGm.id },
        data: { role: "PLAYER" },
      });
    }
  }

  if (gmParticipant.role !== "ADMIN") {
    await prisma.participant.update({
      where: { id: gmParticipant.id },
      data: { role: "GM" },
    });
  }

  await prisma.room.update({
    where: { id: roomId },
    data: { gmParticipantId: gmParticipant.id },
  });

  return ok({ gmId: gmParticipant.id });
}
