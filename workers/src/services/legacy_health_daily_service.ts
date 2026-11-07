import type { Env } from "../types";
import { HEALTH_PROP, buildHealthPartialProps, hasHealthMeasurements } from "./legacy_health_daily_pure.ts";
import type { LegacyHealthPayload } from "./legacy_health_daily_pure.ts";

// Preserve the service entry points used by handlers and existing clients.
export { normalizeHealthPayload, validateHealthPayload, buildValidationDebugInfo } from "./legacy_health_daily_pure.ts";
export { buildHealthPartialProps };
export type { LegacyHealthPayload } from "./legacy_health_daily_pure.ts";

export type NotionRequestResult =
  | { ok: true; json: any }
  | { ok: false; status: number; text: string };

export type NotionRequestFn = (
  url: string,
  options: RequestInit,
  token: string,
) => Promise<NotionRequestResult>;

export type HealthDailyUpsertResult =
  | { ok: true; action: "updated" | "created"; date: string }
  | { ok: false; status: number; body: { ok: false; error: string; status: number; detail: string; error_code?: string } };

const getHealthDatabaseId = (env: Env): string | null =>
  env.HEALTH_DB_ID ?? env.DAILY_LOG_DB_ID ?? null;

const getHealthDateProp = (env: Env): string => env.HEALTH_DATE_PROP ?? HEALTH_PROP.date;
const getHealthTitleProp = (env: Env): string => env.HEALTH_TITLE_PROP ?? HEALTH_PROP.title;
const getHealthDbEnvKey = (env: Env): "HEALTH_DB_ID" | "DAILY_LOG_DB_ID" =>
  env.HEALTH_DB_ID ? "HEALTH_DB_ID" : "DAILY_LOG_DB_ID";

const buildNotionPropertyErrorContext = (
  operation: "query" | "update" | "create",
  propertyNames: string[],
  payload: Record<string, unknown>,
) => ({
  operation,
  propertyNames,
  // Keep field names for diagnosis; never log personal measurement values.
  submittedFields: Object.keys(payload),
});

const logNotionPropertyError = (
  context: ReturnType<typeof buildNotionPropertyErrorContext>,
  result: Extract<NotionRequestResult, { ok: false }>,
) => {
  console.error("HEALTH_DAILY_NOTION_PROPERTY_ERROR", {
    ...context,
    status: result.status,
    errorCode: "notion_property_error",
  });
};

export const upsertHealthDailyPage = async (
  env: Env,
  payload: LegacyHealthPayload,
  notionRequest: NotionRequestFn,
): Promise<HealthDailyUpsertResult> => {
  const databaseId = getHealthDatabaseId(env);
  if (!databaseId) {
    return {
      ok: false,
      status: 500,
      body: {
        ok: false,
        error: "HEALTH_DB_ID (or DAILY_LOG_DB_ID) is required",
        status: 500,
        detail: "Missing Notion database configuration",
      },
    };
  }

  const date = (payload.date ?? "").trim();
  // Metadata alone must not create an empty Health page or report an update.
  // Keep all measurements optional individually, including weight-only updates.
  if (!hasHealthMeasurements(payload)) {
    console.warn("HEALTH_DAILY_NO_MEASUREMENTS", { date, error_code: "health_measurements_empty" });
    return {
      ok: false,
      status: 422,
      body: {
        ok: false,
        error: "No Health measurements supplied",
        status: 422,
        error_code: "health_measurements_empty",
        detail: "Send at least one numeric Health measurement or a valid sleep_start/sleep_end. Metadata alone is not a Health update.",
      },
    };
  }
  const partialProps = buildHealthPartialProps(payload);
  const dateProp = getHealthDateProp(env);
  const titleProp = getHealthTitleProp(env);
  const selectedDatabaseEnvKey = getHealthDbEnvKey(env);
  console.info("HEALTH_DAILY_DB_CONFIG", { selectedDatabaseEnvKey, titleProp, dateProp });

  const queryBody = {
    filter: {
      property: dateProp,
      date: {
        equals: date,
      },
    },
    page_size: 1,
  };

  const queryResult = await notionRequest(
    `https://api.notion.com/v1/databases/${databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify(queryBody),
    },
    env.NOTION_TOKEN,
  );

  if (!queryResult.ok) {
    console.error("HEALTH_DAILY_DB_CONFIG_ON_ERROR", {
      selectedDatabaseEnvKey,
      titleProp,
      dateProp,
    });
    logNotionPropertyError(
      buildNotionPropertyErrorContext("query", [dateProp], queryBody),
      queryResult,
    );
    return {
      ok: false,
      status: 502,
      body: {
        ok: false,
        error: "Notion API error",
        status: queryResult.status,
        detail: queryResult.text,
      },
    };
  }

  const results = queryResult.json.results as Array<{ id: string }>;

  if (results.length > 0) {
    if (Object.keys(partialProps).length === 0) {
      return { ok: true, action: "updated", date };
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
      console.error("HEALTH_DAILY_DB_CONFIG_ON_ERROR", {
        selectedDatabaseEnvKey,
        titleProp,
        dateProp,
      });
      logNotionPropertyError(
        buildNotionPropertyErrorContext("update", Object.keys(partialProps), partialProps),
        updateResult,
      );
      return {
        ok: false,
        status: 502,
        body: {
          ok: false,
          error: "Notion API error",
          status: updateResult.status,
          detail: updateResult.text,
        },
      };
    }

    return { ok: true, action: "updated", date };
  }

  const createProps = {
    [titleProp]: {
      title: [{ text: { content: `Daily Log | ${date}` } }],
    },
    [dateProp]: {
      date: { start: date },
    },
    ...partialProps,
  };

  const createResult = await notionRequest(
    "https://api.notion.com/v1/pages",
    {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: createProps,
      }),
    },
    env.NOTION_TOKEN,
  );

  if (!createResult.ok) {
    console.error("HEALTH_DAILY_DB_CONFIG_ON_ERROR", {
      selectedDatabaseEnvKey,
      titleProp,
      dateProp,
    });
    logNotionPropertyError(
      buildNotionPropertyErrorContext("create", Object.keys(createProps), createProps),
      createResult,
    );
    return {
      ok: false,
      status: 502,
      body: {
        ok: false,
        error: "Notion API error",
        status: createResult.status,
        detail: createResult.text,
      },
    };
  }

  return { ok: true, action: "created", date };
};
