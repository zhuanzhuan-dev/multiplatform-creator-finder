import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(new URL('../background.js', import.meta.url), 'utf8');
const bundle = await build({
  stdin: { contents: source + '\nglobalThis.runtimeTest = { initialize, watchdog, setPaused, stopRun, configureOpenTabSidePanels, state: () => state };', resolveDir: root, loader: 'js' },
  bundle: true, format: 'iife', write: false, platform: 'browser'
});
function event() { const listeners = []; return { listeners, addListener(fn) { listeners.push(fn); }, removeListener(fn) { const i = listeners.indexOf(fn); if(i >= 0) listeners.splice(i, 1); } }; }
async function worker(saved = null) {
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
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), sendMessage: async()=>{}, getManifest:()=>({version:'1.0.6'}), getURL:p=>`chrome-extension://test/${p}` },
    storage: { local: { get: async()=>structuredClone(stored), set: async v=>Object.assign(stored, structuredClone(v)) } },
    alarms: { onAlarm: event(), clear: async n=>alarms.delete(n), create: async(n,v)=>alarms.set(n,v), get:async n=>alarms.get(n) },
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
    action: {onClicked:event()},
    debugger: {onDetach:event(),attach:async()=>{},detach:async()=>{},sendCommand:async(_, method)=>{commands.push(method);if(debuggerError)throw debuggerError;return {frameTree:{}};} }
  };
  const context = { chrome, crypto:globalThis.crypto, structuredClone, URL, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout, console, fetch:()=>{throw new Error('Unexpected network call');} };
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
