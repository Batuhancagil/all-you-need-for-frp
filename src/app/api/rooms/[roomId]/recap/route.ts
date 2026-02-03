import { ok, fail } from "@/server/api";
import { getRoom, setRecap } from "@/server/store";

export async function GET(
  _request: Request,
  { params }: { params: { roomId: string } }
) {
  const room = getRoom(params.roomId);
  if (!room) {
    return fail("room_not_found", "Room not found", 404);
  }

  return ok({ recap: room.recap ?? null });
}

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
  const recap = (body?.recap as string | undefined)?.trim();

  if (!participantId) {
    return fail("missing_fields", "participantId is required");
  }

  if (!recap) {
    return fail("invalid_recap", "Recap cannot be empty");
  }

  const participant = room.participants[participantId];
  if (!participant || (participant.role !== "gm" && participant.role !== "admin")) {
    return fail("forbidden", "Only GM or admin can save recap", 403);
  }

  setRecap(room, recap);
  return ok({ recap: room.recap });
}
