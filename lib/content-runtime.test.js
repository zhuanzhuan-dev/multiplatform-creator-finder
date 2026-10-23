import { recommendationState, recommendationAdvanced } from "./douyin-recommendation.js";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { contentSkipDecision } from "./content-type.js";
import { evaluateVideoRules, evaluateCreatorRules } from "./rule-engine.js";
import { DEFAULT_RULES } from "./defaults.js";
import { readDouyinIpLocation } from "./douyin-ip-location.js";
import { readFile } from "node:fs/promises";

const source = (await readFile(new URL("../content/douyin-content.js", import.meta.url), "utf8"))
  .replace('import { recommendationState, recommendationAdvanced } from "../lib/douyin-recommendation.js";', '')
  .replace('import { captureCurrentRaw, rawCaptureEnabled } from "./raw-capture.js";', 'const rawCaptureEnabled=()=>false;')
  .replace('import { readDouyinIpLocation } from "../lib/douyin-ip-location.js";', '')
  .replace('import { contentSkipDecision } from "../lib/content-type.js";', '')
  .replace('import { evaluateVideoRules, evaluateCreatorRules } from "../lib/rule-engine.js";', '')
  .replace('import { sampleDwellSeconds } from "../lib/dwell.js";', 'const sampleDwellSeconds = () => 5;');

function page(parser = {}, panelUi = () => ({}), identity = () => parser.parseCurrentFeed?.(), profileDocument = {}, bridge = {}) {
  const sent = [];
  let listener;
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const context = {
    recommendationState, recommendationAdvanced, contentSkipDecision, evaluateVideoRules, evaluateCreatorRules, readDouyinIpLocation, AbortController, setTimeout, clearTimeout, Date: Clock, Promise, crypto: globalThis.crypto,
    location: { search: "?recommend=1", href: "https://www.douyin.com/?recommend=1" },
    document: { visibilityState: "hidden", hasFocus: () => false,
      querySelector: () => ({ id: "sliderVideo", getAttribute: () => parser.parseCurrentFeed?.()?.videoId || "" }), ...profileDocument },
    DouyinAutoFinderParser: {
      parseCurrentFeed: () => ({ blockedReason: "fixture blocked" }),
      visibleFeedItem: () => context.document,
      creatorPanelState: () => ({}),
      ...parser
    },
    chrome: { runtime: {
      onMessage: { addListener: (fn) => { listener = fn; } },
      sendMessage: (message, callback) => { sent.push({ message, callback: (response) => { if (message.pageCommandTimeout) return; if (message.type === "DRA_WAIT" && !message.pageCommandTimeout && response.ok) now = Math.max(now, message.until); callback(response); } }); }
    } }
  };
  const listeners = new Set();
  context.window = {
    addEventListener: (type, fn) => { if (type === 'message') listeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'message') listeners.delete(fn); },
    postMessage: message => {
      // The bridge timeout runs concurrently; a prompt response does not advance the clock.
      const timeout = sent.at(-1)?.message;
      if (timeout?.type === "DRA_WAIT") timeout.pageCommandTimeout = true;
      queueMicrotask(() => {
      for (const fn of [...listeners]) fn({source:context.window,data:{...message,direction:'response',result:bridge[message.command] ? bridge[message.command](message.payload) : message.command === "GET_FEED_TARGET" ? {ok:true,target:{target:"feed",x:300,y:300,deltaY:600}} : message.command === "GET_FEED_IDENTITY" ? identity() : {ok:true,panelState:{present:true,selected:true,...panelUi()},targets:{works:{target:'works'},feed:{target:'feed'}}}}});
    }); }
  };
  vm.runInNewContext(source, context);
  return {
    sent,
    now: () => now,
    request(message) { return new Promise(resolve => listener(message, {}, resolve)); },
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

async function screen(observation, profile = {}, resume = null, identity = () => observation, ipResult = null) {
  let profileReads = 0;
  const fixture = page({
    parseCurrentFeed: () => observation,
    parseCreatorPanel: () => { profileReads += 1; return { ready: true, authorName: "作者", secUid: "creator-1", followers: 100000, avatarUrl:'https://example.com/avatar.jpg', ...profile }; }
  }, () => ({}), identity);
  fixture.message({ type: "DRA_START_LOOP", runId: "run", loopId: "one", rules: DEFAULT_RULES, resume });
  for (let index = 0; index < 100; index += 1) {
    await drain();
    const pending = fixture.sent[index];
    assert.ok(pending, "screening should keep making progress");
    if (pending.message.type === "DRA_OBSERVATION") {
      pending.callback({ continue: false });
      await drain();
      return { messages: fixture.sent.map(item => item.message), profileReads, observation: pending.message.observation, profile: pending.message.profile };
    }
    pending.callback(pending.message.type === 'DRA_DOUYIN_PROFILE_IP' ? { ok: true, ipLocation: ipResult } : { ok: true });
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
    assert.equal(result.messages.filter(message => message.type === "DRA_WAIT" && !message.pageCommandTimeout).length, 1, "only loop startup wait");
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

test('IP collection preserves candidate submission on success, missing data, and failure', async () => {
  for (const status of ['available', 'missing', 'failed']) {
    const ip = { ipLocationStatus: status, ipLocation: status === 'available' ? '上海' : null,
      ipLocationSource: 'douyin_profile' };
    const result = await screen(ordinaryVideo, {}, null, () => ordinaryVideo, ip);
    assert.equal(result.messages.filter(v => v.type === 'DRA_DOUYIN_PROFILE_IP').length, 1);
    assert.equal(result.profile.ipLocationStatus, status);
    assert.equal(result.profile.ready, true);
    assert.equal(result.messages.filter(v => v.type === 'DRA_OBSERVATION').length, 1);
  }
  const rejected = await screen({ ...ordinaryVideo, likes: 1 });
  assert.equal(rejected.messages.some(v => v.type === 'DRA_DOUYIN_PROFILE_IP'), false);
});

test('the dedicated homepage message uses the same IP decoder without starting a loop', () => {
  const secUid = 'MS4wLjABAAAAprofile';
  const user = { secUid, ipLocation: 'IP属地：上海', city: '重庆' };
  const chunk = `7:${JSON.stringify(['$', '$L9', null, { user: { user } }])}\n`;
  const fixture = page({}, undefined, undefined, { location: { href: `https://www.douyin.com/user/${secUid}` },
    scripts: [{ textContent: `self.__pace_f.push(${JSON.stringify([1, chunk])})` }] });
  const result = fixture.message({ type: 'DRA_DOUYIN_IP_READ', secUid });
  assert.equal(result.ipLocation.ipLocation, '上海');
  assert.equal(fixture.sent.length, 0);
});

test('pause during IP collection prevents a late result from submitting the candidate', async () => {
  const fixture = page({ parseCurrentFeed: () => ordinaryVideo,
    parseCreatorPanel: () => ({ ready: true, authorName: '作者', secUid: 'creator-1', followers: 100000,
      avatarUrl: 'https://example.com/avatar.jpg' }) }, () => ({}), () => ordinaryVideo);
  fixture.message({ type: 'DRA_START_LOOP', runId: 'run', loopId: 'one', rules: DEFAULT_RULES });
  for (let i = 0; i < 100; i += 1) {
    await drain();
    const pending = fixture.sent[i];
    assert.ok(pending);
    if (pending.message.type === 'DRA_DOUYIN_PROFILE_IP') {
      fixture.message({ type: 'DRA_STOP_LOOP', loopId: 'one' });
      pending.callback({ ok: true, ipLocation: { ipLocation: '上海', ipLocationStatus: 'available' } });
      await drain();
      assert.equal(fixture.sent.some(v => v.message.type === 'DRA_OBSERVATION'), false);
      return;
    }
    pending.callback({ ok: true });
  }
  assert.fail('IP collection was never requested');
});

test("restored dwell cannot delay a newly rejected video", async () => {
  const result = await screen({ ...ordinaryVideo, durationSeconds: 39 }, {}, {
    phase: "dwell", videoId: "video-1", plannedDwellSeconds: 300,
    cycleStartedAt: Date.now(), waitUntil: Date.now() + 300000
  });
  assert.equal(result.messages.some(message => message.phase === "dwell"), false);
  assert.equal(result.messages.filter(message => message.type === "DRA_WAIT" && !message.pageCommandTimeout).length, 1);
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

test("main-world identity overrides an author live DOM signal before screening", async () => {
  const result = await screen({ ...ordinaryVideo, contentType: "live", isLive: true, subtype: "feed-live", likes: 1 }, {}, null,
    () => ({ contentType: "video", isLive: false, subtype: "feed-video", contentId: "video-1" }));
  assert.equal(result.observation.contentType, "video");
  assert.equal(result.observation.isLive, false);
  assert.equal(contentSkipDecision(result.observation), null);
});
test("a stale bridge result never becomes a live skip", async () => {
  const result = await screen(ordinaryVideo, {}, null,
    () => ({ contentType: "live", isLive: true, subtype: "feed-live", contentId: "other-card" }));
  assert.equal(result.observation.contentType, "unknown");
  assert.equal(result.observation.isLive, false);
});

test("manual parsing uses the same verified bridge identity as automated screening", async () => {
  const fixture = page({ parseCurrentFeed: () => ({ ...ordinaryVideo, contentType: "live", isLive: true }), parseCreatorPanel: () => ({ ready: true }) },
    () => ({}), () => ({ contentType: "video", isLive: false, subtype: "feed-video", contentId: "video-1" }));
  const result = await fixture.request({ type: "DRA_PARSE_FEED" });
  assert.equal(result.ok, true);
  assert.equal(result.observation.contentType, "video");
  assert.equal(result.observation.isLive, false);
  assert.equal(fixture.sent.length, 0);
});

async function runFixtureUntil(fixture, stop, respond = () => ({ok:true}), limit = 600) {
  fixture.message({type:'DRA_START_LOOP',runId:'run',loopId:'one',rules:DEFAULT_RULES});
  for(let i=0;i<limit;i++) {
    await drain();
    const next = fixture.sent[i];
    assert.ok(next, 'collector must emit or wait');
    if(stop(next.message)) { fixture.message({type:'DRA_STOP_LOOP'}); next.callback({ok:true}); return next.message; }
    next.callback(respond(next.message));
  }
  fixture.message({type:'DRA_STOP_LOOP'});
  assert.fail('expected collector event was not emitted');
}
const readyProfile = {ready:true,authorName:'作者',secUid:'MS4wLjABAAAAcreator',profileUrl:'https://www.douyin.com/user/MS4wLjABAAAAcreator',followers:100000,avatarUrl:'https://example.com/avatar.jpg'};

test('sidebar response supplies IP to the observation without opening a temporary homepage', async () => {
  const observation = {...ordinaryVideo,secUid:readyProfile.secUid,profileUrl:readyProfile.profileUrl};
  const ip = {secUid:readyProfile.secUid,ipLocation:'河南',ipLocationStatus:'available',ipLocationSource:'douyin_profile_api',ipLocationProfileUrl:readyProfile.profileUrl};
  const fixture = page({parseCurrentFeed:()=>observation,parseCreatorPanel:()=>readyProfile},undefined,()=>observation,{},
    {GET_PROFILE_IP:()=>({ok:true,ipLocation:ip})});
  const submitted = await runFixtureUntil(fixture,m=>m.type==='DRA_OBSERVATION');
  assert.equal(submitted.profile.ipLocation,'河南');
  assert.equal(fixture.sent.some(v=>v.message.type==='DRA_DOUYIN_PROFILE_IP'),false);
});

test('new round restores recommendation from F and opens works before reading the first candidate', async () => {
  let mode = 'slideMode', present = false, selected = false;
  const observation={...ordinaryVideo,likes:1};
  const fixture=page({parseCurrentFeed:()=>observation,parseCreatorPanel:()=>readyProfile},()=>({present,selected}),()=>observation,
    {querySelector:()=>({get id(){return mode;},getAttribute:()=>observation.videoId})});
  await runFixtureUntil(fixture,m=>m.type==='DRA_OBSERVATION',m=>{
    if(m.type==='DRA_TRUSTED_KEY'&&m.key==='Escape')mode='sliderVideo';
    if(m.type==='DRA_TRUSTED_KEY'&&m.key==='x')present=true;
    if(m.type==='DRA_TRUSTED_CLICK')selected=true;
    return {ok:true};
  });
  assert.equal(mode,'sliderVideo');assert.equal(selected,true);
  assert.deepEqual(fixture.sent.filter(v=>v.message.type==='DRA_TRUSTED_KEY').map(v=>v.message.key),['Escape','x']);
});

test('an author-work transition is recovered and retried, not counted as a recommendation advance', async () => {
  let mode='sliderVideo', video='video-1', wheels=0, escaped=0;
  const observation=()=>({...ordinaryVideo,videoId:video,likes:1});
  const fixture=page({parseCurrentFeed:observation,parseCreatorPanel:()=>readyProfile},undefined,observation,
    {querySelector:()=>({get id(){return mode;},getAttribute:()=>video})});
  const result=await runFixtureUntil(fixture,m=>m.type==='DRA_TRANSITION_RESULT',m=>{
    if(m.type==='DRA_OBSERVATION')return {continue:true,observationRecordId:'record',action:'advance'};
    if(m.type==='DRA_TRUSTED_WHEEL'){wheels++;mode='slideMode';video='author-work';}
    if(m.type==='DRA_TRUSTED_KEY'&&m.key==='Escape'){escaped++;mode='sliderVideo';video='video-1';}
    if(m.type==='DRA_TRUSTED_KEY'&&m.key==='ArrowDown'){mode='sliderVideo';video='video-2';}
    return {ok:true};
  });
  assert.equal(wheels,1);assert.equal(escaped,1);assert.equal(video,'video-2');
  assert.equal(result.transition.transitionOk,true);
});

test('failed source recovery never submits an author work as a recommendation', async () => {
  const fixture=page({parseCurrentFeed:()=>ordinaryVideo},undefined,()=>ordinaryVideo,
    {querySelector:()=>({id:'slideMode',getAttribute:()=>ordinaryVideo.videoId})});
  await runFixtureUntil(fixture,m=>m.type==='DRA_TICK_ERROR');
  assert.equal(fixture.sent.some(v=>v.message.type==='DRA_OBSERVATION'),false);
});

test('missing sidebar response from another creator uses homepage fallback without mixing identities', async () => {
  const observation={...ordinaryVideo,secUid:readyProfile.secUid,profileUrl:readyProfile.profileUrl};
  const fixture=page({parseCurrentFeed:()=>observation,parseCreatorPanel:()=>readyProfile},undefined,()=>observation,{},
    {GET_PROFILE_IP:()=>({ok:true,ipLocation:{secUid:'MS4wOther',ipLocation:'错误',ipLocationStatus:'available',ipLocationProfileUrl:readyProfile.profileUrl}})});
  const submitted=await runFixtureUntil(fixture,m=>m.type==='DRA_OBSERVATION',m=>m.type==='DRA_DOUYIN_PROFILE_IP'
    ? {ok:true,ipLocation:{ipLocation:'上海',ipLocationStatus:'available',ipLocationSource:'douyin_profile'}} : {ok:true});
  assert.equal(submitted.profile.ipLocation,'上海');
  assert.equal(fixture.sent.filter(v=>v.message.type==='DRA_DOUYIN_PROFILE_IP').length,1);
});

test('switching to author playback during dwell prevents submitting the interrupted observation', async () => {
  let mode='sliderVideo';
  const fixture=page({parseCurrentFeed:()=>ordinaryVideo,parseCreatorPanel:()=>readyProfile},undefined,()=>ordinaryVideo,
    {querySelector:()=>({get id(){return mode;},getAttribute:()=>ordinaryVideo.videoId})});
  await runFixtureUntil(fixture,m=>m.type==='DRA_TICK_ERROR',m=>{
    if(m.type==='DRA_PROGRESS'&&m.phase==='dwell')mode='slideMode';
    if(m.type==='DRA_TRUSTED_KEY'&&m.key==='Escape')mode='sliderVideo';
    return {ok:true};
  });
  assert.equal(mode,'sliderVideo');
  assert.equal(fixture.sent.some(v=>v.message.type==='DRA_OBSERVATION'),false);
});
