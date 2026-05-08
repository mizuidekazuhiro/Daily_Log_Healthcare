import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const wrangler = fs.readFileSync('wrangler.toml', 'utf8');
const legacy = fs.readFileSync('workers/src/legacy.ts', 'utf8');

test('wrangler.toml title prop defaults match database roles', () => {
  assert.equal(wrangler.includes('HEALTH_TITLE_PROP = "Name"'), true);
  assert.equal(wrangler.includes('DAILY_LOG_TITLE_PROP = "Name"'), false);
  assert.equal(wrangler.includes('HEALTH_TITLE_PROP = "名前"'), false);
  assert.equal(wrangler.includes('DAILY_LOG_TITLE_PROP = "名前"'), true);
});

test('new page creation uses resolved titleProp key', () => {
  assert.match(legacy, /\[titleProp\]: \{\s*\n\s*title:/m);
  assert.equal(legacy.includes('Daily Log｜${date}'), true);
  assert.equal(legacy.includes('[targetDateProp]'), true);
});

test('meal photos resolver defaults daily log title to 名前 and health remains Name in wrangler', () => {
  assert.equal(legacy.includes('titleProp: env.DAILY_LOG_TITLE_PROP ?? "名前"'), true);
  assert.equal(wrangler.includes('HEALTH_TITLE_PROP = "Name"'), true);
});

test('schema preflight exception is not misclassified as Dropbox token refresh failure', () => {
  assert.match(legacy, /error: "Daily Log schema preflight failed"/);
  assert.match(legacy, /error: "Dropbox token refresh failed"/);
  assert.match(legacy, /schemaCheck = await validateDailyLogSchema\(env\)/);
});
