import test from "node:test";
import assert from "node:assert/strict";
import { nextScheduledOccurrence, validScheduleSlots, validateSchedule } from "./scheduler.js";

test("schedule normalizes duplicate weekdays and time slots", () => {
  assert.deepEqual(validScheduleSlots({
    weekdays: [2, 2, 6, 9],
    times: ["9:05", "09:05", "23:00", "25:00"]
  }), {
    weekdays: [2, 6],
    times: [
      { value: "09:05", hour: 9, minute: 5 },
      { value: "23:00", hour: 23, minute: 0 }
    ]
  });
});

test("schedule selects the next configured local occurrence", () => {
  const from = new Date(2026, 8, 1, 12, 0, 0, 0);
  const expected = new Date(2026, 8, 1, 13, 30, 0, 0).getTime();
  const occurrence = nextScheduledOccurrence({ enabled: true, weekdays: [2], times: ["11:15", "13:30"] }, from.getTime());
  assert.equal(occurrence?.scheduledTime, expected);
});

test("disabled schedule accepts an empty plan", () => {
  assert.deepEqual(validateSchedule({ enabled: false, weekdays: [], times: [], lateToleranceMinutes: -1 }), []);
});
