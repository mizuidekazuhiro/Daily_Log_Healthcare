import test from 'node:test';
import assert from 'node:assert/strict';

const service = await import('../workers/src/services/legacy_health_daily_service.ts');

const {
  normalizeHealthPayload,
  validateHealthPayload,
  buildHealthPartialProps,
  upsertHealthDailyPage,
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
    'Readiness Label': {
      rich_text: [
        {
          type: 'text',
          text: { content: 'OK' },
        },
      ],
    },
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
  assert.deepEqual(props['Readiness Label'], {
    rich_text: [
      {
        type: 'text',
        text: { content: 'OK' },
      },
    ],
  });
  assert.deepEqual(props['Heart Rate Percent'], { number: 1.53 });
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

const env = { NOTION_TOKEN: 'test-token', HEALTH_DB_ID: 'health-db' };

for (const [name, input] of [
  ['date only', { date: '2026-10-14' }],
  ['metadata only', { date: '2026-10-14', source: 'healthkit', sleep_source: 'autosleep', readiness_label: 'OK' }],
  ['empty and unparseable values', { date: '2026-10-14', source: 'healthkit', sleep_duration_min: '', sleep_score: 'invalid', readiness_hrv: null, kcal: {} }],
  ['nested empty Shortcut values', { '': { date: { '': '2026-10-14' }, source: { '': 'healthkit' }, sleep_duration_min: { '': '' } } }],
]) {
  test(`rejects ${name} before querying or mutating Notion`, async () => {
    const payload = normalizeHealthPayload(input);
    assert.equal(validateHealthPayload(payload), null);
    let calls = 0;
    const result = await upsertHealthDailyPage(env, payload, async () => {
      calls += 1;
      throw new Error('empty input must not reach Notion');
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 422);
    assert.equal(result.body.error_code, 'health_measurements_empty');
    assert.equal(calls, 0);
    assert.equal(JSON.stringify(result.body).includes('healthkit'), false);
  });
}

for (const existing of [false, true]) {
  for (const [field, value, property, saved] of [
    ['sleep_duration_min', '374', 'Sleep Duration Min', { number: 374 }],
    ['weight', 60, 'Weight', { number: 60 }],
    ['kcal', 0, 'Kcal', { number: 0 }],
    ['rem_duration_min', 45, 'REM Duration Min', { number: 45 }],
    ['sleep_start', '2026-10-13T23:00:00+09:00', 'Sleep Start', { date: { start: '2026-10-13T23:00:00+09:00' } }],
  ]) {
    test(`${existing ? 'updates' : 'creates'} valid ${field}-only input without filling missing values`, async () => {
      const payload = normalizeHealthPayload({ date: '2026-10-14', [field]: value });
      assert.equal(validateHealthPayload(payload), null);
      const calls = [];
      const result = await upsertHealthDailyPage(env, payload, async (url, options) => {
        calls.push({ url, ...options, body: JSON.parse(options.body) });
        return { ok: true, json: calls.length === 1 ? { results: existing ? [{ id: 'existing-page' }] : [] } : { id: 'new-page' } };
      });
      assert.deepEqual(result, { ok: true, action: existing ? 'updated' : 'created', date: '2026-10-14' });
      assert.equal(calls.length, 2);
      assert.ok(calls[0].url.endsWith('/databases/health-db/query'));
      assert.deepEqual(calls[0].body.filter, { property: 'Date', date: { equals: '2026-10-14' } });
      assert.equal(calls[1].method, existing ? 'PATCH' : 'POST');
      const properties = calls[1].body.properties;
      assert.deepEqual(properties[property], saved);
      assert.deepEqual(Object.keys(properties).sort(), existing ? [property] : ['Name', 'Date', property].sort());
    });
  }
}
