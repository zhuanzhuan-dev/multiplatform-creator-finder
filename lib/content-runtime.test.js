import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { contentSkipDecision } from "./content-type.js";
import { evaluateVideoRules, evaluateCreatorRules } from "./rule-engine.js";
import { DEFAULT_RULES } from "./defaults.js";
import { readFile } from "node:fs/promises";

const source = (await readFile(new URL("../content/douyin-content.js", import.meta.url), "utf8"))
  .replace('import { captureCurrentRaw, rawCaptureEnabled } from "./raw-capture.js";', 'const rawCaptureEnabled=()=>false;')
  .replace('import { contentSkipDecision } from "../lib/content-type.js";', '')
  .replace('import { evaluateVideoRules, evaluateCreatorRules } from "../lib/rule-engine.js";', '')
  .replace('import { sampleDwellSeconds } from "../lib/dwell.js";', 'const sampleDwellSeconds = () => 5;');

function page(parser = {}) {
  const sent = [];
  let listener;
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const context = {
    contentSkipDecision, evaluateVideoRules, evaluateCreatorRules, AbortController, Date: Clock, Promise, crypto: globalThis.crypto,
    location: { search: "?recommend=1", href: "https://www.douyin.com/?recommend=1" },
    document: { visibilityState: "hidden", hasFocus: () => false },
    DouyinAutoFinderParser: {
      parseCurrentFeed: () => ({ blockedReason: "fixture blocked" }),
      creatorPanelState: () => ({}),
      ...parser
    },
    chrome: { runtime: {
      onMessage: { addListener: (fn) => { listener = fn; } },
      sendMessage: (message, callback) => { sent.push({ message, callback: (response) => { if (message.type === "DRA_WAIT" && response.ok) now = Math.max(now, message.until); callback(response); } }); }
    } }
  };
  vm.runInNewContext(source, context);
  return {
    sent,
    message(message) { let result; listener(message, {}, (value) => { result = value; }); return result; }
  };
}

const drain = () => new Promise((resolve) => setImmediate(resolve));
test("replacing a loop cancels the previous wait even within the same run", async () => {
  const fixture = page();
  fixture.message({ type: "DRA_START_LOOP", runId: "run", loopId: "old" });
  fixture.message({ type: "DRA_START_LOOP", runId: "run", loopId: "new" });
  fixture.sent[0].callback({ ok: true });
  await drain();
  assert.equal(fixture.sent.length, 2, "old wake must not parse or send progress");
  assert.equal(fixture.message({ type: "DRA_LOOP_STATUS" }).loopId, "new");
  assert.equal(fixture.message({ type: "DRA_LOOP_STATUS" }).running, true);
  fixture.message({ type: "DRA_STOP_LOOP", loopId: "old" });
  assert.equal(fixture.message({ type: "DRA_LOOP_STATUS" }).running, true, "late old stop cannot cancel new loop");
});

test("pause cancels an in-flight progress response before any page action", async () => {
  const fixture = page();
  fixture.message({ type: "DRA_START_LOOP", runId: "run", loopId: "one" });
  fixture.sent[0].callback({ ok: true });
  await drain();
  assert.equal(fixture.sent[1].message.type, "DRA_PROGRESS");
  fixture.message({ type: "DRA_STOP_LOOP" });
  fixture.sent[1].callback({ ok: true });
  await drain();
  assert.equal(fixture.sent.length, 2);
  assert.equal(fixture.message({ type: "DRA_LOOP_STATUS" }).running, false);
});

test("duplicate start for an active generation does not create another timer", () => {
  const fixture = page();
  fixture.message({ type: "DRA_START_LOOP", runId: "run", loopId: "one" });
  fixture.message({ type: "DRA_START_LOOP", runId: "run", loopId: "one" });
  assert.equal(fixture.sent.length, 1);
});

const ordinaryVideo = { contentType: "video", videoId: "video-1", authorName: "作者", secUid: "creator-1", caption: "美食", durationSeconds: 90, likes: 5000 };

async function screen(observation, profile = {}, resume = null) {
  let profileReads = 0;
  const fixture = page({
    parseCurrentFeed: () => observation,
    parseCreatorPanel: () => { profileReads += 1; return { ready: true, authorName: "作者", secUid: "creator-1", followers: 100000, ...profile }; }
  });
  fixture.message({ type: "DRA_START_LOOP", runId: "run", loopId: "one", rules: DEFAULT_RULES, resume });
  for (let index = 0; index < 30; index += 1) {
    await drain();
    const pending = fixture.sent[index];
    assert.ok(pending, "screening should keep making progress");
    if (pending.message.type === "DRA_OBSERVATION") {
      pending.callback({ continue: false });
      await drain();
      return { messages: fixture.sent.map(item => item.message), profileReads, observation: pending.message.observation };
    }
    pending.callback({ ok: true });
  }
  assert.fail("screening did not submit");
}

for (const [label, observation] of [
  ["negative keyword with missing metrics", { ...ordinaryVideo, caption: "和平精英", durationSeconds: null, likes: null }],
  ["short video with missing likes", { ...ordinaryVideo, durationSeconds: 39, likes: null }],
  ["low likes", { ...ordinaryVideo, likes: 1 }],
  ["photo", { contentType: "photo", videoId: "photo-1" }],
  ["live", { contentType: "live", videoId: "live-1" }],
  ["ad", { ...ordinaryVideo, isAd: true }]
]) {
  test(`${label} submits without profile collection or viewing wait`, async () => {
    const result = await screen(observation);
    assert.equal(result.profileReads, 0);
    assert.equal(result.messages.some(message => message.phase === "dwell"), false);
    assert.equal(result.messages.filter(message => message.type === "DRA_WAIT").length, 1, "only loop startup wait");
    assert.equal(result.observation.dwellSeconds, 0);
  });
}

test("creator rejection bypasses viewing wait after profile collection", async () => {
  for (const profile of [{ bio: "和平精英" }, { followers: 9000000 }]) {
    const result = await screen(ordinaryVideo, profile);
    assert.equal(result.profileReads, 1);
    assert.equal(result.messages.some(message => message.phase === "dwell"), false);
  }
});

test("eligible video retains viewing wait", async () => {
  const result = await screen(ordinaryVideo);
  assert.equal(result.profileReads, 1);
  assert.equal(result.messages.find(message => message.phase === "dwell").plannedDwellSeconds, 5);
  assert.equal(result.observation.dwellSeconds, 5);
});

test("restored dwell cannot delay a newly rejected video", async () => {
  const result = await screen({ ...ordinaryVideo, durationSeconds: 39 }, {}, {
    phase: "dwell", videoId: "video-1", plannedDwellSeconds: 300,
    cycleStartedAt: Date.now(), waitUntil: Date.now() + 300000
  });
  assert.equal(result.messages.some(message => message.phase === "dwell"), false);
  assert.equal(result.messages.filter(message => message.type === "DRA_WAIT").length, 1);
});
