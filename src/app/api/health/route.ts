import { getPool } from "@/infrastructure/db/client";
import { jsonResponse } from "@/infrastructure/http";
import { logger } from "@/infrastructure/logging/logger";

export const dynamic = "force-dynamic";

function errorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

export async function GET() {
  try {
    await getPool().query("select 1");
    return jsonResponse({ status: "ok" });
  } catch (error) {
    logger.error({ errorName: errorName(error) }, "health check database probe failed");
    return jsonResponse({ status: "unavailable" }, { status: 503 });
  }
}
