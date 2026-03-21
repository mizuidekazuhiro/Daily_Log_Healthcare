import type { Env } from "../types";

export type LegacyHealthPayload = {
  date?: string | null;
  weight?: number | null;
  protein?: number | null;
  fat?: number | null;
  carb?: number | null;
  kcal?: number | null;
  sleep_start?: string | null;
  sleep_end?: string | null;
  sleep_duration_min?: number | null;
  sleep_score?: number | null;
  sleep_awakenings?: number | null;
  in_bed_duration_min?: number | null;
  sleep_source?: string | null;
  rem_duration_min?: number | null;
  deep_duration_min?: number | null;
  sleep_heart_rate?: number | null;
  readiness_stars?: number | null;
  readiness_hrv?: number | null;
  readiness_bpm?: number | null;
  baseline_hrv?: number | null;
  baseline_waking_bpm?: number | null;
  sleep_percent?: number | null;
  rem_percent?: number | null;
  deep_percent?: number | null;
  heart_rate_percent?: number | null;
  readiness_label?: string | null;
  source?: string | null;
};

export type NotionRequestResult =
  | { ok: true; json: any }
  | { ok: false; status: number; text: string };

export type NotionRequestFn = (
  url: string,
  options: RequestInit,
  token: string,
) => Promise<NotionRequestResult>;

const HEALTH_PROP = {
  title: "Name",
  date: "Date",
  weight: "Weight",
  protein: "Protein",
  fat: "Fat",
  carb: "Carb",
  kcal: "Kcal",
  source: "Source",
  sleepStart: "Sleep Start",
  sleepEnd: "Sleep End",
  sleepDurationMin: "Sleep Duration Min",
  sleepScore: "Sleep Score",
  sleepAwakenings: "Sleep Awakenings",
  inBedDurationMin: "In Bed Duration Min",
  sleepSource: "Sleep Source",
  remDurationMin: "REM Duration Min",
  deepDurationMin: "Deep Duration Min",
  sleepHeartRate: "Sleep Heart Rate",
  readinessStars: "Readiness Stars",
  readinessHrv: "Readiness HRV",
  readinessBpm: "Readiness BPM",
  baselineHrv: "Baseline HRV",
  baselineWakingBpm: "Baseline Waking BPM",
  sleepPercent: "Sleep Percent",
  remPercent: "REM Percent",
  deepPercent: "Deep Percent",
  heartRatePercent: "Heart Rate Percent",
  readinessLabel: "Readiness Label",
} as const;

const NUMERIC_FIELDS = [
  { payloadKey: "weight", notionProp: HEALTH_PROP.weight },
  { payloadKey: "protein", notionProp: HEALTH_PROP.protein },
  { payloadKey: "fat", notionProp: HEALTH_PROP.fat },
  { payloadKey: "carb", notionProp: HEALTH_PROP.carb },
  { payloadKey: "kcal", notionProp: HEALTH_PROP.kcal },
  { payloadKey: "sleep_duration_min", notionProp: HEALTH_PROP.sleepDurationMin },
  { payloadKey: "sleep_score", notionProp: HEALTH_PROP.sleepScore },
  { payloadKey: "sleep_awakenings", notionProp: HEALTH_PROP.sleepAwakenings },
  { payloadKey: "in_bed_duration_min", notionProp: HEALTH_PROP.inBedDurationMin },
  { payloadKey: "rem_duration_min", notionProp: HEALTH_PROP.remDurationMin },
  { payloadKey: "deep_duration_min", notionProp: HEALTH_PROP.deepDurationMin },
  { payloadKey: "sleep_heart_rate", notionProp: HEALTH_PROP.sleepHeartRate },
  { payloadKey: "readiness_stars", notionProp: HEALTH_PROP.readinessStars },
  { payloadKey: "readiness_hrv", notionProp: HEALTH_PROP.readinessHrv },
  { payloadKey: "readiness_bpm", notionProp: HEALTH_PROP.readinessBpm },
  { payloadKey: "baseline_hrv", notionProp: HEALTH_PROP.baselineHrv },
  { payloadKey: "baseline_waking_bpm", notionProp: HEALTH_PROP.baselineWakingBpm },
  { payloadKey: "sleep_percent", notionProp: HEALTH_PROP.sleepPercent },
  { payloadKey: "rem_percent", notionProp: HEALTH_PROP.remPercent },
  { payloadKey: "deep_percent", notionProp: HEALTH_PROP.deepPercent },
  { payloadKey: "heart_rate_percent", notionProp: HEALTH_PROP.heartRatePercent },
] as const;

const STRING_FIELDS = [
  { payloadKey: "source", notionProp: HEALTH_PROP.source, notionType: "select" },
  { payloadKey: "sleep_source", notionProp: HEALTH_PROP.sleepSource, notionType: "select" },
  { payloadKey: "readiness_label", notionProp: HEALTH_PROP.readinessLabel, notionType: "rich_text" },
] as const;

const DATE_FIELDS = [
  { payloadKey: "sleep_start", notionProp: HEALTH_PROP.sleepStart },
  { payloadKey: "sleep_end", notionProp: HEALTH_PROP.sleepEnd },
] as const;

const hasOwn = (payload: LegacyHealthPayload, key: keyof LegacyHealthPayload): boolean =>
  Object.prototype.hasOwnProperty.call(payload, key);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isNullishOrEmptyString = (value: unknown): boolean =>
  value === null || value === undefined || value === "";

const isIso8601DateTimeString = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!isoDateTimePattern.test(trimmed)) {
    return false;
  }
  return !Number.isNaN(Date.parse(trimmed));
};

const unwrapShortcutDeep = (value: any, maxDepth = 6): any => {
  let current = value;
  let depth = 0;
  while (
    depth < maxDepth &&
    current &&
    typeof current === "object" &&
    !Array.isArray(current) &&
    Object.prototype.hasOwnProperty.call(current, "")
  ) {
    current = (current as { "": any })[""];
    depth += 1;
  }
  return current;
};

const toNumberOrNull = (value: any): number | null => {
  const unwrapped = unwrapShortcutDeep(value);
  if (unwrapped === "" || unwrapped === null || unwrapped === undefined) {
    return null;
  }
  if (typeof unwrapped === "number") {
    return Number.isFinite(unwrapped) ? unwrapped : null;
  }
  if (typeof unwrapped === "string") {
    const trimmed = unwrapped.trim();
    if (!trimmed) {
      return null;
    }
    const normalized = trimmed.replace(/,/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toTrimmedStringOrNull = (value: any): string | null => {
  const unwrapped = unwrapShortcutDeep(value);
  if (unwrapped === "" || unwrapped === null || unwrapped === undefined) {
    return null;
  }
  if (typeof unwrapped !== "string") {
    return null;
  }
  const trimmed = unwrapped.trim();
  return trimmed || null;
};

export const normalizeHealthPayload = (
  rawPayload: LegacyHealthPayload,
): LegacyHealthPayload => {
  let payload = rawPayload;
  const raw: any = rawPayload as any;
  if (raw && typeof raw === "object") {
    payload = unwrapShortcutDeep(raw) as LegacyHealthPayload;
  }

  const normalized = { ...payload };
  normalized.date = toTrimmedStringOrNull(normalized.date);

  for (const field of NUMERIC_FIELDS) {
    normalized[field.payloadKey] = toNumberOrNull(normalized[field.payloadKey]);
  }

  for (const field of [...STRING_FIELDS, ...DATE_FIELDS]) {
    normalized[field.payloadKey] = toTrimmedStringOrNull(normalized[field.payloadKey]);
  }

  return normalized;
};

export const buildValidationDebugInfo = (payload: LegacyHealthPayload) => {
  const receivedTypes = Object.fromEntries(
    NUMERIC_FIELDS.map(({ payloadKey }) => {
      const value = payload[payloadKey];
      if (value === null) {
        return [payloadKey, "null"];
      }
      if (Array.isArray(value)) {
        return [payloadKey, "array"];
      }
      return [payloadKey, typeof value];
    }),
  );
  const receivedValues = Object.fromEntries(
    NUMERIC_FIELDS.map(({ payloadKey }) => [payloadKey, payload[payloadKey]]),
  );

  return {
    receivedTypes,
    receivedValues,
  };
};

export const validateHealthPayload = (
  payload: LegacyHealthPayload,
): string | null => {
  for (const { payloadKey } of NUMERIC_FIELDS) {
    if (!hasOwn(payload, payloadKey)) {
      continue;
    }
    const value = payload[payloadKey];
    if (value === null || value === undefined) {
      continue;
    }
    if (!isFiniteNumber(value)) {
      return `${payloadKey} must be a finite number`;
    }
  }

  for (const { payloadKey } of STRING_FIELDS) {
    if (!hasOwn(payload, payloadKey)) {
      continue;
    }
    const value = payload[payloadKey];
    if (isNullishOrEmptyString(value)) {
      continue;
    }
    if (typeof value !== "string") {
      return `${payloadKey} must be a string`;
    }
  }

  for (const { payloadKey } of DATE_FIELDS) {
    if (!hasOwn(payload, payloadKey)) {
      continue;
    }
    const value = payload[payloadKey];
    if (isNullishOrEmptyString(value)) {
      continue;
    }
    if (typeof value !== "string") {
      return `${payloadKey} must be a string`;
    }
    if (!isIso8601DateTimeString(value)) {
      return `${payloadKey} must be an ISO 8601 datetime string`;
    }
  }

  return null;
};

const assignNumberProp = (
  props: Record<string, unknown>,
  propName: string,
  value: number | null | undefined,
): void => {
  if (value === null || value === undefined) {
    return;
  }
  props[propName] = { number: value };
};

const assignDateProp = (
  props: Record<string, unknown>,
  propName: string,
  value: string | null | undefined,
): void => {
  if (value === null || value === undefined) {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  props[propName] = { date: { start: trimmed } };
};

const assignSelectProp = (
  props: Record<string, unknown>,
  propName: string,
  value: string | null | undefined,
): void => {
  if (value === null || value === undefined) {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  props[propName] = { select: { name: trimmed } };
};

const assignRichTextProp = (
  props: Record<string, unknown>,
  propName: string,
  value: string | null | undefined,
): void => {
  if (value === null || value === undefined) {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  props[propName] = {
    rich_text: [
      {
        type: "text",
        text: {
          content: String(trimmed),
        },
      },
    ],
  };
};

export const buildHealthPartialProps = (
  payload: LegacyHealthPayload,
): Record<string, unknown> => {
  const props: Record<string, unknown> = {};

  for (const { payloadKey, notionProp } of NUMERIC_FIELDS) {
    assignNumberProp(props, notionProp, payload[payloadKey]);
  }

  for (const { payloadKey, notionProp } of DATE_FIELDS) {
    assignDateProp(props, notionProp, payload[payloadKey]);
  }

  for (const { payloadKey, notionProp, notionType } of STRING_FIELDS) {
    if (notionType === "select") {
      assignSelectProp(props, notionProp, payload[payloadKey]);
      continue;
    }
    if (notionType === "rich_text") {
      assignRichTextProp(props, notionProp, payload[payloadKey]);
    }
  }

  return props;
};

const getHealthDatabaseId = (env: Env): string | null =>
  env.HEALTH_DB_ID ?? env.DAILY_LOG_DB_ID ?? null;

const getHealthDateProp = (env: Env): string => env.HEALTH_DATE_PROP ?? HEALTH_PROP.date;
const getHealthTitleProp = (env: Env): string => env.HEALTH_TITLE_PROP ?? HEALTH_PROP.title;

const buildNotionPropertyErrorContext = (
  operation: "query" | "update" | "create",
  propertyNames: string[],
  payload: Record<string, unknown>,
) => ({
  operation,
  propertyNames,
  payload,
});

const logNotionPropertyError = (
  context: ReturnType<typeof buildNotionPropertyErrorContext>,
  result: Extract<NotionRequestResult, { ok: false }>,
) => {
  console.error("HEALTH_DAILY_NOTION_PROPERTY_ERROR", {
    ...context,
    status: result.status,
    detailPreview: result.text.slice(0, 500),
  });
};

export const upsertHealthDailyPage = async (
  env: Env,
  payload: LegacyHealthPayload,
  notionRequest: NotionRequestFn,
): Promise<
  | { ok: true; action: "updated" | "created"; date: string }
  | { ok: false; status: number; body: { ok: false; error: string; status: number; detail: string } }
> => {
  const databaseId = getHealthDatabaseId(env);
  if (!databaseId) {
    return {
      ok: false,
      status: 500,
      body: {
        ok: false,
        error: "HEALTH_DB_ID (or DAILY_LOG_DB_ID) is required",
        status: 500,
        detail: "Missing Notion database configuration",
      },
    };
  }

  const date = (payload.date ?? "").trim();
  const partialProps = buildHealthPartialProps(payload);
  const dateProp = getHealthDateProp(env);
  const titleProp = getHealthTitleProp(env);

  const queryBody = {
    filter: {
      property: dateProp,
      date: {
        equals: date,
      },
    },
    page_size: 1,
  };

  const queryResult = await notionRequest(
    `https://api.notion.com/v1/databases/${databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify(queryBody),
    },
    env.NOTION_TOKEN,
  );

  if (!queryResult.ok) {
    logNotionPropertyError(
      buildNotionPropertyErrorContext("query", [dateProp], queryBody),
      queryResult,
    );
    return {
      ok: false,
      status: 502,
      body: {
        ok: false,
        error: "Notion API error",
        status: queryResult.status,
        detail: queryResult.text,
      },
    };
  }

  const results = queryResult.json.results as Array<{ id: string }>;

  if (results.length > 0) {
    if (Object.keys(partialProps).length === 0) {
      return { ok: true, action: "updated", date };
    }

    const updateResult = await notionRequest(
      `https://api.notion.com/v1/pages/${results[0].id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ properties: partialProps }),
      },
      env.NOTION_TOKEN,
    );

    if (!updateResult.ok) {
      logNotionPropertyError(
        buildNotionPropertyErrorContext("update", Object.keys(partialProps), partialProps),
        updateResult,
      );
      return {
        ok: false,
        status: 502,
        body: {
          ok: false,
          error: "Notion API error",
          status: updateResult.status,
          detail: updateResult.text,
        },
      };
    }

    return { ok: true, action: "updated", date };
  }

  const createProps = {
    [titleProp]: {
      title: [{ text: { content: `Daily Log | ${date}` } }],
    },
    [dateProp]: {
      date: { start: date },
    },
    ...partialProps,
  };

  const createResult = await notionRequest(
    "https://api.notion.com/v1/pages",
    {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: createProps,
      }),
    },
    env.NOTION_TOKEN,
  );

  if (!createResult.ok) {
    logNotionPropertyError(
      buildNotionPropertyErrorContext("create", Object.keys(createProps), createProps),
      createResult,
    );
    return {
      ok: false,
      status: 502,
      body: {
        ok: false,
        error: "Notion API error",
        status: createResult.status,
        detail: createResult.text,
      },
    };
  }

  return { ok: true, action: "created", date };
};
