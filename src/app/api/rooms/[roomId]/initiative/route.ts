import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import {
  parseDiceExpression,
  executeParsedRoll,
} from "@/server/dice-parser";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true },
  });
  if (!room) return fail("room_not_found", "Room not found", 404);

  const entries = await prisma.initiativeEntry.findMany({
    where: { roomId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      participant: { select: { id: true, name: true } },
    },
  });

  return ok({
    entries: entries.map((e: (typeof entries)[number]) => ({
      id: e.id,
      participantId: e.participantId,
      participantName: e.participant?.name ?? null,
      creatureName: e.creatureName,
      expression: e.expression,
      result: e.result,
      sortOrder: e.sortOrder,
    })),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const participantId = body?.participantId as string | undefined;
  const action = body?.action as "start" | "add" | undefined;
  const creatureName = body?.creatureName as string | undefined;
  const expression = body?.expression as string | undefined;
  const targetParticipantId = body?.targetParticipantId as string | undefined;

  if (!participantId || !action) {
    return fail("missing_fields", "participantId and action required");
  }

  const requester = await prisma.participant.findFirst({
    where: { id: participantId, roomId },
    select: { id: true, role: true },
  });
  if (!requester) return fail("participant_not_found", "Participant not found", 404);

  const canManage = requester.role === "ADMIN" || requester.role === "GM";

  if (action === "start") {
    if (!canManage) return fail("forbidden", "Only admin or GM can start initiative", 403);
    await prisma.initiativeEntry.deleteMany({ where: { roomId } });
    return ok({ started: true });
  }

  if (action === "add") {
    const isSelfAdd = targetParticipantId === participantId;
    const isCreatureAdd = !!creatureName?.trim();
    if (!canManage && !isSelfAdd) {
      return fail("forbidden", "Only admin/GM can add creatures; players can add themselves", 403);
    }
    if (isCreatureAdd && !canManage) {
      return fail("forbidden", "Only admin or GM can add creatures", 403);
    }
    if (!expression?.trim()) {
      return fail("missing_fields", "expression required");
    }
    const parsed = parseDiceExpression(expression.trim());
    if (!parsed) return fail("invalid_roll", "Invalid expression (e.g. 1d20, 2d6+3)");
    const { total } = executeParsedRoll(parsed);

    const maxOrder = await prisma.initiativeEntry.findFirst({
      where: { roomId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const sortOrder = (maxOrder?.sortOrder ?? -1) + 1;

    const entry = await prisma.initiativeEntry.create({
      data: {
        roomId,
        participantId: isCreatureAdd ? null : (targetParticipantId || participantId),
        creatureName: creatureName?.trim() || null,
        expression: parsed.expression,
        result: total,
        sortOrder,
      },
      include: { participant: { select: { name: true } } },
    });

    const all = await prisma.initiativeEntry.findMany({
      where: { roomId },
      orderBy: { result: "desc" },
      include: { participant: { select: { name: true } } },
    });
    for (let i = 0; i < all.length; i++) {
      await prisma.initiativeEntry.update({
        where: { id: all[i].id },
        data: { sortOrder: i },
      });
    }

    return ok({
      entry: {
        id: entry.id,
        participantName: entry.participant?.name ?? null,
        creatureName: entry.creatureName,
        expression: entry.expression,
        result: entry.result,
        sortOrder,
      },
    });
  }

  return fail("invalid_action", "action must be start or add");
}
