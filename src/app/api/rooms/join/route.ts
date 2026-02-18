import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { mapParticipantRole } from "@/server/room-mappers";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return fail("invalid_body", "Request body must be JSON");
  }

  const { inviteCode, displayName } = body as {
    inviteCode?: string;
    displayName?: string;
  };

  if (!inviteCode || !displayName) {
    return fail("missing_fields", "Invite code and display name are required");
  }

  const room = await prisma.room.findUnique({
    where: { inviteCode: inviteCode.trim().toUpperCase() },
    select: { id: true },
  });
  if (!room) {
    return fail("invite_not_found", "Invite link is invalid or expired", 404);
  }

  // Reuse participant if same name + lastSeen within 5 min (double-click, refresh).
  // If lastSeen > 5 min, create new participant (treated as fresh join).
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const existing = await prisma.participant.findFirst({
    where: {
      roomId: room.id,
      name: displayName.trim(),
      lastSeen: { gte: fiveMinAgo },
    },
    orderBy: { lastSeen: "desc" },
  });

  const participant = existing ?? await prisma.participant.create({
    data: {
      roomId: room.id,
      name: displayName.trim(),
      role: "PLAYER",
    },
  });

  if (existing) {
    await prisma.participant.update({
      where: { id: participant.id },
      data: { lastSeen: new Date() },
    });
  }

  return ok({
    roomId: room.id,
    participant: {
      id: participant.id,
      role: mapParticipantRole(participant.role),
    },
  });
}
