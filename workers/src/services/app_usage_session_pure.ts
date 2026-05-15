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

export const isIso8601DateTimeString = (v: string) => ISO_DT.test(v) && !Number.isNaN(Date.parse(v));

export const getAppUsageTargetDateFromEndAt = (endedAt: string, dayStartHour: number): string => {
  const endMs = Date.parse(endedAt);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(endMs));
  const hour = Number(parts.find((x) => x.type === "hour")?.value ?? "0");
  const yyyy = parts.find((x) => x.type === "year")?.value;
  const mm = parts.find((x) => x.type === "month")?.value;
  const dd = parts.find((x) => x.type === "day")?.value;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00+09:00`);
  if (hour < dayStartHour) d.setUTCDate(d.getUTCDate() - 1);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
};

export const getPreviousJstDateFrom = (baseMs: number): string => {
  const jst = new Date(baseMs + 9 * 60 * 60 * 1000);
  const utcMidnight = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
  const prev = new Date(utcMidnight - 24 * 60 * 60 * 1000);
  const y = prev.getUTCFullYear();
  const m = String(prev.getUTCMonth() + 1).padStart(2, "0");
  const d = String(prev.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const normalizeAppUsagePayload = (raw: AppUsagePayload): NormalizedAppUsage => {
  const p: any = unwrap(raw);
  const day = unwrap((p as any).day_start_hour);
  return {
    app: str(unwrap((p as any).app)),
    session_id: str(unwrap((p as any).session_id)),
    started_at: str(unwrap((p as any).started_at)),
    ended_at: str(unwrap((p as any).ended_at)),
    source: str(unwrap((p as any).source)) || "ios_shortcuts",
    device: str(unwrap((p as any).device)) || "iPhone",
    day_start_hour: Number.isInteger(day) ? day : Number.parseInt(String(day ?? "3"), 10),
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

  const target_date = getAppUsageTargetDateFromEndAt(p.ended_at, p.day_start_hour);
  const durationMin = Math.round((durationSeconds / 60) * 100) / 100;
  return { ignored: false, duration_seconds: durationSeconds, duration_min: durationMin, target_date };
};

export const aggregateStudyRowsDedupBySessionId = (
  rows: any[],
  props: { sessionId: string; durationMin: string; endAt: string },
  target_date: string,
) => {
  const bySession = new Map<string, any>();
  for (const row of rows) {
    const sid =
      row?.properties?.[props.sessionId]?.rich_text?.[0]?.plain_text ??
      row?.properties?.[props.sessionId]?.rich_text?.[0]?.text?.content ??
      "";
    if (!sid) continue;
    const prev = bySession.get(sid);
    if (!prev || Date.parse(row.last_edited_time || "") > Date.parse(prev.last_edited_time || "")) bySession.set(sid, row);
  }

  const seen = new Map<string, number>();
  for (const row of rows) {
    const sid =
      row?.properties?.[props.sessionId]?.rich_text?.[0]?.plain_text ??
      row?.properties?.[props.sessionId]?.rich_text?.[0]?.text?.content ??
      "";
    if (!sid) continue;
    seen.set(sid, (seen.get(sid) || 0) + 1);
  }
  for (const [sid, cnt] of seen.entries()) {
    if (cnt > 1) console.log("APP_USAGE_DUPLICATE_SESSION_ROWS_DETECTED", { target_date, session_id: sid, duplicate_count: cnt });
  }

  let minutes = 0;
  let sessions = 0;
  let last: string | null = null;
  for (const row of bySession.values()) {
    const mins = row?.properties?.[props.durationMin]?.number ?? 0;
    const end = row?.properties?.[props.endAt]?.date?.start ?? null;
    minutes += Number.isFinite(mins) ? mins : 0;
    sessions += 1;
    if (end && (!last || Date.parse(end) > Date.parse(last))) last = end;
  }
  return { minutes, sessions, last };
};
