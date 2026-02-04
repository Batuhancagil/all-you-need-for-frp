import { ok, fail } from "@/server/api";
import { prisma } from "@/server/db";
import { mapPrivacy } from "@/server/room-mappers";

export async function GET() {
  const settings = await prisma.adminSettings.findUnique({
    where: { id: "singleton" },
  });
  return ok({
    defaults: {
      roomNamePrefix: settings?.roomNamePrefix,
      privacy: settings?.privacy ? mapPrivacy(settings.privacy) : undefined,
    },
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return fail("invalid_body", "Request body must be JSON");
  }

  const privacy =
    body.privacy === "public" ? "PUBLIC" : body.privacy === "private" ? "PRIVATE" : undefined;
  const defaults = await prisma.adminSettings.upsert({
    where: { id: "singleton" },
    update: {
      roomNamePrefix: body.roomNamePrefix,
      privacy,
    },
    create: {
      id: "singleton",
      roomNamePrefix: body.roomNamePrefix,
      privacy,
    },
  });

  return ok({
    defaults: {
      roomNamePrefix: defaults.roomNamePrefix,
      privacy: defaults.privacy ? mapPrivacy(defaults.privacy) : undefined,
    },
  });
}
