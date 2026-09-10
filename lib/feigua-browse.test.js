import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:`import {installFeiguaBrowsing} from './content/feigua-browse.js'; globalThis.install=installFeiguaBrowsing;`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',plugins:[{name:'page',setup(b){b.onLoad({filter:/feigua-page.js$/},()=>({contents:`export const browsingSurface=()=>fixture.surface;export const pageAccessProblem=()=>fixture.problem;export const collectCurrentPage=()=>fixture.page;export const collectDetailPage=()=>fixture.page;`,loader:'js'}));}}]});
function setup(){
 const listeners={},sent=[];let timer,running=false,cancelled=0,enabled=true,skipped=false;
 class Element {closest(){return this.control?{}:null;}}
 const context={Element,fixture:{surface:'video',problem:'',page:{rows:[{authorName:'甲'}]}},location:{hash:'#/video-detail/index?awemeId=1'},setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{timer=null;},MutationObserver:class{constructor(fn){listeners.mutation=fn;}observe(){}disconnect(){}},document:{body:{},visibilityState:'visible',addEventListener:(name,fn)=>{listeners[name]=fn;}},window:{addEventListener:(name,fn)=>{listeners[name]=fn;}},chrome:{storage:{onChanged:{addListener:fn=>{listeners.storage=fn;}}},runtime:{sendMessage:async m=>{sent.push(m);return m.type==='DRA_FEIGUA_BROWSE_STATUS'?{enabled,automaticTab:running}:{ok:true,skipped};}}}};
 vm.runInNewContext(bundle.outputFiles[0].text,context);context.install({isRunning:()=>running,cancelAutomatic:()=>{running=false;cancelled++;}});
 return {context,listeners,sent,Element,setRunning:v=>{running=v;},setEnabled:v=>{enabled=v;},setSkipped:v=>{skipped=v;},cancelled:()=>cancelled,tick:async()=>{const fn=timer;timer=null;if(fn)await fn();}};
}
test('passive collector waits for stable content, dedupes and captures same-URL changes',async()=>{
 const f=setup();await f.tick();assert.equal(f.sent.filter(m=>m.type==='DRA_FEIGUA_BROWSE_PAGE').length,0);await f.tick();assert.equal(f.sent.at(-1).type,'DRA_FEIGUA_BROWSE_PAGE');
 f.listeners.mutation();await f.tick();assert.equal(f.sent.filter(m=>m.type==='DRA_FEIGUA_BROWSE_PAGE').length,1);
 f.context.fixture.page.rows[0].title='新的内容';f.listeners.mutation();await f.tick();await f.tick();assert.equal(f.sent.filter(m=>m.type==='DRA_FEIGUA_BROWSE_PAGE').length,2);
});
test('disabled or automatically owned tabs do not passively collect',async()=>{
 const f=setup();f.setEnabled(false);await f.tick();assert.equal(f.sent.some(m=>m.type==='DRA_FEIGUA_BROWSE_PAGE'),false);
 f.setEnabled(true);f.setRunning(true);f.listeners.mutation();await f.tick();assert.equal(f.sent.some(m=>m.type==='DRA_FEIGUA_BROWSE_PAGE'),false);
});
test('real user control cancels automatic run synchronously; script clicks do not',()=>{
 const f=setup();const target=new f.Element();target.closest=selector=>selector.startsWith('#')?null:{};f.setRunning(true);
 f.listeners.click({isTrusted:false,type:'click',target});assert.equal(f.cancelled(),0);
 f.listeners.click({isTrusted:true,type:'click',target});assert.equal(f.cancelled(),1);assert.equal(f.sent.at(-1).type,'DRA_FEIGUA_TAKEOVER');
});

test('a background skip is retried rather than marked as a successful capture',async()=>{
 const f=setup();f.setSkipped(true);await f.tick();await f.tick();
 f.setSkipped(false);await f.tick();
 assert.equal(f.sent.filter(m=>m.type==='DRA_FEIGUA_BROWSE_PAGE').length,2);
 f.listeners.mutation();await f.tick();assert.equal(f.sent.filter(m=>m.type==='DRA_FEIGUA_BROWSE_PAGE').length,2);
});

test('passive capture waits for images even without another DOM mutation',async()=>{
 const f=setup();f.context.fixture.page.pendingImages=1;
 await f.tick();await f.tick();assert.equal(f.sent.some(m=>m.type==='DRA_FEIGUA_BROWSE_PAGE'),false);
 f.context.fixture.page.pendingImages=0;await f.tick();await f.tick();
 assert.equal(f.sent.filter(m=>m.type==='DRA_FEIGUA_BROWSE_PAGE').length,1);
});
