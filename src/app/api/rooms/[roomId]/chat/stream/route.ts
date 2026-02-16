import { NextRequest } from "next/server";
import { prisma } from "@/server/db";

export const runtime = "nodejs";

function eventData(type: string, payload: unknown) {
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const channelId = request.nextUrl.searchParams.get("channelId");
  const since = request.nextUrl.searchParams.get("since");
  if (!channelId) {
    return new Response("channelId is required", { status: 400 });
  }

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, roomId, type: "TEXT" },
    select: { id: true },
  });
  if (!channel) {
    return new Response("channel not found", { status: 404 });
  }

  let cursor = since ? new Date(since) : new Date();
  if (Number.isNaN(cursor.getTime())) {
    cursor = new Date();
  }

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(eventData("ready", { ok: true })));

      const heartbeat = setInterval(() => {
        controller.enqueue(new TextEncoder().encode(eventData("ping", { at: new Date().toISOString() })));
      }, 15000);

      const poll = setInterval(() => {
        void (async () => {
          try {
            const nextMessages = await prisma.chatMessage.findMany({
              where: { roomId, channelId, createdAt: { gt: cursor } },
              include: { participant: { select: { id: true, name: true, role: true } } },
              orderBy: { createdAt: "asc" },
              take: 100,
            });
            if (nextMessages.length === 0) return;

            cursor = nextMessages[nextMessages.length - 1].createdAt;
            const payload = nextMessages.map((message) => ({
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
            }));

            controller.enqueue(new TextEncoder().encode(eventData("messages", payload)));
          } catch {
            clearInterval(poll);
            clearInterval(heartbeat);
            controller.close();
          }
        })();
      }, 1000);

      request.signal.addEventListener("abort", () => {
        clearInterval(poll);
        clearInterval(heartbeat);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
