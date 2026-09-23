import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../content/feigua-content.js', import.meta.url).pathname], bundle:true, write:false, format:'iife', plugins:[{name:'page-fixture',setup(b){
 b.onLoad({filter:/feigua-page\.js$/},()=>({contents:`export const collectDetailPage=()=>({rows:[]}); export const browsingSurface=()=>null; export const pageAccessProblem=()=>''; export const collectCurrentPage=()=>fixture.read(); export const pageFingerprint=p=>JSON.stringify(p.rows); export const pagination=()=>fixture.pager(); export const pageProblem=()=>fixture.problem || ''; export const revealList=()=>{fixture.reveals=(fixture.reveals||0)+1;return {scrolled:true,atEnd:true};};`,loader:'js'}));
 b.onLoad({filter:/feigua-api-cache\.js$/},()=>({contents:`export const installFeiguaApiCache=()=>{}; export const cancelFeiguaIdentities=()=>{}; export const requestFeiguaIdentities=()=>fixture.identity();`,loader:'js'}));
 b.onLoad({filter:/floating-launcher\.js$/},()=>({contents:'',loader:'js'}));
}}] });
async function runFixture({ pause=false, frozen=false, blocked=false, settings={}, pauseWait=false, imagesUntil=0, changingUntil=0, incompleteUntil=0, identityReadyAt=0, loadingAfter=null, badPages=[], totalPages=2, freezeClicks=0, pauseOnTimeout=false, missingPager=false, loadingPages=[] }={}) {
 let listener, page=1, clicks=0, time=0, resolveDone;
 const messages=[], delays=[], clickTimes=[];
 const done=new Promise(resolve=>{resolveDone=resolve;});
 const context={
  Date:{now:()=>time}, location:{href:'https://dy.feigua.cn/app/#/video/library/all'}, document:{visibilityState:'visible',hasFocus:()=>true},
  fixture:{get problem(){return blocked?'需要人工验证':loadingPages.includes(page)?'loading':loadingAfter!==null && time>=loadingAfter && time<loadingAfter+2250?'loading':'';},read:()=>({diagnostics:{candidateCount:time<incompleteUntil?2:1,parsedCount:1},pendingImages:time<imagesUntil?1:0,rows:badPages.includes(page)?[]:[{authorName:`甲${page}`,avatarUrl:'avatar',likes:time<changingUntil?time:100}],pageUrl:'https://dy.feigua.cn/app/#/video/library/all'}),identity:()=>page===1 && time<identityReadyAt?{phase:'loading'}:{phase:'done',lastRequestFinishedAt:page===1?identityReadyAt:0},pager:()=>missingPager?null:({number:String(page),last:page===totalPages,next:{scrollIntoView(){},click(){clicks++;clickTimes.push(time);if(!frozen && clicks>freezeClicks)page++;}}})},
  chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}},async sendMessage(m){messages.push({...m,testTime:time});
   if(m.type==='DRA_WAIT') {delays.push(m.until-time);if(pauseWait && m.until-time>=1000){listener({type:'DRA_STOP_LOOP',loopId:'l'},{},()=>{});resolveDone();}time=m.until;return {ok:true};}
   if(m.type==='DRA_FEIGUA_PAGE' && pause) {listener({type:'DRA_STOP_LOOP',loopId:'l'}, {},()=>{});resolveDone();return {continue:true};}
   if(m.type==='DRA_FEIGUA_PAGE_TIMEOUT' && pauseOnTimeout){listener({type:'DRA_STOP_LOOP',loopId:'l'},{},()=>{});resolveDone();}
   if(m.type==='DRA_FEIGUA_COMPLETE'||m.type==='DRA_PAGE_BLOCKED')resolveDone();
   return {ok:true,continue:true};
  }}}
 };
 vm.runInNewContext(bundle.outputFiles[0].text,context);
 listener({type:'DRA_START_LOOP',runId:'r',loopId:'l',settings},{},()=>{});
 await done;
 await new Promise(resolve=>setImmediate(resolve));
 return {clicks,clickTimes,messages,page,delays,reveals:context.fixture.reveals||0};
}
test('Feigua content collects two stable pages and finishes at disabled next', async()=>{
 const r=await runFixture();assert.equal(r.clicks,1);assert.equal(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE').length,2);assert.equal(r.messages.at(-1).type,'DRA_FEIGUA_COMPLETE');
 assert.ok(r.reveals>=1);
});
test('pause while saving page prevents next click', async()=>{
 const r=await runFixture({pause:true});assert.equal(r.clicks,0);assert.equal(r.messages.some(m=>m.type==='DRA_FEIGUA_COMPLETE'),false);
});
test('a failed next click retries after 30 seconds without duplicate submission', async()=>{
 const r=await runFixture({freezeClicks:1});
 assert.equal(r.clicks,2);
 assert.equal(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE').length,2);
 assert.equal(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE_TIMEOUT').length,1);
 assert.equal(r.messages.at(-1).type,'DRA_FEIGUA_COMPLETE');
});
test('verification blocker prevents collection and clicks', async()=>{
 const r=await runFixture({blocked:true});assert.equal(r.clicks,0);assert.equal(r.messages.some(m=>m.type==='DRA_FEIGUA_PAGE'),false);
});

test('configured flip interval reaches worker wait and last-page flag is submitted',async()=>{
 const r=await runFixture({settings:{feiguaDelay:{minSeconds:9,maxSeconds:9}}});
 assert.equal(r.clickTimes[0],9000);
 assert.equal(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE').at(-1).page.last,true);
});
test('slow detail requests consume page interval but leave a short gap before next page',async()=>{
 const r=await runFixture({settings:{feiguaDelay:{minSeconds:4,maxSeconds:4}},identityReadyAt:9000});
 assert.equal(r.clickTimes[0],10000);
 assert.equal(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE').length,2);
});
test('pause during randomized flip wait cancels the next click',async()=>{
 const r=await runFixture({pauseWait:true});assert.equal(r.clicks,0);
 assert.ok(r.delays.some(ms=>ms>=2500 && ms<=4500));
});

test('waits for image readiness and complete row stability before saving',async()=>{
 const r=await runFixture({imagesUntil:4500,changingUntil:6000});
 const first=r.messages.find(m=>m.type==='DRA_FEIGUA_PAGE');
 assert.ok(first.testTime>=6750);assert.equal(first.page.rows[0].likes,100);
});
test('unready image URLs do not block a stable page or pause the run',async()=>{
 const r=await runFixture({imagesUntil:Infinity});
 assert.equal(r.clicks,1);
 assert.equal(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE').length,2);
 assert.equal(r.messages.at(-1).type,'DRA_FEIGUA_COMPLETE');
 const first=r.messages.find(m=>m.type==='DRA_FEIGUA_PAGE');
 assert.ok(first.testTime>=8000 && first.testTime<20000);
 assert.ok(r.reveals>=1);
});

test('saves a stable page without waiting for late image URLs',async()=>{
 const r=await runFixture({imagesUntil:36000});
 const first=r.messages.find(m=>m.type==='DRA_FEIGUA_PAGE');
 assert.ok(first.testTime>=8000 && first.testTime<20000);
 assert.equal(r.messages.at(-1).type,'DRA_FEIGUA_COMPLETE');
});
test('partially parsed rows and a returning loading mask reset stability',async()=>{
 const r=await runFixture({incompleteUntil:4500,loadingAfter:5250});
 const first=r.messages.find(m=>m.type==='DRA_FEIGUA_PAGE');
 assert.ok(first.testTime>=9000);assert.equal(r.clicks,1);
});

test('a loading mask appearing during the flip delay settles before clicking',async()=>{
 const r=await runFixture({settings:{feiguaDelay:{minSeconds:4,maxSeconds:4}},loadingAfter:5000});
 assert.equal(r.clicks,1);
 assert.equal(r.messages.at(-1).type,'DRA_FEIGUA_COMPLETE');
});
test('continuously changing rows are skipped without submitting incomplete data',async()=>{
 const r=await runFixture({changingUntil:Infinity});
 assert.equal(r.clicks,1);
 assert.equal(r.messages.some(m=>m.type==='DRA_FEIGUA_PAGE'),false);
 assert.equal(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE_TIMEOUT').length,2);
 assert.equal(r.messages.at(-1).type,'DRA_FEIGUA_COMPLETE');
});
test('an empty first page times out at 30 seconds and proceeds to a populated next page',async()=>{
 const r=await runFixture({badPages:[1]});
 assert.equal(r.clicks,1);
 const timeouts=r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE_TIMEOUT');
 assert.equal(timeouts.length,1);assert.equal(timeouts[0].testTime,30000);
 assert.equal(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE').length,1);
 assert.equal(r.messages.at(-1).type,'DRA_FEIGUA_COMPLETE');
});
test('an unloaded middle page is skipped and the following page is saved',async()=>{
 const r=await runFixture({badPages:[2],totalPages:3});
 assert.equal(r.clicks,2);
 assert.deepEqual(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE').map(m=>m.page.rows[0].authorName),['甲1','甲3']);
 assert.equal(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE_TIMEOUT').length,1);
});
test('a loading mask can be skipped after 30 seconds when next remains enabled',async()=>{
 const r=await runFixture({loadingPages:[1]});
 assert.equal(r.clicks,1);assert.equal(r.messages.at(-1).type,'DRA_FEIGUA_COMPLETE');
 assert.equal(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE_TIMEOUT').length,1);
});
test('pausing during timeout reporting prevents further clicks',async()=>{
 const r=await runFixture({badPages:[1],pauseOnTimeout:true});
 assert.equal(r.clicks,0);assert.equal(r.messages.some(m=>m.type==='DRA_FEIGUA_COMPLETE'),false);
});
test('a missing pager still requires intervention because there is no next button',async()=>{
 const r=await runFixture({badPages:[1],missingPager:true});
 assert.equal(r.clicks,0);assert.equal(r.messages.at(-1).type,'DRA_PAGE_BLOCKED');
 assert.match(r.messages.at(-1).reason,/分页/);
});

test('a disabled next button during loading is not reported as successful completion',async()=>{
 const r=await runFixture({loadingPages:[1],totalPages:1});
 assert.equal(r.clicks,0);
 assert.equal(r.messages.at(-1).type,'DRA_PAGE_BLOCKED');
 assert.match(r.messages.at(-1).reason,/下一页按钮不可用/);
 assert.equal(r.messages.some(m=>m.type==='DRA_FEIGUA_COMPLETE'),false);
});
test('a permanently unresponsive next button never resubmits the old page',async()=>{
 const r=await runFixture({frozen:true,pauseOnTimeout:true});
 assert.equal(r.clicks,1);
 assert.equal(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE').length,1);
 assert.equal(r.messages.filter(m=>m.type==='DRA_FEIGUA_PAGE_TIMEOUT').length,1);
});
