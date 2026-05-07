import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const svcSrc = await fs.readFile(new URL('../workers/src/services/voice_diary_note_service.ts', import.meta.url), 'utf8');
const handlerSrc = await fs.readFile(new URL('../workers/src/handlers/voice_diary_note_post.ts', import.meta.url), 'utf8');

test('同じNote Hash重複時は作成せず deduped=true の分岐がある', () => {
  assert.equal(svcSrc.includes('VOICE_DIARY_NOTE_DEDUPE_HIT'), true);
  assert.equal(svcSrc.includes('created: false, deduped: true'), true);
});

test('重複時もHTTP 200レスポンスを返す', () => {
  assert.equal(handlerSrc.includes('jsonResponse(200'), true);
  assert.equal(handlerSrc.includes('deduped: result.deduped'), true);
});

test('VOICE_DIARY_NOTES_DB_ID未設定は500', () => {
  assert.equal(handlerSrc.includes('Missing VOICE_DIARY_NOTES_DB_ID'), true);
  assert.equal(handlerSrc.includes('errorResponse(500'), true);
});

test('Notion API error時は502', () => {
  assert.equal(handlerSrc.includes('Notion API error'), true);
  assert.equal(handlerSrc.includes('errorResponse(502'), true);
});
