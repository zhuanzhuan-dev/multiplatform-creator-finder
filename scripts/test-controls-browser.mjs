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
 const openForms=()=>api(`document.querySelectorAll('details').forEach(d=>d.open=true)`);
 const input=(label)=>`[...document.querySelectorAll('label')].find(l=>l.firstChild.textContent.trim()===${JSON.stringify(label)})?.querySelector('input')`;
 const value=label=>api(`(${input(label)})?.value`);
 const clear=async label=>{
  await api(`(()=>{const e=${input(label)};if(!e)throw Error('missing input');e.focus();e.select();})()`);
  await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8},panel);
  await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8},panel);
 };
 const type=async text=>cmd('Input.insertText',{text},panel);
 const storage=()=>api(`chrome.storage.local.get(['draSettings','draSettingsDraft','draRules'])`);
 await openForms();
 await clear('中心（秒）');assert.equal(await value('中心（秒）'),'');
 assert.equal(await api(`(${input('中心（秒）')}).getAttribute('aria-invalid')`),'true');
 await waitFor(async()=>(await storage()).draSettingsDraft?.dwell.typicalSeconds==='','blank draft persisted');
 assert.equal((await storage()).draSettings.dwell.typicalSeconds,20);
 await cmd('Page.reload',{},panel);await waitFor(()=>api(`!!document.querySelector('.settings-disclosure')`),'reloaded');await openForms();
 assert.equal(await value('中心（秒）'),'');
 report.scenarios.push('keyboard-clear-remains-blank-and-survives-reload');
 await clear('中心（秒）');await type('22');
 await waitFor(async()=>(await storage()).draSettings.dwell.typicalSeconds===22,'replacement autosaved');
 assert.equal(await api(`(${input('中心（秒）')}).getAttribute('aria-invalid')`),'false');
 report.scenarios.push('keyboard-replacement-autosaves-and-clears-error');
 for(const label of ['最低点赞','最低粉丝','优选点赞','最低平均点赞','命中加分']) {
  await clear(label);assert.equal(await value(label),'');await type('0');assert.equal(await value(label),'0');
  assert.equal(await api(`(${input(label)}).getAttribute('aria-invalid')`),'false');
 }
 await api(`document.querySelector('.save-rules').click()`);
 await waitFor(async()=>(await storage()).draRules?.hard.minVideoLikes===0,'zero thresholds saved');
 await cmd('Page.reload',{},panel);await waitFor(()=>api(`!!document.querySelector('.rules-disclosure')`),'rules reloaded');await openForms();
 for(const label of ['最低点赞','最低粉丝','优选点赞','最低平均点赞','命中加分'])assert.equal(await value(label),'0');
 report.scenarios.push('zero-thresholds-and-score-save-and-survive-reload');
 await clear('最低点赞');await api(`document.querySelector('.save-rules').click()`);await delay(200);
 assert.equal((await storage()).draRules.hard.minVideoLikes,0);
 assert.equal(await value('最低点赞'),'');
 assert.equal(await api(`(${input('最低点赞')}).getAttribute('aria-invalid')`),'true');
 report.scenarios.push('blank-rule-rejected-without-overwriting-saved-zero');
 await cmd('Emulation.setDeviceMetricsOverride',{width:360,height:900,deviceScaleFactor:1,mobile:false},panel);
 // A harmless preset button provides real pointer press/release feedback without starting collection.
 await api(`document.querySelector('.preset-button').scrollIntoView({block:'center'})`);
 const center=await api(`(()=>{const r=document.querySelector('.preset-button').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',...center},panel);
 await cmd('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...center},panel);await delay(120);
 assert.notEqual(await api(`getComputedStyle(document.querySelector('.preset-button')).transform`),'none');
 await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...center},panel);await delay(320);
 await waitFor(()=>api(`getComputedStyle(document.querySelector('.preset-button')).transform==='none'`),'release settled');
 report.scenarios.push('pointer-press-and-release-animate-without-layout-shift');

 // Verify actual cursor tracking on both a plain and a primary button, in both themes.
 const glow=selector=>api(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});const p=getComputedStyle(b,'::before');return {active:b.hasAttribute('data-pointer-glow'),x:parseFloat(b.style.getPropertyValue('--pointer-x')),opacity:Number(p.opacity),gradient:p.backgroundImage};})()`);
 const moveWithin=async(selector,fraction)=>{
  await api(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await delay(80);
  const pos=await api(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width*${fraction},y:r.y+r.height/2};})()`);
  await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',...pos},panel);
  await waitFor(async()=>{const g=await glow(selector);return g.active&&Math.abs(g.x-fraction*100)<2&&g.opacity>.99;},'pointer glow tracked').catch(async e=>{throw Error(e.message+' '+JSON.stringify({selector,pos,glow:await glow(selector),hit:await api(`document.elementFromPoint(${pos.x},${pos.y})?.outerHTML`)}));});
  return pos;
 };
 for(const theme of ['light','dark']) {
  await api(`chrome.storage.local.set({draTheme:${JSON.stringify(theme)}})`);
  await waitFor(()=>api(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`),'theme switched');
  for(const selector of ['.preset-button','.save-rules']) {
   const before=await moveWithin(selector,.2);const left=await glow(selector);
   assert.ok(left.gradient.includes('radial-gradient'));
   const leftShot=await cmd('Page.captureScreenshot',{format:'png'},panel);await writeFile(resolve(root,`test-results/glow-${theme}-${selector.slice(1)}-left.png`),Buffer.from(leftShot.data,'base64'));
   await moveWithin(selector,.8);const right=await glow(selector);
   assert.ok(right.x-left.x>55);assert.notEqual(right.gradient,left.gradient);
   const rightShot=await cmd('Page.captureScreenshot',{format:'png'},panel);await writeFile(resolve(root,`test-results/glow-${theme}-${selector.slice(1)}-right.png`),Buffer.from(rightShot.data,'base64'));
   await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:before.y},panel);
   await waitFor(async()=>{const g=await glow(selector);return !g.active&&g.opacity===0;},'pointer exit fades out');
   report.scenarios.push(`${theme}-${selector.slice(1)}-gradient-tracks-real-mouse-and-fades-out`);
  }
 }
 // Disabled while hovered must immediately lose its visible highlight.
 const hover=await moveWithin('.preset-button',.5);
 await api(`document.querySelector('.preset-button').disabled=true`);
 assert.equal((await glow('.preset-button')).opacity,0);
 await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:hover.x+2,y:hover.y},panel);await delay(100);
 assert.equal((await glow('.preset-button')).active,false);
 await api(`document.querySelector('.preset-button').disabled=false`);
 report.scenarios.push('disabled-button-has-no-following-highlight');
 await moveWithin('.preset-button',.5);
 await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},panel);
 await cmd('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...center},panel);await delay(100);
 assert.equal(await api(`getComputedStyle(document.querySelector('.preset-button')).transform`),'none');
 await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...center},panel);
 assert.equal((await glow('.preset-button')).active,false);
 assert.equal((await glow('.preset-button')).gradient,'none');
 report.scenarios.push('reduced-motion-disables-press-transform-and-pointer-glow');
 await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]},panel);
 await api(`document.querySelector('.preset-button').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'touch',clientX:40,clientY:40}))`);await delay(100);
 assert.equal((await glow('.preset-button')).active,false);
 report.scenarios.push('touch-pointer-does-not-enable-mouse-highlight');
 assert.notEqual(await api(`getComputedStyle(document.querySelector('.run-card')).backdropFilter`),'none');
 report.scenarios.push('glass-backdrop-rendered');
 await api(`(${input('最低点赞')}).scrollIntoView({block:'center'})`);
 const shot=await cmd('Page.captureScreenshot',{format:'png'},panel);await writeFile(resolve(root,'test-results/numeric-feedback.png'),Buffer.from(shot.data,'base64'));
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error.stack||error);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(resolve(root,'test-results/controls.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));ws.close();chrome.kill();}
