import type { Env } from "../types";
import { listSupplementChoices } from "../services/supplements_service";
import { getNotionErrorDetails, NotionApiError } from "../services/notion_client";
import { errorResponse, jsonResponse } from "../utils/http";

export const handleSupplementsGet = async (_request: Request, env: Env): Promise<Response> => {
  try {
    const choices = await listSupplementChoices(env);
    return jsonResponse(200, { choices });
  } catch (error) {
    if (error instanceof NotionApiError) {
      return errorResponse(502, "Notion API error", getNotionErrorDetails(error));
    }
    return errorResponse(500, "Internal Server Error", getNotionErrorDetails(error));
  }
};
