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
    id: room.id,
    name: room.name,
    privacy: room.privacy,
    inviteCode: room.inviteCode,
    sessionState: room.sessionState,
    gmId: room.gmId,
    participantCount: Object.keys(room.participants).length,
    recap: room.recap ?? null,
  });
}
