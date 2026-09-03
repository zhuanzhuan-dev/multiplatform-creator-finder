import assert from "node:assert/strict";
import test from "node:test";
import { getRunLimitReason, normalizeRunTarget } from "./run-limits.js";

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
