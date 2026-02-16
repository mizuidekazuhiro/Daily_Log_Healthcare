import type { Env, PostIntakesRequest, PostIntakesResponse } from "../types";
import { createIntakeLogs } from "../services/intake_log_service";
import { getOrCreateDailyHealthPageId } from "../services/daily_health_service";
import { getJstDateString } from "../utils/datetime";
import { badRequest, errorResponse, jsonResponse, readJson } from "../utils/http";
import { getNotionErrorDetails, NotionApiError } from "../services/notion_client";

const isIsoDate = (value: string): boolean => !Number.isNaN(new Date(value).getTime());

const normalizeSupplementIds = (input: unknown): string[] => {
  if (Array.isArray(input)) {
    return input
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
};

const validateRequest = (body: PostIntakesRequest): string | null => {
  if (!body || typeof body !== "object") return "body must be an object";
  if (typeof body.taken_at !== "string" || !isIsoDate(body.taken_at)) return "taken_at must be ISO8601 string";
  if (!Array.isArray(body.supplement_ids) || body.supplement_ids.length === 0) return "supplement_ids must be non-empty array";
  if (!body.supplement_ids.every((v) => typeof v === "string" && v.length > 0)) return "supplement_ids must contain page ids";
  if (body.source !== undefined && typeof body.source !== "string") return "source must be string";
  return null;
};

export const handleSupplementIntakesPost = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  try {
    const rawBody = await readJson<any>(request);

    // ★ ここで正規化（改行文字列でもOKにする）
    rawBody.supplement_ids = normalizeSupplementIds(rawBody.supplement_ids);

    const body = rawBody as PostIntakesRequest;

    const error = validateRequest(body);
    if (error) return badRequest(error);

    const takenAt = new Date(body.taken_at);
    const dailyDate = getJstDateString(takenAt);
    console.log("SUPPLEMENT_INTAKE_REQUEST", {
      request_id: crypto.randomUUID(),
      date: dailyDate,
      count: body.supplement_ids.length,
    });

    const dailyHealthPageId = await getOrCreateDailyHealthPageId(env, dailyDate);
    const result = await createIntakeLogs(
      env,
      dailyHealthPageId,
      body.taken_at,
      body.supplement_ids,
      body.source,
    );

    const response: PostIntakesResponse = {
      daily_health_page_id: dailyHealthPageId,
      created: result.created,
      skipped: result.skipped,
    };
    return jsonResponse(200, response);
  } catch (error) {
    if (error instanceof NotionApiError) {
      return errorResponse(502, "Notion API error", getNotionErrorDetails(error));
    }
    if (error instanceof SyntaxError) {
      return badRequest("invalid JSON body");
    }
    return errorResponse(500, "Internal Server Error", getNotionErrorDetails(error));
  }
};