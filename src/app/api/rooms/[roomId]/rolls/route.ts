import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const sinceRaw = request.nextUrl.searchParams.get("since");
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true },
  });
  if (!room) {
    return fail("room_not_found", "Room not found", 404);
  }

  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (sinceRaw && (!since || Number.isNaN(since.getTime()))) {
    return fail("invalid_since", "since must be a valid ISO datetime");
  }

  const rolls = await prisma.roll.findMany({
    where: since ? { roomId, createdAt: { gt: since } } : { roomId },
    orderBy: { createdAt: since ? "asc" : "desc" },
    take: since ? 100 : 50,
  });

  const cursor = since
    ? rolls[rolls.length - 1]?.createdAt ?? since
    : rolls[0]?.createdAt ?? new Date();

  return ok({
    cursor: cursor.toISOString(),
    rolls: rolls.map((roll: (typeof rolls)[number]) => ({
      id: roll.id,
      participantId: roll.participantId,
      participantName: roll.participantName,
      rollName: roll.rollName,
      sides: roll.sides,
      count: roll.count,
      expression: roll.expression,
      modifier: roll.modifier,
      results: roll.results,
      total: roll.total,
      createdAt: roll.createdAt.toISOString(),
    })),
  });
}
