import { ok } from "@/server/api";
import { prisma } from "@/server/db";

export async function GET() {
  const [sessionsStarted, sessionsEnded, uniqueParticipants] = await prisma.$transaction([
    prisma.room.count({ where: { sessionStartedAt: { not: null } } }),
    prisma.room.count({ where: { sessionEndedAt: { not: null } } }),
    prisma.participant.count(),
  ]);
  return ok({
    metrics: {
      sessionsStarted,
      sessionsEnded,
      uniqueParticipants,
    },
  });
}
