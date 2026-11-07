import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHealthPayload, validateHealthPayload, buildHealthPartialProps, hasHealthMeasurements,
} from '../workers/src/services/legacy_health_daily_pure.ts';

test('metadata, unparseable input, and explicit zero remain distinct', () => {
  for (const raw of [
    { date: '2026-11-06', source: 'shortcut' },
    { date: '2026-11-06', sleep_duration_min: 'unknown' },
  ]) {
    const payload = normalizeHealthPayload(raw);
    assert.equal(hasHealthMeasurements(payload), false);
    assert.equal('Sleep Duration Min' in buildHealthPartialProps(payload), false);
  }
  const zero = normalizeHealthPayload({ date: '2026-11-06', sleep_awakenings: 0 });
  assert.equal(hasHealthMeasurements(zero), true);
  assert.deepEqual(buildHealthPartialProps(zero), { 'Sleep Awakenings': { number: 0 } });
});

test('timestamp-only sleep is a measurement and invalid timestamp fails validation', () => {
  const valid = normalizeHealthPayload({ date: '2026-11-06', sleep_start: '2026-11-06T23:00:00+09:00' });
  assert.equal(hasHealthMeasurements(valid), true);
  assert.equal(validateHealthPayload(valid), null);
  assert.deepEqual(buildHealthPartialProps(valid), { 'Sleep Start': { date: { start: '2026-11-06T23:00:00+09:00' } } });
  const invalid = normalizeHealthPayload({ date: '2026-11-06', sleep_start: 'yesterday' });
  assert.equal(hasHealthMeasurements(invalid), false);
  assert.match(validateHealthPayload(invalid), /ISO 8601/);
});

test('shortcut wrappers and percent scale keep their existing field semantics', () => {
  const normalized = normalizeHealthPayload({ '': {
    date: { '': ' 2026-11-06 ' }, weight: { '': '1,000' }, sleep_percent: '125', readiness_label: ' OK ',
  } });
  assert.equal(validateHealthPayload(normalized), null);
  assert.equal(normalized.date, '2026-11-06');
  assert.deepEqual(buildHealthPartialProps(normalized), {
    Weight: { number: 1000 }, 'Sleep Percent': { number: 1.25 },
    'Readiness Label': { rich_text: [{ type: 'text', text: { content: 'OK' } }] },
  });
});
