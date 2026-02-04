import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { mapSessionState } from "@/server/room-mappers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const participantId = body?.participantId as string | undefined;
  if (!participantId) {
    return fail("missing_fields", "participantId is required");
  }

  const participant = await prisma.participant.findFirst({
    where: { id: participantId, roomId },
  });
  if (!participant) {
    return fail("participant_not_found", "Participant not found", 404);
  }
  if (participant.role !== "GM" && participant.role !== "ADMIN") {
    return fail("forbidden", "Only GM or admin can start sessions", 403);
  }

  const room = await prisma.room.update({
    where: { id: roomId },
    data: {
      sessionState: "ACTIVE",
      sessionStartedAt: new Date(),
    },
    select: { sessionState: true },
  });
  return ok({ sessionState: mapSessionState(room.sessionState) });
}
