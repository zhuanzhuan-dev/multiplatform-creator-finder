// Real headed Chrome + the built extension. Only the website response is a fixture.
// No background-throttling switches, fake extension APIs, or production uploads.
import { spawn, execFileSync } from 'node:child_process';
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect } from 'node:net';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const delay = ms => new Promise(r=>setTimeout(r,ms));
const root=resolve(import.meta.dirname,'..');
const profile=await mkdtemp(resolve(tmpdir(),'finder-runtime-test-'));
// A local TLS proxy serves the fixture across navigation, new tabs and runtime reloads.
// It also prevents the test from reaching the real recommendation feed.
const fixture=await readFile(resolve(root,'scripts/fixtures/runtime-feed.html'),'utf8');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',resolve(profile,'key.pem'),'-out',resolve(profile,'cert.pem'),'-subj','/CN=www.douyin.com','-days','1'],{stdio:'ignore'});
const site=httpsServer({key:await readFile(resolve(profile,'key.pem')),cert:await readFile(resolve(profile,'cert.pem'))},(_,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fixture);});
await new Promise(r=>site.listen(0,'127.0.0.1',r));
const proxy=httpServer((_,res)=>{res.writeHead(502);res.end();});
proxy.on('connect',(req,socket,head)=>{
 if(req.url!=='www.douyin.com:443'){socket.destroy();return;}
 const upstream=connect(site.address().port,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});
 upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
});
await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
site.unref();proxy.unref();
const executable=process.env.CHROME_BIN;
if(!executable)throw new Error('Set CHROME_BIN to Chrome for Testing executable');
const chrome=spawn(executable,[`--user-data-dir=${profile}`,'--remote-debugging-port=0',`--proxy-server=http://127.0.0.1:${proxy.address().port}`,'--ignore-certificate-errors','--no-first-run','--no-default-browser-check',`--disable-extensions-except=${root}/dist`,`--load-extension=${root}/dist`,'about:blank'],{stdio:'ignore'});
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
const feedId=(await cmd('Target.createTarget',{url:'about:blank'})).targetId;
async function fixtureNavigate(){
 const session=await attach(feedId);
 const handler=m=>{if(m.sessionId===session&&m.method==='Fetch.requestPaused')cmd('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html; charset=utf-8'}],body:Buffer.from(fixture).toString('base64')},session).catch(()=>{});};
 listeners.add(handler);await cmd('Fetch.enable',{patterns:[{urlPattern:'https://www.douyin.com/*',resourceType:'Document'}]},session);
 await cmd('Page.navigate',{url:'https://www.douyin.com/?recommend=1&from_nav=1'},session);
 await delay(1000);await cmd('Fetch.disable',{},session);listeners.delete(handler);await cmd('Target.detachFromTarget',{sessionId:session});
}
await fixtureNavigate();
let feedTab=await api(`chrome.tabs.query({url:'https://www.douyin.com/*'}).then(t=>t[0])`);
let feedTabId=feedTab.id;
const initial=await request({type:'DRA_GET_STATUS',tabId:feedTabId});
const configured=await request({type:'DRA_SAVE_CONFIG',settings:{...initial.settings,dryRun:true,cloud:{enabled:false},markRejectedNotInterested:false,dwell:{mode:'fixed',fixedSeconds:5},target:{mode:'time',durationMinutes:6,maxItems:10000},schedule:{...initial.settings.schedule,enabled:false}},rules:initial.rules});
assert.equal(configured.ok,true,JSON.stringify(configured));
const started=await api(`chrome.tabs.update(${feedTabId},{active:true}).then(t=>chrome.windows.update(t.windowId,{focused:true})).then(()=>chrome.runtime.sendMessage({type:'DRA_START',tabId:${feedTabId}}))`);
assert.equal(started.ok,true,JSON.stringify(started));
assert.equal(started.state.feedTabId,feedTabId);

const report={version:'1.0.18',scenarios:[],startedAt:new Date().toISOString()};
await mkdir(resolve(root,'test-results'),{recursive:true});
const waitFor=async(fn,label,timeout=20000)=>{const until=Date.now()+timeout;while(Date.now()<until){const value=await fn();if(value)return value;await delay(100);}throw Error(label);};
const snapshot=async()=>{const r=await request({type:'DRA_GET_STATUS',global:true});assert.equal(r.ok,true,r.error);return r.state;};
const pause=async()=>{const s=await snapshot();const r=await request({type:'DRA_PAUSE',tabId:s.feedTabId});assert.equal(r.ok,true,r.error);return snapshot();};
const resumeButton=async()=>{
 await waitFor(()=>api(`document.querySelector('.run-card .primary')?.textContent==='继续本轮' && !document.querySelector('.run-card .primary').disabled`),'resume button enabled');
 await api(`document.querySelector('.run-card .primary').click()`);
 return waitFor(async()=>{const s=await snapshot();return s.status==='running'?s:null;},'resume must run');
};
const preserved=(before,after)=>{
 console.log(JSON.stringify({resumed:true,tab:after.feedTabId,created:after.createdByExtension,scanned:after.stats.scanned}));
 assert.equal(after.runId,before.runId);assert.equal(after.startedAt,before.startedAt);
 assert.equal(after.elapsedMs,before.elapsedMs);assert.ok(after.stats.scanned>=before.stats.scanned);
 assert.deepEqual(after.runTarget,before.runTarget);
 assert.ok(Math.abs(after.stopAt-Date.now()-(after.runTarget.durationMinutes*60000-before.elapsedMs))<2000);
};
const navigate=async(targetId,url)=>{
 const session=await attach(targetId);
 await cmd('Page.navigate',{url},session);await delay(700);
 await cmd('Target.detachFromTarget',{sessionId:session});
};
try{
 // Rehydrate the real panel after changing the test configuration.
 await cmd('Page.reload',{},control);await delay(800);
 await waitFor(async()=> (await snapshot()).stats.scanned>0,'collect before pause');
 const outside=await api(`chrome.tabs.create({url:'about:blank',active:true})`);
 let before=await pause();
 let after=await resumeButton();preserved(before,after);assert.equal(after.feedTabId,feedTabId);
 assert.equal((await api(`chrome.tabs.get(${outside.id})`)).active,true,'background resume retains current page');
 report.scenarios.push('actual-resume-button-from-other-site-preserves-original-task');
 before=await pause();
 await api(`chrome.tabs.update(${feedTabId},{active:true})`);
 after=await resumeButton();preserved(before,after);assert.equal(after.feedTabId,feedTabId);
 report.scenarios.push('actual-resume-button-from-recommendation-retains-progress');
 before=await pause();
 const featuredTarget=(await cmd('Target.createTarget',{url:'about:blank'})).targetId;
 await navigate(featuredTarget,'https://www.douyin.com/');
 const featuredTab=await api(`chrome.tabs.query({url:'https://www.douyin.com/'}).then(t=>t[0])`);
 await api(`chrome.tabs.update(${featuredTab.id},{active:true})`);
 after=await resumeButton();preserved(before,after);assert.equal(after.feedTabId,feedTabId);
 assert.equal((await api(`chrome.tabs.get(${featuredTab.id})`)).active,true);
 report.scenarios.push('actual-resume-button-from-featured-preserves-original-task');
 before=await pause();
 // Original task navigates away; an existing recommendation page becomes the task page.
 await navigate(feedId,'https://www.douyin.com/');
 const replacementTarget=(await cmd('Target.createTarget',{url:'about:blank'})).targetId;
 await navigate(replacementTarget,'https://www.douyin.com/?recommend=1');
 const replacementTab=await api(`chrome.tabs.query({url:'https://www.douyin.com/*'}).then(t=>t.find(v=>v.url.includes('recommend=1')))`);
 await api(`chrome.tabs.update(${feedTabId},{active:true})`);
 after=await resumeButton();preserved(before,after);assert.equal(after.feedTabId,replacementTab.id);assert.equal(after.createdByExtension,false);
 assert.equal((await api(`chrome.tabs.get(${feedTabId})`)).url,'https://www.douyin.com/');
 report.scenarios.push('original-featured-page-preserved-existing-recommendation-reused');
 await waitFor(async()=> (await snapshot()).runtime?.phase==='dwell','replacement continues collection');
 before=await pause();
 await navigate(replacementTarget,'about:blank');
 await api(`chrome.tabs.update(${replacementTab.id},{active:true})`);
 after=await resumeButton();preserved(before,after);assert.notEqual(after.feedTabId,replacementTab.id);assert.equal(after.createdByExtension,true);
 assert.equal((await api(`chrome.tabs.get(${replacementTab.id})`)).url,'about:blank');
 report.scenarios.push('original-other-site-preserved-new-recommendation-created');
 await waitFor(async()=> (await snapshot()).runtime?.phase==='dwell','new page collects');
 before=await pause();
 await api(`chrome.tabs.remove(${before.feedTabId})`);
 after=await resumeButton();preserved(before,after);assert.notEqual(after.feedTabId,before.feedTabId);assert.equal(after.createdByExtension,true);
 report.scenarios.push('closed-task-tab-recreated-with-same-run');
 await waitFor(async()=> (await snapshot()).runtime?.phase==='dwell','recreated page collects');
 const final=await waitFor(async()=>{const s=await snapshot();return s.stats.scanned>before.stats.scanned?s:null;},'recreated task must process another card');
 assert.equal(final.runId,before.runId);
 report.scannedAfterResume=final.stats.scanned;
 const events=await api(`chrome.debugger.sendCommand({tabId:${final.feedTabId}},'Runtime.evaluate',{expression:'window.fixtureEvents',returnByValue:true}).then(r=>r.result.value)`);
 assert.ok(events.some(event=>event.trusted),'recreated page must advance with trusted input');
 await request({type:'DRA_STOP',tabId:final.feedTabId});
 assert.equal((await api(`chrome.tabs.get(${replacementTab.id})`)).url,'about:blank');
 assert.equal((await api(`chrome.tabs.get(${feedTabId})`)).url,'https://www.douyin.com/');
 report.scenarios.push('stop-closes-only-extension-created-replacement');
 report.passed=true;
 await writeFile(resolve(root,'test-results/resume-navigation.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}catch(error){
 report.error=String(error);report.state=await snapshot().catch(()=>null);report.panel=await api('document.body.innerText').catch(()=>null);
 await writeFile(resolve(root,'test-results/resume-navigation.json'),JSON.stringify(report,null,2));throw error;
}finally{ws.close();chrome.kill();site.close();proxy.close();}
