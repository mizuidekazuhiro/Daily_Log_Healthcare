export type VoiceDiaryPayload = Record<string, unknown>;

export type NormalizedVoiceDiary = {
  text: string;
  recorded_at?: string;
  source: string;
  target_date?: string;
  day_start_hour: number;
};

const ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const unwrap = (v: any): any => (v && typeof v === "object" && "" in v ? unwrap(v[""]) : v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export const normalizeVoiceDiaryPayload = (raw: VoiceDiaryPayload): NormalizedVoiceDiary => {
  const p: any = unwrap(raw);
  const day = unwrap(p.day_start_hour);
  return {
    text: str(unwrap(p.text)),
    recorded_at: str(unwrap(p.recorded_at)) || undefined,
    source: str(unwrap(p.source)) || "ios_shortcut_voice",
    target_date: str(unwrap(p.target_date)) || undefined,
    day_start_hour: Number.isInteger(day) ? day : Number.parseInt(String(day ?? "3"), 10),
  };
};

export const isIso8601DateTimeString = (v: string): boolean => ISO_DT.test(v) && !Number.isNaN(Date.parse(v));
const hasControlChars = (v: string): boolean => /[\x00-\x1F\x7F]/.test(v);

export const toJstIsoString = (date: Date): string => {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  const ss = String(jst.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}+09:00`;
};

export const getJstTargetDate = (recordedAt: string, dayStartHour: number): string => {
  const ms = Date.parse(recordedAt);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const hour = Number(parts.find(x => x.type === "hour")?.value ?? "0");
  const yyyy = parts.find(x => x.type === "year")?.value;
  const mm = parts.find(x => x.type === "month")?.value;
  const dd = parts.find(x => x.type === "day")?.value;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00+09:00`);
  if (hour < dayStartHour) d.setUTCDate(d.getUTCDate() - 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

const toHex = (arr: Uint8Array): string => Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");

export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
};

export const validateAndComputeVoiceDiary = async (p: NormalizedVoiceDiary, now = new Date()) => {
  if (!p.text) return { error: "text is required" };
  if (p.text.length > 2000) return { error: "text must be 2000 characters or fewer" };
  if (!Number.isInteger(p.day_start_hour) || p.day_start_hour < 0 || p.day_start_hour > 23) return { error: "day_start_hour must be an integer from 0 to 23" };
  if (hasControlChars(p.source)) return { error: "source must not contain control characters" };

  const recorded_at = p.recorded_at || toJstIsoString(now);
  if (!isIso8601DateTimeString(recorded_at)) return { error: "recorded_at must be an ISO 8601 datetime string" };

  const target_date = p.target_date || getJstTargetDate(recorded_at, p.day_start_hour);
  if (!ISO_DATE.test(target_date)) return { error: "target_date must be YYYY-MM-DD" };

  const note_hash = await sha256Hex(`${target_date}\n${recorded_at}\n${p.text}`);
  return { error: undefined, text: p.text, source: p.source, recorded_at, target_date, note_hash, day_start_hour: p.day_start_hour };
};
