import { ok, fail } from "@/server/api";
import { getRoomByInvite, joinRoom } from "@/server/store";

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

  const room = getRoomByInvite(inviteCode);
  if (!room) {
    return fail("invite_not_found", "Invite link is invalid or expired", 404);
  }

  const participant = joinRoom(room, displayName);
  return ok({
    roomId: room.id,
    participant,
    room,
  });
}
