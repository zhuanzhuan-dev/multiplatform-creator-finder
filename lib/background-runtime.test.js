import { newEngagement } from './engagement.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { prepareLegacyHistory, normalizeHistoryEntry } from './decision-history.js';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(new URL('../background.js', import.meta.url), 'utf8');
const bundle = await build({
  stdin: { contents: source + '\nglobalThis.runtimeTest = { initialize, watchdog, setPaused, stopRun, configureOpenTabSidePanels, flushOutbox, handleUploadAlarm, resumeRun, state: () => state };', resolveDir: root, loader: 'js' },
  bundle: true, format: 'iife', write: false, platform: 'browser',
  plugins:[{name:'history-test-adapter',setup(b){b.onLoad({filter:/decision-store\.js$/},()=>({contents:`
    export const migrateDecisionHistory=(...args)=>globalThis.testHistory.migrate(...args);
    export const writeDecisions=(...args)=>globalThis.testHistory.write(...args);
    export const cleanupDecisions=async()=>{};
    export const decisionPreview=()=>globalThis.testHistory.preview();
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
    tabs: { onRemoved:event(), onUpdated:event(), get:async()=>tab, query:async()=>[tab], update:async()=>tab, remove:async()=>{}, sendMessage: async(_, message)=>{
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
    preview:async()=>{const items=stored.__history.filter(e=>e.occurredAtMs>Date.now()-86400000).slice().reverse().sort((a,b)=>b.occurredAtMs-a.occurredAtMs);return {items:items.slice(0,5),total:items.length};}
  };
  const context = { testHistory, chrome, crypto:globalThis.crypto, structuredClone, URL, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout, console, fetch:fetchImpl || (()=>{throw new Error('Unexpected network call');}) };
  vm.runInNewContext(bundle.outputFiles[0].text, context);
  await context.runtimeTest.initialize();
  await new Promise(resolve=>setImmediate(resolve));
  return {
    stored, sent, commands, alarms, chrome, ...context.runtimeTest,
    setStatus: value=>{status={...status,...value};},
    hangStop:()=>{stopUnresponsive=true;},
    failDebugger:()=>{debuggerError=new Error('debugger unavailable');},
    message: message=>new Promise(resolve=>chrome.runtime.onMessage.listeners[0]({runId:'run',loopId:'loop',...message},{tab},resolve))
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
 assert.equal(created[0].url,'https://whislte.cc.cd');
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
 assert.equal((await w.message({type:'DRA_GET_LAUNCHER'})).launcher.visible,false);
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
