import { ok, fail } from "@/server/api";
import { getCurrentUserRecord } from "@/server/current-user";
import { prisma } from "@/server/db";
import { attachRoomParticipantSession } from "@/server/room-participant-session";
import { createUniqueInviteCode } from "@/server/room-utils";
import { mapPrivacy, mapSessionState } from "@/server/room-mappers";
import { getDefaultChannels } from "@/server/channel-utils";
import { RoomPrivacy } from "@prisma/client";

export async function GET() {
  const rooms = await prisma.room.findMany({
    where: { privacy: "PUBLIC" },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { participants: true } } },
    take: 30,
  });

  return ok({
    rooms: rooms.map((room: (typeof rooms)[number]) => ({
      id: room.id,
      name: room.name,
      privacy: mapPrivacy(room.privacy),
      inviteCode: room.inviteCode,
      sessionState: mapSessionState(room.sessionState),
      participantCount: room._count.participants,
      createdAt: room.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const currentUser = await getCurrentUserRecord();
  if (!body) {
    return fail("invalid_body", "Request body must be JSON");
  }

  const { name, privacy, adminName } = body as {
    name?: string;
    privacy?: "public" | "private";
    adminName?: string;
  };
  const trimmedRoomName = name?.trim() ?? "";
  const trimmedAdminName = adminName?.trim() ?? "";

  if (!trimmedRoomName || !trimmedAdminName) {
    return fail("missing_fields", "Room name and admin name are required");
  }

  const settings = await prisma.adminSettings.findUnique({ where: { id: "singleton" } });
  const resolvedPrivacy: RoomPrivacy =
    privacy === "public" ? "PUBLIC" : privacy === "private" ? "PRIVATE" : settings?.privacy ?? "PRIVATE";
  const resolvedPrefix = settings?.roomNamePrefix ?? "";
  const inviteCode = await createUniqueInviteCode();

  const room = await prisma.room.create({
    data: {
      name: `${resolvedPrefix}${trimmedRoomName}`.trim(),
      privacy: resolvedPrivacy,
      inviteCode,
    },
  });
  const adminParticipant = await prisma.participant.create({
    data: {
      roomId: room.id,
      name: trimmedAdminName,
      role: "ADMIN",
      userId: currentUser?.id,
    },
  });
  await prisma.room.update({
    where: { id: room.id },
    data: { createdByParticipantId: adminParticipant.id },
  });

  // Every room ships with the full toolkit: channels (chat/voice/dice) and a shared document.
  await prisma.channel.createMany({
    data: getDefaultChannels().map((channel: ReturnType<typeof getDefaultChannels>[number]) => ({
      roomId: room.id,
      name: channel.name,
      slug: channel.slug,
      type: channel.type,
    })),
  });
  await prisma.roomDocument.create({
    data: {
      roomId: room.id,
      title: trimmedRoomName,
    },
  });

  const response = ok({
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
  return attachRoomParticipantSession(response, {
    roomId: room.id,
    participantId: adminParticipant.id,
  });
}
