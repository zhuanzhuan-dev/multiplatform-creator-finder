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



 const api=expression=>evaluate(panel,expression);
 await api(`(()=>{
  const send=chrome.runtime.sendMessage.bind(chrome.runtime);
  window.statsFixture={scanned:13,matched:8,newCreators:5,reviewQueued:1,duplicates:3,notInterested:5,liveSkipped:0,panelSkipped:0,uploaded:12};
  chrome.runtime.sendMessage=(message,callback)=>{
   if(message.type!=='DRA_GET_STATUS')return send(message,callback);
   return send(message,r=>callback({...r,state:{...r.state,stats:window.statsFixture,lastTickAt:new Date().toISOString()}}));
  };
  document.dispatchEvent(new Event('visibilitychange'));
 })()`);
 await waitFor(()=>api(`document.querySelector('.primary-stats strong')?.textContent==='8'`),'fixture stats');
 for(const theme of ['light','dark']) {
  await api(`chrome.storage.local.set({draTheme:${JSON.stringify(theme)}})`);
  for(const width of [280,320,360,520]) {
   await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},panel);await delay(100);
   await api(`document.querySelector('.stats-section').scrollIntoView({block:'start'})`);await delay(100);
   const metrics=await api(`(()=>{const e=document.querySelector('.stats-section');return {height:e.getBoundingClientRect().height,scrollWidth:document.documentElement.scrollWidth,values:[...e.querySelectorAll('.primary-stats strong')].map(e=>e.textContent)};})()`);
   assert.ok(metrics.scrollWidth<=width);assert.deepEqual(metrics.values,['8','5','1']);
   report.scenarios.push({theme,width,...metrics});
   if(width===360){const r=await api(`(()=>{const r=document.querySelector('.stats-section').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:2};})()`);const shot=await cmd('Page.captureScreenshot',{format:'png',clip:r,captureBeyondViewport:true},panel);await writeFile(resolve(root,`test-results/stats-${process.env.BASELINE?'before':'after'}-${theme}.png`),Buffer.from(shot.data,'base64'));}
  }
 }
 if(!process.env.BASELINE) {
  assert.equal(await api(`document.querySelector('.stats-details').open`),false);
  assert.equal(await api(`document.querySelector('.stats-breakdown').checkVisibility()`),false);
  assert.ok(await api(`document.querySelector('.stats-details summary').innerText.includes('13')&&document.querySelector('.stats-details summary').innerText.includes('12')`));
  await cmd('Page.bringToFront',{},panel);
  await api(`document.querySelector('.stats-details summary').focus()`);
  assert.equal(await api(`document.activeElement.matches('.stats-details summary')`),true);
  await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'},panel);
  await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},panel);
  await waitFor(()=>api(`document.querySelector('.stats-details').open`),'keyboard expanded');
  assert.deepEqual(await api(`[...document.querySelectorAll('.stats-breakdown dd')].map(e=>e.textContent)`),['3','5','0','0']);
  await api(`window.statsFixture={scanned:26,matched:16,newCreators:10,reviewQueued:0,duplicates:6,notInterested:10,liveSkipped:0,panelSkipped:2,uploaded:24};document.dispatchEvent(new Event('visibilitychange'))`);
  await waitFor(()=>api(`document.querySelector('.primary-stats strong').textContent==='16'`),'live refresh');
  assert.equal(await api(`document.querySelector('.stats-details').open`),true);
  assert.equal(await api(`!!document.querySelector('.primary-stats .review')`),false);
  assert.deepEqual(await api(`[...document.querySelectorAll('.stats-breakdown dd')].map(e=>e.textContent)`),['6','10','0','2']);
  report.scenarios.push('keyboard-expands-details-live-counts-update-without-collapsing-zero-review-is-neutral');
  await cmd('Emulation.setDeviceMetricsOverride',{width:320,height:900,deviceScaleFactor:1,mobile:false},panel);
  await api(`document.documentElement.style.fontSize='32px'`);await delay(100);
  assert.ok(await api(`document.documentElement.scrollWidth<=320`));
  report.scenarios.push('large-text-expanded-stats-reflow');
 }
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error.stack||error);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(resolve(root,process.env.BASELINE?'test-results/stats-before.json':'test-results/stats-after.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));ws.close();chrome.kill();}
