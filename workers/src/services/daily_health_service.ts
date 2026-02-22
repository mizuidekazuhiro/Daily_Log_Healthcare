import type { Env } from "../types";
import { notionFetch } from "./notion_client";

export const getOrCreateDailyHealthPageId = async (
  env: Env,
  dateJst: string,
): Promise<string> => {
  const databaseId = env.HEALTH_DB_ID ?? env.DAILY_LOG_DB_ID;
  if (!databaseId) {
    throw new Error("HEALTH_DB_ID (or DAILY_LOG_DB_ID) is required");
  }

  const dateProp = env.HEALTH_DATE_PROP ?? "Date";
  const titleProp = env.HEALTH_TITLE_PROP ?? "Name";

  const queried = await notionFetch(env, `/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify({
      filter: { property: dateProp, date: { equals: dateJst } },
      page_size: 1,
    }),
  });

  const existing = queried?.results?.[0]?.id;
  if (existing) {
    return existing;
  }

  const created = await notionFetch(env, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        [titleProp]: { title: [{ text: { content: `Daily Log | ${dateJst}` } }] },
        [dateProp]: { date: { start: dateJst } },
      },
    }),
  });

  return created.id as string;
};
