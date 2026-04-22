import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

import { normalizeCharacterSheet } from "@/lib/character-sheet";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { resolveRoomParticipantAccess } from "@/server/room-participant-session";

const CHARACTER_SHEET_MAX_BYTES = 100_000;

async function getOwnedParticipant(params: {
  request: NextRequest;
  roomId: string;
  participantId?: string | null;
}) {
  const access = await resolveRoomParticipantAccess({
    request: params.request,
    roomId: params.roomId,
    participantId: params.participantId,
    allowAnonymous: false,
  });

  if ("error" in access) {
    return { error: access.error };
  }

  if (!access.currentUser) {
    return { error: fail("unauthorized", "Sign in to access your character sheet", 401) };
  }

  return access;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const participantId = new URL(request.url).searchParams.get("participantId");
  const access = await getOwnedParticipant({ request, roomId, participantId });

  if ("error" in access) {
    return access.error;
  }

  const currentUser = access.currentUser;
  if (!currentUser) {
    return fail("unauthorized", "Sign in to access your character sheet", 401);
  }

  const sheetRecord = await prisma.characterSheet.findUnique({
    where: {
      roomId_userId: {
        roomId,
        userId: currentUser.id,
      },
    },
    select: {
      data: true,
      updatedAt: true,
    },
  });

  return ok({
    sheet: normalizeCharacterSheet(sheetRecord?.data),
    updatedAt: sheetRecord?.updatedAt.toISOString() ?? null,
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);

  if (!body) {
    return fail("invalid_body", "Request body must be JSON");
  }

  const participantId =
    typeof body.participantId === "string" ? body.participantId : null;
  const access = await getOwnedParticipant({ request, roomId, participantId });

  if ("error" in access) {
    return access.error;
  }

  const currentUser = access.currentUser;
  if (!currentUser) {
    return fail("unauthorized", "Sign in to access your character sheet", 401);
  }

  const nextSheet = normalizeCharacterSheet(body.sheet);
  const nextSheetSize = Buffer.byteLength(JSON.stringify(nextSheet), "utf8");
  if (nextSheetSize > CHARACTER_SHEET_MAX_BYTES) {
    return fail("sheet_too_large", "Character sheet is too large to save", 413);
  }
  const saved = await prisma.characterSheet.upsert({
    where: {
      roomId_userId: {
        roomId,
        userId: currentUser.id,
      },
    },
    create: {
      roomId,
      userId: currentUser.id,
      participantId: access.participant.id,
      data: nextSheet as Prisma.InputJsonValue,
    },
    update: {
      participantId: access.participant.id,
      data: nextSheet as Prisma.InputJsonValue,
    },
    select: {
      data: true,
      updatedAt: true,
    },
  });

  return ok({
    sheet: normalizeCharacterSheet(saved.data),
    updatedAt: saved.updatedAt.toISOString(),
  });
}
