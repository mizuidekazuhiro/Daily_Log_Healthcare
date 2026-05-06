import type { Env } from "../types";
import { notionFetch, queryDatabaseAll } from "./notion_client";
import { normalizeAppUsagePayload, validateAndComputeAppUsage, type NormalizedAppUsage } from "./app_usage_session_pure";

export { normalizeAppUsagePayload, validateAndComputeAppUsage };

const prop = (env: Env, name: keyof Env, fallback: string) => (env[name] as string | undefined) || fallback;

export const upsertAndAggregateAnkiSession = async (env: Env, normalized: NormalizedAppUsage, computed: any) => {
  const appDbId = env.APP_USAGE_DB_ID;
  if (!appDbId) throw new Error("Missing APP_USAGE_DB_ID");
  const appProp = {
    name: prop(env, "APP_USAGE_NAME_PROPERTY_NAME", "Name"),
    app: prop(env, "APP_USAGE_APP_PROPERTY_NAME", "App"),
    startAt: prop(env, "APP_USAGE_START_AT_PROPERTY_NAME", "Start At"),
    endAt: prop(env, "APP_USAGE_END_AT_PROPERTY_NAME", "End At"),
    durationMin: prop(env, "APP_USAGE_DURATION_MIN_PROPERTY_NAME", "Duration Min"),
    targetDate: prop(env, "APP_USAGE_TARGET_DATE_PROPERTY_NAME", "Target Date"),
    device: prop(env, "APP_USAGE_DEVICE_PROPERTY_NAME", "Device"),
    source: prop(env, "APP_USAGE_SOURCE_PROPERTY_NAME", "Source"),
    sessionId: prop(env, "APP_USAGE_SESSION_ID_PROPERTY_NAME", "Session ID"),
  };
  console.log("APP_USAGE_SESSION_UPSERT_START", { app: normalized.app, session_id: normalized.session_id, target_date: computed.target_date });
  const found = await queryDatabaseAll(env, appDbId, { filter: { property: appProp.sessionId, rich_text: { equals: normalized.session_id } } });
  const props = {
    [appProp.name]: { title: [{ text: { content: `${normalized.app} ${computed.target_date}` } }] },
    [appProp.app]: { select: { name: normalized.app } },
    [appProp.startAt]: { date: { start: normalized.started_at } },
    [appProp.endAt]: { date: { start: normalized.ended_at } },
    [appProp.durationMin]: { number: computed.duration_min },
    [appProp.targetDate]: { date: { start: computed.target_date } },
    [appProp.device]: { rich_text: [{ text: { content: normalized.device } }] },
    [appProp.source]: { select: { name: normalized.source } },
    [appProp.sessionId]: { rich_text: [{ text: { content: normalized.session_id } }] },
  };
  let upsert_mode = "created";
  if (found.length === 0) {
    await notionFetch(env, "/pages", { method: "POST", body: JSON.stringify({ parent: { database_id: appDbId }, properties: props }) });
  } else {
    upsert_mode = "updated";
    const latest = [...found].sort((a, b) => Date.parse(b.last_edited_time) - Date.parse(a.last_edited_time))[0];
    await notionFetch(env, `/pages/${latest.id}`, { method: "PATCH", body: JSON.stringify({ properties: props }) });
  }
  console.log("APP_USAGE_SESSION_UPSERT_END", { app: normalized.app, session_id: normalized.session_id, upsert_mode });

  console.log("APP_USAGE_DAILY_AGGREGATION_START", { target_date: computed.target_date });
  const rows = await queryDatabaseAll(env, appDbId, { filter: { and: [{ property: appProp.app, select: { equals: "Anki" } }, { property: appProp.targetDate, date: { equals: computed.target_date } }] } });
  const agg = rows.reduce((acc, r) => {
    const mins = r.properties?.[appProp.durationMin]?.number ?? 0;
    const end = r.properties?.[appProp.endAt]?.date?.start ?? null;
    acc.minutes += Number.isFinite(mins) ? mins : 0;
    acc.sessions += 1;
    if (end && (!acc.last || Date.parse(end) > Date.parse(acc.last))) acc.last = end;
    return acc;
  }, { minutes: 0, sessions: 0, last: null as string | null });
  console.log("APP_USAGE_DAILY_AGGREGATION_END", { target_date: computed.target_date, aggregate_minutes: agg.minutes, aggregate_sessions: agg.sessions, last_used_at: agg.last });
  return { upsert_mode, aggregate: agg };
};
