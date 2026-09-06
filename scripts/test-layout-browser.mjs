// Real extension pages, persistent theme preference and emulated OS appearance.
// Uses an isolated Chrome profile; no pairing or uploads.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const delay = ms => new Promise(r=>setTimeout(r,ms));
const root=resolve(import.meta.dirname,'..');
const profile=process.env.RESUME_PROFILE || await mkdtemp(resolve(tmpdir(),'finder-panel-test-'));
if(process.env.RESUME_PROFILE) { const { unlink } = await import('node:fs/promises'); await unlink(resolve(profile,'DevToolsActivePort')).catch(()=>{}); }
const executable=process.env.CHROME_BIN;
if(!executable)throw new Error('Set CHROME_BIN to Chrome for Testing executable');
const chrome=spawn(executable,[`--user-data-dir=${profile}`,'--remote-debugging-port=0','--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check',`--disable-extensions-except=${root}/dist`,`--load-extension=${root}/dist`,'about:blank'],{stdio:'ignore'});
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
  const manifest=await evaluate(candidate,'chrome.runtime.getManifest()');
  await cmd('Target.detachFromTarget',{sessionId:candidate});
  if(manifest.name==='多平台自动找号助手'){extensionId=new URL(worker.url).host;break;}
 }
 if(!extensionId)await delay(200);
}
assert.ok(extensionId,'extension worker loaded');



const report={version:JSON.parse(await readFile(resolve(root,'dist/manifest.json'),'utf8')).version,scenarios:[],startedAt:new Date().toISOString()};
await mkdir(resolve(root,'test-results'),{recursive:true});
const waitFor=async(fn,label)=>{for(let i=0;i<80;i++){if(await fn().catch(()=>false))return;await delay(100);}throw Error(label);};
try{
 const worker=(await cmd('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/background.js`);const sw=await attach(worker.targetId);
 await evaluate(sw,`chrome.tabs.create({url:chrome.runtime.getURL('sidepanel/index.html'),active:true})`);
 let target;await waitFor(async()=>{target=(await cmd('Target.getTargets')).targetInfos.find(t=>t.type==='page'&&t.url===`chrome-extension://${extensionId}/sidepanel/index.html`);return !!target;},'panel');
 const panel=await attach(target.targetId);await cmd('Target.detachFromTarget',{sessionId:sw});
 await waitFor(()=>evaluate(panel,`Boolean(document.querySelector('#themePreference'))`),'loaded');
 await evaluate(panel,`(()=>{
  const send=chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage=(message,callback)=>{
    if(message.type!=='DRA_GET_STATUS')return send(message,callback);
    return send(message,response=>callback({...response,state:{...response.state,status:'paused',pauseReason:'用户暂停',startedAt:new Date(Date.now()-19000).toISOString(),endedAt:new Date().toISOString(),stats:{...response.state.stats,scanned:1,matched:1,newCreators:1},recentDecisions:[{avatarUrl:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',accountName:'小安Anleo · 这是用来验证窄侧栏的长账号名称',code:'ACCEPTED',reasons:['S · 平均点赞10000+ · 粉丝10–100万 · 美食与生活内容'],occurredAt:new Date().toISOString()}]}}));
  };
  document.dispatchEvent(new Event('visibilitychange'));
  document.querySelectorAll('details').forEach(d=>d.open=true);
})()`);
 await waitFor(()=>evaluate(panel,`document.querySelector('.badge')?.textContent==='已暂停'`),'paused fixture rendered');
 for(const theme of ['light','dark']){
  await evaluate(panel,`chrome.storage.local.set({draTheme:${JSON.stringify(theme)}})`);
  for(const width of [280,300,320,360,380,420,520,800]){
   await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},panel);await delay(100);
   const metrics=await evaluate(panel,`(()=>{const w=document.documentElement.clientWidth;const clipped=[...document.querySelectorAll('main > *, .header-actions > *, .decision-avatar, .decision-label, .decision-time, .run-fact strong, button, input, select, textarea')].filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,text:(e.textContent||e.getAttribute('aria-label')||'').slice(0,35),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})).filter(e=>e.left<-.5||e.right>w+.5);return {width:w,scrollWidth:document.documentElement.scrollWidth,clipped};})()`);
   report.scenarios.push({theme,...metrics});assert.ok(metrics.scrollWidth<=width,JSON.stringify(metrics));assert.deepEqual(metrics.clipped,[],JSON.stringify(metrics));
   if(width===300||width===360){await evaluate(panel,`document.querySelector('.health-details').open=false;window.scrollTo(0,0)`);const shot=await cmd('Page.captureScreenshot',{format:'png'},panel);await writeFile(resolve(root,`test-results/layout-${theme}-${width}.png`),Buffer.from(shot.data,'base64'));await evaluate(panel,`document.querySelector('.health-details').open=true`);}
  }
 }
 for(const fontSize of [24,32]) {
  await cmd('Emulation.setDeviceMetricsOverride',{width:320,height:900,deviceScaleFactor:1,mobile:false},panel);
  await evaluate(panel,`document.documentElement.style.fontSize='${fontSize}px'`);await delay(100);
  const metrics=await evaluate(panel,`({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth})`);
  assert.ok(metrics.scrollWidth<=320,JSON.stringify({fontSize,...metrics}));
  report.scenarios.push({fontSize,...metrics});
  await evaluate(panel,`window.scrollTo(0,0)`);
  const shot=await cmd('Page.captureScreenshot',{format:'png'},panel);await writeFile(resolve(root,`test-results/layout-font-${fontSize}.png`),Buffer.from(shot.data,'base64'));
 }
 console.log(JSON.stringify({reviewReady:true,endpoint,extensionId}));
 if(process.env.REVIEW_HOLD_MS)await delay(Number(process.env.REVIEW_HOLD_MS));
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error.stack||error);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(resolve(root,'test-results/layout.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));ws.close();chrome.kill();}
