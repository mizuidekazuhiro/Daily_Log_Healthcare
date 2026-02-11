import type { Env, SupplementChoice } from "../types";
import { queryDatabaseAll } from "./notion_client";

export const getTitlePlainText = (page: any): string => {
  const title = page?.properties?.Name?.title;
  if (!Array.isArray(title)) {
    return "";
  }
  return title.map((t) => t?.plain_text ?? "").join("").trim();
};

export const listSupplementChoices = async (env: Env): Promise<SupplementChoice[]> => {
  if (!env.SUPPLEMENTS_DB_ID) {
    throw new Error("SUPPLEMENTS_DB_ID is required");
  }

  const activeFiltered = await queryDatabaseAll(env, env.SUPPLEMENTS_DB_ID, {
    sorts: [{ property: "Name", direction: "ascending" }],
    filter: {
      property: "Active",
      checkbox: { equals: true },
    },
    page_size: 100,
  });

  const pages = activeFiltered.length
    ? activeFiltered
    : await queryDatabaseAll(env, env.SUPPLEMENTS_DB_ID, {
        sorts: [{ property: "Name", direction: "ascending" }],
        page_size: 100,
      });

  return pages
    .map((p) => ({ label: getTitlePlainText(p), value: p.id as string }))
    .filter((c) => c.label && c.value);
};

export const getSupplementNameMap = async (
  env: Env,
  supplementIds: string[],
): Promise<Map<string, string>> => {
  const all = await listSupplementChoices(env);
  const set = new Set(supplementIds);
  const map = new Map<string, string>();
  all.forEach((s) => {
    if (set.has(s.value)) {
      map.set(s.value, s.label);
    }
  });
  return map;
};
