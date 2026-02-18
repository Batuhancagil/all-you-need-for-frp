import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const sinceRaw = request.nextUrl.searchParams.get("since");
  if (!sinceRaw) {
    return fail("missing_fields", "since is required");
  }
  const since = new Date(sinceRaw);
  if (Number.isNaN(since.getTime())) {
    return fail("invalid_since", "since must be a valid ISO datetime");
  }

  const messages = await prisma.chatMessage.findMany({
    where: { roomId, createdAt: { gt: since }, channel: { type: "TEXT" } },
    include: {
      participant: { select: { id: true, name: true, role: true } },
      channel: { select: { id: true, slug: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 300,
  });

  const lastCursor = messages[messages.length - 1]?.createdAt ?? since;
  return ok({
    cursor: lastCursor.toISOString(),
    messages: messages.map((message: (typeof messages)[number]) => ({
      id: message.id,
      channelId: message.channelId,
      channelSlug: message.channel.slug,
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
