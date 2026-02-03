import { ok, fail } from "@/server/api";
import { createInvite, getRoom } from "@/server/store";

export async function POST(
  _request: Request,
  { params }: { params: { roomId: string } }
) {
  const room = getRoom(params.roomId);
  if (!room) {
    return fail("room_not_found", "Room not found", 404);
  }

  const inviteCode = createInvite(room.id);
  if (!inviteCode) {
    return fail("invite_failed", "Unable to generate invite link", 500);
  }

  return ok({ inviteCode });
}
