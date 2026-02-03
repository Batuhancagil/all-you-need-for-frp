import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { getRoom } from "@/server/store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const room = getRoom(roomId);
  if (!room) {
    return fail("room_not_found", "Room not found", 404);
  }

  return ok({
    participants: Object.values(room.participants),
    sessionState: room.sessionState,
  });
}
