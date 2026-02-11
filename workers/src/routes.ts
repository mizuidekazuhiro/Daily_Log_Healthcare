import type { Env } from "./types";
import { handleSupplementsGet } from "./handlers/supplements_get";
import { handleSupplementIntakesPost } from "./handlers/supplement_intakes_post";
import { requireBearerAuth } from "./utils/auth";
import { jsonResponse } from "./utils/http";
import { handleLegacyRoute } from "./legacy";

export const routeRequest = async (request: Request, env: Env): Promise<Response> => {
  const { pathname } = new URL(request.url);

  if (pathname === "/api/supplements") {
    if (request.method !== "GET") return jsonResponse(405, { ok: false, error: "Method Not Allowed" });
    if (!requireBearerAuth(request, env)) return jsonResponse(401, { ok: false, error: "Unauthorized" });
    return handleSupplementsGet(request, env);
  }

  if (pathname === "/api/supplement_intakes") {
    if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method Not Allowed" });
    if (!requireBearerAuth(request, env)) return jsonResponse(401, { ok: false, error: "Unauthorized" });
    return handleSupplementIntakesPost(request, env);
  }

  const legacy = await handleLegacyRoute(request, env as any);
  if (legacy) {
    return legacy;
  }

  return jsonResponse(404, { ok: false, error: "Not Found" });
};
