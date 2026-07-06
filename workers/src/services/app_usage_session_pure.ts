export type AppUsagePayload = Record<string, unknown>;
export type NormalizedAppUsage = {
  app: string;
  session_id: string;
  started_at: string;
  ended_at: string;
  source: string;
  device: string;
  day_start_hour: number;
  payload_duration_seconds: number | null;
};

export type AppUsageValidationOptions = {
  sessionMaxMinutes?: number | null;
};

const ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DEFAULT_SESSION_MAX_MINUTES = 15;
const DEFAULT_DAY_START_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const unwrap = (v: any): any => (v && typeof v === "object" && "" in v ? unwrap(v[""]) : v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const hasControlChars = (value: string): boolean => [...value].some((ch) => {
  const code = ch.charCodeAt(0);
  return code < 32 || code === 127;
});

const getSessionMaxSeconds = (options?: AppUsageValidationOptions): number | null => {
  if (options?.sessionMaxMinutes === null) return null;
  const minutes = Number(options?.sessionMaxMinutes);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_SESSION_MAX_MINUTES;
  return Math.round(safeMinutes * 60);
};

const normalizeDayStartHour = (value: unknown, fallback = DEFAULT_DAY_START_HOUR): number => {
  const parsed = typeof value === "number" && Number.isInteger(value)
    ? value
    : Number.parseInt(String(value ?? fallback), 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : fallback;
};

const ymdFromUtcDate = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const formatJstCalendarDateFromMs = (ms: number): string => {
  const shiftedToJst = new Date(ms + 9 * HOUR_MS);
  return ymdFromUtcDate(shiftedToJst);
};

const formatJstUsageDateFromMs = (ms: number, dayStartHour: number): string => {
  const shifted = new Date(ms + (9 - dayStartHour) * HOUR_MS);
  return ymdFromUtcDate(shifted);
};

export const isIso8601DateTimeString = (v: string) => ISO_DT.test(v) && !Number.isNaN(Date.parse(v));

export const getAppUsageTargetDateFromStartAt = (startedAt: string, dayStartHour: number): string => {
  return formatJstUsageDateFromMs(Date.parse(startedAt), normalizeDayStartHour(dayStartHour));
};

/**
 * Backward-compatible alias for older callers.
 *
 * New app usage records should use Start At as the ownership key so that
 * a session beginning before 03:00 JST remains on the previous target date,
 * even if it ends after 03:00.
 */
export const getAppUsageTargetDateFromEndAt = (endedAt: string, dayStartHour: number): string => {
  return formatJstUsageDateFromMs(Date.parse(endedAt), normalizeDayStartHour(dayStartHour));
};

export const getAppUsageJstWindowForTargetDate = (
  targetDate: string,
  dayStartHour = DEFAULT_DAY_START_HOUR,
): { start: string; end: string } => {
  const hour = normalizeDayStartHour(dayStartHour);
  const hh = String(hour).padStart(2, "0");
  const startOfTargetDateJst = Date.parse(`${targetDate}T00:00:00+09:00`);
  const nextDate = formatJstCalendarDateFromMs(startOfTargetDateJst + DAY_MS);
  return {
    start: `${targetDate}T${hh}:00:00+09:00`,
    end: `${nextDate}T${hh}:00:00+09:00`,
  };
};

export const getPreviousJstDateFrom = (
  baseMs: number,
  dayStartHour = DEFAULT_DAY_START_HOUR,
): string => {
  const hour = normalizeDayStartHour(dayStartHour);
  const shifted = new Date(baseMs + (9 - hour) * HOUR_MS);
  const currentUsageDateMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  const prev = new Date(currentUsageDateMidnight - DAY_MS);
  return ymdFromUtcDate(prev);
};

export const normalizeAppUsagePayload = (
  raw: AppUsagePayload,
  defaultDayStartHour = DEFAULT_DAY_START_HOUR,
): NormalizedAppUsage => {
  const p: any = unwrap(raw);
  const day = unwrap((p as any).day_start_hour);
  return {
    app: str(unwrap((p as any).app)),
    session_id: str(unwrap((p as any).session_id)),
    started_at: str(unwrap((p as any).started_at)),
    ended_at: str(unwrap((p as any).ended_at)),
    source: str(unwrap((p as any).source)) || "ios_shortcuts",
    device: str(unwrap((p as any).device)) || "iPhone",
    day_start_hour: normalizeDayStartHour(day, defaultDayStartHour),
    payload_duration_seconds: Number.isFinite(Number(unwrap((p as any).duration_seconds)))
      ? Number(unwrap((p as any).duration_seconds))
      : null,
  };
};

export const validateAndComputeAppUsage = (
  p: NormalizedAppUsage,
  options: AppUsageValidationOptions = {},
) => {
  if (!p.app) return { error: "app is required" };
  if (p.app.length > 100) return { error: "app must be 100 characters or fewer" };
  if (hasControlChars(p.app)) return { error: "app must not contain control characters" };
  if (!p.session_id) return { error: "session_id is required" };
  if (!isIso8601DateTimeString(p.started_at)) return { error: "started_at must be an ISO 8601 datetime string" };
  if (!isIso8601DateTimeString(p.ended_at)) return { error: "ended_at must be an ISO 8601 datetime string" };
  if (!Number.isInteger(p.day_start_hour) || p.day_start_hour < 0 || p.day_start_hour > 23) {
    return { error: "day_start_hour must be an integer from 0 to 23" };
  }
  if (p.payload_duration_seconds !== null && (!Number.isFinite(p.payload_duration_seconds) || p.payload_duration_seconds <= 0)) {
    return { error: "duration_seconds must be a positive finite number" };
  }

  const startMs = Date.parse(p.started_at);
  const endMs = Date.parse(p.ended_at);
  if (endMs <= startMs) return { error: "ended_at must be later than started_at" };

  const durationSeconds = Math.round((endMs - startMs) / 1000);
  if (durationSeconds < 10) return { ignored: true, reason: "duration_below_minimum", duration_seconds: durationSeconds };

  const sessionMaxSeconds = getSessionMaxSeconds(options);
  if (sessionMaxSeconds !== null && durationSeconds > sessionMaxSeconds) {
    console.log("APP_USAGE_SESSION_DURATION_ABOVE_MAX_IGNORED", {
      app: p.app,
      session_id: p.session_id,
      duration_seconds: durationSeconds,
      max_duration_seconds: sessionMaxSeconds,
    });
    return { ignored: true, reason: "duration_above_maximum", duration_seconds: durationSeconds };
  }

  const target_date = getAppUsageTargetDateFromStartAt(p.started_at, p.day_start_hour);
  const durationMin = Math.round((durationSeconds / 60) * 100) / 100;
  return { ignored: false, duration_seconds: durationSeconds, duration_min: durationMin, target_date };
};

const textProperty = (row: any, propName: string): string =>
  row?.properties?.[propName]?.rich_text?.[0]?.plain_text ??
  row?.properties?.[propName]?.rich_text?.[0]?.text?.content ??
  row?.properties?.[propName]?.title?.[0]?.plain_text ??
  row?.properties?.[propName]?.title?.[0]?.text?.content ??
  "";

const selectProperty = (row: any, propName: string): string =>
  row?.properties?.[propName]?.select?.name ?? "";

const dateProperty = (row: any, propName: string): string | null =>
  row?.properties?.[propName]?.date?.start ?? null;

const latestRow = (a: any, b: any): any => (
  Date.parse(b?.last_edited_time || "") > Date.parse(a?.last_edited_time || "") ? b : a
);

const exactSessionKey = (
  row: any,
  props: { app?: string; device?: string; startAt?: string; endAt: string },
): string => {
  const app = props.app ? selectProperty(row, props.app) : "";
  const device = props.device ? textProperty(row, props.device) : "";
  const start = props.startAt ? dateProperty(row, props.startAt) : null;
  const end = dateProperty(row, props.endAt);
  return app && device && start && end ? `${app}|${device}|${start}|${end}` : "";
};

export const aggregateStudyRowsDedupBySessionId = (
  rows: any[],
  props: { sessionId: string; durationMin: string; endAt: string; app?: string; startAt?: string; device?: string },
  target_date: string,
) => {
  const bySessionOrFallback = new Map<string, any>();
  const sessionCounts = new Map<string, number>();

  for (const row of rows) {
    const sid = textProperty(row, props.sessionId);
    if (sid) sessionCounts.set(sid, (sessionCounts.get(sid) || 0) + 1);

    const exact = exactSessionKey(row, props);
    const key = sid ? `session:${sid}` : exact ? `exact:${exact}` : `row:${row?.id ?? Math.random()}`;
    const prev = bySessionOrFallback.get(key);
    bySessionOrFallback.set(key, prev ? latestRow(prev, row) : row);
  }

  for (const [sid, cnt] of sessionCounts.entries()) {
    if (cnt > 1) console.log("APP_USAGE_DUPLICATE_SESSION_ROWS_DETECTED", { target_date, session_id: sid, duplicate_count: cnt });
  }

  const byExact = new Map<string, any>();
  const withoutExact: any[] = [];
  for (const row of bySessionOrFallback.values()) {
    const exact = exactSessionKey(row, props);
    if (!exact) {
      withoutExact.push(row);
      continue;
    }
    const prev = byExact.get(exact);
    if (prev) {
      console.log("APP_USAGE_DUPLICATE_EXACT_SESSION_ROWS_DETECTED", { target_date, exact_key: exact });
      byExact.set(exact, latestRow(prev, row));
    } else {
      byExact.set(exact, row);
    }
  }

  let minutes = 0;
  let sessions = 0;
  let last: string | null = null;
  for (const row of [...byExact.values(), ...withoutExact]) {
    const mins = row?.properties?.[props.durationMin]?.number ?? 0;
    const end = dateProperty(row, props.endAt);
    minutes += Number.isFinite(mins) ? mins : 0;
    sessions += 1;
    if (end && (!last || Date.parse(end) > Date.parse(last))) last = end;
  }
  return { minutes: Math.round(minutes * 100) / 100, sessions, last };
};
