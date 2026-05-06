import test from 'node:test';
import assert from 'node:assert/strict';

const svc = await import('../workers/src/services/app_usage_session_pure.ts');

const { normalizeAppUsagePayload, validateAndComputeAppUsage, isIso8601DateTimeString, getPreviousJstDateFrom } = svc;

const base = {
  app: 'Anki', session_id: 's1', started_at: '2026-05-06T01:00:00+09:00', ended_at: '2026-05-06T01:40:00+09:00', day_start_hour: 3,
};

test('target date after 03:00 JST is same day', () => {
  const n = normalizeAppUsagePayload({ ...base, ended_at: '2026-05-06T14:05:00+09:00' });
  const r = validateAndComputeAppUsage(n);
  assert.equal(r.target_date, '2026-05-06');
});



test('target date handles midnight hour as previous day when day_start_hour is 3', () => {
  const n = normalizeAppUsagePayload({ ...base, started_at: '2026-05-06T00:00:00+09:00', ended_at: '2026-05-06T00:30:00+09:00', day_start_hour: 3 });
  const r = validateAndComputeAppUsage(n);
  assert.equal(r.target_date, '2026-05-05');
});


test('target date before 03:00 JST is previous day', () => {
  const n = normalizeAppUsagePayload({ ...base, ended_at: '2026-05-06T02:05:00+09:00' });
  const r = validateAndComputeAppUsage(n);
  assert.equal(r.target_date, '2026-05-05');
});

test('invalid ISO datetime is rejected', () => {
  assert.equal(isIso8601DateTimeString('2026/05/06 02:05'), false);
});

test('ended_at before started_at is rejected', () => {
  const r = validateAndComputeAppUsage(normalizeAppUsagePayload({ ...base, started_at: '2026-05-06T10:00:00+09:00', ended_at: '2026-05-06T09:00:00+09:00' }));
  assert.equal(r.error, 'ended_at must be later than started_at');
});

test('duration below 30 seconds is ignored', () => {
  const r = validateAndComputeAppUsage(normalizeAppUsagePayload({ ...base, started_at: '2026-05-06T10:00:00+09:00', ended_at: '2026-05-06T10:00:20+09:00' }));
  assert.equal(r.ignored, true);
});

test('duration above six hours is capped', () => {
  const r = validateAndComputeAppUsage(normalizeAppUsagePayload({ ...base, started_at: '2026-05-06T00:00:00+09:00', ended_at: '2026-05-06T10:00:00+09:00' }));
  assert.equal(r.duration_seconds, 21600);
});

test('payload duration mismatch uses computed duration', () => {
  const n = normalizeAppUsagePayload({ ...base, duration_seconds: 1 });
  const r = validateAndComputeAppUsage(n);
  assert.equal(r.duration_seconds, 2400);
});

test('normalization handles iOS Shortcuts nested dictionary shape', () => {
  const n = normalizeAppUsagePayload({ '': { app: { '': 'Anki' }, session_id: { '': 'abc' }, started_at: { '': '2026-05-06T10:00:00+09:00' }, ended_at: { '': '2026-05-06T10:40:00+09:00' } } });
  assert.equal(n.app, 'Anki');
  assert.equal(n.session_id, 'abc');
});


test('aggregation dedupes duplicate Session ID rows and latest edited wins', () => {
  const rows = [
    {
      last_edited_time: '2026-05-06T10:00:00.000Z',
      properties: {
        'Session ID': { rich_text: [{ plain_text: 'dup-1' }] },
        'Duration Min': { number: 40 },
        'End At': { date: { start: '2026-05-06T13:40:00+09:00' } },
      },
    },
    {
      last_edited_time: '2026-05-06T11:00:00.000Z',
      properties: {
        'Session ID': { rich_text: [{ plain_text: 'dup-1' }] },
        'Duration Min': { number: 40 },
        'End At': { date: { start: '2026-05-06T14:00:00+09:00' } },
      },
    },
  ];
  const agg = svc.aggregateAnkiRowsDedupBySessionId(rows, { sessionId: 'Session ID', durationMin: 'Duration Min', endAt: 'End At' }, '2026-05-06');
  assert.equal(agg.minutes, 40);
  assert.equal(agg.sessions, 1);
  assert.equal(agg.last, '2026-05-06T14:00:00+09:00');
});


test('previous JST date helper uses scheduled UTC time correctly', () => {
  const r = getPreviousJstDateFrom(Date.parse('2026-05-06T18:00:00Z'));
  assert.equal(r, '2026-05-06');
});
