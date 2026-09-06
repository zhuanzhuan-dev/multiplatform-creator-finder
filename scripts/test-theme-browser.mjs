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


const report={version:JSON.parse(await readFile(resolve(root,'dist/manifest.json'),'utf8')).version,startedAt:new Date().toISOString(),scenarios:[]};
const output=resolve(root,'test-results/themes.json');
await mkdir(resolve(root,'test-results'),{recursive:true});
const waitFor=async(fn,label)=>{for(let i=0;i<80;i++){if(await fn().catch(()=>false))return;await delay(100);}throw Error(`Timed out: ${label}`);};
const pages=[];
const appearance=(page)=>evaluate(page.session,`({theme:document.documentElement.dataset.theme,background:getComputedStyle(document.body).backgroundColor,scheme:getComputedStyle(document.documentElement).colorScheme})`);
const system=async value=>{for(const p of pages)await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value}]},p.session);};
const expectTheme=async(theme,color)=>{for(const p of pages)await waitFor(async()=>{const v=await appearance(p);return v.theme===theme&&v.background===color;},`${p.name} ${theme} ${color}`);};
const choose=async value=>{
 await evaluate(pages[0].session,`(()=>{const b=document.querySelector('button[aria-label="设置"]');if(b?.getAttribute('aria-expanded')==='false')b.click();})()`);
 await evaluate(pages[0].session,`(()=>{const s=document.querySelector('#themePreference');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await waitFor(()=>evaluate(pages[0].session,`chrome.storage.local.get('draTheme').then(v=>v.draTheme===${JSON.stringify(value)})`),'saved theme');
};
const screenshot=async(mode)=>{await evaluate(pages[0].session,`document.querySelector('button[aria-label="关闭设置"]')?.click()`);await delay(250);for(const p of pages){const r=await cmd('Page.captureScreenshot',{format:'png'},p.session);await writeFile(resolve(root,`test-results/theme-${p.name}-${mode}.png`),Buffer.from(r.data,'base64'));}};
try{
 const w=(await cmd('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/background.js`);const sw=await attach(w.targetId);
 for(const [name,path] of [['sidepanel','sidepanel/index.html'],['decisions','decisions/index.html'],['updates','updates/index.html']]) {
  await evaluate(sw,`chrome.tabs.create({url:chrome.runtime.getURL(${JSON.stringify(path)}),active:false})`);
  let target;
  await waitFor(async()=>{target=(await cmd('Target.getTargets')).targetInfos.find(t=>t.type==='page'&&t.url===`chrome-extension://${extensionId}/${path}`);return !!target;},name);
  const session=await attach(target.targetId);pages.push({name,path,session});
  await waitFor(()=>evaluate(session,`Boolean(document.querySelector('h1'))`),`${name} rendered`);
  await cmd('Emulation.setDeviceMetricsOverride',{width:name==='sidepanel'?360:1100,height:900,deviceScaleFactor:1,mobile:false},session);
 }
 await cmd('Target.detachFromTarget',{sessionId:sw});
 assert.equal(await evaluate(pages[0].session,`document.querySelector('#themePreference').value`),'system');
 await system('light');await expectTheme('system','rgb(233, 239, 235)');
 await system('dark');await expectTheme('system','rgb(13, 16, 18)');
 report.scenarios.push('default-system-follows-live-light-dark-changes-on-all-pages');
 await choose('light');await expectTheme('light','rgb(233, 239, 235)');await screenshot('light');
 report.scenarios.push('explicit-light-overrides-dark-system-and-syncs-pages');
 await system('light');await choose('dark');await expectTheme('dark','rgb(13, 16, 18)');await screenshot('dark');
 report.scenarios.push('explicit-dark-overrides-light-system-and-syncs-pages');
 await cmd('Page.reload',{},pages[0].session);await waitFor(()=>evaluate(pages[0].session,`document.querySelector('#themePreference')?.value==='dark'`),'theme restored after reload');
 await expectTheme('dark','rgb(13, 16, 18)');report.scenarios.push('reload-retains-explicit-preference');
 await choose('system');await expectTheme('system','rgb(233, 239, 235)');
 await system('dark');await expectTheme('system','rgb(13, 16, 18)');
 report.scenarios.push('return-to-system-resumes-live-appearance');
 // Theme is independent from collection settings and remains usable during a run.
 const before=await evaluate(pages[0].session,`chrome.storage.local.get('draSettings')`);
 await choose('light');await choose('dark');
 assert.deepEqual(await evaluate(pages[0].session,`chrome.storage.local.get('draSettings')`),before);
 report.scenarios.push('theme-does-not-change-run-settings');

 // Evaluate the light material's text contrast at the darkest endpoint of each gradient.
 await choose('light');
 const materialChecks=await evaluate(pages[0].session,`(()=>{
  const b=getComputedStyle(document.body),root=getComputedStyle(document.documentElement);
  const rgb=value=>value.trim().startsWith('#')?[1,3,5].map(i=>parseInt(value.trim().slice(i,i+2),16)):(value.match(/[0-9.]+/g)||[]).slice(0,3).map(Number);
  const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const contrast=(a,c)=>{const x=lum(a),y=lum(c);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  const mix=(a,c,t)=>a.map((v,i)=>v*t+c[i]*(1-t));
  const surface=rgb(b.getPropertyValue('--surface')),hover=rgb(b.getPropertyValue('--button-hover'));
  const checks=[...document.querySelectorAll('.stats-section h2,.primary-stats dt,.primary-stats strong,.section-meta')].map(e=>({label:e.textContent,ratio:contrast(rgb(getComputedStyle(e).color),surface)}));
  checks.push({label:'quiet-on-page-glow',ratio:contrast(rgb(b.getPropertyValue('--quiet')),rgb(b.getPropertyValue('--page-glow')))});
  checks.push({label:'quiet-on-canvas',ratio:contrast(rgb(b.getPropertyValue('--quiet')),rgb(b.getPropertyValue('--canvas')))});
  checks.push({label:'ordinary-button-at-glow-center',ratio:contrast(rgb(b.getPropertyValue('--text')),mix([91,150,116],hover,.22))});
  checks.push({label:'link-button-at-glow-center',ratio:contrast(rgb(b.getPropertyValue('--blue')),mix([91,150,116],hover,.22))});
  checks.push({label:'primary-reflection',ratio:contrast([255,255,255],mix([255,255,255],rgb(b.getPropertyValue('--primary')),.10))});
  checks.push({label:'primary-follow-glow',ratio:contrast([255,255,255],mix([255,255,255],rgb(b.getPropertyValue('--primary-hover')),.16))});
  return {checks,cardGradient:getComputedStyle(document.querySelector('.stats-section')).backgroundImage,shadow:root.getPropertyValue('--glass-shadow'),pointer:(()=>{const e=document.createElement('span');e.style.color='var(--pointer-glow-core)';document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c;})()};
 })()`);
 assert.ok(materialChecks.checks.every(c=>c.ratio>=4.5),JSON.stringify(materialChecks.checks));
 assert.ok(materialChecks.cardGradient.includes('linear-gradient'));
 assert.ok(materialChecks.pointer.replaceAll(' ','').startsWith('rgba(91,150,116,'));
 await choose('dark');
 assert.equal(await evaluate(pages[0].session,`getComputedStyle(document.querySelector('.stats-section')).backgroundImage`),'none');
 assert.equal(await evaluate(pages[0].session,`(()=>{const e=document.createElement('span');e.style.color='var(--pointer-glow-core)';document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c;})()`),'rgba(255, 255, 255, 0.38)');
 report.scenarios.push({name:'light-material-contrast-and-independent-dark-material',...materialChecks});
 await choose('system');await system('light');
 await evaluate(pages[0].session,`document.querySelector('.settings-disclosure').open=true;document.querySelector('.settings-disclosure').scrollIntoView()`);
 const settingsShot=await cmd('Page.captureScreenshot',{format:'png'},pages[0].session);await writeFile(resolve(root,'test-results/theme-settings-light.png'),Buffer.from(settingsShot.data,'base64'));
 console.log(JSON.stringify({reviewReady:true,endpoint,extensionId,pages}));
 if(process.env.REVIEW_HOLD_MS)await delay(Number(process.env.REVIEW_HOLD_MS));
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error.stack||error);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));ws.close();chrome.kill();}
