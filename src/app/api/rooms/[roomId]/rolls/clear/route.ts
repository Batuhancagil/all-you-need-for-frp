import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { clearRolls, getRoom } from "@/server/store";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const room = getRoom(roomId);
  if (!room) {
    return fail("room_not_found", "Room not found", 404);
  }

  const body = await request.json().catch(() => null);
  const participantId = body?.participantId as string | undefined;
  if (!participantId) {
    return fail("missing_fields", "participantId is required");
  }

  const participant = room.participants[participantId];
  if (!participant || (participant.role !== "gm" && participant.role !== "admin")) {
    return fail("forbidden", "Only GM or admin can clear rolls", 403);
  }

  clearRolls(room);
  return ok({ cleared: true });
}
