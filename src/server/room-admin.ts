import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";

// Must stay in sync with the "Online" threshold used by the room UI
// (see ONLINE_MS in src/app/room/[roomId]/page.tsx). A participant is
// considered online if their lastSeen ping is within this window.
export const ADMIN_ONLINE_WINDOW_MS = 90 * 1000;

/**
 * Guarantees that a room always has an online admin when at least one
 * participant is online.
 *
 * Behaviour:
 *  - If the current admin is online, nothing changes.
 *  - If the current admin is offline/missing and there is another online
 *    participant, the admin role (and `Room.createdByParticipantId`) is
 *    transferred to the oldest online participant.
 *  - The previous offline admin is demoted to PLAYER (unless they are the
 *    active GM, in which case their role stays GM).
 *  - If no participants are online, nothing changes — we avoid promoting
 *    someone who can't actually react.
 */
export async function ensureOnlineAdmin(roomId: string): Promise<{
  transferred: boolean;
  adminParticipantId: string | null;
}> {
  const onlineThreshold = new Date(Date.now() - ADMIN_ONLINE_WINDOW_MS);

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: {
      id: true,
      createdByParticipantId: true,
      gmParticipantId: true,
    },
  });
  if (!room) {
    return { transferred: false, adminParticipantId: null };
  }

  const currentAdmin = room.createdByParticipantId
    ? await prisma.participant.findFirst({
        where: { id: room.createdByParticipantId, roomId },
        select: { id: true, role: true, lastSeen: true },
      })
    : null;

  const adminIsOnline =
    currentAdmin !== null && currentAdmin.lastSeen >= onlineThreshold;

  if (adminIsOnline) {
    if (currentAdmin.role !== "ADMIN") {
      await prisma.participant.update({
        where: { id: currentAdmin.id },
        data: { role: "ADMIN" },
      });
    }
    return { transferred: false, adminParticipantId: currentAdmin.id };
  }

  const candidate = await prisma.participant.findFirst({
    where: {
      roomId,
      lastSeen: { gte: onlineThreshold },
      ...(currentAdmin ? { id: { not: currentAdmin.id } } : {}),
    },
    orderBy: { joinedAt: "asc" },
    select: { id: true, role: true },
  });

  if (!candidate) {
    // No online participant can take over; keep state as-is so the
    // original admin can reclaim the room when they come back online.
    if (!currentAdmin && room.createdByParticipantId) {
      // Current admin participant no longer exists in the room; clear
      // the dangling reference so a new online user can claim it later.
      await prisma.room.update({
        where: { id: roomId },
        data: { createdByParticipantId: null },
      });
    }
    return {
      transferred: false,
      adminParticipantId: currentAdmin?.id ?? null,
    };
  }

  const operations: Prisma.PrismaPromise<unknown>[] = [];
  if (currentAdmin) {
    const demotedRole = currentAdmin.id === room.gmParticipantId ? "GM" : "PLAYER";
    operations.push(
      prisma.participant.update({
        where: { id: currentAdmin.id },
        data: { role: demotedRole },
      })
    );
  }
  if (candidate.role !== "ADMIN") {
    operations.push(
      prisma.participant.update({
        where: { id: candidate.id },
        data: { role: "ADMIN" },
      })
    );
  }
  operations.push(
    prisma.room.update({
      where: { id: roomId },
      data: { createdByParticipantId: candidate.id },
    })
  );

  await prisma.$transaction(operations);

  return { transferred: true, adminParticipantId: candidate.id };
}
