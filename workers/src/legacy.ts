import { requireBearerAuth } from "./utils/auth";
import {
  buildValidationDebugInfo,
  normalizeHealthPayload,
  upsertHealthDailyPage,
  validateHealthPayload,
  type LegacyHealthPayload,
} from "./services/legacy_health_daily_service";

export interface Env {
  NOTION_TOKEN: string;
  DAILY_LOG_DB_ID?: string;
  HEALTH_DB_ID?: string;
  HEALTH_DATE_PROP?: string;
  HEALTH_TITLE_PROP?: string;
  DAILY_LOG_DATE_PROP?: string;
  DAILY_LOG_TARGET_DATE_PROP?: string;
  DAILY_LOG_TITLE_PROP?: string;
  DAILY_LOG_MEAL_PHOTOS_PROP?: string;
  DAILY_LOG_SOURCE_PROP?: string;
  HEALTH_API_KEY: string;
  DROPBOX_CLIENT_ID?: string;
  DROPBOX_CLIENT_SECRET?: string;
  DROPBOX_REFRESH_TOKEN?: string;
  MEAL_PHOTOS_FOLDER_PATH?: string;
  // temporary backward compatibility
  DROPBOX_ACCESS_TOKEN?: string;
  DROPBOX_APP_KEY?: string;
  DROPBOX_APP_SECRET?: string;
  DROPBOX_FOLDER_PATH?: string;
}

type Payload = LegacyHealthPayload;

type DropboxFileEntry = {
  ".tag": "file";
  id: string;
  name: string;
  path_lower?: string;
  path_display?: string;
  server_modified: string;
};

type NotionFileReference = {
  name?: string;
  type: "external" | "file";
  external?: { url: string };
  file?: { url: string; expiry_time?: string };
};

type MealPhotoSkipReason =
  | "already_exists_by_file_id"
  | "already_exists_by_path"
  | "invalid_existing_value"
  | "unsupported_property_shape";

type MealPhotosExistingState = {
  mealPhotosType: string | null;
  existingFiles: NotionFileReference[];
  existingFileIds: Set<string>;
  existingPaths: Set<string>;
  existingExternalUrls: Set<string>;
  skippedReasonCounts: Record<MealPhotoSkipReason, number>;
};
type DailyLogPageCandidate = {
  id: string;
  properties: Record<string, unknown>;
  last_edited_time?: string;
  created_time?: string;
};

type MealPhotoRunResult =
  | {
      ok: true;
      date: string;
      action: string;
      added: number;
      skipped: number;
      target_date?: string;
      canonical_page_id?: string;
      daily_log_duplicate_detected?: boolean;
      duplicate_count?: number;
      meal_photos_existing_count?: number;
      meal_photos_added_count?: number;
      meal_photos_merged_count?: number;
      title_prop_resolved?: string;
      date_prop_resolved?: string;
      target_date_prop_resolved?: string;
      meal_photos_prop_resolved?: string;
    }
  | {
      ok: false;
      error: string;
      detail?: string;
      status?: number;
      date?: string;
      code?: string;
      database_id_present?: boolean;
      missing_properties?: string[];
      type_mismatches?: Array<{ property: string; expected: string; actual: string | null }> ;
      resolved_props?: { date: string; title: string; mealPhotos: string; source: string };
      hint?: string;
    };

const NOTION_VERSION = "2022-06-28";

let currentRequestId: string | null = null;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });

const notionRequest = async (
  url: string,
  options: RequestInit,
  token: string,
): Promise<
  | { ok: true; json: any }
  | { ok: false; status: number; text: string }
> => {
  // LOG: Notion fetch start with requestId
  console.log("NOTION_FETCH_START", {
    requestId: currentRequestId,
    url,
  });
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  // LOG: Notion fetch end with requestId and status
  console.log("NOTION_FETCH_END", {
    requestId: currentRequestId,
    url,
    status: response.status,
    ok: response.ok,
  });
  if (!response.ok) {
    const text = await response.text();
    // LOG: Notion fetch error with response body preview
    console.error("NOTION_FETCH_ERROR", {
      requestId: currentRequestId,
      url,
      status: response.status,
      body: text.slice(0, 300),
    });
    return {
      ok: false,
      status: response.status,
      text,
    };
  }

  return { ok: true, json: await response.json() };
};

type DropboxTokenCache = {
  token: string;
  fetchedAt: number;
};

let cachedDropboxAccessToken: DropboxTokenCache | null = null;

const getDropboxClientId = (env: Env): string | undefined =>
  env.DROPBOX_CLIENT_ID ?? env.DROPBOX_APP_KEY;

const getDropboxClientSecret = (env: Env): string | undefined =>
  env.DROPBOX_CLIENT_SECRET ?? env.DROPBOX_APP_SECRET;

const getMealPhotosFolderPath = (env: Env): string | undefined =>
  env.MEAL_PHOTOS_FOLDER_PATH ?? env.DROPBOX_FOLDER_PATH;

const getMissingDropboxRefreshEnv = (env: Env): string[] => {
  const missing: string[] = [];
  if (!getDropboxClientId(env)) {
    missing.push("DROPBOX_CLIENT_ID");
  }
  if (!getDropboxClientSecret(env)) {
    missing.push("DROPBOX_CLIENT_SECRET");
  }
  if (!env.DROPBOX_REFRESH_TOKEN) {
    missing.push("DROPBOX_REFRESH_TOKEN");
  }
  return missing;
};

const refreshDropboxAccessToken = async (env: Env): Promise<string> => {
  const missing = getMissingDropboxRefreshEnv(env);
  if (missing.length > 0) {
    throw new Error(
      `Missing Dropbox refresh credentials: ${missing.join(", ")}`,
    );
  }

  const clientId = getDropboxClientId(env) as string;
  const clientSecret = getDropboxClientSecret(env) as string;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env.DROPBOX_REFRESH_TOKEN as string,
    client_id: clientId,
    client_secret: clientSecret,
  });

  console.log("DROPBOX_TOKEN_REFRESH_START", {
    requestId: currentRequestId,
    url: "https://api.dropboxapi.com/oauth2/token",
    grantType: "refresh_token",
  });

  const controller = new AbortController();
  const timeoutMs = 10_000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  let text = "";
  try {
    res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    text = await res.text();
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    console.error("DROPBOX_TOKEN_REFRESH_ERROR", {
      requestId: currentRequestId,
      reason: isAbort ? "timeout" : "network_or_runtime",
      timeoutMs,
      message: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      isAbort
        ? `Dropbox token refresh timeout (${timeoutMs}ms)`
        : "Dropbox token refresh request failed",
    );
  } finally {
    clearTimeout(timeoutId);
  }

  console.log("DROPBOX_TOKEN_REFRESH_END", {
    requestId: currentRequestId,
    url: "https://api.dropboxapi.com/oauth2/token",
    status: res.status,
    ok: res.ok,
  });

  if (!res.ok) {
    console.error("DROPBOX_TOKEN_REFRESH_ERROR", {
      requestId: currentRequestId,
      status: res.status,
      body: text.slice(0, 300),
    });
    throw new Error(
      `Dropbox token refresh failed (status=${res.status})`,
    );
  }

  let data: { access_token?: string; token_type?: string; expires_in?: number };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Dropbox token refresh failed: invalid JSON response");
  }

  if (!data.access_token) {
    throw new Error("Dropbox token refresh failed: missing access_token");
  }
  return data.access_token;
};

const getDropboxAccessToken = async (
  env: Env,
  options?: { forceRefresh?: boolean },
): Promise<string> => {
  if (!options?.forceRefresh && env.DROPBOX_ACCESS_TOKEN) {
    return env.DROPBOX_ACCESS_TOKEN;
  }
  if (!options?.forceRefresh && cachedDropboxAccessToken) {
    return cachedDropboxAccessToken.token;
  }

  const token = await refreshDropboxAccessToken(env);
  cachedDropboxAccessToken = { token, fetchedAt: Date.now() };
  return token;
};

const parseDropboxJson = (text: string): any | null => {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error("Dropbox API returned invalid JSON", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};


const getDropboxErrorSummary = (text: string): string | null => {
  const parsed = parseDropboxJson(text);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const summary = (parsed as { error_summary?: unknown }).error_summary;
  return typeof summary === "string" ? summary : null;
};

const isDropboxAccessTokenExpiredError = (status: number, text: string): boolean => {
  if (status !== 401) return false;
  const summary = getDropboxErrorSummary(text);
  return Boolean(summary && summary.includes("expired_access_token"));
};

const buildDropboxApiError = (status: number, text: string): MealPhotoRunResult => ({
  ok: false,
  error: isDropboxAccessTokenExpiredError(status, text)
    ? "dropbox_access_token_expired"
    : "Dropbox API error",
  code: isDropboxAccessTokenExpiredError(status, text)
    ? "dropbox_access_token_expired"
    : undefined,
  status,
  detail: text,
});

const dropboxRequest = async (
  env: Env,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<
  | { ok: true; json: any }
  | { ok: false; status: number; text: string }
> => {
  const makeRequest = async (token: string) => {
    const url = `https://api.dropboxapi.com/2/${endpoint}`;
    // LOG: Dropbox fetch start with requestId
    console.log("DROPBOX_FETCH_START", {
      requestId: currentRequestId,
      url,
    });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    // LOG: Dropbox fetch end with requestId and status
    console.log("DROPBOX_FETCH_END", {
      requestId: currentRequestId,
      url,
      status: response.status,
      ok: response.ok,
      body: text.slice(0, 1000),
    });
    return { response, text };
  };

  let token = await getDropboxAccessToken(env);
  let { response, text } = await makeRequest(token);

  if (response.status === 401) {
    const errorSummary = getDropboxErrorSummary(text);
    console.warn("DROPBOX_API_UNAUTHORIZED", {
      requestId: currentRequestId,
      api: endpoint,
      status: response.status,
      errorSummary,
    });
    try {
      token = await getDropboxAccessToken(env, { forceRefresh: true });
      const retry = await makeRequest(token);
      response = retry.response;
      text = retry.text;
      if (response.status === 401) {
        console.warn("DROPBOX_API_UNAUTHORIZED_AFTER_REFRESH", {
          requestId: currentRequestId,
          api: endpoint,
          status: response.status,
          errorSummary: getDropboxErrorSummary(text),
        });
      }
    } catch (error) {
      console.error("Dropbox token refresh failed after 401", {
        endpoint,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!response.ok) {
    // LOG: Dropbox fetch error with response body preview
    const errorSummary = getDropboxErrorSummary(text);
    console.error("DROPBOX_FETCH_ERROR", {
      requestId: currentRequestId,
      api: endpoint,
      url: `https://api.dropboxapi.com/2/${endpoint}`,
      status: response.status,
      errorSummary,
      body: text.slice(0, 300),
    });
    return {
      ok: false,
      status: response.status,
      text,
    };
  }

  const json = parseDropboxJson(text);
  if (!json) {
    return {
      ok: false,
      status: response.status,
      text,
    };
  }

  return { ok: true, json };
};

const jstFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const formatJstDate = (date: Date): string => jstFormatter.format(date);

const parseYmd = (value: string): { year: number; month: number; day: number } | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return { year, month, day };
};

const getMealPhotoWindowByExecutionDateJst = (
  requestedExecutionDate?: string,
): { targetDate: string; windowStartJst: Date; windowEndJst: Date } => {
  const now = new Date();
  const executionDate = requestedExecutionDate?.trim() || formatJstDate(now);
  const executionYmd = parseYmd(executionDate);

  if (!executionYmd) {
    const fallbackExecutionDate = formatJstDate(now);
    const fallbackExecutionYmd = parseYmd(fallbackExecutionDate) as {
      year: number;
      month: number;
      day: number;
    };
    const windowEndJst = new Date(
      `${fallbackExecutionDate}T05:00:00+09:00`,
    );
    const windowStartJst = new Date(windowEndJst.getTime() - 24 * 60 * 60 * 1000);
    const targetDate = formatJstDate(windowStartJst);
    console.warn("MEAL_PHOTOS_INVALID_EXECUTION_DATE", {
      requestId: currentRequestId,
      requestedExecutionDate,
      fallbackExecutionDate,
    });
    return { targetDate, windowStartJst, windowEndJst };
  }

  const executionDateUtc = Date.UTC(
    executionYmd.year,
    executionYmd.month - 1,
    executionYmd.day,
  );
  const prevDate = new Date(executionDateUtc - 24 * 60 * 60 * 1000);
  const prevDateYmd = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}-${String(
    prevDate.getUTCDate(),
  ).padStart(2, "0")}`;

  const windowStartJst = new Date(`${prevDateYmd}T05:00:00+09:00`);
  const windowEndJst = new Date(`${executionDate}T05:00:00+09:00`);
  const targetDate = prevDateYmd;
  return { targetDate, windowStartJst, windowEndJst };
};

const imageExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".heif",
  ".webp",
]);

const isImageFile = (name: string): boolean => {
  const lower = name.toLowerCase();
  for (const ext of imageExtensions) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
};

const getDropboxPath = (entry: DropboxFileEntry): string | null =>
  entry.path_lower || entry.path_display || null;

const toDropboxRawUrl = (sharedUrl: string): string => {
  try {
    const url = new URL(sharedUrl);
    url.searchParams.set("raw", "1");
    url.searchParams.delete("dl");
    const converted = url.toString();
    console.log("DROPBOX_URL_CONVERT", {
      requestId: currentRequestId,
      host: url.host,
      hasQuery: converted.includes("?"),
    });
    return converted;
  } catch {
    console.warn("DROPBOX_URL_CONVERT_FAILED", {
      requestId: currentRequestId,
      reason: "invalid_shared_url",
    });
    return sharedUrl;
  }
};

const isExistingSharedLinkError = (status: number, text: string): boolean => {
  if (status !== 409) {
    return false;
  }
  const parsed = parseDropboxJson(text);
  const errorSummary = JSON.stringify(parsed ?? {}).toLowerCase();
  return (
    errorSummary.includes("shared_link_already_exists") ||
    errorSummary.includes("already_exists")
  );
};

const normalizeComparisonToken = (value?: string | null): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeDropboxPathForComparison = (value?: string | null): string | null => {
  const normalized = normalizeComparisonToken(value);
  if (!normalized) {
    return null;
  }

  const withoutQuery = normalized.split("?")[0].trim();
  if (!withoutQuery) {
    return null;
  }

  return withoutQuery.toLowerCase();
};

const extractTaggedValue = (name: string, tag: "dropbox-id" | "dropbox-path"): string | null => {
  const match = name.match(new RegExp(`\\[${tag}:([^\\]]+)\\]`));
  return normalizeComparisonToken(match?.[1] ?? null);
};

const isDropboxExternalUrl = (url?: string): boolean => {
  if (typeof url !== "string") {
    return false;
  }
  return /(^https?:\/\/)?([^.]+\.)*dropbox(?:usercontent)?\.com\//i.test(url);
};

const normalizeDropboxUrlForCompare = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    if (!isDropboxExternalUrl(u.toString())) return null;
    u.searchParams.delete("raw");
    u.searchParams.delete("dl");
    return `${u.origin}${u.pathname}`.toLowerCase();
  } catch {
    return null;
  }
};

const buildDropboxCandidateKeys = (
  entry: DropboxFileEntry,
): { fileId: string | null; path: string | null } => ({
  fileId: normalizeComparisonToken(entry.id),
  path: normalizeDropboxPathForComparison(entry.path_lower ?? entry.path_display),
});

const NOTION_FILE_NAME_MAX_LEN = 100;

const sanitizeNotionFileName = (
  filename: string,
  maxLen: number = NOTION_FILE_NAME_MAX_LEN,
): string => {
  if (!filename) {
    return "meal_photo";
  }

  const basename = String(filename)
    .trim()
    .split(/[/\\]/)
    .pop()
    ?.trim();

  if (!basename) {
    return "meal_photo";
  }

  const whitespaceSanitized = basename
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!whitespaceSanitized) {
    return "meal_photo";
  }

  const extIndex = whitespaceSanitized.lastIndexOf(".");
  const hasExt = extIndex > 0 && extIndex < whitespaceSanitized.length - 1;
  let base = hasExt ? whitespaceSanitized.slice(0, extIndex) : whitespaceSanitized;
  let ext = hasExt ? whitespaceSanitized.slice(extIndex) : "";

  if (ext.length > 10) {
    base = whitespaceSanitized;
    ext = "";
  }

  if (whitespaceSanitized.length <= maxLen) {
    return whitespaceSanitized;
  }

  const allowedBaseLen = maxLen - ext.length;
  if (allowedBaseLen <= 0) {
    return whitespaceSanitized.slice(0, maxLen);
  }

  const trimmedBase = base.slice(0, allowedBaseLen).replace(/[ ._-]+$/g, "");
  const safeBase = trimmedBase || "meal_photo";
  return `${safeBase}${ext}`.slice(0, maxLen);
};

const buildMealPhotoName = (entry: DropboxFileEntry): string => {
  const keys = buildDropboxCandidateKeys(entry);
  const metadataParts: string[] = [];
  if (keys.fileId) {
    metadataParts.push(`[dropbox-id:${keys.fileId}]`);
  }
  if (keys.path) {
    // Backward compatibility: keep name-embedded metadata so old entries remain comparable.
    metadataParts.push(`[dropbox-path:${keys.path}]`);
  }

  if (metadataParts.length === 0) {
    return sanitizeNotionFileName(entry.name);
  }

  const metadataSuffix = ` ${metadataParts.join(" ")}`;
  const allowedNameLen = NOTION_FILE_NAME_MAX_LEN - metadataSuffix.length;
  if (allowedNameLen <= 0) {
    return sanitizeNotionFileName(`${entry.name}${metadataSuffix}`);
  }

  const safeName = sanitizeNotionFileName(entry.name, allowedNameLen);
  return `${safeName}${metadataSuffix}`;
};

const extractMealPhotosExistingState = (
  mealPhotosProp: string,
  properties?: Record<string, unknown>,
): MealPhotosExistingState => {
  const initialReasons: Record<MealPhotoSkipReason, number> = {
    already_exists_by_file_id: 0,
    already_exists_by_path: 0,
    invalid_existing_value: 0,
    unsupported_property_shape: 0,
  };

  const mealProp = properties?.[mealPhotosProp] as
    | { type?: string; files?: unknown[] }
    | undefined;

  if (!mealProp) {
    return {
      mealPhotosType: null,
      existingFiles: [],
      existingFileIds: new Set<string>(),
      existingPaths: new Set<string>(),
      existingExternalUrls: new Set<string>(),
      skippedReasonCounts: initialReasons,
    };
  }

  if (mealProp.type !== "files") {
    initialReasons.unsupported_property_shape += 1;
    return {
      mealPhotosType: mealProp.type ?? null,
      existingFiles: [],
      existingFileIds: new Set<string>(),
      existingPaths: new Set<string>(),
      existingExternalUrls: new Set<string>(),
      skippedReasonCounts: initialReasons,
    };
  }

  const files = Array.isArray(mealProp.files)
    ? (mealProp.files as NotionFileReference[])
    : [];
  const existingFileIds = new Set<string>();
  const existingPaths = new Set<string>();
  const existingExternalUrls = new Set<string>();

  for (const file of files) {
    if (!file || typeof file !== "object") {
      initialReasons.invalid_existing_value += 1;
      continue;
    }
    const name = typeof file.name === "string" ? file.name : "";
    // Only trust name-embedded dedup metadata for Dropbox external files.
    if (file.type !== "external" || !isDropboxExternalUrl(file.external?.url)) {
      continue;
    }
    const existingId = extractTaggedValue(name, "dropbox-id");
    const existingPath = normalizeDropboxPathForComparison(
      extractTaggedValue(name, "dropbox-path"),
    );
    if (existingId) {
      existingFileIds.add(existingId);
    }
    if (existingPath) {
      existingPaths.add(existingPath);
    }
    const normalizedUrl = normalizeDropboxUrlForCompare(file.external?.url);
    if (normalizedUrl) existingExternalUrls.add(normalizedUrl);
  }

  return {
    mealPhotosType: mealProp.type ?? null,
    existingFiles: files,
    existingFileIds,
    existingPaths,
    existingExternalUrls,
    skippedReasonCounts: initialReasons,
  };
};

const getMealPhotoSkipReason = (
  entry: DropboxFileEntry,
  existingState: MealPhotosExistingState,
): MealPhotoSkipReason | null => {
  const keys = buildDropboxCandidateKeys(entry);
  if (keys.fileId && existingState.existingFileIds.has(keys.fileId)) {
    return "already_exists_by_file_id";
  }
  if (keys.path && existingState.existingPaths.has(keys.path)) {
    return "already_exists_by_path";
  }
  return null;
};

const listDropboxFiles = async (
  env: Env,
): Promise<{ ok: true; files: DropboxFileEntry[] } | MealPhotoRunResult> => {
  const files: DropboxFileEntry[] = [];
  let cursor: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const endpoint = cursor ? "files/list_folder/continue" : "files/list_folder";
    const body = cursor
      ? { cursor }
      : { path: getMealPhotosFolderPath(env) || "", recursive: false };

    const result = await dropboxRequest(env, endpoint, body);

    if (!result.ok) {
      return buildDropboxApiError(result.status, result.text);
    }

    const entries = Array.isArray(result.json.entries)
      ? (result.json.entries as DropboxFileEntry[])
      : [];

    for (const entry of entries) {
      if (entry?.[".tag"] === "file") {
        files.push(entry);
      }
    }

    hasMore = Boolean(result.json.has_more);
    cursor = typeof result.json.cursor === "string" ? result.json.cursor : null;
    if (!hasMore) {
      break;
    }
  }

  return { ok: true, files };
};

const getDropboxSharedLink = async (
  env: Env,
  entry: DropboxFileEntry,
): Promise<{ ok: true; url: string } | MealPhotoRunResult> => {
  const path = getDropboxPath(entry);
  if (!path) {
    return { ok: false, error: "Dropbox file path missing" };
  }

  console.log("DROPBOX_SHARED_LINK_LOOKUP_START", {
    requestId: currentRequestId,
    entryId: entry.id,
    path,
  });

  const existing = await dropboxRequest(env, "sharing/list_shared_links", {
    path,
    direct_only: true,
  });

  if (!existing.ok) {
    return buildDropboxApiError(existing.status, existing.text);
  }

  const links = Array.isArray(existing.json.links)
    ? (existing.json.links as Array<{ url?: string }>)
    : [];

  console.log("DROPBOX_SHARED_LINK_LOOKUP_END", {
    requestId: currentRequestId,
    entryId: entry.id,
    path,
    linksCount: links.length,
  });

  const existingUrl = links.find((link) => typeof link.url === "string")?.url;
  if (existingUrl) {
    console.log("DROPBOX_SHARED_LINK_LOOKUP_HIT", {
      requestId: currentRequestId,
      entryId: entry.id,
      path,
      reusedExistingLink: true,
    });
    return { ok: true, url: toDropboxRawUrl(existingUrl) };
  }

  console.log("DROPBOX_SHARED_LINK_CREATE_START", {
    requestId: currentRequestId,
    entryId: entry.id,
    path,
  });

  const created = await dropboxRequest(
    env,
    "sharing/create_shared_link_with_settings",
    { path },
  );

  if (!created.ok) {
    console.warn("DROPBOX_SHARED_LINK_CREATE_FAILED", {
      requestId: currentRequestId,
      entryId: entry.id,
      path,
      status: created.status,
      body: created.text.slice(0, 1000),
    });

    if (isExistingSharedLinkError(created.status, created.text)) {
      console.log("DROPBOX_SHARED_LINK_CREATE_FALLBACK_START", {
        requestId: currentRequestId,
        entryId: entry.id,
        path,
      });

      const fallback = await dropboxRequest(env, "sharing/list_shared_links", {
        path,
      });

      if (!fallback.ok) {
        console.error("DROPBOX_SHARED_LINK_CREATE_FALLBACK_FAILED", {
          requestId: currentRequestId,
          entryId: entry.id,
          path,
          status: fallback.status,
          body: fallback.text.slice(0, 1000),
        });
        return buildDropboxApiError(fallback.status, fallback.text);
      }

      const fallbackLinks = Array.isArray(fallback.json.links)
        ? (fallback.json.links as Array<{ url?: string }>)
        : [];
      const fallbackUrl = fallbackLinks.find(
        (link) => typeof link.url === "string",
      )?.url;

      console.log("DROPBOX_SHARED_LINK_CREATE_FALLBACK_END", {
        requestId: currentRequestId,
        entryId: entry.id,
        path,
        linksCount: fallbackLinks.length,
        foundUrl: Boolean(fallbackUrl),
      });

      if (fallbackUrl) {
        return { ok: true, url: toDropboxRawUrl(fallbackUrl) };
      }
    }

    return buildDropboxApiError(created.status, created.text);
  }

  console.log("DROPBOX_SHARED_LINK_CREATE_END", {
    requestId: currentRequestId,
    entryId: entry.id,
    path,
    hasUrl: typeof created.json.url === "string",
  });

  const url =
    typeof created.json.url === "string" ? created.json.url : undefined;
  if (!url) {
    return { ok: false, error: "Dropbox shared link missing" };
  }

  return { ok: true, url: toDropboxRawUrl(url) };
};


const resolveDailyLogDbId = (env: Env): string | undefined =>
  env.DAILY_LOG_DB_ID ?? env.HEALTH_DB_ID;

const resolveMealPhotoProps = (env: Env) => ({
  dateProp: env.DAILY_LOG_DATE_PROP ?? env.HEALTH_DATE_PROP ?? "Date",
  targetDateProp: env.DAILY_LOG_TARGET_DATE_PROP ?? "Target Date",
  titleProp: env.DAILY_LOG_TITLE_PROP ?? "名前",
  mealPhotosProp: env.DAILY_LOG_MEAL_PHOTOS_PROP ?? "Meal Photos",
  sourceProp: env.DAILY_LOG_SOURCE_PROP ?? "Source",
});

const getDatePropertyValue = (properties: Record<string, unknown>, propName: string): string | null => {
  const prop = properties[propName] as { type?: string; date?: { start?: string } } | undefined;
  if (!prop || prop.type !== "date" || !prop.date?.start) return null;
  return prop.date.start.slice(0, 10);
};

const hasNonEmptyProperty = (properties: Record<string, unknown>, propName: string): boolean => {
  const prop = properties[propName] as any;
  if (!prop || typeof prop !== "object") return false;
  if (prop.type === "rich_text" && Array.isArray(prop.rich_text)) return prop.rich_text.length > 0;
  if (prop.type === "title" && Array.isArray(prop.title)) return prop.title.length > 0;
  if (prop.type === "files" && Array.isArray(prop.files)) return prop.files.length > 0;
  if (prop.type === "select") return Boolean(prop.select?.name);
  return false;
};

const validateDailyLogSchema = async (env: Env): Promise<{ ok: true } | MealPhotoRunResult> => {
  const dbId = resolveDailyLogDbId(env);
  const { dateProp, targetDateProp, titleProp, mealPhotosProp, sourceProp } = resolveMealPhotoProps(env);
  if (!dbId) return { ok: false, error: "Daily Log database id missing", detail: "Set DAILY_LOG_DB_ID or HEALTH_DB_ID" };
  const dbResult = await notionRequest(`https://api.notion.com/v1/databases/${dbId}`, { method: "GET" }, env.NOTION_TOKEN);
  if (!dbResult.ok) return { ok: false, error: "Notion API error", status: dbResult.status, detail: dbResult.text };
  const properties = (dbResult.json.properties ?? {}) as Record<string, { type?: string }>;
  const missing: string[] = [];
  const type_mismatches: Array<{ property: string; expected: string; actual: string | null }> = [];
  const check = (name: string, expected: string) => {
    const p = properties[name];
    if (!p) missing.push(name);
    else if (p.type !== expected) type_mismatches.push({ property: name, expected, actual: p.type ?? null });
  };
  check(dateProp, "date");
  check(targetDateProp, "date");
  check(titleProp, "title");
  check(mealPhotosProp, "files");
  if (missing.length || type_mismatches.length) {
    return { ok: false, error: "Daily Log Notion schema mismatch", status: 422, database_id_present: true, missing_properties: missing, type_mismatches, resolved_props: { date: dateProp, title: titleProp, mealPhotos: mealPhotosProp, source: sourceProp }, hint: "Set DAILY_LOG_TITLE_PROP or HEALTH_TITLE_PROP to the actual Notion title property name." };
  }
  return { ok: true };
};

const canSetDropboxSource = async (env: Env): Promise<boolean> => {
  const dbResult = await notionRequest(
    `https://api.notion.com/v1/databases/${resolveDailyLogDbId(env)}`,
    { method: "GET" },
    env.NOTION_TOKEN,
  );

  if (!dbResult.ok) {
    console.warn("Notion database lookup failed; skipping Source select", {
      status: dbResult.status,
    });
    return false;
  }

  const properties = dbResult.json.properties as
    | Record<string, { type?: string; select?: { options?: Array<{ name?: string }> } }>
    | undefined;
  const sourcePropName = resolveMealPhotoProps(env).sourceProp;
  const sourceProp = properties?.[sourcePropName];
  if (sourceProp?.type !== "select") {
    return false;
  }
  const options = Array.isArray(sourceProp.select?.options)
    ? sourceProp.select?.options
    : [];
  return options.some((option) => option?.name === "dropbox");
};

const chooseCanonicalDailyLogPage = (
  candidates: DailyLogPageCandidate[],
  date: string,
  props: ReturnType<typeof resolveMealPhotoProps>,
): DailyLogPageCandidate => {
  const score = (page: DailyLogPageCandidate): [number, number, number, number, number] => {
    const dateMatch = getDatePropertyValue(page.properties, props.dateProp) === date ? 1 : 0;
    const targetDateMatch = getDatePropertyValue(page.properties, props.targetDateProp) === date ? 1 : 0;
    const rule1 = dateMatch && targetDateMatch ? 1 : 0;
    const rule2 = ["Diary", "Today advice", "Weather", "Mail ID"].some((p) => hasNonEmptyProperty(page.properties, p)) ? 1 : 0;
    const rule3 = [props.mealPhotosProp, "Location summary (GPT)", "Mood", "Notes"].some((p) => hasNonEmptyProperty(page.properties, p)) ? 1 : 0;
    const lastEdited = Date.parse(page.last_edited_time ?? "") || 0;
    const created = Date.parse(page.created_time ?? "") || 0;
    return [rule1, rule2, rule3, lastEdited, -created];
  };
  return [...candidates].sort((a, b) => {
    const sa = score(a); const sb = score(b);
    for (let i = 0; i < sa.length; i += 1) if (sa[i] !== sb[i]) return sb[i] - sa[i];
    return 0;
  })[0];
};

const ensureDailyLogPageByDate = async (
  env: Env,
  date: string,
): Promise<
  | { ok: true; pageId: string; canonicalPageId: string; canonicalPage: DailyLogPageCandidate; duplicatePages: DailyLogPageCandidate[]; duplicateCount: number; existingState: MealPhotosExistingState; mergedDuplicateMealPhotosCount: number; duplicateDetected: boolean; duplicateMealPhotosExistingCount: number }
  | MealPhotoRunResult
> => {
  const { dateProp, targetDateProp, titleProp } = resolveMealPhotoProps(env);
  const queryBody = {
    filter: {
      or: [
        { property: dateProp, date: { equals: date } },
        { property: targetDateProp, date: { equals: date } },
        { property: titleProp, title: { equals: `Daily Log｜${date}` } },
        { property: titleProp, title: { equals: `Daily Log | ${date}` } },
        { property: titleProp, title: { equals: `Daily Log ${date}` } },
        { property: titleProp, title: { equals: `Daily Log｜ ${date}` } },
      ],
    },
    page_size: 50,
    sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
  };

  const queryResult = await notionRequest(
    `https://api.notion.com/v1/databases/${resolveDailyLogDbId(env)}/query`,
    {
      method: "POST",
      body: JSON.stringify(queryBody),
    },
    env.NOTION_TOKEN,
  );

  if (!queryResult.ok) {
    return {
      ok: false,
      error: "Notion API error",
      status: queryResult.status,
      detail: queryResult.text,
    };
  }

  const results = Array.isArray(queryResult.json.results)
    ? (queryResult.json.results as Array<{ id?: string; properties?: Record<string, unknown>; last_edited_time?: string; created_time?: string }>)
    : [];

  if (results.length > 1) {
    console.warn("Multiple Daily_Log pages found for date", {
      date,
      count: results.length,
    });
  }

  const candidatePages: DailyLogPageCandidate[] = results
    .filter((r) => typeof r.id === "string")
    .map((r) => ({ id: r.id as string, properties: r.properties ?? {}, last_edited_time: r.last_edited_time, created_time: r.created_time }));
  const canonicalPage = candidatePages.length > 0 ? chooseCanonicalDailyLogPage(candidatePages, date, resolveMealPhotoProps(env)) : null;
  const duplicatePages = canonicalPage ? candidatePages.filter((p) => p.id !== canonicalPage.id) : [];
  const pageId = canonicalPage?.id;

  if (pageId) {
    console.log("Using existing Daily_Log page for meal photos", { date });
    const pageResult = await notionRequest(
      `https://api.notion.com/v1/pages/${pageId}`,
      { method: "GET" },
      env.NOTION_TOKEN,
    );

    if (!pageResult.ok) {
      return {
        ok: false,
        error: "Notion API error",
        status: pageResult.status,
        detail: pageResult.text,
      };
    }

    const properties = pageResult.json.properties as Record<string, unknown> | undefined;
    const existingState = extractMealPhotosExistingState(resolveMealPhotoProps(env).mealPhotosProp, properties);
    let mergedDuplicateMealPhotosCount = 0;
    let duplicateMealPhotosExistingCount = 0;
    for (const dup of duplicatePages) {
      const dupState = extractMealPhotosExistingState(resolveMealPhotoProps(env).mealPhotosProp, dup.properties);
      duplicateMealPhotosExistingCount += dupState.existingFiles.length;
      for (const file of dupState.existingFiles) {
        if (file.type !== "external") continue;
        const normalized = normalizeDropboxUrlForCompare(file.external?.url);
        if (normalized && !existingState.existingExternalUrls.has(normalized)) {
          existingState.existingExternalUrls.add(normalized);
          existingState.existingFiles.push(file);
          mergedDuplicateMealPhotosCount += 1;
        }
      }
    }

    return { ok: true, pageId, canonicalPageId: pageId, canonicalPage: canonicalPage as DailyLogPageCandidate, duplicatePages, duplicateCount: duplicatePages.length, duplicateDetected: duplicatePages.length > 0, existingState, mergedDuplicateMealPhotosCount, duplicateMealPhotosExistingCount };
  }

  const { sourceProp } = resolveMealPhotoProps(env);
  const createProps: Record<string, unknown> = {
    [titleProp]: {
      title: [{ text: { content: `Daily Log｜${date}` } }],
    },
    [dateProp]: {
      date: { start: date },
    },
    [targetDateProp]: {
      date: { start: date },
    },
  };

  if (await canSetDropboxSource(env)) {
    createProps[sourceProp] = { select: { name: "dropbox" } };
  }

  const createResult = await notionRequest(
    "https://api.notion.com/v1/pages",
    {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: resolveDailyLogDbId(env) },
        properties: createProps,
      }),
    },
    env.NOTION_TOKEN,
  );

  if (!createResult.ok) {
    return {
      ok: false,
      error: "Notion API error",
      status: createResult.status,
      detail: createResult.text,
    };
  }

  const createdId =
    typeof createResult.json.id === "string" ? createResult.json.id : null;
  if (!createdId) {
    return { ok: false, error: "Notion page id missing" };
  }

  console.log("Created Daily_Log page for meal photos", { date });
  return {
    ok: true,
    pageId: createdId,
    canonicalPageId: createdId,
    canonicalPage: { id: createdId, properties: createProps },
    duplicatePages: [],
    duplicateCount: 0,
    duplicateDetected: false,
    existingState: extractMealPhotosExistingState(resolveMealPhotoProps(env).mealPhotosProp),
    mergedDuplicateMealPhotosCount: 0,
    duplicateMealPhotosExistingCount: 0,
  };
};

const runMealPhotos = async (
  env: Env,
  requestedDate?: string,
): Promise<MealPhotoRunResult> => {
  const now = new Date();
  const { targetDate, windowStartJst, windowEndJst } =
    getMealPhotoWindowByExecutionDateJst(requestedDate);
  // LOG: Date calculation with requestId
  console.log("MEAL_PHOTOS_DATE_CALC", {
    requestId: currentRequestId,
    now: now.toISOString(),
    execution_date: requestedDate?.trim() || formatJstDate(now),
    target_date: targetDate,
    window_start_jst: windowStartJst.toISOString(),
    window_end_jst: windowEndJst.toISOString(),
  });

  const missingEnv: string[] = [];
  if (!getMealPhotosFolderPath(env)) {
    missingEnv.push("MEAL_PHOTOS_FOLDER_PATH");
  }
  missingEnv.push(...getMissingDropboxRefreshEnv(env));
  if (missingEnv.length > 0) {
    return {
      ok: false,
      error: "Dropbox environment variables missing",
      detail: `Missing: ${missingEnv.join(", ")}`,
    };
  }

  let schemaCheck: { ok: true } | MealPhotoRunResult;
  try {
    schemaCheck = await validateDailyLogSchema(env);
  } catch (error) {
    return {
      ok: false,
      error: "Daily Log schema preflight failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (!schemaCheck.ok) {
    return schemaCheck;
  }

  try {
    await getDropboxAccessToken(env);
  } catch (error) {
    return {
      ok: false,
      error: "Dropbox token refresh failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const listResult = await listDropboxFiles(env);
  if (!listResult.ok) {
    return listResult;
  }

  const targetFiles = listResult.files.filter((entry) => {
    if (!isImageFile(entry.name)) {
      return false;
    }
    const modifiedAtUtc = new Date(entry.server_modified);
    if (Number.isNaN(modifiedAtUtc.getTime())) {
      return false;
    }
    return modifiedAtUtc >= windowStartJst && modifiedAtUtc < windowEndJst;
  });

  console.log("MEAL_PHOTOS_COUNT", {
    requestId: currentRequestId,
    targetDate,
    totalDropboxFiles: listResult.files.length,
    targetFiles: targetFiles.length,
  });

  const pageResult = await ensureDailyLogPageByDate(env, targetDate);
  if (!pageResult.ok) {
    return pageResult;
  }

  const existingState = pageResult.existingState;
  const duplicateCount = pageResult.duplicateCount;
  const existingFiles = existingState.existingFiles;
  const mealPhotosExistingFileCount = existingFiles.length - pageResult.mergedDuplicateMealPhotosCount;
  const dedupBypassedBecauseExistingEmpty =
    existingState.mealPhotosType === "files" && mealPhotosExistingFileCount === 0;
  const newFiles: NotionFileReference[] = [];
  let skipped = 0;
  let firstComputedSkipReason: MealPhotoSkipReason | null = null;

  const firstExistingFileId = Array.from(existingState.existingFileIds)[0] ?? null;
  const firstExistingPath = Array.from(existingState.existingPaths)[0] ?? null;
  const firstCandidateKeys =
    targetFiles.length > 0 ? buildDropboxCandidateKeys(targetFiles[0]) : { fileId: null, path: null };

  console.log("MEAL_PHOTOS_DEDUP_DIAGNOSTICS", {
    requestId: currentRequestId,
    notionMealPhotosType: existingState.mealPhotosType,
    notionMealPhotosFileCount: existingFiles.length,
    mealPhotosExistingFileCount,
    dedupBypassedBecauseExistingEmpty,
    sampleExistingDropboxFileId: firstExistingFileId,
    sampleExistingDropboxPath: firstExistingPath,
    sampleCandidateDropboxFileId: firstCandidateKeys.fileId,
    sampleCandidateDropboxPath: firstCandidateKeys.path,
  });

  for (const entry of targetFiles) {
    const skipReason = dedupBypassedBecauseExistingEmpty
      ? null
      : getMealPhotoSkipReason(entry, existingState);
    if (skipReason) {
      if (!firstComputedSkipReason) {
        firstComputedSkipReason = skipReason;
      }
      skipped += 1;
      existingState.skippedReasonCounts[skipReason] += 1;
      continue;
    }

    const linkResult = await getDropboxSharedLink(env, entry);
    if (!linkResult.ok) {
      return linkResult;
    }
    const normalizedCandidateUrl = normalizeDropboxUrlForCompare(linkResult.url);
    if (normalizedCandidateUrl && existingState.existingExternalUrls.has(normalizedCandidateUrl)) {
      skipped += 1;
      continue;
    }

    newFiles.push({
      name: buildMealPhotoName(entry),
      type: "external",
      external: { url: linkResult.url },
    });

    const newKeys = buildDropboxCandidateKeys(entry);
    if (newKeys.fileId) {
      existingState.existingFileIds.add(newKeys.fileId);
    }
    if (newKeys.path) {
      existingState.existingPaths.add(newKeys.path);
    }
    if (normalizedCandidateUrl) {
      existingState.existingExternalUrls.add(normalizedCandidateUrl);
    }
  }
  existingFiles.push(...newFiles);

  console.log("MEAL_PHOTOS_DEDUP_SUMMARY", {
    requestId: currentRequestId,
    targetDate,
    dropboxTotalCount: listResult.files.length,
    targetDateCount: targetFiles.length,
    notionExistingCount: existingFiles.length,
    mealPhotosExistingFileCount,
    dedupBypassedBecauseExistingEmpty,
    newCandidateCount: newFiles.length,
    skippedCount: skipped,
    skippedReasons: existingState.skippedReasonCounts,
    firstComputedSkipReason,
  });
  console.log("MEAL_PHOTOS_CANONICAL_DIAGNOSTICS", {
    requestId: currentRequestId,
    target_date: targetDate,
    canonical_page_id: pageResult.canonicalPageId,
    daily_log_duplicate_detected: pageResult.duplicateDetected,
    duplicate_count: duplicateCount,
    duplicate_page_ids_count: pageResult.duplicatePages.length,
    meal_photos_existing_count: mealPhotosExistingFileCount,
    meal_photos_duplicate_existing_count: pageResult.duplicateMealPhotosExistingCount,
    meal_photos_merged_count: pageResult.mergedDuplicateMealPhotosCount,
    meal_photos_added_count: newFiles.length,
    title_prop_resolved: resolveMealPhotoProps(env).titleProp,
    date_prop_resolved: resolveMealPhotoProps(env).dateProp,
    target_date_prop_resolved: resolveMealPhotoProps(env).targetDateProp,
    meal_photos_prop_resolved: resolveMealPhotoProps(env).mealPhotosProp,
  });

  if (newFiles.length === 0 && pageResult.mergedDuplicateMealPhotosCount === 0) {
    return {
      ok: true,
      date: targetDate,
      action: "no_new_files",
      added: 0,
      skipped,
      target_date: targetDate,
      canonical_page_id: pageResult.pageId,
      daily_log_duplicate_detected: duplicateCount > 0,
      duplicate_count: duplicateCount,
      meal_photos_existing_count: mealPhotosExistingFileCount,
      meal_photos_added_count: 0,
      meal_photos_merged_count: pageResult.mergedDuplicateMealPhotosCount,
      title_prop_resolved: resolveMealPhotoProps(env).titleProp,
      date_prop_resolved: resolveMealPhotoProps(env).dateProp,
      target_date_prop_resolved: resolveMealPhotoProps(env).targetDateProp,
      meal_photos_prop_resolved: resolveMealPhotoProps(env).mealPhotosProp,
    };
  }
  const action = newFiles.length === 0 && pageResult.mergedDuplicateMealPhotosCount > 0 ? "merged_duplicates" : "added";

  console.log("NOTION_APPEND_START", {
    requestId: currentRequestId,
    pageId: pageResult.pageId,
    appendCount: newFiles.length,
  });

  const updateResult = await notionRequest(
    `https://api.notion.com/v1/pages/${pageResult.pageId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          [resolveMealPhotoProps(env).mealPhotosProp]: {
            files: existingFiles,
          },
        },
      }),
    },
    env.NOTION_TOKEN,
  );

  console.log("NOTION_APPEND_END", {
    requestId: currentRequestId,
    pageId: pageResult.pageId,
    addedCount: newFiles.length,
    skippedCount: skipped,
    status: updateResult.ok ? 200 : updateResult.status,
    body: updateResult.ok
      ? JSON.stringify({ id: pageResult.pageId, appended: newFiles.length })
      : updateResult.text.slice(0, 1000),
  });

  if (!updateResult.ok) {
    return {
      ok: false,
      error: "Notion API error",
      status: updateResult.status,
      detail: updateResult.text,
    };
  }

  return {
    ok: true,
    date: targetDate,
    action,
    added: newFiles.length,
    skipped,
    target_date: targetDate,
    canonical_page_id: pageResult.pageId,
    daily_log_duplicate_detected: duplicateCount > 0,
    duplicate_count: duplicateCount,
    meal_photos_existing_count: mealPhotosExistingFileCount,
    meal_photos_added_count: newFiles.length,
    meal_photos_merged_count: pageResult.mergedDuplicateMealPhotosCount,
    title_prop_resolved: resolveMealPhotoProps(env).titleProp,
    date_prop_resolved: resolveMealPhotoProps(env).dateProp,
    target_date_prop_resolved: resolveMealPhotoProps(env).targetDateProp,
    meal_photos_prop_resolved: resolveMealPhotoProps(env).mealPhotosProp,
  };
};

const handleHealthDaily = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405);
  }

  if (!requireBearerAuth(request, env)) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  let payload: Payload;
  try {
    payload = normalizeHealthPayload((await request.json()) as Payload);
  } catch (error) {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  if (!payload || typeof payload.date !== "string" || !payload.date.trim()) {
    return jsonResponse({ ok: false, error: "date is required" }, 400);
  }

  const validationError = validateHealthPayload(payload);
  if (validationError) {
    const { receivedTypes, receivedValues } = buildValidationDebugInfo(payload);
    return jsonResponse(
      {
        ok: false,
        error: validationError,
        received_types: receivedTypes,
        received_values: receivedValues,
      },
      400,
    );
  }

  const upsertResult = await upsertHealthDailyPage(env, payload, notionRequest);

  if (!upsertResult.ok) {
    return jsonResponse(upsertResult.body, upsertResult.status);
  }

  return jsonResponse(upsertResult);
};

const handleMealPhotosRun = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const requestId = crypto.randomUUID();
  currentRequestId = requestId;
  // LOG: Request start with requestId
  console.log("MEAL_PHOTOS_START", {
    requestId,
    method: request.method,
    path: new URL(request.url).pathname,
    time: new Date().toISOString(),
  });

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method Not Allowed", requestId }, 405);
  }

  if (!requireBearerAuth(request, env)) {
    return jsonResponse({ ok: false, error: "Unauthorized", requestId }, 401);
  }

  let requestedDate: string | undefined;
  try {
    if (request.headers.get("Content-Type")?.includes("application/json")) {
      const body = (await request.json()) as { date?: string };
      // LOG: Request JSON body with requestId
      console.log("MEAL_PHOTOS_REQUEST_BODY", {
        requestId,
        body: { hasDate: typeof body?.date === "string", date: body?.date ?? null },
      });
      if (typeof body?.date === "string" && body.date.trim()) {
        requestedDate = body.date.trim();
      }
    }
  } catch (error) {
    return jsonResponse({ ok: false, error: "Invalid JSON", requestId }, 400);
  }

  try {
    const result = await runMealPhotos(env, requestedDate);
    if (!result.ok) {
      console.error("MEAL_PHOTOS_ERROR", {
        requestId,
        error: result.error,
        code: result.code,
        status: result.status,
        date: result.date,
      });
      return jsonResponse({ ...result, requestId }, 502);
    }
    console.log("MEAL_PHOTOS_DONE", {
      requestId,
      date: result.date,
      action: result.action,
      added: result.added,
      skipped: result.skipped,
    });
    return jsonResponse({ ...result, requestId }, 200);
  } catch (error) {
    // LOG: Catch block with requestId
    console.error("MEAL_PHOTOS_ERROR", {
      requestId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    console.error("Meal photos run crashed", error);
    return jsonResponse({ ok: false, error: "Internal Server Error", requestId }, 500);
  }
};

export const __mealPhotosInternals = { resolveMealPhotoProps, chooseCanonicalDailyLogPage, normalizeDropboxUrlForCompare };

export const handleLegacyRoute = async (
  request: Request,
  env: Env,
): Promise<Response | null> => {
  const url = new URL(request.url);

  if (url.pathname === "/api/health/daily") {
    return handleHealthDaily(request, env);
  }

  if (url.pathname === "/api/daily-log/meal-photos/run") {
    return handleMealPhotosRun(request, env);
  }

  return null;
};
  if (targetFiles.length === 0) {
    const needsPatch = pageResult.mergedDuplicateMealPhotosCount > 0;
    if (needsPatch) {
      const patchRes = await notionRequest(
        `https://api.notion.com/v1/pages/${pageResult.pageId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            properties: {
              [resolveMealPhotoProps(env).mealPhotosProp]: { files: existingFiles },
            },
          }),
        },
        env.NOTION_TOKEN,
      );
      if (!patchRes.ok) {
        return { ok: false, error: "Notion API error", status: patchRes.status, detail: patchRes.text };
      }
    }
    return {
      ok: true,
      date: targetDate,
      action: needsPatch ? "merged_duplicates" : "no_files",
      added: 0,
      skipped: 0,
      target_date: targetDate,
      canonical_page_id: pageResult.pageId,
      daily_log_duplicate_detected: duplicateCount > 0,
      duplicate_count: duplicateCount,
      meal_photos_existing_count: mealPhotosExistingFileCount,
      meal_photos_added_count: 0,
      meal_photos_merged_count: pageResult.mergedDuplicateMealPhotosCount,
      title_prop_resolved: resolveMealPhotoProps(env).titleProp,
      date_prop_resolved: resolveMealPhotoProps(env).dateProp,
      target_date_prop_resolved: resolveMealPhotoProps(env).targetDateProp,
      meal_photos_prop_resolved: resolveMealPhotoProps(env).mealPhotosProp,
    };
  }
