import assert from "node:assert/strict";
import test from "node:test";
import { canResumeRun, elapsedRunMs, getRunLimitReason, normalizeRunTarget } from "./run-limits.js";

test("count target stops scheduled and manual runs", () => {
  const state = { runTrigger: "schedule", runTarget: { mode: "count", maxItems: 20 }, stats: { scanned: 20 } };
  assert.match(getRunLimitReason(state, {}), /20\/20/);
});

test("time target ignores the video count", () => {
  const state = { runTarget: { mode: "time", durationMinutes: 30, maxItems: 2 }, stopAt: 2_000, stats: { scanned: 99 } };
  assert.equal(getRunLimitReason(state, {}, 1_000), "");
  assert.match(getRunLimitReason(state, {}, 2_000), /30分钟/);
});

test("both target stops at whichever limit is reached first", () => {
  const target = normalizeRunTarget({ mode: "both", durationMinutes: 45, maxItems: 12 });
  assert.equal(target.maxItems, 12);
  assert.match(getRunLimitReason({ runTarget: target, stopAt: 9_999, stats: { scanned: 12 } }, {}, 1_000), /数量目标/);
});


test('active duration freezes while paused and supports persisted runs from before resume support', () => {
  assert.equal(elapsedRunMs({ status: 'running', elapsedMs: 60000, activeSince: 100000 }, 105000), 65000);
  assert.equal(elapsedRunMs({ status: 'paused', elapsedMs: 60000, activeSince: null }, 900000), 60000);
  const legacy = { status: 'paused', runId: 'old', startedAt: new Date(1000).toISOString(), endedAt: new Date(61000).toISOString(), runTarget: { mode: 'time', durationMinutes: 5 } };
  assert.equal(elapsedRunMs(legacy, 900000), 60000);
  assert.equal(canResumeRun(legacy), true);
  assert.equal(canResumeRun({ ...legacy, runTarget: { mode: 'count', maxItems: 3 }, stats: { scanned: 3 } }), false);
});
