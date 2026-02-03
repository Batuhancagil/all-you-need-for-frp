import { ok, fail } from "@/server/api";
import { getRoom } from "@/server/store";

export async function GET(
  _request: Request,
  { params }: { params: { roomId: string } }
) {
  const room = getRoom(params.roomId);
  if (!room) {
    return fail("room_not_found", "Room not found", 404);
  }

  return ok({ rolls: room.rolls });
}
