import type { Env } from "../types";
import { getJstDateString, getJstDayRange, getJstMinuteString } from "../utils/datetime";
import { notionFetch } from "./notion_client";
import { getSupplementNameMap } from "./supplements_service";

const buildIntakeTitle = (takenAt: Date, supplementName: string): string =>
  `${getJstMinuteString(takenAt)} - ${supplementName}`;

const hasDuplicate = async (
  env: Env,
  title: string,
  takenAt: Date,
): Promise<boolean> => {
  const databaseId = env.INTAKE_LOG_DB_ID;
  if (!databaseId) {
    throw new Error("INTAKE_LOG_DB_ID is required");
  }
  const range = getJstDayRange(takenAt);
  const json = await notionFetch(env, `/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify({
      filter: {
        and: [
          { property: "TakenAt", date: { on_or_after: range.start } },
          { property: "TakenAt", date: { on_or_before: range.end } },
          { property: "Name", title: { equals: title } },
        ],
      },
      page_size: 1,
    }),
  });
  return (json?.results?.length ?? 0) > 0;
};

export const createIntakeLogs = async (
  env: Env,
  dailyHealthPageId: string,
  takenAtIso: string,
  supplementIds: string[],
  source?: string,
) => {
  const databaseId = env.INTAKE_LOG_DB_ID;
  if (!databaseId) {
    throw new Error("INTAKE_LOG_DB_ID is required");
  }

  const takenAt = new Date(takenAtIso);
  const supplementNames = await getSupplementNameMap(env, supplementIds);

  const created: Array<{ supplement_id: string; intake_page_id: string }> = [];
  const skipped: Array<{ supplement_id: string; reason: string }> = [];

  for (const supplementId of supplementIds) {
    const supplementName = supplementNames.get(supplementId) ?? supplementId;
    const title = buildIntakeTitle(takenAt, supplementName);
    if (await hasDuplicate(env, title, takenAt)) {
      skipped.push({ supplement_id: supplementId, reason: "duplicate" });
      continue;
    }

    const properties: Record<string, unknown> = {
      Name: { title: [{ text: { content: title } }] },
      TakenAt: { date: { start: takenAtIso } },
      Supplement: { relation: [{ id: supplementId }] },
      "Daily Health": { relation: [{ id: dailyHealthPageId }] },
    };

    if (source) {
      properties.Source = { select: { name: source } };
    }

    const createdPage = await notionFetch(env, "/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties,
      }),
    });

    created.push({ supplement_id: supplementId, intake_page_id: createdPage.id as string });
  }

  return {
    date: getJstDateString(takenAt),
    created,
    skipped,
  };
};
