import type { Env } from "../types";
import { errorResponse, jsonResponse } from "../utils/http";
import { NotionApiError } from "../services/notion_client";
import { aggregateStudyUsageForTargetDate, getPreviousJstDateFrom } from "../services/app_usage_session_service";

export const handleAppUsageAggregatePost = async (request: Request, env: Env): Promise<Response> => {
  try {
    const body: any = await request.json().catch(() => ({}));
    const targetDate = typeof body?.target_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.target_date)
      ? body.target_date
      : getPreviousJstDateFrom(Date.now());
    const aggregate = await aggregateStudyUsageForTargetDate(env, targetDate);
    return jsonResponse(200, { ok: true, target_date: targetDate, daily_log_updated: true, aggregate: { study_minutes: aggregate.minutes, study_sessions: aggregate.sessions, study_last_used_at: aggregate.last } });
  } catch (error) {
    if (error instanceof NotionApiError) return errorResponse(502, "Notion API error", { status: error.status, body_preview: error.responseText.slice(0, 300) });
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("APP_USAGE_DB_ID")) return errorResponse(500, "Missing APP_USAGE_DB_ID");
    if (msg.includes("DAILY_LOG_DB_ID")) return errorResponse(500, "Missing DAILY_LOG_DB_ID");
    return errorResponse(500, "Internal Server Error");
  }
};
