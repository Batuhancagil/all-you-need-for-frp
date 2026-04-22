import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { resolveRoomParticipantAccess } from "@/server/room-participant-session";
import { mapParticipantRole } from "@/server/room-mappers";

const CHAT_IMAGE_DATA_URL_MAX_LENGTH = 3_100_000;
const CHAT_IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const channelId = request.nextUrl.searchParams.get("channelId");
  if (!channelId) {
    return fail("missing_fields", "channelId is required");
  }

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, roomId, type: "TEXT" },
    select: { id: true },
  });
  if (!channel) {
    return fail("channel_not_found", "Text channel not found", 404);
  }

  const messages = await prisma.chatMessage.findMany({
    where: { roomId, channelId },
    include: { participant: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: "asc" },
    take: 150,
  });

  return ok({
    messages: messages.map((message: (typeof messages)[number]) => ({
      id: message.id,
      channelId: message.channelId,
      content: message.content,
      imageDataUrl: message.imageDataUrl,
      createdAt: message.createdAt.toISOString(),
      participant: {
        id: message.participant.id,
        name: message.participant.name,
        role: mapParticipantRole(message.participant.role),
      },
    })),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const channelId = body?.channelId as string | undefined;
  const participantId = body?.participantId as string | undefined;
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const imageDataUrl = typeof body?.imageDataUrl === "string" ? body.imageDataUrl.trim() : "";

  if (!channelId || (!content && !imageDataUrl)) {
    return fail(
      "missing_fields",
      "channelId and at least one of content or imageDataUrl are required"
    );
  }
  if (imageDataUrl.length > CHAT_IMAGE_DATA_URL_MAX_LENGTH) {
    return fail("image_too_large", "Image is too large to send", 413);
  }
  if (imageDataUrl && !CHAT_IMAGE_DATA_URL_PATTERN.test(imageDataUrl)) {
    return fail("invalid_image", "Image must be a PNG, JPG, GIF or WebP data URL");
  }

  const [access, channel] = await Promise.all([
    resolveRoomParticipantAccess({ request, roomId, participantId }),
    prisma.channel.findFirst({
      where: { id: channelId, roomId, type: "TEXT" },
      select: { id: true },
    }),
  ]);

  if ("error" in access) {
    return access.error;
  }
  if (!channel) {
    return fail("channel_not_found", "Text channel not found", 404);
  }

  const { participant } = access;
  const message = await prisma.chatMessage.create({
    data: {
      roomId,
      channelId,
      participantId: participant.id,
      content: content ? content.slice(0, 2000) : null,
      imageDataUrl: imageDataUrl || null,
    },
  });

  return ok({
    message: {
      id: message.id,
      channelId: message.channelId,
      content: message.content,
      imageDataUrl: message.imageDataUrl,
      createdAt: message.createdAt.toISOString(),
      participant: {
        id: participant.id,
        name: participant.name,
        role: mapParticipantRole(participant.role),
      },
    },
  });
}
