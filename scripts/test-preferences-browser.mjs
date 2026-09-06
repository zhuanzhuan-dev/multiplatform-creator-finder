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
 const click=async selector=>{
  const p=await api(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',...p},panel);
  await cmd('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p},panel);
  await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p},panel);
 };
 const open=()=>api(`!document.querySelector('#preferencesPopover').hidden`);
 const gear='button[aria-label="设置"]';
 assert.equal(await open(),false);
 assert.equal(await api(`document.querySelector('#themePreference').getClientRects().length`),0);
 assert.equal(await api(`!!document.querySelector('.utility-list')`),false);
 for(const width of [280,320,360,520]) {
  await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},panel);await delay(100);
  const top=await api(`document.querySelector('.run-card').getBoundingClientRect().top`);
  await click(gear);await waitFor(open,'settings open');
  assert.equal(await api(`document.activeElement.id`),'themePreference');
  assert.equal(await api(`document.querySelector('button[aria-label="设置"]').getAttribute('aria-expanded')`),'true');
  const bounds=await api(`(()=>{const r=document.querySelector('#preferencesPopover').getBoundingClientRect();return {left:r.left,right:r.right,scroll:document.documentElement.scrollWidth};})()`);
  assert.ok(bounds.left>=0&&bounds.right<=width&&bounds.scroll<=width,JSON.stringify(bounds));
  assert.equal(await api(`document.querySelector('.run-card').getBoundingClientRect().top`),top);
  if(width===360){const shot=await cmd('Page.captureScreenshot',{format:'png'},panel);await writeFile(resolve(root,'test-results/preferences-open-light.png'),Buffer.from(shot.data,'base64'));}
  await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},panel);
  await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},panel);
  await waitFor(async()=>!await open(),'escape dismissed');
  assert.equal(await api(`document.activeElement.getAttribute('aria-label')`),'设置');
  report.scenarios.push(`settings-${width}-fits-without-shifting-content-and-escape-restores-focus`);
 }
 await click(gear);await waitFor(open,'settings open');
 await api(`(()=>{const s=document.querySelector('#themePreference');s.value='dark';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await waitFor(()=>api(`chrome.storage.local.get('draTheme').then(v=>v.draTheme==='dark')`),'theme saved');
 assert.equal(await open(),true);
 await click('button[aria-label="关闭设置"]');await waitFor(async()=>!await open(),'close button');
 assert.equal(await api(`document.activeElement.getAttribute('aria-label')`),'设置');
 await click(gear);await waitFor(open,'reopened');
 await cmd('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:2,y:300},panel);
 await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:2,y:300},panel);
 await waitFor(async()=>!await open(),'outside dismissed');
 await cmd('Page.reload',{},panel);await waitFor(()=>api(`!!document.querySelector('#themePreference')`),'reloaded');
 assert.equal(await open(),false);await click(gear);await waitFor(open,'reopened after reload');
 assert.equal(await api(`document.querySelector('#themePreference').value`),'dark');
 await cmd('Emulation.setDeviceMetricsOverride',{width:320,height:900,deviceScaleFactor:1,mobile:false},panel);
 await api(`document.documentElement.style.fontSize='32px'`);await delay(100);
 assert.ok(await api(`document.documentElement.scrollWidth<=320`));
 const large=await cmd('Page.captureScreenshot',{format:'png'},panel);await writeFile(resolve(root,'test-results/preferences-large-type.png'),Buffer.from(large.data,'base64'));
 await api(`document.documentElement.style.fontSize='';document.querySelector('#themePreference').focus()`);
 await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},panel);
 await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},panel);
 await waitFor(async()=>!await open(),'tab leaves settings');
 report.scenarios.push('theme-persists-and-close-outside-tab-and-large-type-work');
 // Only presentation data is stubbed here; this does not start collection or upload.
 await api(`(()=>{
  const send=chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage=(message,callback)=>{
   if(message.type!=='DRA_GET_STATUS')return send(message,callback);
   return send(message,r=>callback({...r,outboxCount:5,schedule:{...r.schedule,enabled:true,nextRunAt:'2026-09-08T03:15:00Z',lastRunAt:'2026-09-06T03:15:00Z',lastResult:'已达到本轮时长上限，任务正常结束。待上传队列将在研究台连接恢复后继续上传，详细结果应完整显示。'},state:{...r.state,status:'paused',pauseReason:'用户暂停',lastError:'研究台上传失败：网络连接中断'}}));
  };
  document.dispatchEvent(new Event('visibilitychange'));
 })()`);
 await waitFor(()=>api(`document.querySelector('.health-alert')?.innerText.includes('研究台上传失败')`),'visible error');
 assert.equal(await api(`document.querySelector('.health-details').open`),false);
 for(const label of ['待上传队列','下次定时','定时结果'])assert.equal(await api(`([...document.querySelectorAll('dt')].find(e=>e.textContent===${JSON.stringify(label)})).checkVisibility()`),false);
 await click('.health-details > summary');
 for(const label of ['待上传队列','下次定时','定时结果'])assert.ok(await api(`([...document.querySelectorAll('dt')].find(e=>e.textContent===${JSON.stringify(label)})).checkVisibility()`));
 assert.equal(await api(`document.querySelector('.mini-details dd').textContent`),'5 条');
 const result=await api(`(()=>{const d=[...document.querySelectorAll('dt')].find(e=>e.textContent==='定时结果').nextElementSibling;return {text:d.textContent,whiteSpace:getComputedStyle(d).whiteSpace,overflow:getComputedStyle(d).textOverflow,client:d.clientWidth,scroll:d.scrollWidth};})()`);
 assert.ok(result.text.endsWith('详细结果应完整显示。'));assert.equal(result.whiteSpace,'normal');assert.notEqual(result.overflow,'ellipsis');assert.ok(result.scroll<=result.client);
 report.scenarios.push('auxiliary-status-in-details-with-full-result-and-visible-error');
 await api(`window.scrollTo(0,0)`);
 const detailsShot=await cmd('Page.captureScreenshot',{format:'png'},panel);await writeFile(resolve(root,'test-results/preferences-details-dark.png'),Buffer.from(detailsShot.data,'base64'));
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error.stack||error);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(resolve(root,'test-results/preferences.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));ws.close();chrome.kill();}
