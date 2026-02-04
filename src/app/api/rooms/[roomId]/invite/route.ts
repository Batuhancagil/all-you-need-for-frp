import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { createUniqueInviteCode } from "@/server/room-utils";

export async function POST(
  _request: NextRequest,
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

  const inviteCode = await createUniqueInviteCode();
  await prisma.room.update({
    where: { id: roomId },
    data: { inviteCode },
  });

  return ok({ inviteCode });
}
