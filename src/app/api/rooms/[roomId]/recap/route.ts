import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { resolveRoomParticipantAccess } from "@/server/room-participant-session";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { recap: true },
  });
  if (!room) {
    return fail("room_not_found", "Room not found", 404);
  }

  return ok({ recap: room.recap ?? null });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const participantId = body?.participantId as string | undefined;
  const recap = (body?.recap as string | undefined)?.trim();

  if (!recap) {
    return fail("invalid_recap", "Recap cannot be empty");
  }

  const access = await resolveRoomParticipantAccess({ request, roomId, participantId });
  if ("error" in access) {
    return access.error;
  }
  const participant = access.participant;
  if (participant.role !== "GM" && participant.role !== "ADMIN") {
    return fail("forbidden", "Only GM or admin can save recap", 403);
  }

  const updated = await prisma.room.update({
    where: { id: roomId },
    data: { recap },
    select: { recap: true },
  });
  return ok({ recap: updated.recap });
}
