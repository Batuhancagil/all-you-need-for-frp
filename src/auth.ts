import NextAuth, { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";

import { prisma } from "@/server/db";

const googleProvider = GoogleProvider({
  clientId: process.env.GOOGLE_CLIENT_ID ?? "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
}) as NextAuthOptions["providers"][number];

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [googleProvider],
  session: { strategy: "database" },
};

export const handler = NextAuth(authOptions);
