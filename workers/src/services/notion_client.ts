import type { Env } from "../types";

const NOTION_VERSION = "2022-06-28";

export class NotionApiError extends Error {
  status: number;
  responseText: string;
  constructor(message: string, status: number, responseText: string) {
    super(message);
    this.status = status;
    this.responseText = responseText;
  }
}

export const getNotionErrorDetails = (error: unknown): Record<string, unknown> => {
  if (error instanceof NotionApiError) {
    return {
      status: error.status,
      detail: error.responseText,
      message: error.message,
    };
  }
  return { message: error instanceof Error ? error.message : String(error) };
};

export const notionFetch = async (
  env: Env,
  path: string,
  init: RequestInit,
): Promise<any> => {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    throw new NotionApiError(`Notion API Error: ${res.status}`, res.status, await res.text());
  }
  return res.json();
};

export const queryDatabaseAll = async (
  env: Env,
  databaseId: string,
  body: Record<string, unknown>,
): Promise<any[]> => {
  let hasMore = true;
  let startCursor: string | undefined;
  const items: any[] = [];

  while (hasMore) {
    const payload = startCursor ? { ...body, start_cursor: startCursor } : body;
    const json = await notionFetch(env, `/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    items.push(...(json.results ?? []));
    hasMore = Boolean(json.has_more);
    startCursor = json.next_cursor ?? undefined;
  }

  return items;
};
