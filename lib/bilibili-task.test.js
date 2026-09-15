import test from 'node:test';
import assert from 'node:assert/strict';
import { splitLegacyBilibiliStorage } from './bilibili-task.js';

test('legacy shared Bilibili popular run moves to its own storage', () => {
  const saved = splitLegacyBilibiliStorage({
    draBilibili: {
      state: { status: 'paused', route: { platform: 'bilibili', surface: 'popular' }, runId: 'pop' },
      seen: ['BV1'],
      creators: ['123']
    },
    draBilibiliConfig: { settings: { target: { mode: 'count', maxItems: 40, durationMinutes: 60 } }, rules: {}, settingsDraft: null }
  });
  assert.equal(saved.draBilibili, undefined);
  assert.equal(saved.draBilibiliPopular.state.runId, 'pop');
  assert.deepEqual(saved.draBilibiliPopular.seen, ['BV1']);
  assert.equal(saved.draBilibiliPopularConfig.settings.target.maxItems, 40);
});

test('legacy recommend storage stays put and still clones config for popular', () => {
  const saved = splitLegacyBilibiliStorage({
    draBilibili: {
      state: { status: 'paused', route: { platform: 'bilibili', surface: 'recommend' }, runId: 'rec' },
      seen: ['BV2']
    },
    draBilibiliConfig: { settings: { dryRun: true }, rules: { version: 1 }, settingsDraft: null }
  });
  assert.equal(saved.draBilibili.state.runId, 'rec');
  assert.equal(saved.draBilibiliPopular, undefined);
  assert.equal(saved.draBilibiliPopularConfig.settings.dryRun, true);
  saved.draBilibiliPopularConfig.settings.dryRun = false;
  assert.equal(saved.draBilibiliConfig.settings.dryRun, true);
});
