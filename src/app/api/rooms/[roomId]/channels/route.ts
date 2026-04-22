import { NextRequest } from "next/server";
import { ChannelType } from "@prisma/client";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { resolveRoomParticipantAccess } from "@/server/room-participant-session";
import { getDefaultChannels, sanitizeChannelSlug } from "@/server/channel-utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true },
  });
  if (!room) {
    return fail("room_not_found", "Room not found", 404);
  }

  let channels = await prisma.channel.findMany({
    where: { roomId },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
  });

  if (channels.length === 0) {
    await prisma.channel.createMany({
      data: getDefaultChannels().map((channel: ReturnType<typeof getDefaultChannels>[number]) => ({
        roomId,
        name: channel.name,
        slug: channel.slug,
        type: channel.type,
      })),
    });
  } else {
    const hasDice = channels.some((c: { type: string }) => c.type === "DICE");
    if (!hasDice) {
      try {
        await prisma.channel.create({
          data: { roomId, name: "dice-rolls", slug: "dice-rolls", type: ChannelType.DICE },
        });
      } catch {
        // race condition or already exists
      }
    }
  }
  channels = await prisma.channel.findMany({
    where: { roomId },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
  });

  const typeMap = (t: ChannelType) =>
    t === "TEXT" ? "text" : t === "VOICE" ? "voice" : "dice";

  return ok({
    channels: channels.map((channel: (typeof channels)[number]) => ({
      id: channel.id,
      name: channel.name,
      slug: channel.slug,
      type: typeMap(channel.type),
    })),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const participantId = body?.participantId as string | undefined;
  const name = body?.name as string | undefined;
  const type = body?.type as "text" | "voice" | "dice" | undefined;
  const trimmedName = name?.trim() ?? "";

  if (!trimmedName || !type) {
    return fail("missing_fields", "name and type are required");
  }

  const access = await resolveRoomParticipantAccess({ request, roomId, participantId });
  if ("error" in access) {
    return access.error;
  }

  const channelType: ChannelType =
    type === "voice" ? "VOICE" : type === "dice" ? "DICE" : "TEXT";
  const slug = sanitizeChannelSlug(trimmedName);

  try {
    const channel = await prisma.channel.create({
      data: {
        roomId,
        name: trimmedName.slice(0, 60),
        slug,
        type: channelType,
      },
    });
    return ok({
      channel: {
        id: channel.id,
        name: channel.name,
        slug: channel.slug,
        type: channel.type === "TEXT" ? "text" : channel.type === "VOICE" ? "voice" : "dice",
      },
    });
  } catch {
    return fail("channel_exists", "A channel with this name already exists for that type");
  }
}
