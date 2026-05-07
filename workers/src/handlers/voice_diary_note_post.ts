import type { Env } from "../types.ts";
import { NotionApiError } from "../services/notion_client.ts";
import { createVoiceDiaryNote } from "../services/voice_diary_note_service.ts";
import { normalizeVoiceDiaryPayload, validateAndComputeVoiceDiary } from "../services/voice_diary_note_pure.ts";
import { errorResponse, jsonResponse } from "../utils/http.ts";

export const handleVoiceDiaryNotePost = async (request: Request, env: Env): Promise<Response> => {
  try {
    const raw = await request.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return errorResponse(400, "request body must be a JSON object");
    console.log("VOICE_DIARY_NOTE_RECEIVED", { has_text: Boolean((raw as any)?.text) });
    const normalized = normalizeVoiceDiaryPayload(raw);
    const computed: any = await validateAndComputeVoiceDiary(normalized);
    if (computed.error) {
      console.log("VOICE_DIARY_NOTE_VALIDATION_ERROR", { error: computed.error });
      return errorResponse(400, computed.error);
    }
    const result = await createVoiceDiaryNote(env, computed);
    return jsonResponse(200, { ok: true, created: result.created, deduped: result.deduped, target_date: computed.target_date, recorded_at: computed.recorded_at, note_hash: computed.note_hash });
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse(400, "Invalid JSON");
    if (error instanceof NotionApiError) {
      console.log("VOICE_DIARY_NOTE_CREATE_ERROR", { status: error.status });
      return errorResponse(502, "Notion API error", { status: error.status, body_preview: error.responseText.slice(0, 300) });
    }
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("VOICE_DIARY_NOTES_DB_ID")) return errorResponse(500, "Missing VOICE_DIARY_NOTES_DB_ID");
    console.log("VOICE_DIARY_NOTE_CREATE_ERROR", { message: msg });
    return errorResponse(500, "Internal Server Error");
  }
};
