import { ok, fail } from "@/server/api";
import { createRoom } from "@/server/store";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return fail("invalid_body", "Request body must be JSON");
  }

  const { name, privacy, gmName } = body as {
    name?: string;
    privacy?: "public" | "private";
    gmName?: string;
  };

  if (!name || !gmName) {
    return fail("missing_fields", "Room name and GM name are required");
  }

  const room = createRoom({ name, privacy, gmName });
  return ok({
    roomId: room.id,
    inviteCode: room.inviteCode,
    room,
    gmParticipantId: room.gmId,
  });
}
