import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { createUniqueInviteCode } from "@/server/room-utils";
import { mapPrivacy, mapSessionState } from "@/server/room-mappers";
import { RoomPrivacy } from "@prisma/client";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return fail("invalid_body", "Request body must be JSON");
  }

  const { name, privacy, adminName } = body as {
    name?: string;
    privacy?: "public" | "private";
    adminName?: string;
  };

  if (!name || !adminName) {
    return fail("missing_fields", "Room name and admin name are required");
  }

  const settings = await prisma.adminSettings.findUnique({ where: { id: "singleton" } });
  const resolvedPrivacy: RoomPrivacy =
    privacy === "public" ? "PUBLIC" : privacy === "private" ? "PRIVATE" : settings?.privacy ?? "PRIVATE";
  const resolvedPrefix = settings?.roomNamePrefix ?? "";
  const inviteCode = await createUniqueInviteCode();

  const room = await prisma.room.create({
    data: {
      name: `${resolvedPrefix}${name}`.trim(),
      privacy: resolvedPrivacy,
      inviteCode,
    },
  });
  const adminParticipant = await prisma.participant.create({
    data: {
      roomId: room.id,
      name: adminName,
      role: "ADMIN",
    },
  });

  return ok({
    roomId: room.id,
    inviteCode: room.inviteCode,
    room: {
      id: room.id,
      name: room.name,
      privacy: mapPrivacy(room.privacy),
      inviteCode: room.inviteCode,
      sessionState: mapSessionState(room.sessionState),
      gmId: room.gmParticipantId,
      participantCount: 1,
      recap: room.recap ?? null,
    },
    adminParticipantId: adminParticipant.id,
  });
}
