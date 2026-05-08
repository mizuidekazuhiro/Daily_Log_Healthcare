import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const legacy = fs.readFileSync('workers/src/legacy.ts', 'utf8');

test('no fixed duplicate count constant remains', () => {
  assert.equal(legacy.includes('const duplicateCount = 0;'), false);
  assert.equal(legacy.includes('const duplicateCount = pageResult.duplicateCount;'), true);
});

test('canonical candidate query includes Date / Target Date / legacy title variants', () => {
  assert.equal(legacy.includes('{ property: dateProp, date: { equals: date } }'), true);
  assert.equal(legacy.includes('{ property: targetDateProp, date: { equals: date } }'), true);
  assert.equal(legacy.includes('Daily Log｜${date}'), true);
  assert.equal(legacy.includes('Daily Log | ${date}'), true);
});

test('duplicate meal photos are merged into canonical existing files and diagnostics returned', () => {
  assert.equal(legacy.includes('mergedDuplicateMealPhotosCount += 1;'), true);
  assert.equal(legacy.includes('existingState.existingFiles.push(file);'), true);
  assert.equal(legacy.includes('meal_photos_merged_count: pageResult.mergedDuplicateMealPhotosCount'), true);
  assert.equal(legacy.includes('action = newFiles.length === 0 && pageResult.mergedDuplicateMealPhotosCount > 0 ? "merged_duplicates" : "added"'), true);
});

test('no target files still resolves canonical and can return merged_duplicates', () => {
  assert.equal(legacy.includes('if (targetFiles.length === 0)'), true);
  assert.equal(legacy.includes('action: needsPatch ? "merged_duplicates" : "no_files"'), true);
  assert.equal(legacy.includes('const needsPatch = pageResult.mergedDuplicateMealPhotosCount > 0;'), true);
  assert.equal(legacy.includes('`https://api.notion.com/v1/pages/${pageResult.pageId}`'), true);
});

test('no top-level misplaced targetFiles block after handleLegacyRoute', () => {
  const routeIdx = legacy.lastIndexOf('export const handleLegacyRoute');
  const misplacedIdx = legacy.indexOf('if (targetFiles.length === 0)', routeIdx);
  assert.equal(misplacedIdx, -1);
});

test('targetFiles zero branch appears after ensureDailyLogPageByDate in runMealPhotos', () => {
  const ensureIdx = legacy.indexOf('const pageResult = await ensureDailyLogPageByDate(env, targetDate);');
  const zeroIdx = legacy.indexOf('if (targetFiles.length === 0)', ensureIdx);
  assert.equal(ensureIdx > -1, true);
  assert.equal(zeroIdx > ensureIdx, true);
  assert.equal(legacy.includes('const needsPatch = pageResult.mergedDuplicateMealPhotosCount > 0;'), true);
  assert.equal(legacy.includes('action: needsPatch ? "merged_duplicates" : "no_files"'), true);
});

test('dropbox url normalization ignores raw/dl differences', () => {
  assert.equal(legacy.includes('u.searchParams.delete("raw")'), true);
  assert.equal(legacy.includes('u.searchParams.delete("dl")'), true);
});
