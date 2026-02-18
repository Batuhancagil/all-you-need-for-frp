import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";

function extractYoutubeVideoId(url: string): string | null {
  const trimmed = url.trim();
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = trimmed.match(p);
    if (m) return m[1];
  }
  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { backgroundMusicUrl: true },
  });
  if (!room) return fail("room_not_found", "Room not found", 404);
  return ok({ url: room.backgroundMusicUrl ?? null });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  const participantId = body?.participantId as string | undefined;
  const url = body?.url as string | undefined;

  if (!participantId) {
    return fail("missing_fields", "participantId required");
  }

  const requester = await prisma.participant.findFirst({
    where: { id: participantId, roomId },
    select: { role: true },
  });
  if (!requester) return fail("participant_not_found", "Participant not found", 404);

  const canControl = requester.role === "ADMIN" || requester.role === "GM";
  if (!canControl) {
    return fail("forbidden", "Only admin or GM can set background music", 403);
  }

  let videoId: string | null = null;
  if (url?.trim()) {
    videoId = extractYoutubeVideoId(url);
    if (!videoId) {
      return fail("invalid_url", "Invalid YouTube URL");
    }
  }

  const embedUrl = videoId
    ? `https://www.youtube.com/embed/${videoId}?autoplay=1&loop=1&playlist=${videoId}`
    : null;

  await prisma.room.update({
    where: { id: roomId },
    data: { backgroundMusicUrl: embedUrl },
  });

  return ok({ url: embedUrl });
}
