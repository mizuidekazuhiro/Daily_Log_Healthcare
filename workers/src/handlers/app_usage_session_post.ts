import type { Env } from "../types";
import { errorResponse, jsonResponse } from "../utils/http";
import { NotionApiError, notionFetch, queryDatabaseAll } from "../services/notion_client";
import { normalizeAppUsagePayload, upsertAndAggregateAnkiSession, validateAndComputeAppUsage } from "../services/app_usage_session_service";

export const handleAppUsageSessionPost = async (request: Request, env: Env): Promise<Response> => {
  try {
    const raw = await request.json();
    const normalized = normalizeAppUsagePayload(raw);
    console.log("APP_USAGE_SESSION_RECEIVED", { app: normalized.app, session_id: normalized.session_id, started_at: normalized.started_at, ended_at: normalized.ended_at });
    const computed: any = validateAndComputeAppUsage(normalized);
    if (computed.error) return errorResponse(400, computed.error);
    if (computed.ignored) {
      console.log("APP_USAGE_SESSION_IGNORED", { app: normalized.app, session_id: normalized.session_id, duration_seconds: computed.duration_seconds });
      return jsonResponse(200, { ok: true, ignored: true, reason: computed.reason, duration_seconds: computed.duration_seconds });
    }
    console.log("APP_USAGE_SESSION_VALIDATED", { app: normalized.app, session_id: normalized.session_id, target_date: computed.target_date, duration_seconds: computed.duration_seconds, duration_min: computed.duration_min });

    const { upsert_mode, aggregate } = await upsertAndAggregateAnkiSession(env, normalized, computed);

    const dailyDbId = env.HEALTH_DB_ID || env.DAILY_LOG_DB_ID;
    if (!dailyDbId) return errorResponse(500, "Missing Daily Log DB id");
    const dateProp = env.HEALTH_DATE_PROP || "Date";
    const titleProp = env.HEALTH_TITLE_PROP || "Name";
    const ankiMin = env.DAILY_LOG_ANKI_MINUTES_PROPERTY_NAME || "Anki Minutes";
    const ankiSess = env.DAILY_LOG_ANKI_SESSIONS_PROPERTY_NAME || "Anki Sessions";
    const ankiLast = env.DAILY_LOG_ANKI_LAST_USED_AT_PROPERTY_NAME || "Anki Last Used At";

    console.log("DAILY_LOG_ANKI_USAGE_UPDATE_START", { target_date: computed.target_date });
    const dailyRows = await queryDatabaseAll(env, dailyDbId, { filter: { property: dateProp, date: { equals: computed.target_date } }, page_size: 1 });
    let pageId = dailyRows[0]?.id;
    if (!pageId) {
      const created = await notionFetch(env, "/pages", { method: "POST", body: JSON.stringify({ parent: { database_id: dailyDbId }, properties: { [titleProp]: { title: [{ text: { content: `Daily Log | ${computed.target_date}` } }] }, [dateProp]: { date: { start: computed.target_date } } } }) });
      pageId = created.id;
    }
    await notionFetch(env, `/pages/${pageId}`, { method: "PATCH", body: JSON.stringify({ properties: { [ankiMin]: { number: aggregate.minutes }, [ankiSess]: { number: aggregate.sessions }, [ankiLast]: { date: aggregate.last ? { start: aggregate.last } : null } } }) });
    console.log("DAILY_LOG_ANKI_USAGE_UPDATE_END", { target_date: computed.target_date, aggregate_minutes: aggregate.minutes, aggregate_sessions: aggregate.sessions, last_used_at: aggregate.last });

    return jsonResponse(200, { ok: true, ignored: false, app: normalized.app, session_id: normalized.session_id, target_date: computed.target_date, duration_seconds: computed.duration_seconds, duration_min: computed.duration_min, upsert_mode, daily_log_updated: true, aggregate: { anki_minutes: aggregate.minutes, anki_sessions: aggregate.sessions, anki_last_used_at: aggregate.last } });
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse(400, "Invalid JSON");
    if (error instanceof NotionApiError) return errorResponse(502, "Notion API error", { status: error.status, body_preview: error.responseText.slice(0, 300) });
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("APP_USAGE_DB_ID")) return errorResponse(500, "Missing APP_USAGE_DB_ID");
    console.error("APP_USAGE_SESSION_ERROR", { message: msg });
    return errorResponse(500, "Internal Server Error");
  }
};
