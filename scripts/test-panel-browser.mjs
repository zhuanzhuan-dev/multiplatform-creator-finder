// Real headed Chrome + the built extension. Only the website response is a fixture.
// No background-throttling switches, fake extension APIs, or production uploads.
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
const minutes=Number(process.env.SOAK_MINUTES||30);
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

const report={profile,version:JSON.parse(await readFile(resolve(root,'dist/manifest.json'),'utf8')).version,startedAt:new Date().toISOString(),scenarios:[]};
const output=resolve(root,'test-results/panel-settings.json');
await mkdir(resolve(root,'test-results'),{recursive:true});
let panel;
const api=expression=>evaluate(panel,expression);
const waitFor=async(fn,label)=>{for(let i=0;i<80;i++){const result=await fn().catch(()=>false);if(result)return result;await delay(100);}throw new Error(`Timed out: ${label}`);};
const findPanel=async()=>{
 const target=await waitFor(async()=>(await cmd('Target.getTargets',{filter:[{exclude:false}]})).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/sidepanel/index.html`),'panel target');
 panel=await attach(target.targetId);
 await waitFor(()=>api(`document.body.innerText.includes('开始本轮')`),'panel loaded');
 return target;
};
const button=async text=>api(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('missing button');b.click();return true;})()`);
const fill=async(label,value)=>api(`(()=>{const el=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()===${JSON.stringify(label)})?.querySelector('input');if(!el)throw Error('missing input');el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event('input',{bubbles:true}));el.blur();return true;})()`);
const inputValue=label=>api(`([...document.querySelectorAll('label')].find(l=>l.textContent.trim()===${JSON.stringify(label)})?.querySelector('input'))?.value`);
const stored=()=>api(`chrome.storage.local.get(['draSettings','draSettingsDraft'])`);
const openSettings=()=>api(`document.querySelector('.settings-disclosure').open=true`);
try {
 const blank=(await cmd('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos.find(t=>t.type==='tab'&&t.url==='about:blank');
 assert.ok(blank);
 const w=(await cmd('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/background.js`);const sw=await attach(w.targetId);
 await delay(1000);console.log(JSON.stringify(await evaluate(sw,`Promise.all([chrome.sidePanel.getPanelBehavior(),chrome.sidePanel.getOptions({}),chrome.tabs.query({}).then(async tabs=>Promise.all(tabs.map(async t=>({id:t.id,...await chrome.sidePanel.getOptions({tabId:t.id})}))))])`)));
 await cmd('Target.detachFromTarget',{sessionId:sw});
 await cmd('Extensions.triggerAction',{id:extensionId,targetId:blank.targetId});
 await findPanel();
 assert.equal((await cmd('Target.getTargets')).targetInfos.some(t=>t.url.startsWith('https://www.douyin.com')),false);
 report.scenarios.push('first-toolbar-action-opens-panel-without-douyin');
 console.log(JSON.stringify({ready:true,endpoint,extensionId,panel,report:output}));
 await openSettings();
 if(process.env.RESUME_PROFILE) {
  assert.equal((await stored()).draSettings.schedule.enabled,false);
  assert.equal((await stored()).draSettings.dwell.typicalSeconds,20);
  report.scenarios.push('browser-restart-preserves-settings');
 }
 assert.equal(await api(`document.querySelector('.segmented .selected').textContent`),'随机区间');
 assert.equal(await inputValue('中心（秒）'),'20');
 report.scenarios.push('fresh-install-normal-range-preset');
 await fill('最短（秒）',12);await fill('中心（秒）',22);await fill('最长（秒）',40);
 await waitFor(async()=>{const s=await stored();return s.draSettings.dwell.minSeconds===12&&s.draSettings.dwell.typicalSeconds===22&&s.draSettings.dwell.maxSeconds===40;},'auto-save all edits');
 await api(`chrome.runtime.sendMessage({type:'DRA_STATUS_CHANGED',tabId:999})`);
 await delay(250);
 assert.equal(await inputValue('中心（秒）'),'22');
 report.scenarios.push('valid-edits-autosave-and-survive-status-refresh');
 const windowId=await api('chrome.windows.getCurrent().then(w=>w.id)');
 await api(`chrome.sidePanel.close({windowId:${windowId}})`).catch(()=>{});
 await delay(300);
 await cmd('Extensions.triggerAction',{id:extensionId,targetId:blank.targetId});
 await findPanel();await openSettings();
 assert.equal(await inputValue('最短（秒）'),'12');assert.equal(await inputValue('最长（秒）'),'40');
 report.scenarios.push('close-reopen-retains-settings');
 await fill('最短（秒）',50);
 await waitFor(async()=>{const s=await stored();return s.draSettingsDraft?.dwell.minSeconds===50;},'invalid draft persisted');
 assert.equal((await stored()).draSettings.dwell.minSeconds,12);
 await cmd('Page.reload',{},panel);await delay(500);await openSettings();
 assert.equal(await inputValue('最短（秒）'),'50');
 report.scenarios.push('invalid-draft-restored-without-changing-runtime-config');
 await button('应用随机预设');
 await waitFor(async()=>{const s=await stored();return s.draSettings.dwell.typicalSeconds===20&&s.draSettingsDraft===null;},'preset applied');
 await button('打开工作台');
 const workbench=await waitFor(async()=>(await cmd('Target.getTargets')).targetInfos.find(t=>t.url.startsWith('https://whislte.cc.cd')),'workbench tab');
 await cmd('Target.closeTarget',{targetId:workbench.targetId});
 report.scenarios.push('workbench-button-opens-configured-url');
 // Suppress scheduled runs in this isolated browser while testing reload.
 const saved=await stored();
 await api(`chrome.runtime.sendMessage({type:'DRA_SAVE_CONFIG',settings:${JSON.stringify({...saved.draSettings,schedule:{...saved.draSettings.schedule,enabled:false}})}})`);
 const shot=await cmd('Page.captureScreenshot',{format:'png'},panel);
 await writeFile(resolve(root,'test-results/panel-settings.png'),Buffer.from(shot.data,'base64'));
 console.log(JSON.stringify({reviewReady:true,endpoint,panel,extensionId}));
 if(process.env.REVIEW_HOLD_MS)await delay(Number(process.env.REVIEW_HOLD_MS));
 report.passed=true;
} catch(error) { report.passed=false;report.error=String(error?.stack||error);process.exitCode=1; }
finally { report.finishedAt=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));ws.close();chrome.kill(); }
