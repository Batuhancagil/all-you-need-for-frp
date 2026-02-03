import { ok } from "@/server/api";
import { getMetrics } from "@/server/store";

export async function GET() {
  return ok({ metrics: getMetrics() });
}
