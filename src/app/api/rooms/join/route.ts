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

  const participant = await prisma.participant.create({
    data: {
      roomId: room.id,
      name: displayName.trim(),
      role: "PLAYER",
    },
  });
  return ok({
    roomId: room.id,
    participant: {
      id: participant.id,
      role: mapParticipantRole(participant.role),
    },
  });
}
