export interface Env {
  NOTION_TOKEN: string;
  DAILY_LOG_DB_ID: string;
  HEALTH_API_KEY: string;
  DROPBOX_ACCESS_TOKEN: string;
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
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      text: await response.text(),
    };
  }

  return { ok: true, json: await response.json() };
};

const dropboxRequest = async (
  endpoint: string,
  body: Record<string, unknown>,
  token: string,
): Promise<
  | { ok: true; json: any }
  | { ok: false; status: number; text: string }
> => {
  const response = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      text: await response.text(),
    };
  }

  return { ok: true, json: await response.json() };
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

    const result = await dropboxRequest(
      endpoint,
      body,
      env.DROPBOX_ACCESS_TOKEN,
    );

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

  const existing = await dropboxRequest(
    "sharing/list_shared_links",
    { path, direct_only: true },
    env.DROPBOX_ACCESS_TOKEN,
  );

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
    "sharing/create_shared_link_with_settings",
    { path },
    env.DROPBOX_ACCESS_TOKEN,
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

const getDailyLogPage = async (
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
    return {
      ok: false,
      error: "Notion API error",
      status: queryResult.status,
      detail: queryResult.text,
    };
  }

  const results = Array.isArray(queryResult.json.results)
    ? (queryResult.json.results as Array<{ id?: string }> )
    : [];

  const pageId = results[0]?.id;

  if (pageId) {
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

  const createProps = {
    Name: {
      title: [{ text: { content: `Daily Log | ${date}` } }],
    },
    Date: {
      date: { start: date },
    },
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

  return { ok: true, pageId: createdId, existingFiles: [] };
};

const runMealPhotos = async (
  env: Env,
  requestedDate?: string,
): Promise<MealPhotoRunResult> => {
  const targetDate = requestedDate?.trim() || getYesterdayJstDate();

  if (!env.DROPBOX_ACCESS_TOKEN || !env.DROPBOX_FOLDER_PATH) {
    return { ok: false, error: "Dropbox environment variables missing" };
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

  const pageResult = await getDailyLogPage(env, targetDate);
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
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405);
  }

  const apiKey = request.headers.get("X-API-Key");
  if (!apiKey || apiKey !== env.HEALTH_API_KEY) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  let requestedDate: string | undefined;
  try {
    if (request.headers.get("Content-Type")?.includes("application/json")) {
      const body = (await request.json()) as { date?: string };
      if (typeof body?.date === "string" && body.date.trim()) {
        requestedDate = body.date.trim();
      }
    }
  } catch (error) {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  try {
    const result = await runMealPhotos(env, requestedDate);
    if (!result.ok) {
      console.error("Meal photos run failed", {
        error: result.error,
        status: result.status,
        date: result.date,
      });
      return jsonResponse(result, 502);
    }
    return jsonResponse(result, 200);
  } catch (error) {
    console.error("Meal photos run crashed", error);
    return jsonResponse({ ok: false, error: "Internal Server Error" }, 500);
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

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        try {
          const result = await runMealPhotos(env);
          if (!result.ok) {
            console.error("Scheduled meal photos failed", {
              error: result.error,
              status: result.status,
              date: result.date,
            });
          } else {
            console.log("Scheduled meal photos completed", {
              date: result.date,
              added: result.added,
              skipped: result.skipped,
              action: result.action,
            });
          }
        } catch (error) {
          console.error("Scheduled meal photos crashed", error);
        }
      })(),
    );
  },
};
