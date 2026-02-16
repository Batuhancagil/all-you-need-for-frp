import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";

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
    messages: messages.map((message) => ({
      id: message.id,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      participant: {
        id: message.participant.id,
        name: message.participant.name,
        role:
          message.participant.role === "ADMIN"
            ? "admin"
            : message.participant.role === "GM"
              ? "gm"
              : "player",
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
  const content = body?.content as string | undefined;

  if (!channelId || !participantId || !content?.trim()) {
    return fail("missing_fields", "channelId, participantId and content are required");
  }

  const [participant, channel] = await Promise.all([
    prisma.participant.findFirst({
      where: { id: participantId, roomId },
      select: { id: true, name: true, role: true },
    }),
    prisma.channel.findFirst({
      where: { id: channelId, roomId, type: "TEXT" },
      select: { id: true },
    }),
  ]);

  if (!participant) {
    return fail("participant_not_found", "Participant not found", 404);
  }
  if (!channel) {
    return fail("channel_not_found", "Text channel not found", 404);
  }

  const message = await prisma.chatMessage.create({
    data: {
      roomId,
      channelId,
      participantId: participant.id,
      content: content.trim().slice(0, 2000),
    },
  });

  return ok({
    message: {
      id: message.id,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      participant: {
        id: participant.id,
        name: participant.name,
        role: participant.role === "ADMIN" ? "admin" : participant.role === "GM" ? "gm" : "player",
      },
    },
  });
}
