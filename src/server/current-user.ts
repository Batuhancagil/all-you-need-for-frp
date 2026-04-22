import { getServerSession } from "next-auth";

import { authOptions } from "@/auth";
import { prisma } from "@/server/db";

export async function getCurrentUserRecord() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return null;
  }

  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });
}
