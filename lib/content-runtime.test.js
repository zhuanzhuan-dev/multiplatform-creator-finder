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

function page(parser = {}, panelUi = () => ({})) {
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
  const listeners = new Set();
  context.window = {
    addEventListener: (type, fn) => { if (type === 'message') listeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'message') listeners.delete(fn); },
    postMessage: message => queueMicrotask(() => {
      for (const fn of [...listeners]) fn({source:context.window,data:{...message,direction:'response',result:{ok:true,panelState:panelUi(),targets:{works:{target:'works'}}}}});
    })
  };
  vm.runInNewContext(source, context);
  return {
    sent,
    now: () => now,
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
    parseCreatorPanel: () => { profileReads += 1; return { ready: true, authorName: "作者", secUid: "creator-1", followers: 100000, avatarUrl:'https://example.com/avatar.jpg', ...profile }; }
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
    assert.ok(result.profileReads > 1, 'profile must stabilize before screening');
    assert.equal(result.messages.some(message => message.phase === "dwell"), false);
  }
});

test("eligible video retains viewing wait", async () => {
  const result = await screen(ordinaryVideo);
  assert.ok(result.profileReads > 1, 'profile must stabilize before screening');
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

async function slowProfile({worksDelay=0,avatarDelay=0,pauseAt=Infinity,blockedAt=Infinity}={}) {
  let fixture, started;
  const elapsed=()=>fixture.now()-started;
  fixture=page({
    parseCurrentFeed:()=>elapsed()>=blockedAt?{blockedReason:'请完成验证'}:ordinaryVideo,
    parseCreatorPanel:()=>({ready:elapsed()>=worksDelay,authorName:'作者',secUid:'creator-1',followers:100000,
      avatarUrl:elapsed()>=avatarDelay?'https://example.com/avatar.jpg':'',recentVideos:[{videoId:'work-1',likes:100}],collectedAt:String(fixture.now())})
  },()=>({present:true,selected:true,hasWorks:elapsed()>=worksDelay,ready:elapsed()>=worksDelay}));
  started=fixture.now();
  fixture.message({type:'DRA_START_LOOP',runId:'r',loopId:'l',rules:DEFAULT_RULES});
  const handled=new Set();
  for(let step=0;step<1000;step++) {
    await drain();
    if(elapsed()>=pauseAt){fixture.message({type:'DRA_STOP_LOOP'});return {fixture,elapsed:elapsed()};}
    const next=fixture.sent.filter(item=>!handled.has(item)).sort((a,b)=>(a.message.type==='DRA_WAIT'?a.message.until:-1)-(b.message.type==='DRA_WAIT'?b.message.until:-1))[0];
    assert.ok(next,'the running collector must wait or emit progress');
    handled.add(next);
    if(next.message.type==='DRA_OBSERVATION') {
      next.callback({continue:false});await drain();return {fixture,elapsed:elapsed(),submitted:next.message};
    }
    if(next.message.type==='DRA_TICK_ERROR'||next.message.type==='DRA_PAGE_BLOCKED') {
      fixture.message({type:'DRA_STOP_LOOP'});return {fixture,elapsed:elapsed(),error:next.message};
    }
    next.callback({ok:true});
  }
  assert.fail('slow profile collection did not finish');
}

test('a selected works tab can load for 18s without being clicked again',async()=>{
  const result=await slowProfile({worksDelay:18000,avatarDelay:20000});
  assert.ok(result.submitted);assert.ok(result.elapsed>=21000);
  assert.equal(result.submitted.profile.avatarUrl,'https://example.com/avatar.jpg');
  assert.equal(result.fixture.sent.some(({message})=>message.type==='DRA_TRUSTED_CLICK'||message.type==='DRA_TRUSTED_KEY'),false);
});

test('a late avatar is read after profile identity is ready',async()=>{
  const result=await slowProfile({avatarDelay:3000});
  assert.ok(result.submitted);assert.equal(result.submitted.profile.avatarUrl,'https://example.com/avatar.jpg');
});

test('pausing or encountering verification during slow works loading prevents submission',async()=>{
  for(const options of [{pauseAt:5000},{blockedAt:5000}]) {
    const result=await slowProfile({worksDelay:18000,...options});
    assert.equal(result.fixture.sent.some(({message})=>message.type==='DRA_OBSERVATION'||message.type==='DRA_TRUSTED_CLICK'),false);
    if(options.blockedAt)assert.match(result.error.error,/验证/);
  }
});
