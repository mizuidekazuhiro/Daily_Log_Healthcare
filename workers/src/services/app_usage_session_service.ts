import type { Env } from "../types";
import { notionFetch, queryDatabaseAll } from "./notion_client";
import {
  aggregateAnkiRowsDedupBySessionId,
  normalizeAppUsagePayload,
  validateAndComputeAppUsage,
  getPreviousJstDateFrom,
  type NormalizedAppUsage,
} from "./app_usage_session_pure";

export { normalizeAppUsagePayload, validateAndComputeAppUsage, getPreviousJstDateFrom };

const prop = (env: Env, name: keyof Env, fallback: string) => (env[name] as string | undefined) || fallback;

const getAppUsageProps = (env: Env) => ({
  name: prop(env, "APP_USAGE_NAME_PROPERTY_NAME", "Name"),
  app: prop(env, "APP_USAGE_APP_PROPERTY_NAME", "App"),
  startAt: prop(env, "APP_USAGE_START_AT_PROPERTY_NAME", "Start At"),
  endAt: prop(env, "APP_USAGE_END_AT_PROPERTY_NAME", "End At"),
  durationMin: prop(env, "APP_USAGE_DURATION_MIN_PROPERTY_NAME", "Duration Min"),
  targetDate: prop(env, "APP_USAGE_TARGET_DATE_PROPERTY_NAME", "Target Date"),
  device: prop(env, "APP_USAGE_DEVICE_PROPERTY_NAME", "Device"),
  source: prop(env, "APP_USAGE_SOURCE_PROPERTY_NAME", "Source"),
  sessionId: prop(env, "APP_USAGE_SESSION_ID_PROPERTY_NAME", "Session ID"),
});

export const upsertAnkiSession = async (env: Env, normalized: NormalizedAppUsage, computed: any) => {
  const appDbId = env.APP_USAGE_DB_ID;
  if (!appDbId) throw new Error("Missing APP_USAGE_DB_ID");
  const appProp = getAppUsageProps(env);
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
  return { upsert_mode };
};

export const aggregateAnkiUsageForTargetDate = async (env: Env, targetDate: string) => {
  const appDbId = env.APP_USAGE_DB_ID;
  const dailyDbId = env.DAILY_LOG_DB_ID;
  if (!appDbId) throw new Error("Missing APP_USAGE_DB_ID");
  if (!dailyDbId) throw new Error("Missing DAILY_LOG_DB_ID");

  const appProp = getAppUsageProps(env);
  const rows = await queryDatabaseAll(env, appDbId, { filter: { and: [{ property: appProp.app, select: { equals: "Anki" } }, { property: appProp.targetDate, date: { equals: targetDate } }] } });
  const aggregate = aggregateAnkiRowsDedupBySessionId(rows, { sessionId: appProp.sessionId, durationMin: appProp.durationMin, endAt: appProp.endAt }, targetDate);

  const dateProp = env.HEALTH_DATE_PROP || "Date";
  const titleProp = env.HEALTH_TITLE_PROP || "Name";
  const ankiMin = env.DAILY_LOG_ANKI_MINUTES_PROPERTY_NAME || "Anki Minutes";
  const ankiSess = env.DAILY_LOG_ANKI_SESSIONS_PROPERTY_NAME || "Anki Sessions";
  const ankiLast = env.DAILY_LOG_ANKI_LAST_USED_AT_PROPERTY_NAME || "Anki Last Used At";

  const dailyRows = await queryDatabaseAll(env, dailyDbId, { filter: { property: dateProp, date: { equals: targetDate } }, page_size: 1 });
  let pageId = dailyRows[0]?.id;
  if (!pageId) {
    const created = await notionFetch(env, "/pages", { method: "POST", body: JSON.stringify({ parent: { database_id: dailyDbId }, properties: { [titleProp]: { title: [{ text: { content: `Daily Log | ${targetDate}` } }] }, [dateProp]: { date: { start: targetDate } } } }) });
    pageId = created.id;
  }
  await notionFetch(env, `/pages/${pageId}`, { method: "PATCH", body: JSON.stringify({ properties: { [ankiMin]: { number: aggregate.minutes }, [ankiSess]: { number: aggregate.sessions }, [ankiLast]: { date: aggregate.last ? { start: aggregate.last } : null } } }) });
  return aggregate;
};
