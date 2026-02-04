import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";

export async function GET(
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

  const rolls = await prisma.roll.findMany({
    where: { roomId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return ok({
    rolls: rolls.map((roll) => ({
      id: roll.id,
      participantId: roll.participantId,
      participantName: roll.participantName,
      sides: roll.sides,
      count: roll.count,
      results: roll.results,
      total: roll.total,
      createdAt: roll.createdAt.toISOString(),
    })),
  });
}
