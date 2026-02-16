import { ChannelType } from "@prisma/client";

export type DefaultChannelSeed = {
  name: string;
  slug: string;
  type: ChannelType;
};

export function getDefaultChannels(): DefaultChannelSeed[] {
  return [
    { name: "general", slug: "general", type: "TEXT" },
    { name: "session-notes", slug: "session-notes", type: "TEXT" },
    { name: "table", slug: "table", type: "VOICE" },
    { name: "afk", slug: "afk", type: "VOICE" },
  ];
}

export function sanitizeChannelSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "channel";
}
