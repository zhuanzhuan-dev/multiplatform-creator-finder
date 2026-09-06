import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(new URL('../background.js', import.meta.url), 'utf8');
const bundle = await build({
  stdin: { contents: source + '\nglobalThis.runtimeTest = { initialize, watchdog, setPaused, stopRun, state: () => state };', resolveDir: root, loader: 'js' },
  bundle: true, format: 'iife', write: false, platform: 'browser'
});
function event() { const listeners = []; return { listeners, addListener(fn) { listeners.push(fn); }, removeListener(fn) { const i = listeners.indexOf(fn); if(i >= 0) listeners.splice(i, 1); } }; }
async function worker() {
  const stored = {
    draSettings: { dryRun: true, cloud: { enabled: false }, schedule: { enabled: false } },
    draState: { status: 'running', feedTabId: 7, feedWindowId: 1, runId: 'run', loopId: 'loop', startedAt: new Date().toISOString(), stopAt: Date.now() + 600000, runTarget: { mode: 'time', durationMinutes: 10 }, runtime: { phase: 'dwell', deadlineAt: Date.now() + 300000, recoveryAttempts: 0 } }
  };
  let status = { running: true, runId: 'run', loopId: 'loop', visibilityState: 'visible', url: 'https://www.douyin.com/?recommend=1' };
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
    sidePanel: {setPanelBehavior:async()=>{},setOptions:async()=>{}},
    action: {onClicked:event()},
    debugger: {onDetach:event(),attach:async()=>{},detach:async()=>{},sendCommand:async(_, method)=>{commands.push(method);if(debuggerError)throw debuggerError;return {frameTree:{}};} }
  };
  const context = { chrome, crypto:globalThis.crypto, structuredClone, URL, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout, console, fetch:()=>{throw new Error('Unexpected network call');} };
  vm.runInNewContext(bundle.outputFiles[0].text, context);
  await context.runtimeTest.initialize();
  return {
    stored, sent, commands, alarms, ...context.runtimeTest,
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
