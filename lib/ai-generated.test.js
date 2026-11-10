import test from "node:test";
import assert from "node:assert/strict";
import { emptyAiGenerated, normalizeAiGeneratedAction, recordAiGenerated, aiGeneratedEffect, aiGeneratedStatusText } from "./ai-generated.js";

const hint = "作者声明：内容由 AI 生成";

test("the first official AI card is already over half and uses not interested", () => {
  const step = recordAiGenerated(emptyAiGenerated(), { fingerprint: "a", hint, action: "short-dwell", dwellSeconds: 5 });
  assert.equal(step.hit, true);
  assert.equal(step.action, "not-interested");
  assert.equal(step.dwellSeconds, 0);
  assert.equal(step.counter.seen, 1);
  assert.equal(step.counter.hits, 1);
  assert.equal(step.counter.switched, true);
  assert.equal(aiGeneratedStatusText(step.counter), "1/1，已自动改为不感兴趣");
});

test("exactly half keeps the selected action, and the next AI card switches", () => {
  let counter = recordAiGenerated(emptyAiGenerated(), { fingerprint: "a", hint: "", action: "short-dwell", dwellSeconds: 5 }).counter;
  const half = recordAiGenerated(counter, { fingerprint: "b", hint, action: "short-dwell", dwellSeconds: 5 });
  assert.equal(half.counter.seen, 2);
  assert.equal(half.counter.hits, 1);
  assert.equal(half.counter.switched, false);
  assert.equal(half.action, "short-dwell");
  assert.equal(half.dwellSeconds, 5);
  const over = recordAiGenerated(half.counter, { fingerprint: "c", hint: "AI生成", action: "skip", dwellSeconds: 5 });
  assert.equal(over.counter.hits / over.counter.seen, 2 / 3);
  assert.equal(over.action, "not-interested");
  assert.equal(aiGeneratedEffect(over.counter, "c", "skip"), "not-interested");
});

test("a minority of AI cards keeps short dwell or fast skip", () => {
  let counter = emptyAiGenerated();
  counter = recordAiGenerated(counter, { fingerprint: "a", hint: "", action: "short-dwell", dwellSeconds: 5 }).counter;
  counter = recordAiGenerated(counter, { fingerprint: "b", hint: "", action: "short-dwell", dwellSeconds: 5 }).counter;
  const dwell = recordAiGenerated(counter, { fingerprint: "c", hint, action: "short-dwell", dwellSeconds: 5 });
  assert.equal(dwell.action, "short-dwell");
  assert.equal(dwell.dwellSeconds, 5);
  const skip = recordAiGenerated(dwell.counter, { fingerprint: "d", hint: "", action: "skip", dwellSeconds: 5 }).counter;
  const fast = recordAiGenerated(skip, { fingerprint: "e", hint, action: "skip", dwellSeconds: 8 });
  assert.equal(fast.counter.hits / fast.counter.seen, 2 / 5);
  assert.equal(fast.action, "skip");
  assert.equal(fast.dwellSeconds, 0);
});

test("the same card is counted once and a caption is not an AI hit", () => {
  const first = recordAiGenerated(emptyAiGenerated(), { fingerprint: "a", hint, action: "skip", dwellSeconds: 5 });
  const again = recordAiGenerated(first.counter, { fingerprint: "a", hint: "", action: "short-dwell", dwellSeconds: 5 });
  assert.equal(again.counter.seen, 1);
  assert.equal(again.counter.hits, 1);
  assert.equal(again.action, "not-interested");
  const caption = recordAiGenerated(emptyAiGenerated(), { fingerprint: "b", hint: "#即梦AI", action: "not-interested", dwellSeconds: 5 });
  assert.equal(caption.hit, false);
  assert.equal(caption.counter.hits, 0);
  assert.equal(caption.counter.seen, 1);
  assert.equal(caption.action, null);
  assert.equal(aiGeneratedEffect(caption.counter, "b", "not-interested"), null);
});

test("cards without the official label stay on their normal path while the switch is active", () => {
  let counter = recordAiGenerated(emptyAiGenerated(), { fingerprint: "a", hint, action: "short-dwell", dwellSeconds: 5 }).counter;
  counter = recordAiGenerated(counter, { fingerprint: "b", hint, action: "short-dwell", dwellSeconds: 5 }).counter;
  const ordinary = recordAiGenerated(counter, { fingerprint: "c", hint: "个人观点，仅供参考", action: "short-dwell", dwellSeconds: 5 });
  assert.equal(ordinary.hit, false);
  assert.equal(ordinary.action, null);
  assert.equal(ordinary.counter.switched, true);
  assert.equal(ordinary.counter.seen, 3);
  assert.equal(ordinary.counter.hits, 2);
  assert.equal(normalizeAiGeneratedAction("fly"), "short-dwell");
  assert.equal(aiGeneratedStatusText(emptyAiGenerated()), "0/0");
});
