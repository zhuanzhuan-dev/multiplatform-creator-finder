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

 await api(await readFile(resolve(root,'lib/douyin-page-parser.js'),'utf8'));
 const classifier = await api(`(() => {
   const host=document.createElement('div');host.style.cssText='position:fixed;top:0;left:0;width:250px;background:white;z-index:100';document.body.append(host);
   const classify = (markup) => {host.innerHTML=markup;return DouyinAutoFinderParser.feedContentIdentity(host,host.querySelector('aside'));};
   const result = [
     classify('<div data-e2e="feed-video">视频</div><p data-e2e="video-desc">直播中，进入直播间，广告</p>'),
     classify('<div data-e2e="feed-live">图文直播</div><div data-e2e="feed-photo">图片</div>'),
     classify('<div data-e2e="feed-photo">图文轮播</div><div data-e2e="feed-video">播放器</div>'),
     classify('<div data-e2e="feed-video">视频</div><span>广告</span>'),
     classify('<p>普通卡片内容</p>'),
     classify('<div data-e2e="feed-video">视频</div><aside><div data-e2e="feed-live">直播</div><span>广告</span></aside>'),
     classify('<div data-e2e="feed-video">视频</div><div data-e2e="feed-live" hidden>直播</div>'),
     classify('<div data-e2e="feed-video">视频</div><p data-e2e="video-desc"><span>广告</span></p>'),
     classify('<a href="https://live.douyin.com/123456">进入直播间</a>')
   ]; host.remove();return result;
 })()`);
 assert.deepEqual(classifier.map(x=>[x.contentType,x.isAd]),[['video',false],['live',false],['photo',false],['video',true],['unknown',false],['video',false],['video',false],['video',false],['live',false]]);
 report.scenarios.push('real-DOM-content-type-9-cases-caption-hidden-drawer-exclusions');
 await api(`(() => {
  const send=chrome.runtime.sendMessage.bind(chrome.runtime);
  window.fixtureCloud={connected:false};window.fixturePairStarts=0;window.fixtureStatus='paused';
  window.fixtureDecisions=Array.from({length:7},(_,i)=>({accountName:'示例创作者 '+(i+1),code:i===1?'ACCEPTED_REVIEW':'ACCEPTED',reasons:['美食内容 · 点赞 5000 · 粉丝 10 万'],occurredAt:new Date().toISOString()}));
  chrome.runtime.sendMessage=(m,cb)=>{
    if(m.type==='DRA_GET_STATUS')return send(m,r=>cb({...r,cloud:window.fixtureCloud,daily:{date:new Date(Date.now()+8*3600000).toISOString().slice(0,10),scanned:168},state:{...r.state,status:window.fixtureStatus,runId:'fixture-run',startedAt:new Date(Date.now()-180000).toISOString(),elapsedMs:60000,activeSince:null,runTarget:{mode:'time',durationMinutes:60},stats:{scanned:40,matched:18,newCreators:11,reviewQueued:3,uploaded:38,duplicates:7,notInterested:22,liveSkipped:2,photoSkipped:3,adSkipped:1,unknownSkipped:1},recentDecisions:window.fixtureDecisions}}));
    if(m.type==='DRA_RESUME'){window.fixtureStatus='running';return cb({ok:true});}
    if(m.type==='DRA_PAUSE'){window.fixtureStatus='paused';return cb({ok:true});}
    if(m.type==='DRA_START_PAIR'){window.fixturePairStarts++;window.fixtureCloud={connected:false,pairing:{status:'pending',code:'fixture'}};return cb({ok:true,cloud:window.fixtureCloud});}
    if(m.type==='DRA_POLL_PAIR')return cb({ok:true,cloud:window.fixtureCloud});
    return send(m,cb);
  };
  document.dispatchEvent(new Event('visibilitychange'));
 })()`);
 await waitFor(()=>api(`document.querySelector('.stats-section .section-meta').textContent.includes('168')`),'daily fixture');
 assert.equal(await api(`document.querySelector('.run-card .primary').disabled`),true);
 assert.equal(await api(`document.querySelectorAll('.stats-section .decision-row').length`),5);
 assert.equal(await api(`!!document.querySelector('main > .decision-section')`),false);
 assert.equal(await api(`document.querySelector('.stats-details summary').textContent.includes('已上传')`),false);
 await api(`document.querySelector('main > .cloud-panel .primary').click()`);
 await waitFor(()=>api(`document.querySelector('main > .cloud-panel').textContent.includes('等待研究台授权')`),'pairing');
 assert.equal(await api('window.fixturePairStarts'),1);
 await api(`window.fixtureCloud={connected:true};document.dispatchEvent(new Event('visibilitychange'))`);
 await waitFor(()=>api(`!!document.querySelector('.connection-summary')`),'connected compact');
 assert.equal(await api(`!!document.querySelector('main > .cloud-panel')`),false);
 assert.equal(await api(`document.querySelector('.run-card .primary').disabled`),false);
 assert.ok(await api(`document.querySelector('#preferencesPopover .cloud-panel').textContent.includes('切换账号')`));
 assert.equal(await api(`!!document.querySelector('.app-header .badge')`),false);
 assert.equal(await api(`document.querySelector('.run-card .badge').textContent`),'已暂停');
 assert.equal(await api(`document.querySelector('.run-card .primary').textContent`),'继续本轮');
 assert.equal(await api(`document.querySelector('.run-time strong').textContent`),'00:01:00');
 await api(`document.querySelector('.run-card .primary').click()`);
 await waitFor(()=>api(`document.querySelector('.run-card .primary').textContent==='暂停'`),'resume action');
 assert.deepEqual(await api(`[...document.querySelectorAll('.primary-stats strong')].map(e=>e.textContent)`),['18','11','3']);
 await api(`document.querySelector('.run-card .primary').click()`);
 await waitFor(()=>api(`document.querySelector('.run-card .primary').textContent==='继续本轮'`),'pause action');
 report.scenarios.push('onboarding-connected-gear-five-recent-task-status-resume-pause-preserve-results');
 for (const theme of ['light','dark']) {
   await api(`chrome.storage.local.set({draTheme:${JSON.stringify(theme)}})`);
   for (const width of [280,320,360,520]) {
     await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false},panel);await delay(150);
     assert.ok(await api(`document.documentElement.scrollWidth<=${width}`));
     if(width===360){await api('window.scrollTo(0,0)');const shot=await cmd('Page.captureScreenshot',{format:'png'},panel);await writeFile(resolve(root,`test-results/product-panel-${theme}.png`),Buffer.from(shot.data,'base64'));}
   }
 }
 await api(`window.fixtureCloud={connected:false,expired:true};document.dispatchEvent(new Event('visibilitychange'))`);
 await waitFor(()=>api(`document.querySelector('main > .cloud-panel')?.textContent.includes('重新登录并连接')`),'expired prompt');
 assert.equal(await api(`document.querySelector('.run-card .primary').disabled`),true);
 report.scenarios.push('both-themes-280-to-520-reflow-expired-authorization');
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error.stack||error);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(resolve(root,'test-results/product-panel.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));ws.close();chrome.kill();}
