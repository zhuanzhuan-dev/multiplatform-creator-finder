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
let fixture=await readFile(resolve(root,'scripts/fixtures/runtime-feed.html'),'utf8');

// There are no interaction buttons in this fixture. Shortcuts toggle existing state directly.
fixture += `<script>
window.fixtureInteractions=JSON.parse(sessionStorage.getItem('interactions')||'[]');
const reactions=JSON.parse(sessionStorage.getItem('reactions')||'{"0:100000002":true,"1:100000002":true,"2:author":true}');
addEventListener('keydown',event=>{
 const action={z:0,c:1,g:2}[event.key];if(action===undefined||!event.isTrusted)return;
 const video=document.querySelector('#video').getAttribute('data-e2e-vid');
 const id=action+':'+(action===2?'author':video);const was=!!reactions[id];reactions[id]=!was;
 window.fixtureInteractions.push({action,key:event.key,code:event.code,keyCode:event.keyCode,trusted:event.isTrusted,video,cancel:was});
 sessionStorage.setItem('interactions',JSON.stringify(window.fixtureInteractions));sessionStorage.setItem('reactions',JSON.stringify(reactions));
});
</script>`;
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

const report={version:'1.0.19',scenarios:[],startedAt:new Date().toISOString()};
await mkdir(resolve(root,'test-results'),{recursive:true});
const waitFor=async(fn,label,timeout=20000)=>{const until=Date.now()+timeout;while(Date.now()<until){const value=await fn();if(value)return value;await delay(100);}throw Error(label);};
const state=()=>request({type:'DRA_GET_STATUS',global:true}).then(r=>r.state);
const storage=()=>api(`chrome.storage.local.get('draSettings').then(r=>r.draSettings)`);
const click=expression=>api(`(${expression}).click()`);
try {
 await cmd('Page.reload',{},control);await delay(500);
 await waitFor(()=>api(`Boolean(document.querySelector('.configuration-panel'))`),'panel');
 assert.equal(await api(`document.querySelectorAll('main > .configuration-panel').length`),1);
 await click(`document.querySelector('.configuration-panel > summary')`);
 await api(`document.querySelector('#configuration-tab-0').focus()`);
 await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39},control);
 assert.equal(await api(`document.querySelector('#configuration-tab-1').getAttribute('aria-selected')`),'true');
 assert.equal(await api(`document.activeElement.id`),'configuration-tab-1');
 assert.equal(await api(`document.querySelector('#configuration-panel-0').hidden`),true);
 assert.equal(await api(`document.querySelectorAll('.engagement-actions input:checked').length`),0);
 await click(`document.querySelector('.engagement-settings .inline-heading button')`);
 await waitFor(async()=>{const s=await storage();return s.engagement.like&&s.engagement.collect&&s.engagement.follow;},'all interactions saved');
 await click(`document.querySelector('.engagement-presets button')`);
 await waitFor(async()=>(await storage()).engagement.rate===5,'preset saves globally');
 await api(`document.querySelector('#engagementRate').focus();document.querySelector('#engagementRate').select()`);
 await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8},control);
 await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8},control);
 assert.equal(await api(`document.querySelector('#engagementRate').value`),'');
 assert.equal(await api(`document.querySelector('#engagementRate').getAttribute('aria-invalid')`),'true');
 await cmd('Input.insertText',{text:'0'},control);
 await waitFor(async()=>(await storage()).engagement.rate===0,'zero quota saves');
 await api(`document.querySelector('#engagementRate').select()`);await cmd('Input.insertText',{text:'50'},control);
 await waitFor(async()=>(await storage()).engagement.rate===50,'test quota saves');
 await cmd('Page.reload',{},control);await delay(400);
 await waitFor(()=>api(`Boolean(document.querySelector('#engagementRate'))`),'reload');
 await click(`document.querySelector('.configuration-panel > summary')`);await click(`document.querySelector('#configuration-tab-1')`);
 assert.equal(await api(`document.querySelector('#engagementRate').value`),'50');
 assert.equal(await api(`document.querySelectorAll('.engagement-actions input:checked').length`),3);
 report.scenarios.push('shared-tabs-keyboard-navigation-default-off-global-presets-zero-and-reload');
 for(const theme of ['light','dark'])for(const width of [280,320,520]){
  await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},control);
  await api(`chrome.storage.local.set({draTheme:${JSON.stringify(theme)}})`);await delay(150);
  await api(`document.querySelector('.configuration-panel').scrollIntoView({block:'start'})`);
  const configShot=await cmd('Page.captureScreenshot',{format:'png'},control);
  await writeFile(resolve(root,`test-results/configuration-${theme}-${width}.png`),Buffer.from(configShot.data,'base64'));
  await api(`document.querySelector('.engagement-settings').scrollIntoView({block:'start'})`);
  assert.ok(await api(`document.documentElement.scrollWidth<=innerWidth`),'no horizontal overflow');
  const shot=await cmd('Page.captureScreenshot',{format:'png'},control);
  await writeFile(resolve(root,`test-results/engagement-${theme}-${width}.png`),Buffer.from(shot.data,'base64'));
 }
 report.scenarios.push('light-dark-280-320-520-settings-layout');
 const started=await api(`chrome.tabs.update(${feedTabId},{active:true}).then(t=>chrome.windows.update(t.windowId,{focused:true})).then(()=>chrome.runtime.sendMessage({type:'DRA_START',tabId:${feedTabId}}))`);
 assert.equal(started.ok,true,JSON.stringify(started));
 const foreground=await api(`chrome.tabs.create({url:"about:blank",active:true})`);
 assert.equal((await api(`chrome.tabs.get(${feedTabId})`)).active,false);
 // 50% accelerates the real end-to-end test; unit tests check all 100 prefixes at 10%.
 const completed=await waitFor(async()=>{const s=await state();assert.equal(s.status,'running',JSON.stringify(s));return s.engagement.sent.like===3&&s.engagement.sent.collect===3?s:null;},'three quota-limited likes and collections',70000);
 assert.ok(completed.engagement.used.like<=Math.floor(completed.engagement.videos*.5));
 assert.equal(completed.engagement.sent.follow,1,'follow once for multiple videos from one creator');
 assert.equal((await api(`chrome.tabs.get(${foreground.id})`)).active,true,'keys must stay in the background task tab');
 await request({type:'DRA_PAUSE',tabId:feedTabId});
 const before=await state();
 const actual=await api(`chrome.debugger.attach({tabId:${feedTabId}},'1.3').then(()=>chrome.debugger.sendCommand({tabId:${feedTabId}},'Runtime.evaluate',{expression:'window.fixtureInteractions',returnByValue:true})).then(r=>r.result.value)`);
 await api(`chrome.debugger.detach({tabId:${feedTabId}})`);
 assert.equal(actual.filter(e=>e.cancel).length,3,'shortcuts are sent even when platform state was already on');
 assert.ok(actual.every(e=>e.trusted));
 assert.deepEqual([...new Set(actual.map(e=>e.key))],['z','c','g']);
 assert.ok(actual.every(e=>e.code===({z:'KeyZ',c:'KeyC',g:'KeyG'})[e.key]));
 assert.equal(actual.filter(e=>e.action===0).length,3);
 assert.equal(actual.filter(e=>e.action===1).length,3);
 assert.equal(actual.filter(e=>e.action===2).length,1);
 const resumed=await request({type:'DRA_RESUME'});assert.equal(resumed.ok,true,resumed.error);
 assert.equal(resumed.state.runId,before.runId);assert.deepEqual(resumed.state.engagement.used,before.engagement.used);
 await request({type:'DRA_STOP',tabId:feedTabId});
 assert.deepEqual((await state()).engagement.used,before.engagement.used);
 report.scenarios.push('background-trusted-Z-C-G-without-buttons-or-state-checks-quota-dedup-pause-resume-stop');
 report.interactions=actual;report.ledger=(await state()).engagement;report.passed=true;
} catch(error) {report.error=String(error.stack||error);report.state=await state().catch(()=>null);process.exitCode=1;}
finally{await writeFile(resolve(root,'test-results/engagement.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));ws.close();chrome.kill();site.close();proxy.close();}
