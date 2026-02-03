import { ok } from "@/server/api";
import { listRooms } from "@/server/store";

export async function GET() {
  return ok({ rooms: listRooms() });
}
