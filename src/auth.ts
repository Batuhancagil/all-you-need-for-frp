import NextAuth, { type NextAuthOptions } from "next-auth";
// Next.js/TS module resolution can fail this subpath in strict build despite runtime support.
// @ts-expect-error next-auth provider subpath types are present in package exports.
import EmailProvider from "next-auth/providers/email";
import { PrismaAdapter } from "@next-auth/prisma-adapter";

import { prisma } from "@/server/db";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    EmailProvider({
      server: process.env.EMAIL_SERVER,
      from: process.env.EMAIL_FROM,
    }),
  ],
  session: { strategy: "database" },
};

export const handler = NextAuth(authOptions);
