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
  const sides = Number(body?.sides ?? 20);
  const count = Number(body?.count ?? 1);

  if (!participantId) {
    return fail("missing_fields", "participantId is required");
  }

  if (!Number.isFinite(sides) || sides <= 1 || !Number.isFinite(count) || count <= 0) {
    return fail("invalid_roll", "Invalid dice roll parameters");
  }

  const participant = await prisma.participant.findFirst({
    where: { id: participantId, roomId },
  });
  if (!participant) {
    return fail("participant_not_found", "Participant not found", 404);
  }

  const results = Array.from({ length: count }, () => Math.ceil(Math.random() * sides));
  const roll = await prisma.roll.create({
    data: {
      roomId,
      participantId: participant.id,
      participantName: participant.name,
      sides,
      count,
      results,
      total: results.reduce((sum, value) => sum + value, 0),
    },
  });

  return ok({
    roll: {
      id: roll.id,
      participantId: roll.participantId,
      participantName: roll.participantName,
      sides: roll.sides,
      count: roll.count,
      results: roll.results,
      total: roll.total,
      createdAt: roll.createdAt.toISOString(),
    },
  });
}
