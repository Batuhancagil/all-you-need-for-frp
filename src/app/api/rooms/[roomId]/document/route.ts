import { NextRequest } from "next/server";

import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { resolveRoomParticipantAccess } from "@/server/room-participant-session";

const DOCUMENT_STATE_MAX_BYTES = 2_000_000;
const DOCUMENT_TITLE_MAX_LENGTH = 200;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const participantId = new URL(request.url).searchParams.get("participantId");

  const access = await resolveRoomParticipantAccess({
    request,
    roomId,
    participantId,
    allowAnonymous: false,
  });
  if ("error" in access) {
    return access.error;
  }

  let doc = await prisma.roomDocument.findUnique({
    where: { roomId },
    select: { title: true, yjsState: true, updatedAt: true },
  });

  if (!doc) {
    // Lazily provision a document for older rooms that predate this feature.
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { name: true },
    });
    if (!room) {
      return fail("room_not_found", "Room not found", 404);
    }
    doc = await prisma.roomDocument.create({
      data: { roomId, title: room.name || "Untitled" },
      select: { title: true, yjsState: true, updatedAt: true },
    });
  }

  const stateBase64 = doc.yjsState
    ? Buffer.from(doc.yjsState).toString("base64")
    : null;

  return ok({
    title: doc.title,
    yjsState: stateBase64,
    updatedAt: doc.updatedAt.toISOString(),
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

  const access = await resolveRoomParticipantAccess({
    request,
    roomId,
    participantId,
    allowAnonymous: false,
  });
  if ("error" in access) {
    return access.error;
  }

  let existing = await prisma.roomDocument.findUnique({
    where: { roomId },
    select: { id: true },
  });
  if (!existing) {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { name: true },
    });
    if (!room) {
      return fail("room_not_found", "Room not found", 404);
    }
    existing = await prisma.roomDocument.create({
      data: { roomId, title: room.name || "Untitled" },
      select: { id: true },
    });
  }

  const nextTitle =
    typeof body.title === "string" ? body.title.trim().slice(0, DOCUMENT_TITLE_MAX_LENGTH) : undefined;

  let nextState: Uint8Array<ArrayBuffer> | undefined;
  if (typeof body.yjsState === "string" && body.yjsState.length > 0) {
    const buffer = Buffer.from(body.yjsState, "base64");
    if (buffer.length > DOCUMENT_STATE_MAX_BYTES) {
      return fail("document_too_large", "Document state is too large", 413);
    }
    // Copy into a plain Uint8Array backed by a fresh ArrayBuffer so the type
    // matches Prisma's Bytes field expectation (Uint8Array<ArrayBuffer>).
    const ab = new ArrayBuffer(buffer.byteLength);
    const view = new Uint8Array(ab);
    view.set(buffer);
    nextState = view;
  }

  if (!nextTitle && !nextState) {
    return fail("missing_fields", "Nothing to update");
  }

  const saved = await prisma.roomDocument.update({
    where: { roomId },
    data: {
      ...(nextTitle !== undefined ? { title: nextTitle || "Untitled" } : {}),
      ...(nextState !== undefined ? { yjsState: nextState } : {}),
    },
    select: { title: true, updatedAt: true },
  });

  return ok({
    title: saved.title,
    updatedAt: saved.updatedAt.toISOString(),
  });
}
