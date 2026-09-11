import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../content/feigua-content.js', import.meta.url).pathname], bundle:true, write:false, format:'iife', plugins:[{name:'page-fixture',setup(b){
 b.onLoad({filter:/feigua-page\.js$/},()=>({contents:`export const collectDetailPage=()=>({rows:[]}); export const browsingSurface=()=>null; export const pageAccessProblem=()=>''; export const collectCurrentPage=()=>fixture.read(); export const pageFingerprint=p=>JSON.stringify(p.rows); export const pagination=()=>fixture.pager(); export const pageProblem=()=>fixture.problem || '';`,loader:'js'}));
 b.onLoad({filter:/floating-launcher\.js$/},()=>({contents:'',loader:'js'}));
}}] });
async function runFixture({ pause=false, frozen=false, blocked=false, settings={}, pauseWait=false, imagesUntil=0, changingUntil=0, incompleteUntil=0, loadingAfter=null }={}) {
 let listener, page=1, clicks=0, time=0, resolveDone;
 const messages=[], delays=[];
 const done=new Promise(resolve=>{resolveDone=resolve;});
 const context={
  Date:{now:()=>time}, location:{href:'https://dy.feigua.cn/app/#/video/library/all'}, document:{visibilityState:'visible',hasFocus:()=>true},
  fixture:{get problem(){return blocked?'需要人工验证':loadingAfter!==null && time>=loadingAfter && time<loadingAfter+2250?'loading':'';},read:()=>({diagnostics:{candidateCount:time<incompleteUntil?2:1,parsedCount:1},pendingImages:time<imagesUntil?1:0,rows:[{authorName:`甲${page}`,avatarUrl:'avatar',likes:time<changingUntil?time:100}],pageUrl:'https://dy.feigua.cn/app/#/video/library/all'}),pager:()=>({number:String(page),last:page===2,next:{scrollIntoView(){},click(){clicks++;if(!frozen)page++;}}})},
  chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}},async sendMessage(m){messages.push({...m,testTime:time});
   if(m.type==='DRA_WAIT') {delays.push(m.until-time);if(pauseWait && m.until-time>=1000){listener({type:'DRA_STOP_LOOP',loopId:'l'},{},()=>{});resolveDone();}time=m.until;return {ok:true};}
   if(m.type==='DRA_FEIGUA_PAGE' && pause) {listener({type:'DRA_STOP_LOOP',loopId:'l'}, {},()=>{});resolveDone();return {continue:true};}
   if(m.type==='DRA_FEIGUA_COMPLETE'||m.type==='DRA_PAGE_BLOCKED')resolveDone();
   return {ok:true,continue:true};
  }}}
 };
 vm.runInNewContext(bundle.outputFiles[0].text,context);
 listener({type:'DRA_START_LOOP',runId:'r',loopId:'l',settings},{},()=>{});
 await done;
 await new Promise(resolve=>setImmediate(resolve));
 return {clicks,messages,page,delays};
}
test('Feigua content collects two stable pages and finishes at disabled next', async()=>{
 const r=await runFixture();assert.equal(r.clicks,1);assert.equal(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE').length,2);assert.equal(r.messages.at(-1).type,'DRA_FEIGUA_COMPLETE');
});
test('pause while saving page prevents next click', async()=>{
 const r=await runFixture({pause:true});assert.equal(r.clicks,0);assert.equal(r.messages.some(m=>m.type==='DRA_FEIGUA_COMPLETE'),false);
});
test('unchanged rows after next click pause with one click and no duplicate upload', async()=>{
 const r=await runFixture({frozen:true});assert.equal(r.clicks,1);assert.equal(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE').length,1);assert.match(r.messages.at(-1).reason,/未更新/);
});
test('verification blocker prevents collection and clicks', async()=>{
 const r=await runFixture({blocked:true});assert.equal(r.clicks,0);assert.equal(r.messages.some(m=>m.type==='DRA_FEIGUA_PAGE'),false);
});

test('configured flip interval reaches worker wait and last-page flag is submitted',async()=>{
 const r=await runFixture({settings:{feiguaDelay:{minSeconds:9,maxSeconds:9}}});
 assert.ok(r.delays.includes(9000));
 assert.equal(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE').at(-1).page.last,true);
});
test('pause during randomized flip wait cancels the next click',async()=>{
 const r=await runFixture({pauseWait:true});assert.equal(r.clicks,0);
 assert.ok(r.delays.some(ms=>ms>=4000 && ms<=6000));
});

test('waits for image readiness and complete row stability before saving',async()=>{
 const r=await runFixture({imagesUntil:4500,changingUntil:6000});
 const first=r.messages.find(m=>m.type==='DRA_FEIGUA_PAGE');
 assert.ok(first.testTime>=6750);assert.equal(first.page.rows[0].likes,100);
});
test('image loading timeout pauses without submitting or flipping',async()=>{
 const r=await runFixture({imagesUntil:Infinity});
 assert.equal(r.clicks,0);assert.equal(r.messages.some(m=>m.type==='DRA_FEIGUA_PAGE'),false);
 assert.match(r.messages.at(-1).reason,/头像或封面地址未就绪/);
 assert.ok(r.messages.at(-1).testTime>=60000);
});

test('slow image URLs arriving after the former 25s timeout are collected',async()=>{
 const r=await runFixture({imagesUntil:36000});
 assert.equal(r.clicks,1);assert.equal(r.messages.at(-1).type,'DRA_FEIGUA_COMPLETE');
 assert.ok(r.messages.find(m=>m.type==='DRA_FEIGUA_PAGE').testTime>=37500);
});
test('partially parsed rows and a returning loading mask reset stability',async()=>{
 const r=await runFixture({incompleteUntil:4500,loadingAfter:5250});
 const first=r.messages.find(m=>m.type==='DRA_FEIGUA_PAGE');
 assert.ok(first.testTime>=9000);assert.equal(r.clicks,1);
});
