import { ok, fail } from "@/server/api";
import { getAdminDefaults, setAdminDefaults } from "@/server/store";

export async function GET() {
  return ok({ defaults: getAdminDefaults() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return fail("invalid_body", "Request body must be JSON");
  }

  const defaults = setAdminDefaults({
    roomNamePrefix: body.roomNamePrefix,
    privacy: body.privacy,
  });

  return ok({ defaults });
}
