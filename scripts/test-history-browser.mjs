// Real extension pages, persistent theme preference and emulated OS appearance.
// Uses an isolated Chrome profile; no pairing or uploads.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const delay = ms => new Promise(r=>setTimeout(r,ms));
const root=resolve(import.meta.dirname,'..');
const profile=process.env.RESUME_PROFILE || await mkdtemp(resolve(tmpdir(),'finder-panel-test-'));
if(process.env.RESUME_PROFILE) { const { unlink } = await import('node:fs/promises'); await unlink(resolve(profile,'DevToolsActivePort')).catch(()=>{}); }
const executable=process.env.CHROME_BIN;
if(!executable)throw new Error('Set CHROME_BIN to Chrome for Testing executable');
const fixtureDist=await mkdtemp(resolve(tmpdir(),'finder-launcher-dist-'));
await cp(resolve(root,'dist'),fixtureDist,{recursive:true});
await writeFile(resolve(fixtureDist,'background.js'),(await readFile(resolve(fixtureDist,'background.js'),'utf8'))+`
globalThis.launcherTest={set: async patch=>{state={...state,...patch};await persistState();},history:{write:writeDecisions,query:queryDecisions,preview:decisionPreview,migrate:migrateDecisionHistory,cleanup:cleanupDecisions},status:()=>state.status,windows:()=>[...panelPorts.keys()]};`);
const chrome=spawn(executable,[`--user-data-dir=${profile}`,'--remote-debugging-port=0','--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check',`--disable-extensions-except=${fixtureDist}`,`--load-extension=${fixtureDist}`,'about:blank'],{stdio:'ignore'});
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



const report={version:JSON.parse(await readFile(resolve(root,'dist/manifest.json'),'utf8')).version,scenarios:[],startedAt:new Date().toISOString()};
await mkdir(resolve(root,'test-results'),{recursive:true});
const waitFor=async(fn,label)=>{for(let i=0;i<80;i++){if(await fn().catch(()=>false))return;await delay(100);}throw Error(label);};
try {
 const worker=(await cmd('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/background.js`);let sw=await attach(worker.targetId);
 await evaluate(sw,`chrome.tabs.create({url:chrome.runtime.getURL('sidepanel/index.html'),active:true})`);
 let target;await waitFor(async()=>{target=(await cmd('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/sidepanel/index.html`);return !!target;},'panel');const panel=await attach(target.targetId);const api=e=>evaluate(panel,e);
 await waitFor(()=>api(`Boolean(document.querySelector('#themePreference'))`),'ready');
 await api(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('dra-decision-history',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise((resolve,reject)=>{const tx=db.transaction(['records','meta'],'readwrite');tx.objectStore('records').clear();tx.objectStore('meta').clear();tx.oncomplete=resolve;tx.onerror=reject});db.close()})()`);
 const now=Date.now();
 const sources=['douyin','kuaishou','feigua','xingtu'];
 const entries=Array.from({length:180},(_,i)=>({id:'item-'+String(i).padStart(3,'0'),occurredAt:new Date(now-Math.floor(i/3)*1000).toISOString(),sourcePlatform:sources[i%4],runId:i<90?'new':'old',runStartedAt:new Date(now-i*1000).toISOString(),accountName:'账号 '+i,code:i%3?'ACCEPTED':'ACCEPTED_REVIEW',reasons:['来源验证']}));
 entries.push({id:'expired',occurredAt:new Date(now-86400001).toISOString(),code:'ACCEPTED'});
 const seed=JSON.stringify({draDecisionHistory:entries});
 await evaluate(sw,`launcherTest.history.migrate(${seed},${now})`);await evaluate(sw,`launcherTest.history.migrate(${seed},${now})`);
 const preview=await evaluate(sw,'launcherTest.history.preview()');assert.equal(preview.total,180);assert.equal(preview.items.length,5);
 let cursor=null,asOf,all=[];for(let i=0;i<4;i++){
  const result=await api(`chrome.runtime.sendMessage({type:'DRA_QUERY_HISTORY',options:${JSON.stringify({cursor,asOf})}})`);
  assert.equal(result.ok,true);assert.equal(result.total,180);assert.equal(result.items.length,i<3?50:30);all.push(...result.items.map(e=>e.id));cursor=result.nextCursor;asOf=result.asOf;
 }
 assert.equal(new Set(all).size,180);assert.equal(cursor,null);
 const source=await api(`chrome.runtime.sendMessage({type:'DRA_QUERY_HISTORY',options:{sourcePlatform:'feigua'}})`);assert.equal(source.total,45);assert.ok(source.items.every(e=>e.sourcePlatform==='feigua'));
 const filtered=await api(`chrome.runtime.sendMessage({type:'DRA_QUERY_HISTORY',options:{sourcePlatform:'feigua',runId:'new',query:'账号',tone:'good'}})`);assert.ok(filtered.items.every(e=>e.sourcePlatform==='feigua'&&e.runId==='new'&&e.code==='ACCEPTED'));
 await api(`document.dispatchEvent(new Event('visibilitychange'))`);await waitFor(()=>api(`document.querySelector('.decision-toggle')?.textContent.includes('180')`),'preview total');assert.equal(await api(`document.querySelectorAll('.decision-row').length`),5);
 await api(`document.querySelector('.decision-toggle').click()`);
 let ledgerTarget;await waitFor(async()=>{ledgerTarget=(await cmd('Target.getTargets')).targetInfos.find(t=>t.url.endsWith('/decisions/index.html'));return !!ledgerTarget;},'history page');const ledger=await attach(ledgerTarget.targetId);const ledgerApi=e=>evaluate(ledger,e);
 await waitFor(()=>ledgerApi(`document.querySelectorAll('tbody tr').length===50`),'first page');
 await ledgerApi(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='下一页').click()`);await waitFor(()=>ledgerApi(`document.querySelector('.history-pagination span').textContent==='第 2 页'&&!document.querySelector('.ledger').getAttribute('aria-busy').includes('true')`),'second page');
 await ledgerApi(`(()=>{const select=document.querySelector('[aria-label="筛选平台来源"]');select.value='xingtu';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await waitFor(()=>ledgerApi(`document.querySelectorAll('tbody tr').length===45`),'platform filter');assert.ok(await ledgerApi(`Array.from(document.querySelectorAll('td[data-label="平台来源"]')).every(e=>e.textContent==='星图')`));
 for(const theme of ['light','dark'])for(const width of [320,520,1280]){
  await api(`chrome.storage.local.set({draTheme:${JSON.stringify(theme)}})`);await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},ledger);await delay(100);assert.ok(await ledgerApi(`document.documentElement.scrollWidth<=${width}`));
  if(width===1280||width===320){const shot=await cmd('Page.captureScreenshot',{format:'png'},ledger);await writeFile(resolve(root,`test-results/history-${theme}-${width}.png`),Buffer.from(shot.data,'base64'));}
 }
 await cmd('Page.reload',{},ledger);await waitFor(()=>ledgerApi(`document.querySelectorAll('tbody tr').length===50`),'reload persists records');
 await evaluate(sw,`launcherTest.history.write([{id:'edge',occurredAt:new Date(${now}-86400000+100).toISOString(),code:'ACCEPTED'}],${now})`);
 assert.equal((await evaluate(sw,`launcherTest.history.preview(${now}+50)`)).total,181);
 assert.equal((await evaluate(sw,`launcherTest.history.preview(${now}+101)`)).total,180);
 await evaluate(sw,`launcherTest.history.cleanup(${now}+101)`);
 const physical=await api(`(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('dra-decision-history');r.onsuccess=()=>resolve(r.result)});const count=await new Promise(resolve=>{const r=db.transaction('records').objectStore('records').count();r.onsuccess=()=>resolve(r.result)});db.close();return count})()`);assert.equal(physical,180);
 // Reopen after terminating the worker; records are persisted outside memory.
 await cmd('Target.detachFromTarget',{sessionId:sw});
 const versions=new Map();const onVersion=m=>{if(m.sessionId===panel&&m.method==='ServiceWorker.workerVersionUpdated')for(const v of m.params.versions)versions.set(v.versionId,v);};listeners.add(onVersion);
 await cmd('ServiceWorker.enable',{},panel);await delay(500);const version=[...versions.values()].find(v=>v.scriptURL===worker.url);assert.ok(version);await cmd('ServiceWorker.stopWorker',{versionId:version.versionId},panel);
 const restored=await api(`chrome.runtime.sendMessage({type:'DRA_QUERY_HISTORY',options:{}})`);assert.equal(restored.total,180);
 report.scenarios=['idempotent legacy migration','180 records retained','50-row cursor pagination with timestamp ties','source/run/search/result filters','five-row preview with full count','history page source column and pagination','light/dark responsive layout','reload and worker restart persistence','24h query cutoff and physical cleanup'];
 report.passed=true;await writeFile(resolve(root,'test-results/history.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await cmd('Browser.close').catch(()=>{});ws.close();chrome.kill();}
