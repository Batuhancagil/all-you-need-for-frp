import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { getRoom, updateParticipantCallState } from "@/server/store";

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

  const participant = updateParticipantCallState(room, participantId, {
    inCall: body?.inCall,
    micOn: body?.micOn,
    camOn: body?.camOn,
  });
  if (!participant) {
    return fail("participant_not_found", "Participant not found", 404);
  }

  return ok({ participant });
}
