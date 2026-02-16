import { NextRequest } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { buildVideoRoomName } from "@/lib/video-room";

const LIVEKIT_TOKEN_TTL_SECONDS = 60 * 60 * 12;
const LIVEKIT_TOKEN_TTL = "12h";

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

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return fail("config_missing", "LiveKit server credentials are not configured", 500);
  }

  const participant = await prisma.participant.findFirst({
    where: { id: participantId, roomId },
  });
  if (!participant) {
    return fail("participant_not_found", "Participant not found", 404);
  }

  const roomName = buildVideoRoomName(roomId);
  const token = new AccessToken(apiKey, apiSecret, {
    identity: participant.id,
    name: participant.name,
    ttl: LIVEKIT_TOKEN_TTL,
  });

  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return ok({
    token: await token.toJwt(),
    roomName,
    expiresInSeconds: LIVEKIT_TOKEN_TTL_SECONDS,
  });
}
