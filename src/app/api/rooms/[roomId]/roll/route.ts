import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import {
  parseDiceExpression,
  executeParsedRoll,
  rollDice,
} from "@/server/dice-parser";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const participantId = body?.participantId as string | undefined;
  const expression = body?.expression as string | undefined;
  const rollName = body?.rollName as string | undefined;
  const sides = Number(body?.sides ?? 20);
  const count = Number(body?.count ?? 1);

  if (!participantId) {
    return fail("missing_fields", "participantId is required");
  }

  const participant = await prisma.participant.findFirst({
    where: { id: participantId, roomId },
  });
  if (!participant) {
    return fail("participant_not_found", "Participant not found", 404);
  }

  let results: number[];
  let total: number;
  let storedExpression: string | null = null;
  let storedModifier = 0;
  let storedSides = sides;
  let storedCount = count;

  if (expression?.trim()) {
    const parsed = parseDiceExpression(expression.trim());
    if (!parsed) {
      return fail("invalid_roll", "Invalid dice expression (e.g. 2d4+3, d20, d100)");
    }
    const executed = executeParsedRoll(parsed);
    results = executed.results;
    total = executed.total;
    storedExpression = parsed.expression;
    storedModifier = parsed.modifier;
    storedSides = parsed.terms[0]?.sides ?? 20;
    storedCount = parsed.terms.reduce((s, t) => s + t.count, 0);
  } else {
    if (!Number.isFinite(sides) || sides <= 1 || !Number.isFinite(count) || count <= 0) {
      return fail("invalid_roll", "Invalid dice roll parameters");
    }
    results = rollDice(count, sides);
    total = results.reduce((s, v) => s + v, 0);
  }

  const roll = await prisma.roll.create({
    data: {
      roomId,
      participantId: participant.id,
      participantName: participant.name,
      rollName: rollName?.trim() || null,
      sides: storedSides,
      count: storedCount,
      expression: storedExpression,
      modifier: storedModifier,
      results,
      total,
    },
  });

  return ok({
    roll: {
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
    },
  });
}
