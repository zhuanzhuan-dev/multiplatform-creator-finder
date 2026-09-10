import { newEngagement } from './engagement.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { prepareLegacyHistory, normalizeHistoryEntry } from './decision-history.js';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(new URL('../background.js', import.meta.url), 'utf8');
const bundle = await build({
  stdin: { contents: source + '\nglobalThis.runtimeTest = { exportObservations, feigua, initialize, watchdog, setPaused, stopRun, configureOpenTabSidePanels, flushOutbox, handleUploadAlarm, resumeRun, state: () => state };', resolveDir: root, loader: 'js' },
  bundle: true, format: 'iife', write: false, platform: 'browser',
  plugins:[{name:'history-test-adapter',setup(b){b.onLoad({filter:/decision-store\.js$/},()=>({contents:`
    export const migrateDecisionHistory=(...args)=>globalThis.testHistory.migrate(...args);
    export const writeDecisions=(...args)=>globalThis.testHistory.write(...args);
    export const cleanupDecisions=async()=>{};
    export const decisionPreview=(platform)=>globalThis.testHistory.preview(platform);
    export const queryDecisions=()=>globalThis.testHistory.preview();
  `,loader:'js'}));}}]
});
function event() { const listeners = []; return { listeners, addListener(fn) { listeners.push(fn); }, removeListener(fn) { const i = listeners.indexOf(fn); if(i >= 0) listeners.splice(i, 1); } }; }
async function worker(saved = null, fetchImpl = null) {
  const stored = saved || {
    draSettings: { dryRun: true, cloud: { enabled: false }, schedule: { enabled: false } },
    draState: { status: 'running', feedTabId: 7, feedWindowId: 1, runId: 'run', loopId: 'loop', startedAt: new Date().toISOString(), stopAt: Date.now() + 600000, runTarget: { mode: 'time', durationMinutes: 10 }, runtime: { phase: 'dwell', deadlineAt: Date.now() + 300000, recoveryAttempts: 0 } }
  };
  let status = { ok: true, running: true, runId: 'run', loopId: 'loop', visibilityState: 'visible', url: 'https://www.douyin.com/?recommend=1' };
  let debuggerError = null;
  let stopUnresponsive = false;
  const sent = [], commands = [], alarms = new Map();
  const tab = { id: 7, windowId: 1, active: false, status: 'complete', url: 'https://www.douyin.com/?recommend=1' };
  const chrome = {
    runtime: { onConnect:event(), onInstalled: event(), onStartup: event(), onMessage: event(), sendMessage: async()=>{}, getManifest:()=>({version:'1.0.6'}), getURL:p=>`chrome-extension://test/${p}` },
    storage: { local: { get: async()=>structuredClone(stored), set: async v=>Object.assign(stored, structuredClone(v)), remove:async key=>{delete stored[key];} } },
    alarms: { onAlarm: event(), clear: async n=>alarms.delete(n), create: async(n,v)=>alarms.set(n,{...v,scheduledTime:v.when}), get:async n=>alarms.get(n) },
    power: { requestKeepAwake(){}, releaseKeepAwake(){} },
    tabs: { onActivated:event(), onRemoved:event(), onUpdated:event(), get:async()=>tab, query:async()=>[tab], update:async()=>tab, remove:async()=>{}, sendMessage: async(_, message)=>{
      sent.push(message);
      if(message.type === 'DRA_LOOP_STATUS') return {...status};
      if(message.type === 'DRA_START_LOOP') status={...status,running:true,loopId:message.loopId};
      if(message.type === 'DRA_STOP_LOOP' && stopUnresponsive) return new Promise(()=>{});
      if(message.type === 'DRA_STOP_LOOP') status={...status,running:false};
      return {ok:true};
    } },
    windows: {get:async()=>({focused:false,state:'normal'})},
    sidePanel: {setPanelBehavior:async()=>{},setOptions:async()=>{},getOptions:async()=>({enabled:true,path:"sidepanel/index.html"})},
    action: {onClicked:event(),setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}},
    debugger: {onDetach:event(),attach:async()=>{},detach:async()=>{},sendCommand:async(_, method)=>{commands.push(method);if(debuggerError)throw debuggerError;return {frameTree:{}};} }
  };
  // Workflow tests use an isolated persistence adapter; browser tests exercise real IndexedDB.
  const testHistory={
    migrate:async saved=>{if(!stored.__history)stored.__history=prepareLegacyHistory(saved);},
    write:async entries=>{for(const raw of entries){const entry=normalizeHistoryEntry(raw);if(entry){const index=stored.__history.findIndex(v=>v.id===entry.id);if(index<0)stored.__history.push(entry);else stored.__history[index]=entry;}}},
    preview:async(platform='')=>{const items=stored.__history.filter(e=>e.occurredAtMs>Date.now()-86400000 && (!platform || e.sourcePlatform===platform)).slice().reverse().sort((a,b)=>b.occurredAtMs-a.occurredAtMs);return {items:items.slice(0,5),total:items.length};}
  };
  const context = { indexedDB:new IDBFactory(),IDBKeyRange,testHistory, chrome, crypto:globalThis.crypto, structuredClone, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout, console, fetch:fetchImpl || (()=>{throw new Error('Unexpected network call');}) };
  vm.runInNewContext(bundle.outputFiles[0].text, context);
  await context.runtimeTest.initialize();
  await new Promise(resolve=>setImmediate(resolve));
  return {
    stored, sent, commands, alarms, chrome, ...context.runtimeTest,
    setTab: value=>Object.assign(tab,value),
    setStatus: value=>{status={...status,...value};},
    hangStop:()=>{stopUnresponsive=true;},
    failDebugger:()=>{debuggerError=new Error('debugger unavailable');},
    message: message=>new Promise(resolve=>chrome.runtime.onMessage.listeners[0]({runId:(message.platform === 'feigua' ? context.runtimeTest.feigua.state() : context.runtimeTest.state()).runId || 'run',loopId:'loop',...message},{tab},resolve))
  };
}

test('worker restart reconstructs watchdog and keeps a valid long dwell running', async()=>{
 const w=await worker();assert.ok(w.alarms.has('dra-watchdog'));
 await w.watchdog();assert.equal(w.stored.draState.status,'running');
 assert.equal(w.sent.filter(m=>m.type==='DRA_START_LOOP').length,0);
 assert.ok(w.commands.includes('Emulation.setFocusEmulationEnabled'));
 assert.equal(w.stored.draState.pageVisibility,'hidden');
});

test('watchdog replaces missing content with a new generation preserving dwell', async()=>{
 const w=await worker();w.setStatus({running:false});
 const deadline=w.stored.draState.runtime.deadlineAt;
 await Promise.all([w.watchdog(),w.watchdog()]);
 const starts=w.sent.filter(m=>m.type==='DRA_START_LOOP');assert.equal(starts.length,1);
 assert.notEqual(starts[0].loopId,'loop');assert.equal(starts[0].resume.deadlineAt,deadline);
 const stale=await w.message({type:'DRA_TRUSTED_KEY',key:'ArrowDown'});
 assert.equal(stale.ok,false);assert.equal(w.commands.includes('Input.dispatchKeyEvent'),false);
});

test('pause resolves pending waits and rejects subsequent actions', async()=>{
 const w=await worker();const waiting=w.message({type:'DRA_WAIT',until:Date.now()+20000});
 await new Promise(resolve=>setImmediate(resolve));
 await w.setPaused('test pause');assert.equal((await waiting).ok,false);
 assert.equal((await w.message({type:'DRA_TRUSTED_KEY',key:'ArrowDown'})).ok,false);
 assert.equal(w.stored.draState.status,'paused');
});

test('keepalive failures are surfaced and cannot be reported healthy', async()=>{
 const w=await worker();w.failDebugger();await assert.rejects(w.watchdog(),/debugger unavailable/);
 assert.equal(w.stored.draState.keepAliveAt,null);
});


test('a running flag cannot hide repeated stalled steps; recovery is bounded', async()=>{
 const w=await worker();
 for(let attempt=0;attempt<3;attempt++){
  w.state().runtime.deadlineAt=Date.now()-16000;
  await w.watchdog();
 }
 assert.equal(w.sent.filter(m=>m.type==='DRA_START_LOOP').length,2);
 assert.equal(w.stored.draState.status,'paused');
 assert.match(w.stored.draState.pauseReason,/恢复失败/);
});

test('a real transition resets recovery allowance while phase updates alone do not', async()=>{
 const w=await worker();
 w.state().runtime.recoveryAttempts=2;
 await w.message({type:'DRA_PROGRESS',phase:'read'});
 assert.equal(w.state().runtime.recoveryAttempts,2);
 await w.message({type:'DRA_PROGRESS',phase:'idle',transitionOk:true});
 assert.equal(w.state().runtime.recoveryAttempts,0);
 assert.ok(w.state().runtime.lastTransitionAt>0);
});


test('stop completes and releases resources when a page never acknowledges stop', async()=>{
 const w=await worker();w.hangStop();
 await w.stopRun();
 assert.equal(w.stored.draState.status,'stopped');
 assert.equal(w.alarms.has('dra-watchdog'),false);
 assert.equal(w.alarms.has('dra-run-stop'),false);
});


test('repeated dwell restoration retains the original observation start time', async()=>{
 const w=await worker();const cycleStartedAt=Date.now()-20000;const waitUntil=Date.now()+10000;
 for(let i=0;i<2;i++){
  await w.message({type:'DRA_PROGRESS',phase:'read'});
  await w.message({type:'DRA_PROGRESS',phase:'dwell',cycleStartedAt,waitUntil,plannedDwellSeconds:30});
  assert.equal(w.state().runtime.cycleStartedAt,cycleStartedAt);
  assert.equal(w.state().runtime.waitUntil,waitUntil);
 }
});


test('settings auto-save serializes edits and survives worker restart', async()=>{
 const w=await worker();await w.setPaused('edit');
 const base=w.stored.draSettings;
 const responses=await Promise.all([41,42,43].map(maxItems=>w.message({type:'DRA_SAVE_CONFIG',saveDraft:true,settings:{...base,target:{mode:'count',maxItems,durationMinutes:60}}})));
 assert.ok(responses.every(r=>r.ok));
 assert.equal(w.stored.draSettings.target.maxItems,43);
 const restarted=await worker(structuredClone(w.stored));
 assert.equal((await restarted.message({type:'DRA_GET_STATUS',global:true})).settings.target.maxItems,43);
});

test('invalid settings survive as a draft without replacing runnable settings', async()=>{
 const w=await worker();await w.setPaused('edit');
 const base=structuredClone(w.stored.draSettings);
 const invalid={...base,dwell:{mode:'range',minSeconds:25,typicalSeconds:20,maxSeconds:30}};
 const result=await w.message({type:'DRA_SAVE_CONFIG',saveDraft:true,settings:invalid});
 assert.equal(result.ok,true);assert.ok(result.problems.length);
 assert.deepEqual(w.stored.draSettings,base);
 const restarted=await worker(structuredClone(w.stored));
 assert.equal((await restarted.message({type:'DRA_GET_STATUS'})).settingsDraft.dwell.minSeconds,25);
 assert.equal((await restarted.message({type:'DRA_SAVE_CONFIG',settings:invalid})).ok,false);
 await restarted.message({type:'DRA_SAVE_CONFIG',saveDraft:true,settings:{...invalid,dwell:{...invalid.dwell,typicalSeconds:27}}});
 assert.equal(restarted.stored.draSettingsDraft,null);
 assert.equal(restarted.stored.draSettings.dwell.typicalSeconds,27);
});

test('global panel shows the bound run from unrelated tabs and opens configured workbench', async()=>{
 const w=await worker();const created=[];w.chrome.tabs.create=async options=>{created.push(options);return {id:9};};
 const status=await w.message({type:'DRA_GET_STATUS',tabId:999,global:true});
 assert.equal(status.state.feedTabId,7);assert.equal(status.state.status,'running');
 assert.equal((await w.message({type:'DRA_OPEN_WORKBENCH'})).ok,true);
 assert.equal(created[0].url,'https://fai.zhuanspirit.com/creators');
});


test('pending pairing reopens on the intranet after upgrading without losing its secret', async()=>{
 const saved={
   draSettings:{dryRun:true,cloud:{enabled:false},schedule:{enabled:false}},
   draPairing:{status:'pending',code:'XK7-P2M',deviceSecret:'test-secret',pairUrl:'https://whislte.cc.cd/pair?code=XK7-P2M',expiresAt:new Date(Date.now()+600000).toISOString()}
 };
 const w=await worker(saved);const created=[];
 w.chrome.tabs.create=async options=>{created.push(options);return {id:9};};
 const result=await w.message({type:'DRA_START_PAIR'});
 assert.equal(result.ok,true);
 assert.equal(created[0].url,'https://fai.zhuanspirit.com/creators/pair?code=XK7-P2M');
 assert.equal(w.stored.draPairing.pairUrl,created[0].url);
 assert.equal(w.stored.draPairing.deviceSecret,'test-secret');
 assert.equal(w.stored.draPairing.code,'XK7-P2M');
});

test('upgrade repairs old tab overrides while fresh tabs inherit the global panel', async()=>{
 const w=await worker();const calls=[];
 w.chrome.sidePanel.setOptions=async options=>calls.push(options);
 w.chrome.sidePanel.getOptions=async()=>({tabId:7,enabled:false});
 await w.configureOpenTabSidePanels();
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{path:'sidepanel/index.html',enabled:true},{tabId:7,path:'sidepanel/index.html',enabled:true}]);
 calls.length=0;w.chrome.sidePanel.getOptions=async()=>({enabled:true,path:'sidepanel/index.html'});
 await w.configureOpenTabSidePanels();assert.equal(calls.length,1);
});

test('starting from an unrelated tab creates and binds a recommendation tab', async()=>{
 const w=await worker();await w.setPaused('edit');const created=[];
 const unrelated={id:8,windowId:1,url:'about:blank',active:true,status:'complete'};
 const feed={id:10,windowId:1,url:'https://www.douyin.com/?recommend=1',active:true,status:'complete'};
 w.chrome.tabs.get=async id=>id===8?unrelated:feed;
 w.chrome.tabs.query=async()=>[];
 w.chrome.tabs.create=async options=>{created.push(options);return feed;};
 w.chrome.tabs.update=async()=>feed;
 w.chrome.windows.get=async()=>({focused:true,state:'normal'});
 const response=await w.message({type:'DRA_START',tabId:8});
 assert.equal(response.ok,true,response.error);
 assert.equal(w.state().feedTabId,10);assert.equal(w.state().createdByExtension,true);
 assert.equal(created[0].active,true);assert.match(created[0].url,/douyin.com/);
 await w.stopRun();
});


test('cleared numeric draft survives restart and cannot replace runnable settings', async()=>{
 const w=await worker();await w.setPaused('edit');
 const base=structuredClone(w.stored.draSettings);
 const draft={...base,dwell:{mode:'range',minSeconds:10,typicalSeconds:'',maxSeconds:30}};
 const result=await w.message({type:'DRA_SAVE_CONFIG',saveDraft:true,settings:draft});
 assert.ok(result.problems.length);
 assert.deepEqual(w.stored.draSettings,base);
 const restarted=await worker(structuredClone(w.stored));
 assert.equal((await restarted.message({type:'DRA_GET_STATUS'})).settingsDraft.dwell.typicalSeconds,'');
 assert.equal((await restarted.message({type:'DRA_SAVE_CONFIG',settings:draft})).ok,false);
});


test('non-video observations are logged separately without a creator panel and counted once per day', async () => {
  const w = await worker();
  for (const [i, observation, counter] of [
    [1, { contentType: 'live' }, 'liveSkipped'],
    [2, { contentType: 'photo' }, 'photoSkipped'],
    [3, { contentType: 'video', isAd: true }, 'adSkipped'],
    [4, { contentType: 'unknown' }, 'unknownSkipped']
  ]) {
    const response = await w.message({ type: 'DRA_OBSERVATION', observation: { ...observation, videoId: `item-${i}` } });
    assert.equal(response.continue, true);
    assert.equal(response.action, 'advance');
    assert.equal(w.state().stats[counter], 1);
  }
  await w.message({ type: 'DRA_OBSERVATION', observation: { videoId: 'item-1', contentType: 'live' } });
  assert.equal(w.state().stats.scanned, 4);
  assert.equal(w.stored.draOutbox.length, 4);
  assert.equal((await w.message({ type: 'DRA_GET_STATUS' })).daily.scanned, 4);
  const restarted = await worker(w.stored);
  await restarted.message({ type: 'DRA_OBSERVATION', observation: { videoId: 'item-1', contentType: 'live' } });
  assert.equal((await restarted.message({ type: 'DRA_GET_STATUS' })).daily.scanned, 4);
  assert.equal(restarted.stored.__history.length, 4);
  await restarted.stopRun();
  const activeTab = { ...(await restarted.chrome.tabs.get(7)), active: true };
  restarted.chrome.tabs.get = async () => activeTab;
  restarted.chrome.tabs.query = async () => [activeTab];
  restarted.chrome.windows.get = async () => ({ focused: true, state: "normal" });
  const start = await restarted.message({ type: 'DRA_START', tabId: 7 });
  assert.equal(start.ok, true, JSON.stringify(start));
  assert.equal(restarted.state().stats.scanned, 0);
  assert.equal((await restarted.message({ type: 'DRA_GET_STATUS' })).daily.scanned, 4);
  assert.equal(restarted.stored.__history.length, 4);
});

test('formal run requires authorization even when an old configuration disabled uploads', async () => {
  const w = await worker({ draSettings: { dryRun: false, cloud: { enabled: false }, schedule: { enabled: false } } });
  const response = await w.message({ type: 'DRA_START', tabId: 7 });
  assert.equal(response.ok, false);
  assert.match(response.error, /登录并连接研究台/);
  assert.equal(w.state().status, 'idle');
});

test('revoked authorization is persisted and shown disconnected', async () => {
  const w = await worker({ draCloudAuth: { device_token: 'fixture-token' }, draSettings: { schedule: { enabled: false } }, draState: { status: 'running', feedTabId: 7 } },
    async () => ({ ok: false, status: 401, json: async () => ({ error: 'revoked' }) }));
  const response = await w.message({ type: 'DRA_CHECK_CLOUD' });
  assert.equal(response.ok, false);
  assert.equal(w.stored.draCloudAuth.expired, true);
  const status = await w.message({ type: 'DRA_GET_STATUS', global: true });
  assert.equal(status.cloud.connected, false);
  assert.equal(status.cloud.expired, true);
  assert.equal(status.state.status, 'paused');
});

test('concurrent upload triggers share a batch and historical acknowledgements do not inflate this run', async () => {
  let requests = 0;
  const item = (id, sessionId) => ({ id, sessionId, status: 'pending', transitionPending: false,
    startedAt: new Date().toISOString(), queuedAt: new Date().toISOString(), payload: { record_id: id, feed_index: 1 } });
  const w = await worker({
    draCloudAuth: { device_token: 'fixture-token' },
    draState: { runId: 'current', stats: { uploaded: 0 } },
    draSettings: { schedule: { enabled: false } },
    draOutbox: [item('old-record', 'previous'), item('new-record', 'current')]
  }, async (_, options) => {
    requests++;
    await new Promise(resolve => setImmediate(resolve));
    const ids = JSON.parse(options.body).records.map(row => row.record_id);
    return { ok: true, status: 200, json: async () => ({ accepted: ids }) };
  });
  await Promise.all([w.flushOutbox({ force: true }), w.flushOutbox({ force: true })]);
  assert.equal(requests, 1);
  assert.equal(w.stored.draState.stats.uploaded, 0);
  await w.flushOutbox({ force: true });
  assert.equal(w.stored.draState.stats.uploaded, 1);
  await w.flushOutbox({ force: true });
  assert.equal(w.stored.draState.stats.uploaded, 1);
});


test('disconnect pauses formal collection and keeps queued records for reconnection', async () => {
  const w = await worker({ draCloudAuth: { device_token: 'fixture-token' },
    draSettings: { schedule: { enabled: false } }, draState: { status: 'running', feedTabId: 7 },
    draOutbox: [{ id: 'pending-record', status: 'pending', payload: { record_id: 'pending-record', feed_index: 1 } }] });
  const response = await w.message({ type: 'DRA_DISCONNECT_CLOUD' });
  assert.equal(response.ok, true);
  assert.equal(response.cloud.connected, false);
  assert.equal(w.state().status, 'paused');
  assert.equal(w.stored.draOutbox.length, 1);
});


test('resume preserves the run, results and remaining time across a worker restart', async () => {
  const pausedAt = Date.now() - 120000;
  const saved = {
    draSettings: { dryRun: true, schedule: { enabled: false } },
    draState: { status: 'paused', runId: 'same-run', loopId: 'old-loop', feedTabId: 7,
      startedAt: new Date(pausedAt - 60000).toISOString(), endedAt: new Date(pausedAt).toISOString(),
      pausedAt, elapsedMs: 60000, activeSince: null, runTarget: { mode: 'time', durationMinutes: 5 },
      stats: { scanned: 19, matched: 12 }, recentDecisions: [{ code: 'ACCEPTED', accountName: 'example', occurredAt:new Date().toISOString() }],
      runtime: { phase: 'dwell', videoId: 'video', waitUntil: pausedAt + 10000, deadlineAt: pausedAt + 25000,
        cycleStartedAt: pausedAt - 20000, plannedDwellSeconds: 30 }
    }
  };
  const initialStartedAt = saved.draState.startedAt;
  const w = await worker(saved);
  const response = await w.message({ type: 'DRA_RESUME' });
  assert.equal(response.ok, true, response.error);
  assert.equal(w.state().runId, 'same-run');
  assert.equal(w.state().stats.scanned, 19);
  assert.equal((await w.message({type:'DRA_GET_STATUS',global:true})).decisionHistory.length, 1);
  assert.equal(w.state().startedAt, initialStartedAt);
  assert.equal(w.state().elapsedMs, 60000);
  assert.ok(Math.abs(w.state().stopAt - Date.now() - 240000) < 1000);
  const start = w.sent.find(m => m.type === 'DRA_START_LOOP');
  assert.notEqual(start.loopId, 'old-loop');
  assert.ok(Math.abs(start.resume.waitUntil - Date.now() - 10000) < 1000);
  assert.ok(Math.abs(start.resume.cycleStartedAt - Date.now() + 20000) < 1000);
  const stale = await w.message({ type: 'DRA_PROGRESS', phase: 'read', runId: 'same-run', loopId: 'old-loop' });
  assert.equal(stale.ok, false);
});

test('completed targets cannot resume or silently reset results', async () => {
  const w = await worker({ draSettings: { dryRun: true, schedule: { enabled: false } },
    draState: { status: 'paused', runId: 'complete', startedAt: new Date().toISOString(),
      elapsedMs: 60000, runTarget: { mode: 'time', durationMinutes: 1 }, stats: { scanned: 7 } } });
  const response = await w.message({ type: 'DRA_RESUME' });
  assert.equal(response.ok, false);
  assert.equal(w.state().runId, 'complete');
  assert.equal(w.state().stats.scanned, 7);
});

test('upload latency cannot hold transition confirmation, progress or pause; paused queues restart', async () => {
  let release, requests = 0;
  const w = await worker({
    draSettings: { schedule: { enabled: false } }, draCloudAuth: { device_token: 'fixture' },
    draState: { status: 'running', runId: 'run', loopId: 'loop', feedTabId: 7, startedAt: new Date().toISOString(),
      runTarget: { mode: 'time', durationMinutes: 5 }, stopAt: Date.now()+300000 },
    draOutbox: [{ id: 'record', sessionId: 'run', status: 'pending', transitionPending: true,
      queuedAt: new Date().toISOString(), payload: { record_id: 'record', feed_index: 1 } }]
  }, async () => { requests++;await new Promise(resolve => { release = resolve; });return { ok: true, status: 200, json: async () => ({ accepted: ['record'] }) }; });
  assert.equal((await w.message({ type: 'DRA_TRANSITION_RESULT', recordId: 'record', transition: { transitionOk: true } })).ok, true);
  assert.equal(requests, 0);
  assert.ok(w.alarms.has('dra-upload'));
  w.alarms.delete('dra-upload');
  const uploading = w.handleUploadAlarm();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.equal((await w.message({ type: 'DRA_PROGRESS', phase: 'read' })).ok, true);
  assert.equal((await w.message({ type: 'DRA_PAUSE', tabId: 7 })).ok, true);
  const restarted = await worker(w.stored);
  assert.equal(restarted.state().status, 'paused');
  assert.ok(restarted.alarms.has('dra-upload'));
  release();await uploading;
  assert.equal(w.stored.draOutbox[0].status, 'written');
});

test('closing panel releases window presence without stopping collection',async()=>{
 const w=await worker();
 const port={name:'dra-panel:1',sender:{url:'chrome-extension://test/sidepanel/index.html'},onDisconnect:event()};
 w.chrome.runtime.onConnect.listeners[0](port);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await w.message({type:'DRA_GET_LAUNCHER'})).launcher.visible,true);
 port.onDisconnect.listeners[0]();
 assert.equal((await w.message({type:'DRA_GET_LAUNCHER'})).launcher.visible,true);
 assert.equal(w.state().status,'running');
 assert.equal(w.sent.some(m=>m.type==='DRA_STOP_LOOP'),false);
});

test('global status retains stopped results after the managed task tab closes',async()=>{
 const w=await worker({draSettings:{dryRun:true,schedule:{enabled:false}},draState:{status:'running',createdByExtension:true,feedTabId:7,runId:'old',stats:{scanned:19},recentDecisions:[{code:'LIVE_SKIPPED',occurredAt:new Date().toISOString()}]}});
 await w.stopRun();
 const snapshot=await w.message({type:'DRA_GET_STATUS',global:true});
 assert.equal(snapshot.state.status,'stopped');assert.equal(snapshot.state.feedTabId,null);assert.equal(snapshot.state.stats.scanned,19);
 assert.equal(snapshot.decisionHistory.length,1);assert.equal(snapshot.decisionHistory[0].runId,'old');
 const saved=structuredClone(w.stored);saved.draState={status:'running',feedTabId:7,runId:'new',loopId:'loop'};
 const next=await worker(saved);await next.message({type:'DRA_OBSERVATION',runId:'new',observation:{videoId:'new-video',contentType:'live'}});
 const updated=await next.message({type:'DRA_GET_STATUS',global:true});
 assert.equal(updated.state.stats.scanned,1);assert.equal(updated.decisionHistory.length,2);assert.equal(updated.decisionHistory[0].runId,'new');assert.equal(updated.decisionHistory[1].runId,'old');
 const restart=await worker(structuredClone(next.stored));assert.equal((await restart.message({type:'DRA_GET_STATUS',global:true})).decisionHistory.length,2);
});

test('connection checks persist a server profile matching the connected user',async()=>{
 const w=await worker({draCloudAuth:{device_token:'fixture',user_id:'mine'},draSettings:{dryRun:true,schedule:{enabled:false}}},async()=>({ok:true,status:200,json:async()=>({accepted:[],account:{id:'mine',name:'张三',email:'one@example.com'}})}));
 assert.equal((await w.message({type:'DRA_CHECK_CLOUD'})).ok,true);
 const s=await w.message({type:'DRA_GET_STATUS',global:true});assert.equal(s.cloud.account.name,'张三');assert.equal(w.stored.draCloudAuth.account.email,'one@example.com');
});

for (const oldUrl of ['https://www.douyin.com/', 'https://example.com/', null]) {
  test(`resume recovers from ${oldUrl || 'closed task tab'} without resetting the run`, async () => {
    const w = await worker();
    await w.setPaused('left recommendation');
    w.state().stats.scanned = 19;
    w.state().elapsedMs = 60000;
    w.state().runtime = { phase: 'dwell', videoId: 'old', waitUntil: Date.now()+10000 };
    const oldTab = oldUrl ? {id:7,windowId:1,url:oldUrl,status:'complete'} : null;
    const created = [], removed = [], updates = [];
    const newTab = {id:8,windowId:2,url:'https://www.douyin.com/?recommend=1',status:'complete',active:true};
    w.chrome.tabs.get = async id => { if(id===8)return newTab;if(oldTab)return oldTab;throw Error('closed'); };
    w.chrome.tabs.query = async () => oldTab ? [oldTab] : [];
    w.chrome.tabs.create = async options => {created.push(options);return newTab;};
    w.chrome.tabs.update = async (id,options) => {updates.push({id,...options});return newTab;};
    w.chrome.tabs.remove = async id => removed.push(id);
    w.chrome.windows.get = async id => ({id,focused:true});
    const result = await w.message({type:'DRA_RESUME',windowId:2});
    assert.equal(result.ok,true,result.error);
    assert.equal(w.state().status,'running');
    assert.equal(w.state().runId,'run');
    assert.equal(w.state().stats.scanned,19);
    assert.equal(w.state().elapsedMs,60000);
    assert.equal(w.state().feedTabId,8);
    assert.equal(w.state().feedWindowId,2);
    assert.equal(w.state().createdByExtension,true);
    assert.equal(w.state().route.surface,'recommend');
    assert.equal(created.length,1);assert.equal(created[0].windowId,2);
    assert.equal(updates.some(t=>t.id===7),false);
    assert.equal(w.sent.find(m=>m.type==='DRA_START_LOOP').resume,null,'new page cannot inherit old card dwell');
    const stale = await w.message({type:'DRA_PROGRESS',phase:'read',loopId:w.state().loopId});
    assert.equal(stale.ok,false,'old tab no longer owns the run');
    await w.stopRun();assert.deepEqual(removed,[8]);
  });
}

test('resume reuses a recommendation tab while preserving user ownership', async () => {
  const w=await worker();await w.setPaused('left recommendation');w.state().createdByExtension=true;
  const oldTab={id:7,windowId:1,url:'https://www.douyin.com/',status:'complete'};
  const existing={id:9,windowId:1,url:'https://www.douyin.com/?recommend=1',status:'complete'};
  const removed=[];
  w.chrome.tabs.get=async id=>id===7?oldTab:existing;
  w.chrome.tabs.query=async()=>[oldTab,existing];
  w.chrome.tabs.update=async()=>existing;
  w.chrome.tabs.create=async()=>{throw Error('must reuse');};
  w.chrome.tabs.remove=async id=>removed.push(id);
  w.chrome.windows.get=async id=>({id});
  assert.equal((await w.message({type:'DRA_RESUME',windowId:1})).ok,true);
  assert.equal(w.state().feedTabId,9);assert.equal(w.state().createdByExtension,false);
  await w.stopRun();assert.deepEqual(removed,[]);
});

test('resume failure stays paused and exposes the error without resetting counters', async()=>{
  const w=await worker();await w.setPaused('left recommendation');w.state().stats.scanned=19;
  w.chrome.tabs.get=async()=>({id:7,windowId:1,url:'https://www.douyin.com/'});
  w.chrome.tabs.query=async()=>[];
  w.chrome.windows.get=async id=>({id});
  w.state().createdByExtension=true;
  const removed=[];w.chrome.tabs.remove=async id=>removed.push(id);
  w.chrome.tabs.create=async()=>{throw Error('cannot open tab');};
  const result=await w.message({type:'DRA_RESUME',windowId:1});
  assert.equal(result.ok,false);assert.match(result.error,/cannot open tab/);
  assert.equal(w.state().status,'paused');assert.equal(w.state().stats.scanned,19);
  assert.match(w.state().lastError,/cannot open tab/);
  await w.stopRun();assert.deepEqual(removed,[],'failed resume preserves the navigated page');
});

test('stop during replacement tab creation cancels resume and removes only the new tab',async()=>{
  const w=await worker();await w.setPaused('left recommendation');
  w.chrome.tabs.get=async()=>({id:7,windowId:1,url:'https://www.douyin.com/'});
  w.chrome.tabs.query=async()=>[];w.chrome.windows.get=async id=>({id});
  let release;const removed=[];
  w.chrome.tabs.create=()=>new Promise(resolve=>{release=resolve;});
  w.chrome.tabs.remove=async id=>removed.push(id);
  const resuming=w.message({type:'DRA_RESUME',windowId:1});
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  await w.stopRun();release({id:8,windowId:1});await resuming;
  assert.equal(w.state().status,'stopped');assert.equal(w.state().runId,'run');
  assert.deepEqual(removed,[8]);assert.equal(w.sent.some(m=>m.type==='DRA_START_LOOP'),false);
});

async function interactionWorker({ fail = false } = {}) {
  const w = await worker();
  w.state().engagement = newEngagement({rate:10,like:true,collect:true,follow:true});
  const ledger=w.state().engagement;ledger.videos=10;ledger.candidate={videoId:'v',creatorKey:'author',loopId:'loop'};
  const events=[];
  const original=w.chrome.tabs.sendMessage;
  w.chrome.tabs.sendMessage=async(tab,message)=>{
    assert.notEqual(message.type,'DRA_ENGAGEMENT_PROBE','interaction state must not be queried');
    return original(tab,message);
  };
  w.chrome.debugger.sendCommand=async(_,method,params)=>{
    assert.notEqual(method,'Input.dispatchMouseEvent','engagements must use keys');
    if(method==='Input.dispatchKeyEvent'){
      const action={z:'like',c:'collect',g:'follow'}[params.key];
      assert.equal(w.stored.draState.engagement.used[action],1,'reservation must be durable before input');
      events.push(params);
      if(fail&&params.type==='keyDown')throw Error('uncertain delivery');
    }
    return {};
  };
  return {w,events};
}

test('concurrent interaction requests consume one durable quota and one key pair',async()=>{
  const {w,events}=await interactionWorker();
  const responses=await Promise.all(Array.from({length:5},()=>w.message({type:'DRA_ENGAGE',action:'like',videoId:'v'})));
  assert.equal(responses.filter(r=>r.sent).length,1);
  assert.deepEqual(events.map(e=>[e.type,e.key,e.code,e.windowsVirtualKeyCode]),[['keyDown','z','KeyZ',90],['keyUp','z','KeyZ',90]]);
  assert.equal(w.state().engagement.used.like,1);assert.equal(w.state().engagement.sent.like,1);
  const restarted=await worker(w.stored);
  assert.equal(restarted.state().engagement.used.like,1);
  assert.equal((await restarted.message({type:'DRA_ENGAGE',action:'like',videoId:'v'})).skipped,true);
});
test('Z C G use the quota path without checking platform state; generic keys cannot bypass quota',async()=>{
  const {w,events}=await interactionWorker();
  for(const key of ['z','c','g'])assert.equal((await w.message({type:'DRA_TRUSTED_KEY',key})).ok,false);
  assert.equal(events.length,0);
  for(const action of ['like','collect','follow'])assert.equal((await w.message({type:'DRA_ENGAGE',action,videoId:'v'})).sent,true);
  assert.deepEqual(events.filter(e=>e.type==='keyDown').map(e=>[e.key,e.code,e.windowsVirtualKeyCode]),[['z','KeyZ',90],['c','KeyC',67],['g','KeyG',71]]);
});
test('uncertain key delivery retains quota across retries and restart',async()=>{
  const {w,events}=await interactionWorker({fail:true});
  assert.equal((await w.message({type:'DRA_ENGAGE',action:'like',videoId:'v'})).ok,false);
  assert.equal((await w.message({type:'DRA_ENGAGE',action:'like',videoId:'v'})).skipped,true);
  assert.equal(events.length,1);assert.equal(events[0].type,'keyDown');
  assert.equal(w.state().engagement.used.like,1);assert.equal(w.state().engagement.sent.like,0);
  assert.equal((await worker(w.stored)).state().engagement.used.like,1);
});
test('paused, stale and non-candidate interaction requests cannot send input',async()=>{
  const {w,events}=await interactionWorker();
  assert.equal((await w.message({type:'DRA_ENGAGE',action:'like',videoId:'other'})).skipped,true);
  assert.equal((await w.message({type:'DRA_ENGAGE',action:'like',videoId:'v',loopId:'stale'})).ok,false);
  await w.setPaused('user');
  assert.equal((await w.message({type:'DRA_ENGAGE',action:'like',videoId:'v'})).ok,false);
  assert.equal(events.length,0);
});
test('pause during debugger attachment prevents reserved keys from being sent',async()=>{
  const {w,events}=await interactionWorker();let release;
  const command=w.chrome.debugger.sendCommand;
  w.chrome.debugger.sendCommand=(target,method,params)=>method==='Page.getFrameTree'?Promise.reject(Error('not attached')):command(target,method,params);
  w.chrome.debugger.attach=()=>new Promise(resolve=>{release=resolve;});
  const sending=w.message({type:'DRA_ENGAGE',action:'like',videoId:'v'});
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  await w.setPaused('user');release();
  assert.equal((await sending).ok,false);assert.equal(events.length,0);
  assert.equal(w.state().engagement.used.like,1);
});

test('only accepted positive videos enable actions; negatives, review items and other types cannot',async()=>{
  const w=await worker();w.state().engagement=newEngagement({rate:100,like:true,collect:true,follow:true});
  const observation={contentType:'video',videoId:'1',caption:'美食',durationSeconds:90,likes:5000,authorName:'测试作者',secUid:'creator'};
  const profile={ready:true,secUid:'creator',authorName:'测试作者',followers:100000,averageLikes:5000};
  const positive=await w.message({type:'DRA_OBSERVATION',observation,profile});
  assert.deepEqual(Array.from(positive.engagementActions),['like','collect','follow']);
  assert.equal(w.state().engagement.videos,1);
  for(const changed of [
    {videoId:'2',caption:'和平精英'},
    {videoId:'3',caption:'未分类文字'},
    {videoId:'4',contentType:'photo'},
    {videoId:'5',contentType:'live'},
    {videoId:'6',isAd:true},
    {videoId:'7',isLive:true}
  ]){
    const result=await w.message({type:'DRA_OBSERVATION',observation:{...observation,...changed},profile});
    assert.equal(result.engagementActions?.length||0,0);
    assert.equal(w.state().engagement.candidate,null);
  }
  assert.equal(w.state().engagement.videos,3,'photo, live and ad never add quota');
  w.state().engagement.policy.rate=0;
  const noQuota=await w.message({type:'DRA_OBSERVATION',observation:{...observation,videoId:'8'},profile});
  assert.equal(noQuota.engagementActions.length,0);
});

const feiguaUrl = 'https://dy.feigua.cn/app/#/video/library/all';
async function feiguaWorker() {
 const w = await worker({
  draSettings: { dryRun:true, cloud:{enabled:false}, schedule:{enabled:false} },
  draState: {route:{platform:'feigua',surface:'library',label:'飞瓜视频库'},status:'running',feedTabId:7,feedWindowId:1,runId:'run',loopId:'loop',startedAt:new Date().toISOString(),stopAt:Date.now()+600000,runTarget:{mode:'time',durationMinutes:10},runtime:{phase:'dwell',deadlineAt:Date.now()+300000,recoveryAttempts:0}},
  draFeiguaCollection: {runId:'run',dryRun:true,accounts:{},excluded:{},seen:[],pages:[],finalized:false,keywords:['恐怖']}
 });
 w.state=w.feigua.state; w.watchdog=w.feigua.inspect; w.setPaused=w.feigua.pause; w.stopRun=w.feigua.stop; w.resumeRun=w.feigua.resume;
 w.setTab({ url: feiguaUrl });
 w.setStatus({ url: feiguaUrl });
 return w;
}
test('Feigua watchdog uses its content loop without Douyin debugger emulation', async()=>{
 const w=await feiguaWorker();
 await w.watchdog();
 assert.equal(w.state().status,'running');
 assert.equal(w.commands.includes('Emulation.setFocusEmulationEnabled'),false);
});
test('Feigua navigation to a different runnable platform pauses instead of switching collectors', async()=>{
 const w=await feiguaWorker();
 w.setTab({url:'https://www.douyin.com/?recommend=1'});
 await w.watchdog();
 assert.equal(w.state().status,'paused');
 assert.match(w.state().pauseReason,/原飞瓜/);
});
test('Feigua recovery refuses to launch when navigation did not restore the collector', async()=>{
 const w=await feiguaWorker();
 await w.setPaused('test');
 w.setTab({url:'https://dy.feigua.cn/app/#/workbench/index'});
 await assert.rejects(w.resumeRun({windowId:1}),/原飞瓜标签页/);
 assert.equal(w.state().status,'paused');
});

const fgPage = (fingerprint, rows) => ({fingerprint, rows, pageUrl:feiguaUrl, capturedAt:new Date().toISOString()});
const fgRow = (authorName, title='美食教程') => ({authorName,title,videoId:authorName+title,topics:[],hotWords:[],followerCount:'12w'});
test('Feigua pause keeps candidates local, stop enqueues only final nonexcluded accounts', async()=>{
 const w=await feiguaWorker();
 await w.message({type:'DRA_FEIGUA_PAGE',page:fgPage('1',[fgRow('账号甲'),fgRow('账号乙')])});
 assert.equal(w.stored.draFeiguaState.stats.scanned,2);
 assert.equal(w.stored.draOutbox.length,0);
 await w.setPaused('用户暂停');
 assert.equal(w.stored.draOutbox.length,0);
 await w.resumeRun({windowId:1});
 const loopId=w.state().loopId;
 await w.message({type:'DRA_FEIGUA_PAGE',loopId,page:fgPage('2',[fgRow('账号甲','恐怖故事')])});
 await w.stopRun();
 assert.equal(w.stored.draOutbox.length,1);
 assert.equal(w.stored.draOutbox[0].payload.author,'账号乙');
 assert.equal(w.stored.draOutbox[0].payload.rpa_feedback.source_platform,'feigua');
 assert.equal(w.stored.draOutbox[0].status,'dry-run');
 assert.equal(w.stored.draOutbox[0].transitionPending,false);
 await w.stopRun();
 assert.equal(w.stored.draOutbox.length,1);
});
test('Feigua full-page exclusion precedes page rest and preserves complete page', async()=>{
 const w=await feiguaWorker();w.state().runTarget={mode:'pages',maxPages:1};
 const r=await w.message({type:'DRA_FEIGUA_PAGE',page:fgPage('1',[fgRow('账号甲'),fgRow('账号甲','恐怖故事'),fgRow('账号乙')])});
 assert.equal(r.continue,false);assert.equal(w.state().stats.scanned,3);
 assert.equal(w.state().status,'paused');
 assert.equal(Object.keys(w.stored.draFeiguaCollection.accounts).length,1);
 assert.equal(w.stored.draOutbox.length,0);assert.equal(w.stored.draFeiguaCollection.finalized,false);
});
test('Feigua stale generation cannot submit page records', async()=>{
 const w=await feiguaWorker();
 const r=await w.message({type:'DRA_FEIGUA_PAGE',loopId:'old',page:fgPage('1',[fgRow('账号甲')])});
 assert.equal(r.ok,false);assert.equal(w.state().stats.scanned,0);
});
test('Feigua queue survives a service worker restart before finalization', async()=>{
 const w=await feiguaWorker();await w.message({type:'DRA_FEIGUA_PAGE',page:fgPage('1',[fgRow('账号甲')])});
 const restarted=await worker(structuredClone(w.stored));
 await restarted.feigua.stop();assert.equal(restarted.stored.draOutbox.length,1);assert.equal(restarted.stored.draOutbox[0].payload.author,'账号甲');
});

test('switching to an already-open ordinary tab restores its missing launcher', async()=>{
 const w=await worker();
 w.setTab({url:'https://www.zhihu.com/',active:true});
 const injections=[];
 w.chrome.scripting={executeScript:async options=>{injections.push(options);return [];}};
 assert.ok(w.chrome.tabs.onActivated?.listeners.length,'missing tab activation recovery');
 await w.chrome.tabs.onActivated.listeners[0]({tabId:7,windowId:1});
 assert.equal(injections.length,1);
 assert.deepEqual(Array.from(injections[0].files),['content/floating-launcher.js']);
 assert.equal(injections[0].target.tabId,7);
});

test('tab activation reuses current launcher and skips protected pages',async()=>{
 const w=await worker(),injections=[];
 w.chrome.scripting={executeScript:async options=>{injections.push(options);return [];}};
 w.chrome.tabs.sendMessage=async()=>({launcherVersion:w.chrome.runtime.getManifest().version});
 w.setTab({url:'https://example.com/'});
 await w.chrome.tabs.onActivated.listeners[0]({tabId:7});
 assert.equal(injections.length,0);
 w.chrome.tabs.sendMessage=async()=>null;
 w.setTab({url:'chrome://newtab/'});
 await w.chrome.tabs.onActivated.listeners[0]({tabId:7});
 assert.equal(injections.length,0);
});
test('repeated activation coalesces injection without reloading the tab',async()=>{
 const w=await worker(),injections=[];
 w.chrome.tabs.reload=async()=>{throw Error('must preserve page');};
 w.chrome.scripting={executeScript:async options=>{injections.push(options);return [];}};
 await Promise.all([w.chrome.tabs.onActivated.listeners[0]({tabId:7}),w.chrome.tabs.onActivated.listeners[0]({tabId:7})]);
 assert.equal(injections.length,1);
});

async function parallelWorker() {
 const w=await worker();
 const dyTab={id:7,windowId:1,active:false,status:'complete',url:'https://www.douyin.com/?recommend=1'};
 const fgTab={id:8,windowId:1,active:true,status:'complete',url:feiguaUrl};
 let fgStatus={ok:true,running:false,url:feiguaUrl,visibilityState:'hidden'};
 const previousSend=w.chrome.tabs.sendMessage;
 w.chrome.tabs.get=async id=>id===8?fgTab:dyTab;
 w.chrome.tabs.sendMessage=async(id,message)=>{
  if(id!==8)return previousSend(id,message);
  if(message.type==='DRA_START_LOOP')fgStatus={...fgStatus,running:true,runId:message.runId,loopId:message.loopId};
  if(message.type==='DRA_STOP_LOOP')fgStatus={...fgStatus,running:false};
  return message.type==='DRA_LOOP_STATUS'?fgStatus:{ok:true};
 };
 w.fgTab=fgTab;
 w.fgMessage=message=>new Promise(resolve=>w.chrome.runtime.onMessage.listeners[0]({runId:w.feigua.state().runId,loopId:w.feigua.state().loopId,...message},{tab:fgTab,frameId:0},resolve));
 const started=await w.message({type:'DRA_START',tabId:8});
 assert.equal(started.ok,true,started.error);
 return w;
}
test('starting Feigua preserves Douyin run, isolates snapshot selection and shares outbox',async()=>{
 const w=await parallelWorker();
 assert.equal(w.state().status,'running');assert.equal(w.state().runId,'run');
 assert.equal(w.feigua.state().status,'running');assert.notEqual(w.feigua.state().runId,'run');
 assert.equal(w.sent.some(m=>m.type==='DRA_STOP_LOOP'),false);
 const current=await w.message({type:'DRA_GET_STATUS',tabId:8});
 assert.equal(current.state.route.platform,'feigua');assert.equal(current.tasks.filter(t=>t.status==='running').length,2);
 await Promise.all([
  w.message({type:'DRA_OBSERVATION',observation:{videoId:'dy-live',contentType:'live'}}),
  w.fgMessage({type:'DRA_FEIGUA_PAGE',page:fgPage('fg-one',[fgRow('并行账号')])})
 ]);
 assert.equal(w.state().stats.scanned,1);assert.equal(w.feigua.state().stats.scanned,1);
 await w.feigua.stop();
 assert.equal(w.state().status,'running');assert.equal(w.stored.draOutbox.length,2);
 assert.deepEqual(new Set(w.stored.draOutbox.map(item=>item.sessionId)),new Set(['run',w.feigua.state().runId]));
 assert.equal(w.stored.draFeiguaCollection.finalized,true);
});
test('pausing either platform leaves the other platform alarms and waits alive',async()=>{
 const w=await parallelWorker();
 const waiting=w.fgMessage({type:'DRA_WAIT',until:Date.now()+30000});
 await new Promise(r=>setImmediate(r));
 await w.message({type:'DRA_PAUSE',platform:'feigua'});
 assert.equal((await waiting).ok,false);
 assert.equal(w.state().status,'running');assert.ok(w.alarms.has('dra-watchdog'));
 await w.feigua.resume();await w.setPaused('暂停抖音');
 assert.equal(w.feigua.state().status,'running');assert.ok(w.alarms.has('dra-feigua-watchdog'));
 assert.equal((await w.fgMessage({type:'DRA_PROGRESS',phase:'read'})).ok,true);
});
test('closing Feigua tab pauses only Feigua and keeps its staged candidates',async()=>{
 const w=await parallelWorker();
 await w.fgMessage({type:'DRA_FEIGUA_PAGE',page:fgPage('fg-one',[fgRow('保留账号')])});
 w.chrome.tabs.onRemoved.listeners[0](8);
 await new Promise(r=>setImmediate(r));
 assert.equal(w.feigua.state().status,'paused');assert.equal(w.state().status,'running');
 assert.equal(Object.keys(w.stored.draFeiguaCollection.accounts).length,1);
});
test('shared queue capacity pauses before marking a Douyin video seen and preserves all pending records',async()=>{
 const items=Array.from({length:1000},(_,i)=>({id:`queued-${i}`,sessionId:'old',status:'pending',payload:{record_id:`queued-${i}`,feed_index:i+1}}));
 const w=await worker({draSettings:{dryRun:true,schedule:{enabled:false}},draState:{status:'running',runId:'run',loopId:'loop',feedTabId:7},draOutbox:items});
 const result=await w.message({type:'DRA_OBSERVATION',observation:{videoId:'not-lost',contentType:'live'}});
 assert.equal(result.continue,false);assert.equal(w.state().status,'paused');
 assert.equal(w.stored.draOutbox.length,1000);assert.equal(w.stored.draOutbox[0].id,'queued-0');
 assert.equal(w.stored.draSeenVideos.includes('not-lost'),false);
});
test('one shared uploader preserves acquisition order and credits the owning platform',async()=>{
 const item=(id,sessionId)=>({id,sessionId,status:'pending',queuedAt:new Date().toISOString(),payload:{record_id:id,feed_index:1}});
 const batches=[];
 const w=await worker({draCloudAuth:{device_token:'fixture'},draSettings:{feiguaUploadEnabled:true,schedule:{enabled:false}},draState:{runId:'dy-run'},draFeiguaState:{runId:'fg-run'},draOutbox:[item('d1','dy-run'),item('d2','dy-run'),item('f1','fg-run')]},async(_,options)=>{
  const ids=JSON.parse(options.body).records.map(row=>row.record_id);batches.push(ids);
  return {ok:true,status:200,json:async()=>({accepted:ids})};
 });
 await Promise.all([w.flushOutbox({force:true,limit:1}),w.flushOutbox({force:true,limit:1})]);
 await w.flushOutbox({force:true,limit:1});await w.flushOutbox({force:true,limit:1});
 assert.deepEqual(batches,[['d1'],['d2'],['f1']]);
 assert.equal(w.stored.draState.stats.uploaded,2);assert.equal(w.stored.draFeiguaState.stats.uploaded,1);
});

test('pausing during Feigua start prevents a late launch while Douyin continues',async()=>{
 const w=await parallelWorker();await w.feigua.stop();
 const get=w.chrome.tabs.get;let release;
 w.chrome.tabs.get=async id=>{if(id===8)await new Promise(resolve=>{release=resolve;});return get(id);};
 const starting=w.feigua.start(8);await new Promise(r=>setImmediate(r));
 await w.feigua.pause('取消启动');
 w.chrome.tabs.get=get;release();await starting;
 assert.equal(w.feigua.state().status,'paused');assert.equal(w.state().status,'running');
});
test('Feigua capacity failure retains staged accounts for retry without clearing shared outbox',async()=>{
 const w=await parallelWorker();
 await w.fgMessage({type:'DRA_FEIGUA_PAGE',page:fgPage('p',[fgRow('候选保留')])});
 const saved=structuredClone(w.stored);
 saved.draOutbox=Array.from({length:1000},(_,i)=>({id:`full-${i}`,sessionId:'previous',status:'pending',payload:{record_id:`full-${i}`,feed_index:i+1}}));
 const restarted=await worker(saved);
 await assert.rejects(restarted.feigua.stop(),/队列已满/);
 assert.equal(restarted.feigua.state().status,'paused');
 assert.equal(restarted.state().status,'running');
 assert.equal(Object.keys(restarted.stored.draFeiguaCollection.accounts).length,1);
 assert.equal(restarted.stored.draFeiguaCollection.finalized,false);
 assert.equal(restarted.stored.draOutbox.length,1000);
});

test('shared formal queue keeps uploading when the next task uses dry-run mode',async()=>{
 const w=await worker({draCloudAuth:{device_token:'fixture'},draSettings:{feiguaUploadEnabled:true,dryRun:true,schedule:{enabled:false}},draState:{runId:'dry-task'},draFeiguaState:{runId:'formal-fg'},draOutbox:[{id:'formal-record',sessionId:'formal-fg',status:'pending',payload:{record_id:'formal-record',feed_index:1}}]},async()=>({ok:true,status:200,json:async()=>({accepted:['formal-record']})}));
 await w.flushOutbox({force:true});
 assert.equal(w.stored.draOutbox[0].status,'written');
 assert.equal(w.stored.draFeiguaState.stats.uploaded,1);assert.equal(w.stored.draState.stats.uploaded,0);
});


test('Feigua uploads default off, retaining queued Feigua records while Douyin uploads',async()=>{
 const sent=[];
 const item=(id,platform)=>({id,sessionId:id,status:'pending',payload:{record_id:id,feed_index:1,rpa_feedback:{source_platform:platform}}});
 const w=await worker({draCloudAuth:{device_token:'fixture'},draSettings:{schedule:{enabled:false}},draState:{runId:'dy'},draOutbox:[item('fg','feigua'),item('dy','douyin')]},async(_,options)=>{const ids=JSON.parse(options.body).records.map(r=>r.record_id);sent.push(...ids);return {ok:true,status:200,json:async()=>({accepted:ids})};});
 await w.flushOutbox({force:true});
 assert.deepEqual(sent,['dy']);
 assert.equal(w.stored.draOutbox.find(item=>item.id==='fg').status,'pending');
 assert.equal(w.stored.draSettings.feiguaUploadEnabled,false);
});
test('restoring a formal Feigua collection with uploads off keeps new results local',async()=>{
 const w=await worker({draSettings:{dryRun:false,schedule:{enabled:false}},draFeiguaState:{status:'paused',runId:'fg'},draFeiguaCollection:{runId:'fg',dryRun:false,accounts:{one:{authorName:'本地飞瓜',feedIndex:1}},excluded:{},seen:[],pages:[],finalized:false}});
 assert.equal(w.feigua.state().runSettings.dryRun,true);
 await w.feigua.stop();
 assert.equal(w.stored.draOutbox[0].status,'dry-run');
});

test('Feigua continue navigates an existing Feigua tab back to the collector without resetting progress',async()=>{
 const w=await feiguaWorker();
 await w.message({type:'DRA_FEIGUA_PAGE',page:fgPage('before',[fgRow('先前账号')])});
 await w.feigua.pause('页面离开');
 const runId=w.feigua.state().runId;
 w.setTab({url:'https://dy.feigua.cn/app/#/workbench/index'});
 const navigations=[];
 w.chrome.tabs.update=async(id,options)=>{navigations.push(options);w.setTab({...options,status:'complete'});return w.chrome.tabs.get(id);};
 await w.feigua.resume({windowId:1});
 assert.equal(w.feigua.state().status,'running');
 assert.equal(w.feigua.state().runId,runId);assert.equal(w.feigua.state().stats.scanned,1);
 assert.equal(navigations[0].url,feiguaUrl);
 assert.equal(navigations[0].active,undefined);
});


test('Feigua continue creates a replacement tab when the original is closed and preserves candidates',async()=>{
 const w=await feiguaWorker();
 await w.message({type:'DRA_FEIGUA_PAGE',page:fgPage('before',[fgRow('恢复候选')])});
 await w.feigua.pause('标签页已关闭');
 const runId=w.feigua.state().runId;
 const replacement={id:19,windowId:1,active:true,status:'complete',url:feiguaUrl};
 w.chrome.tabs.get=async id=>{if(id===7)throw Error('closed');return replacement;};
 w.chrome.tabs.query=async()=>[];
 const opened=[];w.chrome.tabs.create=async options=>{opened.push(options);return replacement;};
 await w.feigua.resume({windowId:1});
 assert.equal(opened[0].active,false);
 assert.equal(opened[0].url,feiguaUrl);assert.equal(w.feigua.state().feedTabId,19);
 assert.equal(w.feigua.state().runId,runId);assert.equal(w.feigua.state().stats.scanned,1);
 assert.equal(Object.keys(w.stored.draFeiguaCollection.accounts).length,1);
});
test('Feigua resumed pagination can replay previously collected pages without double counting',async()=>{
 const w=await feiguaWorker();
 await w.message({type:'DRA_FEIGUA_PAGE',page:fgPage('one',[fgRow('甲')])});
 await w.message({type:'DRA_FEIGUA_PAGE',page:fgPage('two',[fgRow('乙')])});
 await w.feigua.pause();await w.feigua.resume({windowId:1});
 const loopId=w.feigua.state().loopId;
 const repeated=await w.message({type:'DRA_FEIGUA_PAGE',loopId,page:fgPage('one',[fgRow('甲')])});
 assert.equal(repeated.continue,true);assert.equal(w.feigua.state().stats.scanned,2);
 const fresh=await w.message({type:'DRA_FEIGUA_PAGE',loopId,page:fgPage('three',[fgRow('丙')])});
 assert.equal(fresh.continue,true);assert.equal(w.feigua.state().stats.scanned,3);
 const stale=await w.message({type:'DRA_FEIGUA_PAGE',loopId,page:fgPage('one',[fgRow('甲')])});
 assert.equal(stale.ok,false);
});
test('Feigua next-run settings can be changed while Douyin runs and do not alter its target',async()=>{
 const w=await worker();const target=structuredClone(w.stored.draSettings.target);
 const response=await new Promise(resolve=>w.chrome.runtime.onMessage.listeners[0]({type:'DRA_SAVE_FEIGUA_CONFIG',maxPages:50,minSeconds:4,maxSeconds:6,keywords:['恐怖','测试词']},{url:'chrome-extension://test/sidepanel/index.html'},resolve));
 assert.equal(response.ok,true,response.error);
 assert.deepEqual(w.stored.draSettings.target,target);
 assert.equal(w.stored.draSettings.feiguaTarget.maxPages,50);
 assert.equal(w.state().status,'running');
 assert.deepEqual(w.stored.draRules.feiguaKeywords,['恐怖','测试词']);
});


test('Feigua default 50-page rest survives restart and manual early resume advances another batch',async()=>{
 const w=await feiguaWorker();
 for(let i=1;i<=50;i++) await w.message({type:'DRA_FEIGUA_PAGE',page:fgPage(String(i),[fgRow(`账号${i}`)])});
 assert.equal(w.state().status,'paused');assert.equal(w.state().stats.pagesCollected,50);
 assert.ok(w.state().restUntil>Date.now()+10790000);assert.equal(w.stored.draFeiguaCollection.finalized,false);
 const restarted=await worker(structuredClone(w.stored));
 assert.equal(restarted.feigua.state().restUntil,w.state().restUntil);
 await restarted.feigua.inspect();assert.equal(restarted.feigua.state().status,'paused');
 await w.resumeRun();
 assert.equal(w.state().batchStartPages,50);assert.equal(w.state().restUntil,null);
 const send=page=>w.message({type:'DRA_FEIGUA_PAGE',loopId:w.state().loopId,page});
 await send(fgPage('50',[fgRow('账号50')]));assert.equal(w.state().stats.pagesCollected,50);
 for(let i=51;i<=100;i++) await send(fgPage(String(i),[fgRow(`账号${i}`)]));
 assert.equal(w.state().status,'paused');assert.equal(w.state().stats.pagesCollected,100);
});
test('Feigua final page ends before rest both below and exactly at page limit',async()=>{
 for(const maxPages of [1,50]) {
  const w=await feiguaWorker();w.state().runTarget={mode:'pages',maxPages};
  await w.message({type:'DRA_FEIGUA_PAGE',page:{...fgPage('last',[fgRow('最后账号')]),last:true}});
  assert.equal(w.state().status,'stopped');assert.equal(w.stored.draFeiguaCollection.finalized,true);
  assert.match(w.state().pauseReason,/当前筛选的最后一页/);assert.equal(w.state().restUntil,null);
 }
});
test('Feigua rejects invalid page and delay settings without saving',async()=>{
 const w=await worker();
 for(const patch of [{maxPages:0},{maxPages:1.5},{minSeconds:0},{maxSeconds:31},{minSeconds:7,maxSeconds:6}]) {
  const result=await new Promise(resolve=>w.chrome.runtime.onMessage.listeners[0]({type:'DRA_SAVE_FEIGUA_CONFIG',maxPages:50,minSeconds:4,maxSeconds:6,keywords:[],...patch},{url:'chrome-extension://test/sidepanel/index.html'},resolve));
  assert.equal(result.ok,false);
 }
 assert.equal(w.stored.draSettings.feiguaTarget.maxPages,50);
});

test('Feigua automatic observations retain excluded raw facts outside the candidate list',async()=>{
 const w=await feiguaWorker();
 await w.message({type:'DRA_FEIGUA_PAGE',page:fgPage('raw',[{...fgRow('甲'),title:'恐怖故事',hotWords:['恐怖'],rawText:'恐怖故事'}])});
 assert.equal((await w.exportObservations()).length,1);
 assert.equal((await w.exportObservations())[0].raw.rawText,'恐怖故事');
});
test('platform previews filter before taking five and count only the selected source',async()=>{
 const w=await worker();
 w.stored.__history=Array.from({length:15},(_,i)=>normalizeHistoryEntry({id:`recent-${i}`,sourcePlatform:i<7?'douyin':'feigua',occurredAt:new Date(Date.now()-30000+i*1000).toISOString(),accountName:`账号${i}`,code:'ACCEPTED'}));
 const douyin=await w.message({type:'DRA_GET_STATUS',platform:'douyin'});
 assert.equal(douyin.decisionHistory.length,5);assert.equal(douyin.decisionHistoryTotal,7);
 assert.ok(douyin.decisionHistory.every(item=>item.sourcePlatform==='douyin'));
 assert.equal(douyin.decisionHistory[0].id,'recent-6');
 const feigua=await w.message({type:'DRA_GET_STATUS',platform:'feigua'});
 assert.equal(feigua.decisionHistory.length,5);assert.equal(feigua.decisionHistoryTotal,8);
 assert.ok(feigua.decisionHistory.every(item=>item.sourcePlatform==='feigua'));
 w.chrome.tabs.get=async()=>({id:9,url:'https://dy.feigua.cn/app/#/video/library/all',windowId:1});
 const followed=await w.message({type:'DRA_GET_STATUS',tabId:9,platform:'auto'});
 assert.equal(followed.decisionHistoryTotal,8);
 const all=await new Promise(resolve=>w.chrome.runtime.onMessage.listeners[0]({type:'DRA_QUERY_HISTORY'},{url:'chrome-extension://test/decisions/index.html'},resolve));
 // The full history query remains separate from task preview filtering.
 assert.equal(all.total,15);
});
test('unknown current page has no Douyin page fallback while manual task selection still works',async()=>{
 const w=await worker();w.chrome.tabs.get=async()=>({id:9,url:'https://example.com',windowId:1});
 const automatic=await w.message({type:'DRA_GET_STATUS',tabId:9});assert.equal(automatic.state.route,null);
 const manual=await w.message({type:'DRA_GET_STATUS',tabId:9,platform:'douyin'});assert.equal(manual.state.runId,'run');
});
test('browse capture after automatic stop persists separately and respects the switch',async()=>{
 const w=await feiguaWorker();await w.feigua.stop();
 const url='https://dy.feigua.cn/app/#/video-detail/index?awemeId=123456789';
 w.chrome.tabs.get=async()=>({id:9,url,active:true});
 const call=message=>new Promise(resolve=>w.chrome.runtime.onMessage.listeners[0](message,{tab:{id:9,url},url,frameId:0},resolve));
 const page={...fgPage('browse',[{...fgRow('浏览账号'),videoId:'123456789'}]),pageUrl:url,surface:'video'};
 const first=await call({type:'DRA_FEIGUA_BROWSE_PAGE',page});assert.equal(first.ok,true);assert.equal(first.count,1);
 assert.equal((await w.exportObservations())[0].mode,'browse');assert.equal(w.feigua.state().status,'stopped');
 const second=await call({type:'DRA_FEIGUA_BROWSE_PAGE',page});assert.equal(second.count,0);
 const set=()=>new Promise(resolve=>w.chrome.runtime.onMessage.listeners[0]({type:'DRA_SET_FEIGUA_BROWSING',enabled:false},{url:'chrome-extension://test/sidepanel/index.html'},resolve));
 assert.equal((await set()).ok,true);
 assert.equal((await call({type:'DRA_FEIGUA_BROWSE_PAGE',page:{...page,rows:[fgRow('另一个')]}})).skipped,true);
});
test('opening another Feigua detail tab pauses automatic Feigua only',async()=>{
 const w=await parallelWorker();
 const url='https://dy.feigua.cn/app/#/video-detail/index?awemeId=123456789';
 const response=await new Promise(resolve=>w.chrome.runtime.onMessage.listeners[0]({type:'DRA_FEIGUA_BROWSE_STATUS'},{tab:{id:9,url},url,frameId:0},resolve));
 assert.equal(response.ok,true);assert.equal(w.feigua.state().status,'paused');assert.equal(w.state().status,'running');
});
test('FIFO batches stop at another session rather than jumping across its earlier observation',async()=>{
 const item=(id,sessionId,time)=>({id,sessionId,status:'pending',queuedAt:'2026-09-10T01:00:00Z',payload:{record_id:id,feed_index:1,observed_at:time}});
 const batches=[];
 const w=await worker({draCloudAuth:{device_token:'fixture'},draSettings:{feiguaUploadEnabled:true,schedule:{enabled:false}},draState:{runId:'dy'},draOutbox:[item('late','dy','2026-09-10T00:03:00Z'),item('early','dy','2026-09-10T00:01:00Z'),item('middle','fg','2026-09-10T00:02:00Z')]},async(_,options)=>{const ids=JSON.parse(options.body).records.map(row=>row.record_id);batches.push(ids);return {ok:true,status:200,json:async()=>({accepted:ids})};});
 await w.flushOutbox({force:true});await w.flushOutbox({force:true});await w.flushOutbox({force:true});assert.deepEqual(batches,[['early'],['middle'],['late']]);
});
test('temporary upload failure waits while another session can upload',async()=>{
 let calls=0;const ids=[];
 const w=await worker({draCloudAuth:{device_token:'fixture'},draSettings:{schedule:{enabled:false}},draOutbox:[{id:'a',sessionId:'a',status:'pending',payload:{record_id:'a',feed_index:1}},{id:'b',sessionId:'b',status:'pending',payload:{record_id:'b',feed_index:1}}]},async(_,options)=>{const records=JSON.parse(options.body).records;ids.push(records[0].record_id);calls++;return calls===1?{ok:false,status:503,json:async()=>({error:'busy'})}:{ok:true,status:200,json:async()=>({accepted:['b']})};});
 await w.flushOutbox({force:true});await w.flushOutbox({force:true});assert.deepEqual(ids,['a','b']);assert.equal(w.stored.draOutbox[0].status,'write-error');assert.ok(w.stored.draOutbox[0].retryAt>Date.now());
});
test('full outbox still drains while durable observations wait for room',async()=>{
 const pending=Array.from({length:1000},(_,i)=>({id:`q${i}`,sessionId:'old',status:'pending',payload:{record_id:`q${i}`,feed_index:i+1}}));
 const obs={id:'waiting',key:'waiting',sessionId:'fg',entityKey:'video:1',surface:'video',sourcePlatform:'feigua',mode:'browse',sequence:1,observedAt:new Date().toISOString(),firstObservedAt:new Date().toISOString(),uploadEligible:true,raw:{authorName:'甲'}};
 const w=await worker({draCloudAuth:{device_token:'fixture'},draSettings:{feiguaUploadEnabled:true,schedule:{enabled:false}},draOutbox:pending,draObservations:{records:[obs],sequence:1}},async(_,options)=>({ok:true,status:200,json:async()=>({accepted:JSON.parse(options.body).records.map(r=>r.record_id)})}));
 await w.flushOutbox({force:true,limit:1});assert.equal(w.stored.draOutbox.find(i=>i.id==='q0').status,'written');
 assert.equal((await w.exportObservations())[0].id,'waiting');
});

test('startup retention cleans expired local facts and retains unresolved upload records',async()=>{
 const old=new Date(Date.now()-3*86400000).toISOString();
 const observation=(id,extra={})=>({id,sequence:Number(id.slice(1)),sourcePlatform:'feigua',sessionId:'old-run',surface:'video',entityKey:id,observedAt:old,lastObservedAt:old,raw:{title:id},...extra});
 const w=await worker({draSettings:{schedule:{enabled:false}},draObservations:{sequence:4,records:[observation('o1',{sessionId:'local-only'}),observation('o2',{uploadEligible:true,queuedId:'o2'}),observation('o3',{uploadEligible:true,queuedId:'o3'}),observation('o4',{sourcePlatform:'douyin',entityKey:'video-4'})]},draOutbox:[{id:'o2',sessionId:'old-run',status:'dead',payload:{record_id:'o2'}},{id:'o3',sessionId:'old-run',status:'written',payload:{record_id:'o3'}},{id:'dy',sessionId:'old-run',status:'pending',payload:{aweme_id:'video-4'}}]});
 assert.equal(w.alarms.get('dra-observations-cleanup').periodInMinutes,60);
 const records=await w.exportObservations();
 assert.ok(records.some(item=>item.id==='o2'));assert.ok(records.some(item=>item.id==='o4'));
 assert.equal(records.some(item=>item.id==='o1'),false);
});


test('Feigua resumes a valid background tab without activation but explicit open focuses it',async()=>{
 const w=await feiguaWorker();
 await w.feigua.pause();
 w.setTab({active:false});
 const updates=[];
 w.chrome.tabs.update=async(id,options)=>{updates.push(options);w.setTab(options);return w.chrome.tabs.get(id);};
 await w.feigua.resume({windowId:1});
 assert.equal(w.feigua.state().status,'running');
 assert.equal(updates.length,0);
 await w.feigua.openPage({windowId:1});
 assert.equal(updates.length,1);assert.equal(updates[0].active,true);
});
