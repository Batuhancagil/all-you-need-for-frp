import { NextRequest } from "next/server";
import { ok } from "@/server/api";
import { prisma } from "@/server/db";
import { mapParticipantRole } from "@/server/room-mappers";
import { resolveRoomParticipantAccess } from "@/server/room-participant-session";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const participantId = body?.participantId as string | undefined;
  const access = await resolveRoomParticipantAccess({ request, roomId, participantId });
  if ("error" in access) {
    return access.error;
  }

  const updated = await prisma.participant.update({
    where: { id: access.participant.id },
    data: {
      inCall: typeof body?.inCall === "boolean" ? body.inCall : access.participant.inCall,
      micOn: typeof body?.micOn === "boolean" ? body.micOn : access.participant.micOn,
      camOn: typeof body?.camOn === "boolean" ? body.camOn : access.participant.camOn,
      callChannelSlug:
        typeof body?.inCall === "boolean" && body.inCall === false
          ? null
          : typeof body?.channelSlug === "string"
            ? body.channelSlug
            : access.participant.callChannelSlug,
      lastSeen: new Date(),
    },
  });

  return ok({
    participant: {
      id: updated.id,
      name: updated.name,
      role: mapParticipantRole(updated.role),
      joinedAt: updated.joinedAt.toISOString(),
      lastSeen: updated.lastSeen.toISOString(),
      inCall: updated.inCall,
      micOn: updated.micOn,
      camOn: updated.camOn,
      callChannelSlug: updated.callChannelSlug,
    },
  });
}
