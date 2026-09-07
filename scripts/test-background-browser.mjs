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
const profile=await mkdtemp(resolve(tmpdir(),'finder-runtime-test-'));
const executable=process.env.CHROME_BIN;
if(!executable)throw new Error('Set CHROME_BIN to Chrome for Testing executable');
const minutes=Number(process.env.SOAK_MINUTES||30);
const chrome=spawn(executable,[`--user-data-dir=${profile}`,'--remote-debugging-port=0','--no-first-run','--no-default-browser-check',`--disable-extensions-except=${root}/dist`,`--load-extension=${root}/dist`,'about:blank'],{stdio:'ignore'});
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
const workerTarget=(await cmd('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/background.js`);
const workerSession=await attach(workerTarget.targetId);
await evaluate(workerSession, `chrome.tabs.create({url:chrome.runtime.getURL('sidepanel/index.html')})`);
await cmd('Target.detachFromTarget',{sessionId:workerSession});
await delay(700);
const allTargets=(await cmd('Target.getTargets')).targetInfos;
console.log(JSON.stringify({targets:allTargets.map(t=>({type:t.type,url:t.url}))}));
const controlId=allTargets.find(t=>t.url===`chrome-extension://${extensionId}/sidepanel/index.html`).targetId;
const control=await attach(controlId);
const api=expression=>evaluate(control,expression);
console.log(JSON.stringify({extensionId,controlPage:await api('({url:location.href,title:document.title,tabs:typeof chrome.tabs})')}));
for(let i=0;i<50;i++){if(await api('Boolean(chrome.tabs)'))break;await delay(100);}
const request=message=>api(`chrome.runtime.sendMessage(${JSON.stringify(message)})`);
const fixture=await readFile(resolve(root,'scripts/fixtures/runtime-feed.html'),'utf8');
const feedId=(await cmd('Target.createTarget',{url:'about:blank'})).targetId;
async function fixtureNavigate(){
 const session=await attach(feedId);
 if(process.env.LIVE_PROBE==='1'||process.env.LIVE_RUN==='1'){await cmd('Page.navigate',{url:'https://www.douyin.com/?recommend=1&from_nav=1'},session);await delay(15000);await cmd('Target.detachFromTarget',{sessionId:session});return;}
 const handler=m=>{if(m.sessionId===session&&m.method==='Fetch.requestPaused')cmd('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html; charset=utf-8'}],body:Buffer.from(fixture).toString('base64')},session).catch(()=>{});};
 listeners.add(handler);await cmd('Fetch.enable',{patterns:[{urlPattern:'https://www.douyin.com/*',resourceType:'Document'}]},session);
 await cmd('Page.navigate',{url:'https://www.douyin.com/?recommend=1&from_nav=1'},session);
 await delay(1000);await cmd('Fetch.disable',{},session);listeners.delete(handler);await cmd('Target.detachFromTarget',{sessionId:session});
}
await fixtureNavigate();
let feedTab=await api(`chrome.tabs.query({url:'https://www.douyin.com/*'}).then(t=>t[0])`);
let feedTabId=feedTab.id;
if(process.env.LIVE_PROBE==='1'){
 const parsed=await api(`chrome.tabs.sendMessage(${feedTabId},{type:'DRA_PARSE_FEED'})`).catch(error=>({error:String(error)}));
 const result={kind:'live-douyin-read-only-probe',at:new Date().toISOString(),pageStatus:feedTab.status,ok:parsed.ok,blockedReason:parsed.observation?.blockedReason,hasObservation:Boolean(parsed.observation?.videoId),profileReady:parsed.profile?.ready,error:parsed.error};
 console.log(JSON.stringify(result));
 await writeFile(process.env.RUNTIME_REPORT||resolve(profile,'live-probe.json'),JSON.stringify(result,null,2));ws.close();chrome.kill();process.exit(0);
}
const initial=await request({type:'DRA_GET_STATUS',tabId:feedTabId});
const configured=await request({type:'DRA_SAVE_CONFIG',settings:{...initial.settings,dryRun:true,cloud:{enabled:false},markRejectedNotInterested:false,dwell:{mode:'fixed',fixedSeconds:5},target:{mode:'time',durationMinutes:Math.ceil(minutes+5),maxItems:10000},schedule:{...initial.settings.schedule,enabled:process.env.LIVE_RUN==='1'}},rules:initial.rules});
assert.equal(configured.ok,true,JSON.stringify(configured));
if(process.env.RAW_CAPTURE==='1') assert.equal((await request({type:'DRA_SET_RAW_CAPTURE',enabled:true})).ok,true);
if(process.env.LIVE_RUN==='1'){
 await api(`chrome.alarms.create('dra-schedule-next',{when:Date.now()+200})`);
 let saved;
 for(let i=0;i<150;i++){saved=await api(`chrome.storage.local.get('draState').then(v=>v.draState)`);if(saved.status==='running'||saved.status==='paused')break;await delay(300);}
 assert.equal(saved.status,'running',JSON.stringify(saved));feedTabId=saved.feedTabId;feedTab=await api(`chrome.tabs.get(${feedTabId})`);
}else{
 const startTabId=process.env.START_FROM_OTHER==='1' ? (await api(`chrome.tabs.create({url:'about:blank',active:true})`)).id : feedTabId;
 const started=await api(`chrome.tabs.update(${startTabId},{active:true}).then(t=>chrome.windows.update(t.windowId,{focused:true})).then(()=>chrome.runtime.sendMessage({type:'DRA_START',tabId:${startTabId}}))`);
 assert.equal(started.ok,true,JSON.stringify(started));
 assert.equal(started.state.feedTabId,feedTabId);
}
const foreground=await api(`chrome.tabs.create({url:'about:blank',active:${process.env.FOREGROUND_BASELINE!=='1'}})`);
const state=()=>request({type:'DRA_GET_STATUS',tabId:feedTabId}).then(r=>r.state);
const pageEval=expression=>api(`chrome.debugger.sendCommand({tabId:${feedTabId}},'Runtime.evaluate',{expression:${JSON.stringify(expression)},returnByValue:true}).then(r=>r.result.value)`);
const hashes = {};
for (const name of ['background.js','content/douyin-content.js','manifest.json']) hashes[name]=createHash('sha256').update(await readFile(resolve(root,'dist',name))).digest('hex');
const report={hashes,startedAt:new Date().toISOString(),chrome:await cmd('Browser.getVersion'),minutes,foregroundBaseline:process.env.FOREGROUND_BASELINE==='1',fixtures:process.env.LIVE_RUN!=='1',samples:[],scenarios:[]};
const output=process.env.RUNTIME_REPORT||resolve(profile,'report.json');
await writeFile(resolve(profile,'control.json'),JSON.stringify({endpoint,controlId,feedId,feedTabId,extensionId,foreground,output}));
console.log(JSON.stringify({ready:true,control:resolve(profile,'control.json'),output}));
const start=Date.now();
try{
 for(let i=0;Date.now()-start<minutes*60000;i++){
  await delay(30000);
  const snapshot=await state();const sample={at:new Date().toISOString(),elapsedSeconds:Math.round((Date.now()-start)/1000),status:snapshot.status,scanned:snapshot.stats.scanned,runtime:snapshot.runtime,visibility:snapshot.pageVisibility,error:snapshot.pauseReason||snapshot.lastError};
  report.samples.push(sample);console.log(JSON.stringify(sample));
  await writeFile(output,JSON.stringify(report,null,2));
  assert.equal(snapshot.status,'running',JSON.stringify(sample));
  if(process.env.LIVE_RUN!=='1')assert.ok(snapshot.stats.scanned>0,'must process cards');
  if(i===0){const tab=await api(`chrome.tabs.get(${feedTabId})`);assert.equal(tab.active,process.env.FOREGROUND_BASELINE==='1','tab activity must match test mode');assert.equal(tab.autoDiscardable,false);report.scenarios.push(process.env.FOREGROUND_BASELINE==='1'?'active-tab-baseline':'background-tab');}
  if(i===2){await api(`chrome.windows.update(${feedTab.windowId},{state:'minimized'})`);report.scenarios.push('minimized-window');}
  if(i===14){await api(`chrome.windows.update(${feedTab.windowId},{state:'normal',focused:false})`);report.scenarios.push('restored-unfocused');}
 }
 if(process.env.LIVE_RUN==='1'){
  const entries=await api(`chrome.storage.local.get('draOutbox').then(v=>v.draOutbox||[])`);
  report.liveResults={observations:entries.length,confirmedTransitions:entries.filter(e=>e.payload?.transition_ok===true).length,dwellSeconds:entries.map(e=>e.payload?.dwell_seconds),decisions:entries.map(e=>e.payload?.decision)};
  assert.ok(report.liveResults.confirmedTransitions>0,'real page must confirm at least one transition');
  report.scenarios.push('live-douyin-background-read-and-transition');
 } else {
 report.events=await pageEval('window.fixtureEvents');
 assert.ok(report.events.every(e=>e.trusted),'all transitions use trusted input');
 const intervals=report.events.slice(1).map((e,i)=>e.at-report.events[i].at).sort((a,b)=>a-b);
 report.intervals={count:intervals.length,min:intervals[0],p95:intervals[Math.floor(intervals.length*.95)],max:intervals.at(-1)};
 assert.ok(report.intervals.max<15000,JSON.stringify(report.intervals));
 report.scenarios.push('steady-background-timing');
 }
 const stopped=await request({type:'DRA_PAUSE',tabId:feedTabId});assert.equal(stopped.ok,true);
 const pausedSnapshot=await state();const pausedCount=pausedSnapshot.stats.scanned;const pausedHistory=(await request({type:"DRA_GET_STATUS",global:true})).decisionHistoryTotal;
 await delay(6000);assert.equal((await state()).stats.scanned,pausedCount);report.scenarios.push('pause-cancels-work');
 const resumed=await request({type:'DRA_RESUME'});assert.equal(resumed.ok,true,JSON.stringify(resumed));
 assert.equal(resumed.state.runId,pausedSnapshot.runId);assert.equal(resumed.state.startedAt,pausedSnapshot.startedAt);
 assert.equal(resumed.state.stats.scanned,pausedCount);assert.equal((await request({type:"DRA_GET_STATUS",global:true})).decisionHistoryTotal,pausedHistory);
 assert.ok(resumed.state.stopAt-pausedSnapshot.stopAt>=6000,'paused interval is excluded from target');
 await delay(1000);await request({type:'DRA_PAUSE',tabId:feedTabId});
 const pausedAgain=await state();assert.ok(pausedAgain.elapsedMs-pausedSnapshot.elapsedMs<5000,'paused wall time excluded from active duration');
 report.scenarios.push('resume-preserves-run-results-and-excludes-pause-time');
 console.log(JSON.stringify({scenario:'resume-preserved-results',passed:true}));
 if(process.env.LIVE_RUN!=='1'&&process.env.FOREGROUND_BASELINE!=='1'){
 const waitState=async(predicate,timeout=15000)=>{const end=Date.now()+timeout;while(Date.now()<end){const value=await state();if(predicate(value))return value;await delay(250);}throw new Error('State condition timed out: '+JSON.stringify(await state()));};
 // Refresh while waiting: preserve the run and its real stop deadline.
 await api(`chrome.tabs.update(${feedTabId},{active:true}).then(t=>chrome.windows.update(t.windowId,{focused:true}))`);
 const configNow=await request({type:'DRA_GET_STATUS',tabId:feedTabId});
 await request({type:'DRA_SAVE_CONFIG',settings:{...configNow.settings,dwell:{mode:'fixed',fixedSeconds:30},target:{mode:'time',durationMinutes:5,maxItems:10000}},rules:configNow.rules});
 assert.equal((await request({type:'DRA_START',tabId:feedTabId})).ok,true);
 await api(`chrome.tabs.update(${foreground.id},{active:true})`);
 const beforeReload=await waitState(s=>s.runtime?.phase==='dwell');
 await fixtureNavigate();
 const afterReload=await waitState(s=>s.loopId!==beforeReload.loopId&&s.runtime?.phase==='dwell');
 assert.equal(afterReload.runId,beforeReload.runId);
 assert.equal(afterReload.stopAt,beforeReload.stopAt);
 assert.equal(afterReload.runtime.waitUntil,beforeReload.runtime.waitUntil,'refresh must preserve dwell deadline');
 report.scenarios.push('refresh-preserves-run-and-deadline');
 console.log(JSON.stringify({scenario:'refresh',passed:true}));
 await fixtureNavigate();
 const secondReload=await waitState(s=>s.loopId!==afterReload.loopId&&s.runtime?.phase==='dwell');
 assert.equal(secondReload.runtime.waitUntil,beforeReload.runtime.waitUntil);
 assert.equal(secondReload.runtime.cycleStartedAt,beforeReload.runtime.cycleStartedAt);
 report.scenarios.push('repeated-refresh-preserves-observation-start');
 console.log(JSON.stringify({scenario:'repeated-refresh',passed:true}));

 // Unexpected detach: the next watchdog must reacquire its own debugger.
 const beforeDetach=await state();
 await api(`chrome.debugger.detach({tabId:${feedTabId}})`);
 await api(`chrome.alarms.create('dra-watchdog',{when:Date.now()+100})`);
 await waitState(s=>s.status==='paused'||Date.parse(s.keepAliveAt)>Date.parse(beforeDetach.keepAliveAt));
 const reattached=await api(`chrome.debugger.sendCommand({tabId:${feedTabId}},'Page.getFrameTree').then(()=>true,()=>false)`);
 assert.equal(reattached,true,'debugger must be restored');
 report.scenarios.push('debugger-reattached');
 console.log(JSON.stringify({scenario:'debugger-reattached',passed:true}));
 const preFreeze=await state();
 await api(`chrome.debugger.sendCommand({tabId:${feedTabId}},'Page.setWebLifecycleState',{state:'frozen'})`);
 await api(`chrome.alarms.create('dra-watchdog',{when:Date.now()+100})`);
 await waitState(s=>Date.parse(s.keepAliveAt)>Date.parse(preFreeze.keepAliveAt));
 const thawed=await api(`chrome.tabs.sendMessage(${feedTabId},{type:'DRA_LOOP_STATUS'})`);
 assert.equal(thawed.running,true,'frozen page must resume its loop');
 report.scenarios.push('frozen-page-thawed');
 console.log(JSON.stringify({scenario:'frozen-page-thawed',passed:true}));
 if(process.env.STOP_WORKER==='1'){
  const versions=new Map();
  const onVersion=message=>{if(message.sessionId===control&&message.method==='ServiceWorker.workerVersionUpdated')for(const v of message.params.versions)versions.set(v.versionId,v);};
  listeners.add(onVersion);await cmd('ServiceWorker.enable',{},control);await delay(500);
  const version=[...versions.values()].find(v=>v.scriptURL===`chrome-extension://${extensionId}/background.js`);
  assert.ok(version,'test must discover the extension worker');
  const beforeWorkerStop=await state();
  await cmd('ServiceWorker.stopWorker',{versionId:version.versionId},control);
  const recovered=await waitState(s=>s.status==='running'&&s.runtime?.lastTransitionAt>(beforeWorkerStop.runtime?.lastTransitionAt||0),60000);
  assert.equal(recovered.runId,beforeWorkerStop.runId);
  assert.equal(recovered.stopAt,beforeWorkerStop.stopAt);
  report.scenarios.push('worker-restart-preserves-run');
  listeners.delete(onVersion);await cmd('ServiceWorker.disable',{},control);
  console.log(JSON.stringify({scenario:'worker-restarted',passed:true}));
 }


 await request({type:'DRA_PAUSE',tabId:feedTabId});
 // A short time target must stop in the background, including while dwelling.
 const finalConfig=await request({type:'DRA_GET_STATUS',tabId:feedTabId});
 await request({type:'DRA_SAVE_CONFIG',settings:{...finalConfig.settings,dwell:{mode:'fixed',fixedSeconds:300},target:{mode:'time',durationMinutes:1,maxItems:10000}},rules:finalConfig.rules});
 await api(`chrome.tabs.update(${feedTabId},{active:true}).then(t=>chrome.windows.update(t.windowId,{focused:true}))`);
 assert.equal((await request({type:'DRA_START',tabId:feedTabId})).ok,true);
 await api(`chrome.tabs.update(${foreground.id},{active:true})`);
 const timed=await waitState(s=>s.status==='paused',75000);
 report.stopDelayMs=Date.parse(timed.endedAt)-timed.stopAt;
 assert.ok(report.stopDelayMs>=0&&report.stopDelayMs<5000,`stop delay ${report.stopDelayMs}`);
 report.scenarios.push('time-target-stops-during-long-dwell');
 console.log(JSON.stringify({scenario:'timed-stop',passed:true,delay:report.stopDelayMs}));
 }
 if(process.env.RAW_CAPTURE==='1') {
  const samples=await request({type:'DRA_EXPORT_RAW'});
  assert.ok(samples.samples.length>0,'automatic samples recorded during actual runtime');
  assert.ok(samples.samples.every(s=>s.label==='unconfirmed'&&s.dom.includes('feed-item')));
  report.rawSampleCount=samples.samples.length;
  report.scenarios.push('automatic-local-raw-capture-with-background-runtime');
 }
 report.passed=true;
}catch(error){report.error=String(error);console.error(error);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({complete:true,passed:report.passed,output,intervals:report.intervals}));ws.close();chrome.kill();}
