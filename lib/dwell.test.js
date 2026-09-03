import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDwellPolicy, sampleDwellSeconds } from "./dwell.js";

test("fixed dwell keeps the configured duration", () => {
  assert.equal(sampleDwellSeconds({ mode: "fixed", fixedSeconds: 30 }, () => 0.2), 30);
});

test("range dwell uses an intuitive min, typical, max distribution", () => {
  const policy = { mode: "range", minSeconds: 10, typicalSeconds: 15, maxSeconds: 30 };
  const samples = [0, 0.1, 0.25, 0.5, 0.9, 0.999].map((value) => sampleDwellSeconds(policy, () => value));
  assert.ok(samples.every((value) => value >= 10 && value <= 30));
  assert.equal(samples[0], 10);
  assert.ok(samples[2] <= 20);
});

test("invalid dwell values normalize into safe bounds", () => {
  assert.deepEqual(normalizeDwellPolicy({ mode: "range", minSeconds: 1, typicalSeconds: 999, maxSeconds: 20 }), {
    mode: "range",
    fixedSeconds: 30,
    minSeconds: 5,
    typicalSeconds: 20,
    maxSeconds: 20
  });
});
