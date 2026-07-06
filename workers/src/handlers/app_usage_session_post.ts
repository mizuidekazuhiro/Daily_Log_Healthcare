import type { Env } from "../types";
import { errorResponse, jsonResponse } from "../utils/http";
import { NotionApiError } from "../services/notion_client";
import {
  getAppUsageDayStartHour,
  getAppUsageSessionMaxMinutes,
  normalizeAppUsagePayload,
  upsertAppUsageSession,
  validateAndComputeAppUsage,
} from "../services/app_usage_session_service";

export const handleAppUsageSessionPost = async (request: Request, env: Env): Promise<Response> => {
  try {
    const raw = await request.json();
    const dayStartHour = getAppUsageDayStartHour(env);
    const normalized = normalizeAppUsagePayload(raw, dayStartHour);
    const isAnki = normalized.app.trim().toLowerCase() === "anki";
    const computed: any = validateAndComputeAppUsage(normalized, {
      sessionMaxMinutes: isAnki ? getAppUsageSessionMaxMinutes(env) : null,
    });
    if (computed.error) return errorResponse(400, computed.error);
    if (computed.ignored) return jsonResponse(200, { ok: true, ignored: true, reason: computed.reason, duration_seconds: computed.duration_seconds, daily_log_updated: false });
    const { upsert_mode } = await upsertAppUsageSession(env, normalized, computed);
    return jsonResponse(200, { ok: true, ignored: false, app: normalized.app, session_id: normalized.session_id, target_date: computed.target_date, day_start_hour: normalized.day_start_hour, duration_seconds: computed.duration_seconds, duration_min: computed.duration_min, upsert_mode, daily_log_updated: false });
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse(400, "Invalid JSON");
    if (error instanceof NotionApiError) return errorResponse(502, "Notion API error", { status: error.status, body_preview: error.responseText.slice(0, 300) });
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("APP_USAGE_DB_ID")) return errorResponse(500, "Missing APP_USAGE_DB_ID");
    console.error("APP_USAGE_SESSION_ERROR", { message: msg });
    return errorResponse(500, "Internal Server Error");
  }
};
