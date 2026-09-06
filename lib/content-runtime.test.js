import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = (await readFile(new URL("../content/douyin-content.js", import.meta.url), "utf8"))
  .replace('import { sampleDwellSeconds } from "../lib/dwell.js";', 'const sampleDwellSeconds = () => 5;');

function page() {
  const sent = [];
  let listener;
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const context = {
    AbortController, Date: Clock, Promise, crypto: globalThis.crypto,
    location: { search: "?recommend=1", href: "https://www.douyin.com/?recommend=1" },
    document: { visibilityState: "hidden", hasFocus: () => false },
    DouyinAutoFinderParser: {
      parseCurrentFeed: () => ({ blockedReason: "fixture blocked" }),
      creatorPanelState: () => ({})
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
