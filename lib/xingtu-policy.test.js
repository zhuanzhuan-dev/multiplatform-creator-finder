import test from 'node:test';
import assert from 'node:assert/strict';
import { xingtuPolicy, xingtuDelayMs } from './xingtu-policy.js';
import { canResumeRun } from './run-limits.js';

test('default policy bounds random delay and page batch', () => {
  assert.equal(xingtuPolicy({xingtuTarget:{maxItems:1000}}).maxPages, 50);
  assert.equal(xingtuDelayMs({}, () => 0), 4000);
  assert.equal(xingtuDelayMs({}, () => 1), 6000);
  assert.equal(xingtuDelayMs({xingtuDelay:{minSeconds:10,maxSeconds:20}}, () => 0.5), 15000);
});

test('Xingtu rest is resumable regardless of video count', () => {
  assert.equal(canResumeRun({route:{platform:'xingtu'},status:'paused',runId:'r',startedAt:'2026-09-15',runTarget:{mode:'pages',maxPages:50},stats:{scanned:2000},restUntil:Date.now()+10800000}), true);
});
