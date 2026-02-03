import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { getRoom, setRoomGm } from "@/server/store";

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
  const gmParticipantId = body?.gmParticipantId as string | undefined;
  if (!participantId || !gmParticipantId) {
    return fail("missing_fields", "participantId and gmParticipantId are required");
  }

  const requester = room.participants[participantId];
  if (!requester || requester.role !== "admin") {
    return fail("forbidden", "Only admin can assign GM", 403);
  }

  const updatedGm = setRoomGm(room, gmParticipantId);
  if (!updatedGm) {
    return fail("invalid_gm", "Selected participant cannot be set as GM", 400);
  }

  return ok({ gmId: updatedGm.id });
}
