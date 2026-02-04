import { prisma } from "@/server/db";

function generateInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function createUniqueInviteCode(maxAttempts = 8) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const inviteCode = generateInviteCode();
    const exists = await prisma.room.findUnique({
      where: { inviteCode },
      select: { id: true },
    });
    if (!exists) return inviteCode;
  }
  throw new Error("Unable to generate unique invite code");
}
