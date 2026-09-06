// Real extension pages, persistent theme preference and emulated OS appearance.
// Uses an isolated Chrome profile; no pairing or uploads.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const delay = ms => new Promise(r=>setTimeout(r,ms));
const root=resolve(import.meta.dirname,'..');
const profile=process.env.RESUME_PROFILE || await mkdtemp(resolve(tmpdir(),'finder-panel-test-'));
if(process.env.RESUME_PROFILE) { const { unlink } = await import('node:fs/promises'); await unlink(resolve(profile,'DevToolsActivePort')).catch(()=>{}); }
const executable=process.env.CHROME_BIN;
if(!executable)throw new Error('Set CHROME_BIN to Chrome for Testing executable');
const fixtureDist=await mkdtemp(resolve(tmpdir(),'finder-launcher-dist-'));
await cp(resolve(root,'dist'),fixtureDist,{recursive:true});
await writeFile(resolve(fixtureDist,'background.js'),(await readFile(resolve(fixtureDist,'background.js'),'utf8'))+`
globalThis.launcherTest={set: async patch=>{state={...state,...patch};await persistState();},status:()=>state.status,windows:()=>[...panelPorts.keys()]};`);
const chrome=spawn(executable,[`--user-data-dir=${profile}`,'--remote-debugging-port=0','--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check',`--disable-extensions-except=${fixtureDist}`,`--load-extension=${fixtureDist}`,'about:blank'],{stdio:'ignore'});
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
try {
 const worker=(await cmd('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/background.js`);
 const sw=await attach(worker.targetId);
 const {targetId}=await cmd('Target.createTarget',{url:'about:blank'});const page=await attach(targetId);
 await cmd('Fetch.enable',{patterns:[{urlPattern:'https://www.douyin.com/*',requestStage:'Request'}]},page);
 listeners.add(m=>{if(m.sessionId===page&&m.method==='Fetch.requestPaused')void cmd('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from('<!doctype html><html><body style="background:#edf2ef;height:2000px"><h1>隔离测试推荐页</h1></body></html>').toString('base64')},page);});
 await cmd('Page.navigate',{url:'https://www.douyin.com/?recommend=1'},page);
 await waitFor(()=>evaluate(page,`Boolean(document.getElementById('dra-floating-launcher'))`),'launcher installed');
 await evaluate(sw,`launcherTest.set({status:'running',runId:'launcher-test',stats:{scanned:19},feedTabId:null})`);
 await waitFor(()=>evaluate(page,`document.getElementById('dra-floating-launcher').hasAttribute('data-visible')`),'visible');
 const get=()=>evaluate(page,`(()=>{const h=document.getElementById('dra-floating-launcher'),b=h.shadowRoot.querySelector('button'),r=b.getBoundingClientRect();return {visible:h.hasAttribute('data-visible'),theme:h.dataset.theme,label:b.getAttribute('aria-label'),x:r.x+r.width/2,y:r.y+r.height/2,top:r.top,width:r.width}})()`);
 let info=await get();assert.match(info.label,/19/);assert.equal(info.width,48);
 await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:info.x,y:info.y,button:'left',clickCount:1},page);
 await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:info.x,y:info.y-90,button:'left',buttons:1},page);
 await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:info.x,y:info.y-90,button:'left',clickCount:1},page);
 assert.ok((await get()).top<info.top-60);const position=await evaluate(sw,`chrome.storage.local.get('draLauncherPosition')`);assert.equal(typeof position.draLauncherPosition,'number');
 await evaluate(sw,`chrome.storage.local.set({draTheme:'dark'})`);await waitFor(async()=>(await get()).theme==='dark','theme');
 const shot=await cmd('Page.captureScreenshot',{format:'png'},page);await writeFile(resolve(root,'test-results/launcher-dark.png'),Buffer.from(shot.data,'base64'));
 info=await get();await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:info.x,y:info.y,button:'left',clickCount:1},page);await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:info.x,y:info.y,button:'left',clickCount:1},page);
 await waitFor(()=>evaluate(sw,`launcherTest.windows().length>0`),'actual side panel opened from trusted click');
 await waitFor(async()=>!(await get()).visible,'launcher hidden while panel open');
 assert.equal(await evaluate(sw,'launcherTest.status()'),'running');
 // Close the native side panel through the API on current Chrome, equivalent lifetime to X.
 await evaluate(sw,`chrome.sidePanel.close({windowId:launcherTest.windows()[0]})`);
 await waitFor(async()=>(await get()).visible,'restored after closing panel');
 assert.equal(await evaluate(sw,'launcherTest.status()'),'running');
 await evaluate(sw,`launcherTest.set({status:'paused'})`);await waitFor(async()=>/已暂停/.test((await get()).label),'paused');
 await evaluate(sw,`launcherTest.set({status:'stopped',endedAt:new Date(Date.now()-9000).toISOString()})`);await waitFor(async()=>!(await get()).visible,'finished hidden');
 report.scenarios.push('real content injection','drag persists position','dark theme','trusted click opens native side panel','closing native panel preserves running task','paused status','ended visibility');
 await writeFile(resolve(root,'test-results/launcher.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally { await cmd('Browser.close').catch(()=>{});ws.close();chrome.kill(); }
