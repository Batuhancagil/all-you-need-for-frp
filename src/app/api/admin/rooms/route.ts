import { ok } from "@/server/api";
import { prisma } from "@/server/db";
import { mapPrivacy, mapSessionState } from "@/server/room-mappers";

export async function GET() {
  const rooms = await prisma.room.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      privacy: true,
      inviteCode: true,
      sessionState: true,
    },
  });
  return ok({
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      privacy: mapPrivacy(room.privacy),
      inviteCode: room.inviteCode,
      sessionState: mapSessionState(room.sessionState),
    })),
  });
}
