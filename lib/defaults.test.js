import test from "node:test";
import assert from "node:assert/strict";
import { mergeSettings, validateSettings } from "./defaults.js";

test("cloud upload stays enabled by default", () => {
  assert.equal(mergeSettings().cloud.enabled, true);
  assert.equal(mergeSettings({}).cloud.enabled, true);
});

test("old bridge.enabled migrates to cloud.enabled", () => {
  assert.equal(mergeSettings({ bridge: { enabled: false } }).cloud.enabled, false);
  assert.equal(mergeSettings({ bridge: { enabled: true } }).cloud.enabled, true);
});

test("explicit cloud.enabled wins over leftover bridge settings", () => {
  assert.equal(mergeSettings({
    cloud: { enabled: true },
    bridge: { enabled: false },
  }).cloud.enabled, true);
});

test("legacy dwell and task limits migrate into the new settings model", () => {
  const settings = mergeSettings({ dwellSeconds: 42, runMinutes: 75, maxItemsPerRun: 240 });
  assert.equal(settings.dwell.fixedSeconds, 42);
  assert.equal(settings.target.durationMinutes, 75);
  assert.equal(settings.target.maxItems, 240);
});

test("scheduled runs discard the legacy foreground-focus setting", () => {
  const settings = mergeSettings({ schedule: { focusTab: true } });
  assert.equal("focusTab" in settings.schedule, false);
});

test("disabled schedule does not block a valid manual task", () => {
  const settings = mergeSettings({
    schedule: { enabled: false, target: { mode: "count", maxItems: 0 } }
  });
  assert.deepEqual(validateSettings(settings), []);
});

test("only the active dwell policy is validated", () => {
  const fixed = mergeSettings({ dwell: { mode: "fixed", fixedSeconds: 30, minSeconds: 1 } });
  assert.deepEqual(validateSettings(fixed), []);

  const range = mergeSettings({ dwell: { mode: "range", minSeconds: 10, typicalSeconds: 15, maxSeconds: 30 } });
  assert.deepEqual(validateSettings(range), []);
});
