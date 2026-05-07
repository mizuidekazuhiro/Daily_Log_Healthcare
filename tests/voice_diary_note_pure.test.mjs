import test from 'node:test';
import assert from 'node:assert/strict';

const pure = await import('../workers/src/services/voice_diary_note_pure.ts');

test('textなしは400相当エラー', async () => {
  const r = await pure.validateAndComputeVoiceDiary(pure.normalizeVoiceDiaryPayload({}));
  assert.equal(r.error, 'text is required');
});

test('空textは400相当エラー', async () => {
  const r = await pure.validateAndComputeVoiceDiary(pure.normalizeVoiceDiaryPayload({ text: '   ' }));
  assert.equal(r.error, 'text is required');
});

test('recorded_atなしなら現在時刻JST補完', async () => {
  const now = new Date('2026-05-07T09:10:11Z');
  const r = await pure.validateAndComputeVoiceDiary(pure.normalizeVoiceDiaryPayload({ text: 'メモ' }), now);
  assert.equal(r.recorded_at, '2026-05-07T18:10:11+09:00');
});

test('recorded_at不正はエラー', async () => {
  const r = await pure.validateAndComputeVoiceDiary(pure.normalizeVoiceDiaryPayload({ text: 'x', recorded_at: '2026/05/07 18:10' }));
  assert.equal(r.error, 'recorded_at must be an ISO 8601 datetime string');
});

test('target_dateなしならJST+day_start_hourで算出', async () => {
  const r = await pure.validateAndComputeVoiceDiary(pure.normalizeVoiceDiaryPayload({ text: 'x', recorded_at: '2026-05-07T18:10:00+09:00', day_start_hour: 3 }));
  assert.equal(r.target_date, '2026-05-07');
});

test('深夜2:30かつday_start_hour=3なら前日', async () => {
  const r = await pure.validateAndComputeVoiceDiary(pure.normalizeVoiceDiaryPayload({ text: 'x', recorded_at: '2026-05-07T02:30:00+09:00', day_start_hour: 3 }));
  assert.equal(r.target_date, '2026-05-06');
});


test('source未指定はios_shortcut_voice', async () => {
  const r = await pure.validateAndComputeVoiceDiary(pure.normalizeVoiceDiaryPayload({ text: 'x', recorded_at: '2026-05-07T18:10:00+09:00' }));
  assert.equal(r.source, 'ios_shortcut_voice');
});

test('source不正値は400相当エラー', async () => {
  const r = await pure.validateAndComputeVoiceDiary(pure.normalizeVoiceDiaryPayload({ text: 'x', recorded_at: '2026-05-07T18:10:00+09:00', source: 'invalid' }));
  assert.equal(r.error, 'source must be one of ios_shortcut_voice, manual, test');
});

test('target_date=2026-02-30は無効', async () => {
  const r = await pure.validateAndComputeVoiceDiary(pure.normalizeVoiceDiaryPayload({ text: 'x', recorded_at: '2026-05-07T18:10:00+09:00', target_date: '2026-02-30' }));
  assert.equal(r.error, 'target_date must be a valid YYYY-MM-DD date');
});
