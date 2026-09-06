import test from "node:test";
import assert from "node:assert/strict";
import { createRunWaits, runtimeStalled, stepBudget, withTimeout } from "./runtime-health.js";

function clock() {
  let now = 1_000;
  let next = 0;
  const timers = new Map();
  return {
    now: () => now,
    schedule: (callback, ms) => { const id = ++next; timers.set(id, { callback, at: now + ms }); return id; },
    unschedule: (id) => timers.delete(id),
    advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } }
  };
}

test("worker waits use absolute deadlines even when wakeups are delayed", async () => {
  const time = clock();
  const waits = createRunWaits(time);
  const pending = waits.wait(31_000);
  time.advance(75_000);
  assert.deepEqual(await pending, { ok: true, wokeAt: 76_000 });
  assert.equal(waits.size, 0);
});

test("canceling a generation resolves all waits without waking stale work", async () => {
  const time = clock();
  const waits = createRunWaits(time);
  const first = waits.wait(100_000);
  const second = waits.wait(2_000);
  waits.cancel();
  assert.equal((await first).ok, false);
  assert.equal((await second).ok, false);
  time.advance(200_000);
  assert.equal(waits.size, 0);
});

test("long dwell is healthy until its deadline; profile retries have bounded budget", () => {
  const budget = stepBudget("dwell", {}, 301_000, 1_000);
  assert.equal(budget, 300_000);
  assert.equal(runtimeStalled({ deadlineAt: 301_000 }, 200_000), false);
  assert.equal(runtimeStalled({ deadlineAt: 301_000 }, 316_001), true);
  assert.equal(stepBudget("profile", { panelRecoveryAttempts: 5 }), 200_000);
  assert.throws(() => stepBudget("dwell", {}, Infinity));
  assert.throws(() => stepBudget("unknown"));
});

test("unresponsive page messages cannot hold watchdog forever", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 5), /页面响应超时/);
  assert.equal(await withTimeout(Promise.resolve("ready"), 5), "ready");
});
