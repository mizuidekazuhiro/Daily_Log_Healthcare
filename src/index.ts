export interface Env {
  NOTION_TOKEN: string;
  DAILY_LOG_DB_ID: string;
  HEALTH_API_KEY: string;
  DROPBOX_ACCESS_TOKEN?: string;
  DROPBOX_APP_KEY?: string;
  DROPBOX_APP_SECRET?: string;
  DROPBOX_REFRESH_TOKEN?: string;
  DROPBOX_FOLDER_PATH: string;
}

type Payload = {
  date?: string | null;
  weight?: number | null;
  protein?: number | null;
  fat?: number | null;
  carb?: number | null;
  kcal?: number | null;
  source?: string | null;
};

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

type MealPhotoRunResult =
  | {
      ok: true;
      date: string;
      action: string;
      added: number;
      skipped: number;
    }
  | {
      ok: false;
      error: string;
      detail?: string;
      status?: number;
      date?: string;
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

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const validatePayload = (payload: Payload): string | null => {
  const numericKeys = [
    "weight",
    "protein",
    "fat",
    "carb",
    "kcal",
  ] as const;

  for (const key of numericKeys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      continue;
    }
    const value = payload[key];
    if (value === null || value === undefined) {
      continue;
    }
    if (!isFiniteNumber(value)) {
      return `${key} must be a finite number`;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "source")) {
    const value = payload.source;
    if (value === null || value === undefined || value === "") {
      return null;
    }
    if (typeof value !== "string") {
      return "source must be a string";
    }
  }

  return null;
};

const buildPartialProps = (payload: Payload): Record<string, unknown> => {
  const props: Record<string, unknown> = {};

  if (payload.weight !== null && payload.weight !== undefined) {
    props["Weight"] = { number: payload.weight };
  }
  if (payload.protein !== null && payload.protein !== undefined) {
    props["Protein"] = { number: payload.protein };
  }
  if (payload.fat !== null && payload.fat !== undefined) {
    props["Fat"] = { number: payload.fat };
  }
  if (payload.carb !== null && payload.carb !== undefined) {
    props["Carb"] = { number: payload.carb };
  }
  if (payload.kcal !== null && payload.kcal !== undefined) {
    props["Kcal"] = { number: payload.kcal };
  }
  if (payload.source !== null && payload.source !== undefined) {
    const trimmed = payload.source.trim();
    if (trimmed) {
      props["Source"] = { select: { name: trimmed } };
    }
  }

  return props;
};

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

const getMissingDropboxRefreshEnv = (env: Env): string[] => {
  const missing: string[] = [];
  if (!env.DROPBOX_APP_KEY) {
    missing.push("DROPBOX_APP_KEY");
  }
  if (!env.DROPBOX_APP_SECRET) {
    missing.push("DROPBOX_APP_SECRET");
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

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env.DROPBOX_REFRESH_TOKEN as string,
    client_id: env.DROPBOX_APP_KEY as string,
    client_secret: env.DROPBOX_APP_SECRET as string,
  });

  // LOG: Dropbox token fetch start with requestId
  console.log("DROPBOX_TOKEN_FETCH_START", {
    requestId: currentRequestId,
    url: "https://api.dropboxapi.com/oauth2/token",
  });
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text();
  // LOG: Dropbox token fetch end with requestId and status
  console.log("DROPBOX_TOKEN_FETCH_END", {
    requestId: currentRequestId,
    url: "https://api.dropboxapi.com/oauth2/token",
    status: res.status,
    ok: res.ok,
  });
  if (!res.ok) {
    // LOG: Dropbox token fetch error with response body preview
    console.error("DROPBOX_TOKEN_FETCH_ERROR", {
      requestId: currentRequestId,
      url: "https://api.dropboxapi.com/oauth2/token",
      status: res.status,
      body: text.slice(0, 300),
    });
    console.error("Dropbox token refresh failed", {
      status: res.status,
      body: text,
    });
    throw new Error(`Dropbox token refresh failed: ${res.status}`);
  }

  const data = JSON.parse(text) as { access_token?: string };
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
    });
    return { response, text };
  };

  let token = await getDropboxAccessToken(env);
  let { response, text } = await makeRequest(token);

  if (response.status === 401) {
    console.warn("Dropbox API unauthorized", {
      endpoint,
      status: response.status,
    });
    try {
      token = await getDropboxAccessToken(env, { forceRefresh: true });
      const retry = await makeRequest(token);
      response = retry.response;
      text = retry.text;
      if (response.status === 401) {
        console.warn("Dropbox API unauthorized after refresh", {
          endpoint,
          status: response.status,
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
    console.error("DROPBOX_FETCH_ERROR", {
      requestId: currentRequestId,
      url: `https://api.dropboxapi.com/2/${endpoint}`,
      status: response.status,
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

const getYesterdayJstDate = (): string => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return formatJstDate(yesterday);
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
    return url.toString();
  } catch {
    return sharedUrl;
  }
};

const buildMealPhotoName = (entry: DropboxFileEntry): string =>
  `${entry.name} [dropbox-id:${entry.id}]`;

const mealPhotoAlreadyAttached = (
  entry: DropboxFileEntry,
  existingFiles: NotionFileReference[],
): boolean =>
  existingFiles.some((file) => {
    const name = typeof file.name === "string" ? file.name : "";
    const url =
      file.type === "external" && file.external
        ? file.external.url
        : file.type === "file" && file.file
          ? file.file.url
          : "";
    return name.includes(entry.id) || url.includes(entry.id);
  });

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
      : { path: env.DROPBOX_FOLDER_PATH || "", recursive: false };

    const result = await dropboxRequest(env, endpoint, body);

    if (!result.ok) {
      return {
        ok: false,
        error: "Dropbox API error",
        status: result.status,
        detail: result.text,
      };
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

  const existing = await dropboxRequest(env, "sharing/list_shared_links", {
    path,
    direct_only: true,
  });

  if (!existing.ok) {
    return {
      ok: false,
      error: "Dropbox API error",
      status: existing.status,
      detail: existing.text,
    };
  }

  const links = Array.isArray(existing.json.links)
    ? (existing.json.links as Array<{ url?: string }>)
    : [];

  const existingUrl = links.find((link) => typeof link.url === "string")?.url;
  if (existingUrl) {
    return { ok: true, url: toDropboxRawUrl(existingUrl) };
  }

  const created = await dropboxRequest(
    env,
    "sharing/create_shared_link_with_settings",
    { path },
  );

  if (!created.ok) {
    return {
      ok: false,
      error: "Dropbox API error",
      status: created.status,
      detail: created.text,
    };
  }

  const url =
    typeof created.json.url === "string" ? created.json.url : undefined;
  if (!url) {
    return { ok: false, error: "Dropbox shared link missing" };
  }

  return { ok: true, url: toDropboxRawUrl(url) };
};

const canSetDropboxSource = async (env: Env): Promise<boolean> => {
  const dbResult = await notionRequest(
    `https://api.notion.com/v1/databases/${env.DAILY_LOG_DB_ID}`,
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
  const sourceProp = properties?.["Source"];
  if (sourceProp?.type !== "select") {
    return false;
  }
  const options = Array.isArray(sourceProp.select?.options)
    ? sourceProp.select?.options
    : [];
  return options.some((option) => option?.name === "dropbox");
};

const ensureDailyLogPageByDate = async (
  env: Env,
  date: string,
): Promise<
  | { ok: true; pageId: string; existingFiles: NotionFileReference[] }
  | MealPhotoRunResult
> => {
  const queryBody = {
    filter: {
      property: "Date",
      date: {
        equals: date,
      },
    },
    page_size: 2,
  };

  const queryResult = await notionRequest(
    `https://api.notion.com/v1/databases/${env.DAILY_LOG_DB_ID}/query`,
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
    ? (queryResult.json.results as Array<{ id?: string }>)
    : [];

  if (results.length > 1) {
    console.warn("Multiple Daily_Log pages found for date", {
      date,
      count: results.length,
    });
  }

  const pageId = results[0]?.id;

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

    const properties = pageResult.json.properties as
      | Record<string, unknown>
      | undefined;
    const mealProp = properties?.["Meal Photos"] as
      | { type?: string; files?: NotionFileReference[] }
      | undefined;
    const existingFiles =
      mealProp?.type === "files" && Array.isArray(mealProp.files)
        ? mealProp.files
        : [];

    return { ok: true, pageId, existingFiles };
  }

  const createProps: Record<string, unknown> = {
    Name: {
      title: [{ text: { content: `Daily Log | ${date}` } }],
    },
    Date: {
      date: { start: date },
    },
  };

  if (await canSetDropboxSource(env)) {
    createProps["Source"] = { select: { name: "dropbox" } };
  }

  const createResult = await notionRequest(
    "https://api.notion.com/v1/pages",
    {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: env.DAILY_LOG_DB_ID },
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
  return { ok: true, pageId: createdId, existingFiles: [] };
};

const runMealPhotos = async (
  env: Env,
  requestedDate?: string,
): Promise<MealPhotoRunResult> => {
  const now = new Date();
  const targetDate = requestedDate?.trim() || getYesterdayJstDate();
  // LOG: Date calculation with requestId
  console.log("MEAL_PHOTOS_DATE_CALC", {
    requestId: currentRequestId,
    now: now.toISOString(),
    target_date: targetDate,
  });

  const missingEnv: string[] = [];
  if (!env.DROPBOX_FOLDER_PATH) {
    missingEnv.push("DROPBOX_FOLDER_PATH");
  }
  if (!env.DROPBOX_ACCESS_TOKEN) {
    missingEnv.push(...getMissingDropboxRefreshEnv(env));
  }
  if (missingEnv.length > 0) {
    return {
      ok: false,
      error: "Dropbox environment variables missing",
      detail: `Missing: ${missingEnv.join(", ")}`,
    };
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
    const modifiedDate = new Date(entry.server_modified);
    return formatJstDate(modifiedDate) === targetDate;
  });

  if (targetFiles.length === 0) {
    return { ok: true, date: targetDate, action: "no_files", added: 0, skipped: 0 };
  }

  const pageResult = await ensureDailyLogPageByDate(env, targetDate);
  if (!pageResult.ok) {
    return pageResult;
  }

  const existingFiles = pageResult.existingFiles;
  const newFiles: NotionFileReference[] = [];
  let skipped = 0;

  for (const entry of targetFiles) {
    if (mealPhotoAlreadyAttached(entry, existingFiles)) {
      skipped += 1;
      continue;
    }

    const linkResult = await getDropboxSharedLink(env, entry);
    if (!linkResult.ok) {
      return linkResult;
    }

    newFiles.push({
      name: buildMealPhotoName(entry),
      type: "external",
      external: { url: linkResult.url },
    });
  }

  if (newFiles.length === 0) {
    return {
      ok: true,
      date: targetDate,
      action: "no_new_files",
      added: 0,
      skipped,
    };
  }

  const updateResult = await notionRequest(
    `https://api.notion.com/v1/pages/${pageResult.pageId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          "Meal Photos": {
            files: [...existingFiles, ...newFiles],
          },
        },
      }),
    },
    env.NOTION_TOKEN,
  );

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
    action: "added",
    added: newFiles.length,
    skipped,
  };
};

const handleHealthDaily = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405);
  }

  const apiKey = request.headers.get("X-API-Key");
  if (!apiKey || apiKey !== env.HEALTH_API_KEY) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
    // --- normalize Shortcuts payload ---
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

    const raw: any = payload as any;
    if (raw && typeof raw === "object") {
      payload = unwrapShortcutDeep(raw) as Payload;
    }

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

    (payload as any).weight = toNumberOrNull((payload as any).weight);
    (payload as any).protein = toNumberOrNull((payload as any).protein);
    (payload as any).fat = toNumberOrNull((payload as any).fat);
    (payload as any).carb = toNumberOrNull((payload as any).carb);
    (payload as any).kcal = toNumberOrNull((payload as any).kcal);
  } catch (error) {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  if (!payload || typeof payload.date !== "string" || !payload.date.trim()) {
    return jsonResponse({ ok: false, error: "date is required" }, 400);
  }

  const validationError = validatePayload(payload);
  if (validationError) {
    const numericKeys = ["weight", "protein", "fat", "carb", "kcal"] as const;
    const receivedTypes = Object.fromEntries(
      numericKeys.map((key) => {
        const value = payload[key];
        if (value === null) {
          return [key, "null"];
        }
        if (Array.isArray(value)) {
          return [key, "array"];
        }
        return [key, typeof value];
      }),
    );
    const receivedValues = Object.fromEntries(
      numericKeys.map((key) => [key, payload[key]]),
    );
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

  const date = payload.date.trim();
  const partialProps = buildPartialProps(payload);

  const queryBody = {
    filter: {
      property: "Date",
      date: {
        equals: date,
      },
    },
    page_size: 1,
  };

  const queryResult = await notionRequest(
    `https://api.notion.com/v1/databases/${env.DAILY_LOG_DB_ID}/query`,
    {
      method: "POST",
      body: JSON.stringify(queryBody),
    },
    env.NOTION_TOKEN,
  );

  if (!queryResult.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "Notion API error",
        status: queryResult.status,
        detail: queryResult.text,
      },
      502,
    );
  }

  const results = queryResult.json.results as Array<{ id: string }>;

  if (results.length > 0) {
    if (Object.keys(partialProps).length === 0) {
      return jsonResponse({ ok: true, action: "updated", date });
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
      return jsonResponse(
        {
          ok: false,
          error: "Notion API error",
          status: updateResult.status,
          detail: updateResult.text,
        },
        502,
      );
    }

    return jsonResponse({ ok: true, action: "updated", date });
  }

  const createProps = {
    Name: {
      title: [{ text: { content: `Daily Log | ${date}` } }],
    },
    Date: {
      date: { start: date },
    },
    ...partialProps,
  };

  const createResult = await notionRequest(
    "https://api.notion.com/v1/pages",
    {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: env.DAILY_LOG_DB_ID },
        properties: createProps,
      }),
    },
    env.NOTION_TOKEN,
  );

  if (!createResult.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "Notion API error",
        status: createResult.status,
        detail: createResult.text,
      },
      502,
    );
  }

  return jsonResponse({ ok: true, action: "created", date });
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

  const apiKey = request.headers.get("X-API-Key");
  if (!apiKey || apiKey !== env.HEALTH_API_KEY) {
    return jsonResponse({ ok: false, error: "Unauthorized", requestId }, 401);
  }

  let requestedDate: string | undefined;
  try {
    if (request.headers.get("Content-Type")?.includes("application/json")) {
      const body = (await request.json()) as { date?: string };
      // LOG: Request JSON body with requestId
      console.log("MEAL_PHOTOS_REQUEST_BODY", {
        requestId,
        body,
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
      console.error("Meal photos run failed", {
        requestId,
        error: result.error,
        status: result.status,
        date: result.date,
      });
      return jsonResponse({ ...result, requestId }, 502);
    }
    return jsonResponse({ ...result, requestId }, 200);
  } catch (error) {
    // LOG: Catch block with requestId
    console.error("MEAL_PHOTOS_CATCH", {
      requestId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    console.error("Meal photos run crashed", error);
    return jsonResponse({ ok: false, error: "Internal Server Error", requestId }, 500);
  }
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health/daily") {
      return handleHealthDaily(request, env);
    }

    if (url.pathname === "/api/daily-log/meal-photos/run") {
      return handleMealPhotosRun(request, env);
    }

    return jsonResponse({ ok: false, error: "Not Found" }, 404);
  },
};
