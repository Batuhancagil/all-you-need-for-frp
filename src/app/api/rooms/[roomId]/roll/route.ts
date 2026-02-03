import { ok, fail } from "@/server/api";
import { addRoll, getRoom } from "@/server/store";

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
  const sides = Number(body?.sides ?? 20);
  const count = Number(body?.count ?? 1);

  if (!participantId) {
    return fail("missing_fields", "participantId is required");
  }

  if (!Number.isFinite(sides) || sides <= 1 || !Number.isFinite(count) || count <= 0) {
    return fail("invalid_roll", "Invalid dice roll parameters");
  }

  const participant = room.participants[participantId];
  if (!participant) {
    return fail("participant_not_found", "Participant not found", 404);
  }

  const roll = addRoll(room, participant, sides, count);
  return ok({ roll });
}
