// Real built sidepanel with isolated runtime fixtures: target edit -> save -> resume.
// Uses an isolated Chrome profile; no pairing or uploads.
import { spawn } from 'node:child_process';
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
try{
 const worker=(await cmd('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/background.js`);const sw=await attach(worker.targetId);
 await evaluate(sw,`chrome.tabs.create({url:chrome.runtime.getURL('sidepanel/index.html'),active:true})`);
 let target;await waitFor(async()=>{target=(await cmd('Target.getTargets')).targetInfos.find(t=>t.type==='page'&&t.url===`chrome-extension://${extensionId}/sidepanel/index.html`);return !!target;},'panel');
 const panel=await attach(target.targetId);await cmd('Target.detachFromTarget',{sessionId:sw});
 await waitFor(()=>evaluate(panel,`Boolean(document.querySelector('#themePreference'))`),'loaded');



 const api=expression=>evaluate(panel,expression);


 const fixture=`(() => {
  const send=chrome.runtime.sendMessage.bind(chrome.runtime);
  window.targetMessages=[];
  window.targetState={status:'paused',runId:'target-fixture',runTrigger:'manual',route:{platform:'kuaishou',surface:'recommend',label:'快手推荐'},startedAt:new Date(Date.now()-600000).toISOString(),elapsedMs:600000,activeSince:null,runTarget:{mode:'both',durationMinutes:60,maxItems:100},stats:{scanned:100},pauseReason:'已达到本轮视频数量目标（100/100条）'};
  window.targetSettings=null;
  chrome.runtime.sendMessage=(m,cb)=>{
    if(m.type==='DRA_GET_STATUS')return send(m,r=>{
      window.targetSettings ||= {...r.settings,dryRun:true,target:{mode:'both',durationMinutes:60,maxItems:100},schedule:{...r.settings.schedule,enabled:true,target:{mode:'count',durationMinutes:60,maxItems:1}}};
      cb({...r,configPlatform:'kuaishou',state:window.targetState,tasks:[window.targetState],settings:window.targetSettings,settingsDraft:null,cloud:{connected:false},decisionHistory:[],decisionHistoryTotal:0});
    });
    if(m.type==='DRA_SAVE_CONFIG'){
      window.targetMessages.push(m);window.targetSettings=structuredClone(m.settings);
      return send({type:'DRA_GET_STATUS',platform:'kuaishou'},r=>cb({ok:true,settings:window.targetSettings,settingsDraft:null,rules:r.rules,problems:[]}));
    }
    if(m.type==='DRA_RESUME'){
      window.targetMessages.push(m);window.targetState={...window.targetState,status:'running',runTarget:structuredClone(window.targetSettings.target),activeSince:Date.now(),pauseReason:''};return cb({ok:true});
    }
    if(m.type==='DRA_START'){window.targetMessages.push(m);return cb({ok:false,error:'测试应继续本轮'});}
    return send(m,cb);
  };
 })();`;
 await api(fixture);
 await api(`document.dispatchEvent(new Event('visibilitychange'))`);
 await waitFor(()=>api(`document.querySelector('.run-card')?.textContent.includes('100/100')`),'paused count target');
 await cmd('Emulation.setDeviceMetricsOverride',{width:420,height:1000,deviceScaleFactor:1,mobile:false},panel);
 await api(`document.querySelector('.configuration-panel summary').click();document.querySelector('#targetSettingTitle').scrollIntoView({block:'center'})`);
 await delay(150);
 const shot=async name=>{const image=await cmd('Page.captureScreenshot',{format:'png'},panel);await writeFile(resolve(root,'test-results',name),Buffer.from(image.data,'base64'));};
 await shot('target-01-before.png');
 assert.equal(await api(`document.querySelector('.run-card .primary').textContent`),'开始新一轮');
 await api(`(()=>{const select=document.querySelector('[aria-labelledby="targetSettingTitle"] select');select.value='time';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await waitFor(()=>api(`window.targetSettings?.target.mode==='time' && document.querySelector('.run-card .primary').textContent==='继续本轮'`),'time target allows resume');
 assert.equal(await api(`window.targetSettings.schedule.target.mode`),'count');
 assert.equal(await api(`document.querySelector('[aria-labelledby="targetSettingTitle"]').textContent.includes('保留计数和已运行时长')`),true);
 await shot('target-02-saved.png');
 await api(`document.querySelector('.run-card .primary').scrollIntoView({block:'center'});document.querySelector('.run-card .primary').click()`);
 await waitFor(()=>api(`document.querySelector('.run-card .primary').textContent==='暂停'`),'resumed');
 const result=await api(`({types:window.targetMessages.map(m=>m.type),target:window.targetState.runTarget,runId:window.targetState.runId,scanned:window.targetState.stats.scanned,elapsed:window.targetState.elapsedMs,lastSave:window.targetMessages.filter(m=>m.type==='DRA_SAVE_CONFIG').at(-1)})`);
 assert.equal(result.types.at(-1),'DRA_RESUME');assert.equal(result.types.at(-2),'DRA_SAVE_CONFIG');assert.ok(!result.types.includes('DRA_START'));
 assert.equal(result.lastSave.platform,'kuaishou');assert.equal(result.target.mode,'time');assert.equal(result.target.durationMinutes,60);assert.equal(result.runId,'target-fixture');assert.equal(result.scanned,100);assert.equal(result.elapsed,600000);
 await shot('target-03-resumed.png');
 for(const width of [320,420]){await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false},panel);await delay(100);assert.ok(await api(`document.documentElement.scrollWidth<=${width}`));}
 report.scenarios=['旧数量目标已达到时显示开始新一轮','改为时间目标并保存后显示继续本轮，定时目标保持独立','点击继续先保存再恢复，本轮100条和10分钟保留','320px和420px侧栏无横向溢出'];
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error.stack||error);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(resolve(root,'test-results/run-target-panel.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));ws.close();chrome.kill();}
