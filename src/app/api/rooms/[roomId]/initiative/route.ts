import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { resolveRoomParticipantAccess } from "@/server/room-participant-session";
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
    select: {
      id: true,
      initiativeCurrentEntryId: true,
      initiativeTurnCount: true,
      initiativeRoundCount: true,
    },
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
      results: e.results ?? [],
      sortOrder: e.sortOrder,
      isAlive: e.isAlive,
    })),
    currentTurnEntryId: room.initiativeCurrentEntryId,
    turnCount: room.initiativeTurnCount,
    roundCount: room.initiativeRoundCount,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const participantId = body?.participantId as string | undefined;
  const action = body?.action as "start" | "add" | "remove" | "toggleAlive" | "nextTurn" | "setTurnCount" | undefined;
  const creatureName = body?.creatureName as string | undefined;
  const expression = body?.expression as string | undefined;
  const targetParticipantId = body?.targetParticipantId as string | undefined;
  const entryId = body?.entryId as string | undefined;
  const turnCount = body?.turnCount as number | undefined;

  if (!action) {
    return fail("missing_fields", "action required");
  }

  const access = await resolveRoomParticipantAccess({ request, roomId, participantId });
  if ("error" in access) {
    return access.error;
  }
  const requester = access.participant;
  const requesterId = requester.id;

  const canManage = requester.role === "ADMIN" || requester.role === "GM";

  if (action === "start") {
    if (!canManage) return fail("forbidden", "Only admin or GM can start initiative", 403);
    await prisma.initiativeEntry.deleteMany({ where: { roomId } });
    await prisma.room.update({
      where: { id: roomId },
      data: { initiativeCurrentEntryId: null, initiativeTurnCount: 0, initiativeRoundCount: 0 },
    });
    return ok({ started: true });
  }

  if (action === "remove") {
    if (!canManage) return fail("forbidden", "Only admin or GM can remove entries", 403);
    if (!entryId) return fail("missing_fields", "entryId required");
    const entry = await prisma.initiativeEntry.findFirst({
      where: { id: entryId, roomId },
    });
    if (!entry) return fail("entry_not_found", "Entry not found", 404);
    await prisma.initiativeEntry.delete({ where: { id: entryId } });
    await prisma.room.updateMany({
      where: { id: roomId, initiativeCurrentEntryId: entryId },
      data: { initiativeCurrentEntryId: null },
    });
    return ok({ removed: true });
  }

  if (action === "toggleAlive") {
    if (!entryId) return fail("missing_fields", "entryId required");
    const entry = await prisma.initiativeEntry.findFirst({
      where: { id: entryId, roomId },
    });
    if (!entry) return fail("entry_not_found", "Entry not found", 404);
    const isOwnEntry = entry.participantId === requesterId;
    if (!canManage && !isOwnEntry) return fail("forbidden", "Cannot toggle other entries", 403);
    const updated = await prisma.initiativeEntry.update({
      where: { id: entryId },
      data: { isAlive: !entry.isAlive },
    });
    return ok({ isAlive: updated.isAlive });
  }

  if (action === "nextTurn") {
    const [roomState, entries] = await Promise.all([
      prisma.room.findUnique({
        where: { id: roomId },
        select: { initiativeCurrentEntryId: true, initiativeTurnCount: true, initiativeRoundCount: true },
      }),
      prisma.initiativeEntry.findMany({
        where: { roomId, isAlive: true },
        orderBy: [{ sortOrder: "asc" }],
      }),
    ]);
    if (entries.length === 0) return fail("no_entries", "No alive entries in initiative", 400);
    const currentIndex = entries.findIndex(
      (e: { id: string }) => e.id === roomState?.initiativeCurrentEntryId
    );
    let nextIndex: number;
    if (canManage) {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % entries.length;
    } else {
      const currentEntry = currentIndex >= 0 ? entries[currentIndex] : null;
      const isMyTurn = currentEntry?.participantId === requesterId;
      if (!isMyTurn) return fail("forbidden", "Only GM can advance when it is not your turn", 403);
      nextIndex = (currentIndex + 1) % entries.length;
    }
    const nextEntry = entries[nextIndex];
    const turnCount = (roomState?.initiativeTurnCount ?? 0) + 1;
    const wrappedToStart = nextIndex === 0 && currentIndex >= 0;
    const roundCount = (roomState?.initiativeRoundCount ?? 0) + (wrappedToStart ? 1 : 0);
    await prisma.room.update({
      where: { id: roomId },
      data: {
        initiativeCurrentEntryId: nextEntry.id,
        initiativeTurnCount: turnCount,
        initiativeRoundCount: roundCount,
      },
    });
    return ok({ currentTurnEntryId: nextEntry.id, turnCount, roundCount });
  }

  if (action === "setTurnCount") {
    if (!canManage) return fail("forbidden", "Only admin or GM can set turn count", 403);
    const count = typeof turnCount === "number" && Number.isFinite(turnCount) && turnCount >= 0 ? turnCount : 0;
    const roundCountParam = body?.roundCount as number | undefined;
    const roundCount =
      typeof roundCountParam === "number" && Number.isFinite(roundCountParam) && roundCountParam >= 0
        ? roundCountParam
        : undefined;
    await prisma.room.update({
      where: { id: roomId },
      data: {
        initiativeTurnCount: count,
        ...(roundCount !== undefined && { initiativeRoundCount: roundCount }),
      },
    });
    const updated = await prisma.room.findUnique({
      where: { id: roomId },
      select: { initiativeRoundCount: true },
    });
    return ok({ turnCount: count, roundCount: updated?.initiativeRoundCount ?? 0 });
  }

  if (action === "add") {
    const resolvedTargetParticipantId = targetParticipantId || requesterId;
    const isSelfAdd = resolvedTargetParticipantId === requesterId;
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
    const { total, results } = executeParsedRoll(parsed);

    const maxOrder = await prisma.initiativeEntry.findFirst({
      where: { roomId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const sortOrder = (maxOrder?.sortOrder ?? -1) + 1;

    const entry = await prisma.initiativeEntry.create({
      data: {
        roomId,
        participantId: isCreatureAdd ? null : resolvedTargetParticipantId,
        creatureName: creatureName?.trim() || null,
        expression: parsed.expression,
        result: total,
        results: results,
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

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { initiativeCurrentEntryId: true },
    });
    if (!room?.initiativeCurrentEntryId && all.length > 0) {
      const firstAlive = all.find((e: { isAlive: boolean }) => e.isAlive) ?? all[0];
      await prisma.room.update({
        where: { id: roomId },
        data: {
          initiativeCurrentEntryId: firstAlive.id,
          initiativeTurnCount: 1,
        },
      });
    }

    return ok({
      entry: {
        id: entry.id,
        participantName: entry.participant?.name ?? null,
        creatureName: entry.creatureName,
        expression: entry.expression,
        result: entry.result,
        results,
        sortOrder,
      },
    });
  }

  return fail("invalid_action", "action must be start or add");
}
