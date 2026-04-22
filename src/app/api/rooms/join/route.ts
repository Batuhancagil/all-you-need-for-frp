import { ok, fail } from "@/server/api";
import { getCurrentUserRecord } from "@/server/current-user";
import { prisma } from "@/server/db";
import { attachRoomParticipantSession } from "@/server/room-participant-session";
import { mapParticipantRole } from "@/server/room-mappers";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const currentUser = await getCurrentUserRecord();
  if (!body) {
    return fail("invalid_body", "Request body must be JSON");
  }

  const { inviteCode, displayName } = body as {
    inviteCode?: string;
    displayName?: string;
  };
  const trimmedInviteCode = inviteCode?.trim().toUpperCase() ?? "";
  const trimmedName = displayName?.trim() ?? "";

  if (!trimmedInviteCode || !trimmedName) {
    return fail("missing_fields", "Invite code and display name are required");
  }

  const room = await prisma.room.findUnique({
    where: { inviteCode: trimmedInviteCode },
    select: { id: true },
  });
  if (!room) {
    return fail("invite_not_found", "Invite code was not found", 404);
  }

  // Reuse participant if same name + lastSeen within 5 min (double-click, refresh).
  // If lastSeen > 5 min, create new participant (treated as fresh join).
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const existingForUser = currentUser
    ? await prisma.participant.findFirst({
        where: {
          roomId: room.id,
          userId: currentUser.id,
          lastSeen: { gte: fiveMinAgo },
        },
        orderBy: { lastSeen: "desc" },
      })
    : null;
  const existingLegacy =
    currentUser && !existingForUser
      ? await prisma.participant.findFirst({
          where: {
            roomId: room.id,
            name: trimmedName,
            userId: null,
            lastSeen: { gte: fiveMinAgo },
          },
          orderBy: { lastSeen: "desc" },
        })
      : null;
  const existing = existingForUser ?? existingLegacy;

  const participant = existing ?? await prisma.participant.create({
    data: {
      roomId: room.id,
      name: trimmedName,
      role: "PLAYER",
      userId: currentUser?.id,
    },
  });

  if (existing) {
    await prisma.participant.update({
      where: { id: participant.id },
      data: {
        lastSeen: new Date(),
        name: trimmedName,
        userId: participant.userId ?? currentUser?.id,
      },
    });
  }

  const response = ok({
    roomId: room.id,
    participant: {
      id: participant.id,
      role: mapParticipantRole(participant.role),
    },
  });
  return attachRoomParticipantSession(response, {
    roomId: room.id,
    participantId: participant.id,
  });
}
