import test from 'node:test';
import assert from 'node:assert/strict';

const { createVoiceDiaryNote } = await import('../workers/src/services/voice_diary_note_service.ts');
const { handleVoiceDiaryNotePost } = await import('../workers/src/handlers/voice_diary_note_post.ts');

const env = { NOTION_TOKEN: 't', HEALTH_API_KEY: 'k', VOICE_DIARY_NOTES_DB_ID: 'db' };

test('重複時はNotion createが呼ばれず created=false deduped=true', async () => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ results: [{ id: 'dup1' }], has_more: false, next_cursor: null }), { status: 200 });
  };
  const r = await createVoiceDiaryNote(env, { text: 'x', source: 'ios_shortcut_voice', recorded_at: '2026-05-07T18:10:00+09:00', target_date: '2026-05-07', note_hash: 'h' });
  assert.deepEqual(r, { created: false, deduped: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.includes('/databases/db/query'), true);
  globalThis.fetch = orig;
});

test('新規作成時は/pages POSTされ payloadにStatus=newを含む', async () => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/databases/db/query')) return new Response(JSON.stringify({ results: [], has_more: false, next_cursor: null }), { status: 200 });
    if (String(url).includes('/pages')) return new Response(JSON.stringify({ id: 'new1' }), { status: 200 });
    return new Response('not found', { status: 404 });
  };
  const c = { text: '本文', source: 'manual', recorded_at: '2026-05-07T18:10:00+09:00', target_date: '2026-05-07', note_hash: 'hash-1' };
  const r = await createVoiceDiaryNote(env, c);
  assert.deepEqual(r, { created: true, deduped: false });
  const createCall = calls.find((x) => x.url.includes('/pages'));
  assert.ok(createCall);
  const body = JSON.parse(createCall.init.body);
  const props = body.properties;
  assert.equal(props.Name.title[0].text.content, 'Voice Diary 2026-05-07');
  assert.equal(props['Target Date'].date.start, c.target_date);
  assert.equal(props['Recorded At'].date.start, c.recorded_at);
  assert.equal(props.Text.rich_text[0].text.content, c.text);
  assert.equal(props.Source.select.name, c.source);
  assert.equal(props['Note Hash'].rich_text[0].text.content, c.note_hash);
  assert.equal(props.Status.select.name, 'new');
  globalThis.fetch = orig;
});

test('Notion API errorはhandlerで502', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response('boom', { status: 500 });
  const req = new Request('https://x/api/voice-diary/note', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'abc', recorded_at: '2026-05-07T18:10:00+09:00' }) });
  const res = await handleVoiceDiaryNotePost(req, env);
  assert.equal(res.status, 502);
  globalThis.fetch = orig;
});

test('VOICE_DIARY_NOTES_DB_ID未設定は500相当', async () => {
  const req = new Request('https://x/api/voice-diary/note', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'abc', recorded_at: '2026-05-07T18:10:00+09:00' }) });
  const res = await handleVoiceDiaryNotePost(req, { ...env, VOICE_DIARY_NOTES_DB_ID: undefined });
  assert.equal(res.status, 500);
});

test('body=null と body=[] は400', async () => {
  const req1 = new Request('https://x/api/voice-diary/note', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null' });
  const req2 = new Request('https://x/api/voice-diary/note', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]' });
  const r1 = await handleVoiceDiaryNotePost(req1, env);
  const r2 = await handleVoiceDiaryNotePost(req2, env);
  assert.equal(r1.status, 400);
  assert.equal(r2.status, 400);
});
