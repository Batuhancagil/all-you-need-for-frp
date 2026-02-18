import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { mapParticipantRole } from "@/server/room-mappers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const participantId = body?.participantId as string | undefined;
  if (!participantId) {
    return fail("missing_fields", "participantId is required");
  }

  const participant = await prisma.participant.findFirst({
    where: { id: participantId, roomId },
  });
  if (!participant) {
    return fail("participant_not_found", "Participant not found", 404);
  }

  const updated = await prisma.participant.update({
    where: { id: participant.id },
    data: {
      inCall: typeof body?.inCall === "boolean" ? body.inCall : participant.inCall,
      micOn: typeof body?.micOn === "boolean" ? body.micOn : participant.micOn,
      camOn: typeof body?.camOn === "boolean" ? body.camOn : participant.camOn,
      callChannelSlug:
        typeof body?.inCall === "boolean" && body.inCall === false
          ? null
          : typeof body?.channelSlug === "string"
            ? body.channelSlug
            : participant.callChannelSlug,
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
