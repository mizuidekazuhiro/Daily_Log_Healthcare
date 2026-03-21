import test from 'node:test';
import assert from 'node:assert/strict';

const service = await import('../workers/src/services/legacy_health_daily_service.ts');

const {
  normalizeHealthPayload,
  validateHealthPayload,
  buildHealthPartialProps,
} = service;

test('succeeds when no new optional fields are sent', () => {
  const payload = normalizeHealthPayload({
    date: '2026-03-21',
    sleep_duration_min: 585,
    sleep_source: 'autosleep',
    sleep_score: 100,
  });

  assert.equal(validateHealthPayload(payload), null);
  assert.deepEqual(buildHealthPartialProps(payload), {
    'Sleep Duration Min': { number: 585 },
    'Sleep Score': { number: 100 },
    'Sleep Source': { select: { name: 'autosleep' } },
  });
});

test('succeeds when some new optional fields are sent', () => {
  const payload = normalizeHealthPayload({
    date: '2026-03-21',
    rem_duration_min: '165',
    readiness_label: 'OK',
    sleep_heart_rate: '71',
  });

  assert.equal(validateHealthPayload(payload), null);
  assert.deepEqual(buildHealthPartialProps(payload), {
    'REM Duration Min': { number: 165 },
    'Sleep Heart Rate': { number: 71 },
    'Readiness Label': { select: { name: 'OK' } },
  });
});

test('succeeds when all new optional fields are sent', () => {
  const payload = normalizeHealthPayload({
    date: '2026-03-21',
    rem_duration_min: 165,
    deep_duration_min: 75,
    sleep_heart_rate: 71,
    readiness_stars: 3,
    readiness_hrv: 39,
    readiness_bpm: 69,
    baseline_hrv: 39,
    baseline_waking_bpm: 69,
    sleep_percent: 135,
    rem_percent: 204,
    deep_percent: 110,
    heart_rate_percent: 153,
    readiness_label: 'OK',
  });

  assert.equal(validateHealthPayload(payload), null);
  const props = buildHealthPartialProps(payload);
  assert.equal(Object.keys(props).length, 13);
  assert.deepEqual(props['Readiness Label'], { select: { name: 'OK' } });
  assert.deepEqual(props['Heart Rate Percent'], { number: 153 });
});

test('ignores empty, null, and unparseable optional additions while continuing', () => {
  const payload = normalizeHealthPayload({
    date: '2026-03-21',
    rem_duration_min: '',
    deep_duration_min: null,
    sleep_heart_rate: 'not-a-number',
    readiness_stars: undefined,
    readiness_label: '   ',
    sleep_score: 100,
  });

  assert.equal(validateHealthPayload(payload), null);
  assert.deepEqual(buildHealthPartialProps(payload), {
    'Sleep Score': { number: 100 },
  });
});

test('still validates sleep_start and sleep_end as ISO 8601 when present', () => {
  const valid = normalizeHealthPayload({
    date: '2026-03-21',
    sleep_start: '2026-03-20T22:53:00+09:00',
    sleep_end: '2026-03-21T08:33:00+09:00',
  });
  assert.equal(validateHealthPayload(valid), null);

  const invalid = normalizeHealthPayload({
    date: '2026-03-21',
    sleep_start: '2026/03/20 22:53',
  });
  assert.equal(
    validateHealthPayload(invalid),
    'sleep_start must be an ISO 8601 datetime string',
  );
});
