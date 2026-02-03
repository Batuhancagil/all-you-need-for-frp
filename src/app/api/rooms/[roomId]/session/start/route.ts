import { ok, fail } from "@/server/api";
import { getRoom, setSessionState } from "@/server/store";

export async function POST(
  request: Request,
  { params }: { params: { roomId: string } }
) {
  const room = getRoom(params.roomId);
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
    return fail("forbidden", "Only GM or admin can start sessions", 403);
  }

  setSessionState(room, "active");
  return ok({ sessionState: room.sessionState });
}
