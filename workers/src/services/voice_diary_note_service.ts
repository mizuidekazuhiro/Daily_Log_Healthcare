import type { Env } from "../types.ts";
import { notionFetch, queryDatabaseAll } from "./notion_client.ts";

const prop = (env: Env, name: keyof Env, fallback: string) => (env[name] as string | undefined) || fallback;

const getVoiceProps = (env: Env) => ({
  name: prop(env, "VOICE_DIARY_NAME_PROPERTY_NAME", "Name"),
  targetDate: prop(env, "VOICE_DIARY_TARGET_DATE_PROPERTY_NAME", "Target Date"),
  recordedAt: prop(env, "VOICE_DIARY_RECORDED_AT_PROPERTY_NAME", "Recorded At"),
  text: prop(env, "VOICE_DIARY_TEXT_PROPERTY_NAME", "Text"),
  source: prop(env, "VOICE_DIARY_SOURCE_PROPERTY_NAME", "Source"),
  noteHash: prop(env, "VOICE_DIARY_NOTE_HASH_PROPERTY_NAME", "Note Hash"),
  status: prop(env, "VOICE_DIARY_STATUS_PROPERTY_NAME", "Status"),
});

export const createVoiceDiaryNote = async (env: Env, computed: { text: string; source: string; recorded_at: string; target_date: string; note_hash: string; }) => {
  const dbId = env.VOICE_DIARY_NOTES_DB_ID;
  if (!dbId) throw new Error("Missing VOICE_DIARY_NOTES_DB_ID");
  const props = getVoiceProps(env);

  const found = await queryDatabaseAll(env, dbId, { filter: { property: props.noteHash, rich_text: { equals: computed.note_hash } }, page_size: 1 });
  if (found.length > 0) {
    console.log("VOICE_DIARY_NOTE_DEDUPE_HIT", { target_date: computed.target_date, note_hash: computed.note_hash });
    return { created: false, deduped: true };
  }

  console.log("VOICE_DIARY_NOTE_CREATE_START", { target_date: computed.target_date, note_hash: computed.note_hash });
  await notionFetch(env, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties: {
        [props.name]: { title: [{ text: { content: `Voice Diary ${computed.target_date}` } }] },
        [props.targetDate]: { date: { start: computed.target_date } },
        [props.recordedAt]: { date: { start: computed.recorded_at } },
        [props.text]: { rich_text: [{ text: { content: computed.text } }] },
        [props.source]: { select: { name: computed.source } },
        [props.noteHash]: { rich_text: [{ text: { content: computed.note_hash } }] },
        [props.status]: { select: { name: "new" } },
      },
    }),
  });
  console.log("VOICE_DIARY_NOTE_CREATE_DONE", { target_date: computed.target_date, note_hash: computed.note_hash });
  return { created: true, deduped: false };
};
