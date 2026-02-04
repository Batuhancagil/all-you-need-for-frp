import { NextRequest } from "next/server";
import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";

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

  const updated = await prisma.participant.updateMany({
    where: { id: participantId, roomId },
    data: { lastSeen: new Date() },
  });
  if (updated.count === 0) {
    return fail("participant_not_found", "Participant not found", 404);
  }
  return ok({ ok: true });
}
