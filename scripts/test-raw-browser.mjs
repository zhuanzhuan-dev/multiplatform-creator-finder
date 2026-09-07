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
globalThis.launcherTest={set: async patch=>{state={...state,...patch};await persistState();},history:writeDecisions,status:()=>state.status,windows:()=>[...panelPorts.keys()]};`);
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
 const worker=(await cmd('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/background.js`);const sw=await attach(worker.targetId);
 const {targetId}=await cmd('Target.createTarget',{url:'about:blank'});const page=await attach(targetId);
 await cmd('Fetch.enable',{patterns:[{urlPattern:'https://www.douyin.com/*',requestStage:'Request'}]},page);
 listeners.add(m=>{if(m.sessionId===page&&m.method==='Fetch.requestPaused')void cmd('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html; charset=utf-8'}],body:Buffer.from('<!doctype html><html><body><div data-e2e="feed-item" style="width:600px;height:600px"><div data-e2e="feed-photo" data-e2e-vid="12345">图文样本</div><a href="/user/fixture">测试作者</a><p data-e2e="video-desc">测试图文</p><input value="private-password"><span data-token="private-token">内容</span></div></body></html>').toString('base64')},page);});
 await cmd('Page.navigate',{url:'https://www.douyin.com/?recommend=1'},page);
 await waitFor(()=>evaluate(page,`Boolean(document.getElementById('dra-floating-launcher'))`),'content installed');
 await evaluate(page,`document.querySelector('[data-e2e="feed-item"]').__reactProps$fixture={item:{aweme_id:'12345',aweme_type:68,is_ads:false,authentication_token:'private-token'}}`);
 const tab=await evaluate(sw,`chrome.tabs.create({url:chrome.runtime.getURL('sidepanel/index.html'),active:false})`);
 let target;await waitFor(async()=>{target=(await cmd('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/sidepanel/index.html`);return !!target;},'panel');const panel=await attach(target.targetId);
 const api=expression=>evaluate(panel,expression);
 await waitFor(()=>api(`Boolean(document.querySelector('#themePreference'))`),'loaded');
 assert.equal((await api(`chrome.runtime.sendMessage({type:'DRA_DEBUG_STATUS'})`)).enabled,false);
 const blocked=await api(`chrome.runtime.sendMessage({type:'DRA_CAPTURE_RAW',label:'photo'})`);assert.equal(blocked.ok,false);
 await api(`chrome.runtime.sendMessage({type:'DRA_SET_RAW_CAPTURE',enabled:true})`);await delay(150);
 const saved=await api(`chrome.runtime.sendMessage({type:'DRA_CAPTURE_RAW',label:'photo'})`);assert.equal(saved.ok,true,JSON.stringify(saved));assert.equal(saved.samples.count,1);
 const data=await api(`chrome.runtime.sendMessage({type:'DRA_EXPORT_RAW'})`);const sample=data.samples[0];
 assert.equal(sample.label,'photo');assert.equal(sample.parsed.contentType,'photo');assert.ok(sample.dom.includes('feed-photo'));assert.ok(!JSON.stringify(sample).includes('private-'));assert.equal(sample.structured.candidates[0].data.aweme_type,68);
 await cmd('Page.reload',{},panel);await waitFor(()=>api(`Boolean(document.querySelector('#themePreference'))`),'reloaded');
 assert.equal((await api(`chrome.runtime.sendMessage({type:'DRA_DEBUG_STATUS'})`)).samples.count,1);
 // Exercise concurrent insertions and eviction in the real extension IndexedDB.
 const size=await api(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('dra-local-raw-samples',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('samples','readwrite');const store=tx.objectStore('samples');for(let i=0;i<205;i++)store.add({bytes:1,label:'fixture',dom:'x'});tx.oncomplete=resolve;tx.onerror=reject});db.close();return true})()`);assert.equal(size,true);
 const bounded=await api(`chrome.runtime.sendMessage({type:'DRA_CAPTURE_RAW',label:'photo'})`);assert.equal(bounded.samples.count,200);
 assert.equal((await api(`chrome.runtime.sendMessage({type:'DRA_CLEAR_RAW'})`)).samples.count,0);
 assert.equal((await api(`chrome.runtime.sendMessage({type:'DRA_EXPORT_RAW'})`)).samples.length,0);
 // The expanded developer controls must fit inside the narrow settings popover.
 await api(`document.querySelector('[aria-label="设置"]').click();document.querySelector('.debug-settings').open=true`);
 for(const theme of ['light','dark'])for(const width of [280,360,520]) {
  await api(`chrome.storage.local.set({draTheme:${JSON.stringify(theme)}})`);await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},panel);await delay(100);
  assert.ok(await api(`(()=>{const p=document.querySelector('#preferencesPopover');return p.scrollWidth<=p.clientWidth+1&&document.documentElement.scrollWidth<=${width}})()`),'expanded raw settings fit');
  if(width===360){await api(`document.querySelector('.raw-capture-settings').scrollIntoView({block:'nearest'})`);const shot=await cmd('Page.captureScreenshot',{format:'png'},panel);await writeFile(resolve(root,`test-results/raw-settings-${theme}.png`),Buffer.from(shot.data,'base64'));}
 }
 report.scenarios.push('expanded sampling controls fit narrow settings');
 // Full history uses a separate key and remains visible independently of task state.
 await evaluate(sw,`launcherTest.history(Array.from({length:6},(_,i)=>({id:'record-'+i,runId:i<3?'new':'old',runStartedAt:new Date(1700000000000+i*1000).toISOString(),accountName:'测试账号'+i,code:'ACCEPTED',occurredAt:new Date().toISOString()})))`);
 await api(`chrome.tabs.create({url:chrome.runtime.getURL('decisions/index.html'),active:true})`);
 let ledgerTarget;await waitFor(async()=>{ledgerTarget=(await cmd('Target.getTargets')).targetInfos.find(t=>t.url.endsWith('/decisions/index.html'));return !!ledgerTarget;},'history page');
 const ledger=await attach(ledgerTarget.targetId);const historyApi=e=>evaluate(ledger,e);
 await waitFor(()=>historyApi(`document.querySelectorAll('tbody tr').length===6`),'six records across runs');
 await historyApi(`(()=>{const s=document.querySelector('[aria-label="筛选轮次"]');s.value='old';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await waitFor(()=>historyApi(`document.querySelectorAll('tbody tr').length===3`),'run filter');
 await cmd('Page.reload',{},ledger);await waitFor(()=>historyApi(`document.querySelectorAll('tbody tr').length===6`),'history persists reload');
 for(const theme of ['light','dark'])for(const width of [320,520,1280]) {
  await api(`chrome.storage.local.set({draTheme:${JSON.stringify(theme)}})`);await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},ledger);await delay(100);
  assert.ok(await historyApi(`document.documentElement.scrollWidth<=${width}`),'history reflows');
 }
 report.scenarios.push('history across runs','filter by run','history survives reload','history responsive light and dark');
 report.scenarios.push('default disabled','manual labelled DOM capture','raw card fields with matched ID','credentials redacted','IndexedDB survives reload','bounded retention','export and clear');
 await writeFile(resolve(root,'test-results/raw-samples.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await cmd('Browser.close').catch(()=>{});ws.close();chrome.kill();}
