import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDwellPolicy, sampleDwellSeconds } from "./dwell.js";

test("fixed dwell keeps the configured duration", () => {
  assert.equal(sampleDwellSeconds({ mode: "fixed", fixedSeconds: 30 }, () => 0.2), 30);
});

test("range samples form a bounded normal distribution around the center", () => {
  let seed = 912;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const samples = Array.from({ length: 20000 }, () => sampleDwellSeconds({ mode: "range", minSeconds: 10, typicalSeconds: 20, maxSeconds: 30 }, random));
  assert.ok(samples.every(n => n >= 10 && n <= 30));
  assert.ok(new Set(samples).size > 100, "continuous values rather than three discrete durations");
  const mean = samples.reduce((a,b)=>a+b,0) / samples.length;
  const std = Math.sqrt(samples.reduce((a,b)=>a+(b-mean)**2,0) / samples.length);
  assert.ok(Math.abs(mean-20)<0.1);
  assert.ok(std>3.15 && std<3.4, `standard deviation ${std}`);
  const center = samples.filter(n=>Math.abs(n-20)<=10/3).length / samples.length;
  assert.ok(center>0.66 && center<0.70, `mass within one sigma ${center}`);
});

test("equal range endpoints return that endpoint, not the fixed duration", () => {
  assert.equal(sampleDwellSeconds({mode:"range",minSeconds:12,maxSeconds:12,fixedSeconds:30}),12);
});

test("skewed centers and pathological random inputs stay bounded", () => {
  for (const center of [10,11,29,30]) {
    for (const random of [()=>0,()=>1,()=>NaN,()=>0.5]) {
      const n=sampleDwellSeconds({mode:"range",minSeconds:10,typicalSeconds:center,maxSeconds:30},random);
      assert.ok(Number.isFinite(n) && n>=10 && n<=30);
    }
  }
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
