import { ok, fail } from "@/server/api";
import { createRoom } from "@/server/store";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return fail("invalid_body", "Request body must be JSON");
  }

  const { name, privacy, adminName } = body as {
    name?: string;
    privacy?: "public" | "private";
    adminName?: string;
  };

  if (!name || !adminName) {
    return fail("missing_fields", "Room name and admin name are required");
  }

  const { room, adminParticipant } = createRoom({ name, privacy, adminName });
  return ok({
    roomId: room.id,
    inviteCode: room.inviteCode,
    room,
    adminParticipantId: adminParticipant.id,
  });
}
