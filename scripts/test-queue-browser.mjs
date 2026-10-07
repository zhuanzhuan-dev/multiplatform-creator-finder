// Isolated Chrome queue regression and performance comparison.
// Exercises production persistence and sidepanel code; uploads use an in-memory response.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const delay = ms => new Promise(r=>setTimeout(r,ms));
const root=resolve(import.meta.dirname,'..');
const profile=await mkdtemp(resolve(tmpdir(),'finder-queue-test-'));
const executable=process.env.CHROME_BIN;
if(!executable)throw new Error('Set CHROME_BIN to Chrome for Testing executable');

const {cp}=await import('node:fs/promises');
const {build}=await import('esbuild');
const {createServer}=await import('node:http');
const testDist=resolve(profile,'extension');
await cp(resolve(root,'dist'),testDist,{recursive:true});
const original=await readFile(resolve(root,'background.js'),'utf8');
const instrumentation=`
// Seed an old-version profile before the normal background initialization.
const legacyRow=(id,status,extra={})=>({id,status,sessionId:'legacy',payload:{record_id:id,feed_index:1},...extra});
globalThis.queueProbeLegacySeed=chrome.storage.local.set({draOutbox:[legacyRow('ack','written'),legacyRow('dup','duplicate'),legacyRow('pending','pending'),legacyRow('failure','write-error',{retryAt:Date.now()+600000}),legacyRow('transition','pending',{transitionPending:true})],draBilibili:{state:{status:'paused',runId:'legacy-b',freshIdx:19},seen:['BVlegacy'],creators:['123']}});
// Cloud clients capture fetch at creation; block network before constructing them.
globalThis.fetch=(...args)=>{if(globalThis.queueProbeFetch)return globalThis.queueProbeFetch(...args);throw Error('Unexpected network call in isolated queue test');};
globalThis.queueProbeMetrics={writes:0,bytes:0,queueWrites:0,queuePuts:0,queueDeletes:0,statusRequests:0};
const setLocal=chrome.storage.local.set.bind(chrome.storage.local);
chrome.storage.local.set=async values=>{queueProbeMetrics.writes++;queueProbeMetrics.bytes+=new TextEncoder().encode(JSON.stringify(values)).length;if(values.draOutbox)queueProbeMetrics.queueWrites++;return setLocal(values);};
const putRecord=IDBObjectStore.prototype.put,deleteRecord=IDBObjectStore.prototype.delete;
IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name==='dra-upload-queue'&&this.name==='records')queueProbeMetrics.queuePuts++;return putRecord.apply(this,args);};
IDBObjectStore.prototype.delete=function(...args){if(this.transaction.db.name==='dra-upload-queue'&&this.name==='records')queueProbeMetrics.queueDeletes++;return deleteRecord.apply(this,args);};
const registerMessage=chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
chrome.runtime.onMessage.addListener=listener=>registerMessage((message,sender,reply)=>{if(message.type==='DRA_GET_STATUS')queueProbeMetrics.statusRequests++;return listener(message,sender,reply);});
`;
const api=`
import {readOutbox} from "./lib/outbox-store.js";
globalThis.queueProbe={
 seed:async(size)=>{
  await initialize();settings.keepSystemAwake=false;
  state={...cloneInitialState(),status:'running',runId:'probe-douyin',feedTabId:99997,loopId:'probe-d-loop',startedAt:new Date().toISOString(),stopAt:Date.now()+600000,runtime:{phase:'read'}};
  bilibili.restore({draBilibiliState:{status:'running',runId:'probe-bilibili',feedTabId:99998,feedWindowId:1,loopId:'probe-b-loop',startedAt:new Date().toISOString(),runSettings:{...settings,keepSystemAwake:false},runRules:bilibiliConfig.rules},draBilibili:{seen:[],creators:[]}});
  removeOutbox(outbox.map(item=>item.id));
  for(let i=0;i<size;i++)addOutbox('pending',{record_id:'probe-'+i,feed_index:i+1,caption:'x'.repeat(2048)});
  await persistWorkData();
  await chrome.alarms.clearAll();
 },
 reset:()=>{globalThis.queueProbeMetrics={writes:0,bytes:0,queueWrites:0,queuePuts:0,queueDeletes:0,statusRequests:0};},
 progress:async(count)=>{
  const started=performance.now();
  for(let i=0;i<count;i++)await Promise.all([
   persistState(),
   bilibili.message({type:'DRA_PROGRESS',phase:'submit',runId:bilibili.state().runId,loopId:bilibili.state().loopId},{tab:{id:99998,url:'https://www.bilibili.com/'}})
  ]);
  return {elapsedMs:Math.round(performance.now()-started),...queueProbeMetrics};
 },
 metrics:()=>queueProbeMetrics,
 snapshot:async()=>{await initialize();return readOutbox();},
 display:async()=>{state.stats.scanned=211;bilibili.state().stats.scanned=119;await persistState();await persistTaskProgress(bilibili.progressStorage());},
 drain:async()=>{
  removeOutbox(outbox.map(item=>item.id));
  for(let i=0;i<320;i++)addOutbox('pending',{record_id:'upload-'+i,feed_index:i+1});
  await persistWorkData();cloudAuth={device_token:'isolated-fixture'};let requests=0;
  globalThis.queueProbeFetch=async(_url,options)=>{requests++;const rows=JSON.parse(options.body).records;return {ok:true,status:200,json:async()=>({accepted:rows.filter((_,i)=>i%2===0).map(row=>row.record_id),duplicated:rows.filter((_,i)=>i%2!==0).map(row=>row.record_id)})};};
  try{await Promise.all([handleUploadAlarm(),handleUploadAlarm()]);return {requests,retained:(await readOutbox()).length,uploaded:state.stats.uploaded};}
  finally{delete globalThis.queueProbeFetch;cloudAuth=null;await chrome.alarms.clearAll();}
 }
};`;
await build({stdin:{contents:instrumentation+original.replace('async function initialize() {','async function initialize() { await globalThis.queueProbeLegacySeed;')+api,resolveDir:root,loader:'js'},outfile:resolve(testDist,'background.js'),bundle:true,format:'esm',platform:'browser',target:'chrome120'});
const launcherPrefix=`globalThis.queueTabProbe={events:0,queueEvents:0,layoutReads:0,visibilityWrites:0};
const registerStorage=chrome.storage.onChanged.addListener.bind(chrome.storage.onChanged);
chrome.storage.onChanged.addListener=listener=>registerStorage((changes,area)=>{queueTabProbe.events++;if(changes.draOutbox)queueTabProbe.queueEvents++;return listener(changes,area);});
const originalToggle=Element.prototype.toggleAttribute;Element.prototype.toggleAttribute=function(...args){if(this.id==='dra-floating-launcher')queueTabProbe.visibilityWrites++;return originalToggle.apply(this,args);};
const originalRect=Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect=function(){if(this.id==='dra-floating-launcher'||this.getRootNode()?.host?.id==='dra-floating-launcher')queueTabProbe.layoutReads++;return originalRect.call(this);};`;
await writeFile(resolve(testDist,'content/floating-launcher.js'),launcherPrefix+await readFile(resolve(testDist,'content/floating-launcher.js'),'utf8'));
const server=createServer((_req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end('<!doctype html><title>Queue benchmark</title><p>Isolated extension fixture</p>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
process.on('exit',()=>server.close());
const fixtureUrl=`http://127.0.0.1:${server.address().port}/`;

const chrome=spawn(executable,[`--user-data-dir=${profile}`,'--remote-debugging-port=0','--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check',`--disable-extensions-except=${testDist}`,`--load-extension=${testDist}`,'about:blank'],{stdio:'ignore'});
process.on('exit',()=>chrome.kill());
let endpoint;
for(let i=0;i<100;i++){try{const [port,path]=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');endpoint=`ws://127.0.0.1:${port}${path}`;break;}catch{await delay(100);}}
if(!endpoint)throw new Error('Chrome failed to start');
console.log(JSON.stringify({profile,endpoint,pid:chrome.pid}));
const ws=new WebSocket(endpoint);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let seq=0;const pending=new Map(),listeners=new Set();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}else for(const f of [...listeners])f(m);});
function cmd(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}`));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,sessionId}));});}
async function attach(targetId){return (await cmd('Target.attachToTarget',{targetId,flatten:true})).sessionId;}
async function evaluate(sessionId,expression){const r=await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
let extensionId;
for(let i=0;i<50&&!extensionId;i++){
 const {targetInfos}=await cmd('Target.getTargets');
 for(const worker of targetInfos.filter(t=>t.type==='service_worker'&&t.url.startsWith('chrome-extension://')&&t.url.endsWith('/background.js'))){
  const candidate=await attach(worker.targetId);
  const manifest=await evaluate(candidate,'globalThis.chrome?.runtime?.getManifest?.()');
  await cmd('Target.detachFromTarget',{sessionId:candidate});
  if(manifest?.name==='多平台自动找号助手'){extensionId=new URL(worker.url).host;break;}
 }
 if(!extensionId)await delay(200);
}
assert.ok(extensionId,'extension worker loaded');




await mkdir(resolve(root,'artifacts'),{recursive:true});
const report={version:JSON.parse(await readFile(resolve(root,'dist/manifest.json'),'utf8')).version,fixture:true,chrome:await cmd('Browser.getVersion'),tabs:8,scenarios:[]};
const waitFor=async(fn,label)=>{for(let i=0;i<80;i++){if(await fn())return;await delay(100);}throw Error(label);};
try {
 const worker=(await cmd('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/background.js`);
 let sw=await attach(worker.targetId);
 const api=expression=>evaluate(sw,expression);
 const migrated=await api('queueProbe.snapshot()');
 assert.deepEqual(migrated.map(item=>item.id),['pending','failure','transition']);
 const saved=await api("chrome.storage.local.get(['draOutbox','draBilibili','draBilibiliState'])");
 assert.equal(saved.draOutbox,undefined);assert.equal(saved.draBilibiliState.freshIdx,19);assert.deepEqual(saved.draBilibili.seen,['BVlegacy']);
 report.migration={remaining:migrated.map(item=>item.id),legacyQueueRemoved:true,bilibiliFreshIdx:saved.draBilibiliState.freshIdx};
 const tabs=[];
 for(let i=0;i<report.tabs;i++)tabs.push(await api(`chrome.tabs.create({url:${JSON.stringify(fixtureUrl)},active:false})`));
 await api(`chrome.tabs.create({url:chrome.runtime.getURL('sidepanel/index.html'),active:true})`);
 await delay(1800);
 const queryTabs=()=>api(`Promise.all(${JSON.stringify(tabs.map(v=>v.id))}.map(tabId=>chrome.scripting.executeScript({target:{tabId},func:()=>globalThis.queueTabProbe}))).then(items=>items.map(v=>v[0].result))`);
 assert.ok((await queryTabs()).every(Boolean),'all fixture launchers installed');
 for(const size of [0,1000,1000,1000]) {
  await api(`queueProbe.seed(${size})`);await delay(200);
  await api(`Promise.all(${JSON.stringify(tabs.map(v=>v.id))}.map(tabId=>chrome.scripting.executeScript({target:{tabId},func:()=>{globalThis.queueTabProbe={events:0,queueEvents:0,layoutReads:0,visibilityWrites:0};}})))`);
  await api('queueProbe.reset()');
  const before=(await cmd('SystemInfo.getProcessInfo')).processInfo;
  const start=performance.now();
  const measured=await api('queueProbe.progress(100)');
  await delay(250);
  const metrics=await api('queueProbe.metrics()');
  const after=(await cmd('SystemInfo.getProcessInfo')).processInfo;
  const cpuSeconds=after.reduce((sum,v)=>sum+Math.max(0,v.cpuTime-(before.find(b=>b.id===v.id)?.cpuTime||v.cpuTime)),0);
  const tabMetrics=await queryTabs();
  const scenario={mode:'fixed',queue:size,progressMessages:200,...measured,statusRequests:metrics.statusRequests,chromeCpuMs:Math.round(cpuSeconds*1000),withDeliveryMs:Math.round(performance.now()-start),tabMetrics};
  assert.equal(scenario.queueWrites,0);assert.equal(scenario.queuePuts,0);assert.equal(scenario.queueDeletes,0);
  assert.ok(scenario.bytes<2000000);assert.ok(scenario.statusRequests<=10);
  assert.equal((await api('queueProbe.snapshot()')).length,size);
  report.scenarios.push(scenario);console.log(JSON.stringify(scenario));
 }

 const panelTarget=(await cmd('Target.getTargets')).targetInfos.find(target=>target.type==='page'&&target.url===`chrome-extension://${extensionId}/sidepanel/index.html`);
 const panel=await attach(panelTarget.targetId);
 await api('queueProbe.display()');
 const panelRows=()=>evaluate(panel,`[...document.querySelectorAll('.platform-row')].map(row=>row.textContent)`);
 await waitFor(async()=>{const rows=await panelRows();return rows[0]?.includes('211 条')&&rows[2]?.includes('119 条');},'merged refresh must display the latest state of both platforms');
 await evaluate(panel,`document.querySelectorAll('.platform-row')[2].click()`);
 await waitFor(()=>evaluate(panel,`document.querySelector('.platform-trigger')?.getAttribute('aria-label')==='平台任务：B站首页推荐'`),'platform selection survives refresh coalescing');
 const launcherRows=await api(`chrome.scripting.executeScript({target:{tabId:${tabs[0].id}},func:()=>document.getElementById('dra-floating-launcher').shadowRoot.querySelector('.task-list').textContent}).then(results=>results[0].result)`);
 assert.match(launcherRows,/已刷 211 条/);assert.match(launcherRows,/已刷 119 条/);
 report.display={panelRows:await panelRows(),launcherRows,selected:'bilibili'};

 report.launcherNoise={unrelatedWrites:30};
 await api(`Promise.all(${JSON.stringify(tabs.map(v=>v.id))}.map(tabId=>chrome.scripting.executeScript({target:{tabId},func:()=>{globalThis.queueTabProbe={events:0,queueEvents:0,layoutReads:0,visibilityWrites:0};}})))`);
 for(let i=0;i<30;i++)await api(`chrome.storage.local.set({queueProbeNoise:${i}})`);
 await delay(250);report.launcherNoise.tabMetrics=await queryTabs();
 assert.ok(report.launcherNoise.tabMetrics.every(tab=>tab.layoutReads===0&&tab.visibilityWrites===0));
 report.uploads=await api('queueProbe.drain()');assert.equal(report.uploads.requests,4);assert.equal(report.uploads.retained,0);assert.equal(report.uploads.uploaded,320);
 await writeFile(resolve(root,'artifacts/queue-fixed-chrome.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({migration:report.migration,uploads:report.uploads,launcherNoise:report.launcherNoise,display:report.display}));
} finally {await cmd('Browser.close').catch(()=>{});ws.close();chrome.kill();await new Promise(r=>server.close(r));}
