import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { HUXUAN_CHANNEL, HUXUAN_SEARCH_PATH } from './huxuan-api.js';
import { createHuxuanRuntime } from './huxuan-task.js';
import { normalizeHuxuanObservation } from './huxuan-collection.js';

const bundle=await build({entryPoints:[new URL('../content/huxuan-content.js',import.meta.url).pathname],bundle:true,format:'iife',write:false,platform:'browser'});
const pageBundle=await build({entryPoints:[new URL('../page/huxuan-page-bridge.js',import.meta.url).pathname],bundle:true,format:'iife',write:false,platform:'browser'});

test('actual content loop saves the original list first, collects all homepage sections and finalizes the saved roster',async()=>{
 const listeners=[],messages=[],endpoints=[];
 const row={authorId:'sphFixtureOne',authorName:'样例',tags:[],listFields:{unknown_field:'完整保留'}};
 const page={rows:[row],pageNumber:1,pageUrl:'https://huxuan.qq.com/trade/selection/12345678/selection_list?type=finder-trade',capturedAt:new Date().toISOString(),queryKey:'fixture-query',last:true};
 let start,resolveDone,rejectDone;
 const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});
 const timer=setTimeout(()=>rejectDone(Error('content loop did not finish')),2000);
 const window={addEventListener:(_,fn)=>listeners.push(fn),postMessage:message=>{
  if(message.direction!=='request')return;
  const data=message.action==='status'?{ok:true,queryKey:page.queryKey,pageNumber:1}:message.action==='page'?{ok:true,page}: {ok:true,capture:{authorId:row.authorId,dataset:message.dataset,pageIndex:message.pageIndex,status:'available',capturedAt:page.capturedAt,data:message.dataset.startsWith('videos:')?{total_cnt:0,video_list:[]}:{all_fields:'kept'}}};
  if(message.action==='profile')endpoints.push(message.dataset);
  queueMicrotask(()=>listeners.forEach(fn=>fn({source:window,origin:'https://huxuan.qq.com',data:{channel:HUXUAN_CHANNEL,direction:'response',requestId:message.requestId,...data}})));
 }};
 const chrome={runtime:{onMessage:{addListener:fn=>{start=fn;}},sendMessage:async message=>{
  messages.push(message);
  if(message.type==='DRA_HUXUAN_LIST'){
   assert.equal(message.page.rows[0].listFields.unknown_field,'完整保留');
   return {ok:true,checkpoint:{page:{...page,rows:[{...row,listFields:undefined}]},completed:{'sphFixtureOne:list:':{status:'available'}},range:{beginDate:'20260514',endDate:'20261110'}}};
  }
  if(message.type==='DRA_HUXUAN_PART')return {ok:true,summary:message.capture.dataset.startsWith('videos:')?{status:'available',count:0,total:0,fingerprint:'[]'}:{status:'available'}};
  if(message.type==='DRA_HUXUAN_PAGE'){resolveDone(message);return {continue:false};}
  if(message.type==='DRA_TICK_ERROR'){rejectDone(Error(message.error));return {ok:true};}
  return {ok:true};
 }}};
 try{
  vm.runInNewContext(bundle.outputFiles[0].text,{window,chrome,location:{origin:'https://huxuan.qq.com'},document:{},crypto,Date,URL,queueMicrotask,setTimeout,clearTimeout});
  start({type:'DRA_START_LOOP',runId:'run',loopId:'loop',settings:{huxuanDelay:{minSeconds:0,maxSeconds:0}}},null,()=>{});
  const final=await done;
  assert.equal(final.page.profileCollection,true);
  assert.equal(final.page.rows[0].authorId,row.authorId);
  assert.equal(endpoints.length,10);
  assert.equal(messages.filter(m=>m.type==='DRA_HUXUAN_PART').at(-1).capture.dataset,'complete');
  assert.ok(messages.findIndex(m=>m.type==='DRA_HUXUAN_LIST')<messages.findIndex(m=>m.type==='DRA_HUXUAN_PART'));
 }finally{clearTimeout(timer);}
});

for (const resume of [false,true]) test(`real bridge, content and runtime ${resume?'resume after':'continue through'} an advertising-account and filter change`,async()=>{
 const listeners=[],requests=[],writes=[];
 const oldUrl='https://huxuan.qq.com/trade/selection/12345678/selection_list?type=finder-trade';
 const newUrl=oldUrl.replace('12345678','87654321');
 const location={origin:'https://huxuan.qq.com',href:oldUrl};
 const tab={id:17,windowId:1,url:oldUrl};
 let receive,execute=!resume,switched=false,runtime,resolveDone,rejectDone;
 const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});
 const timeout=setTimeout(()=>rejectDone(Error('collection did not finish')),2000);
 class XHR {open(){}setRequestHeader(){}send(){}}
 const seed=()=>{const xhr=new XHR();xhr.open('POST',HUXUAN_SEARCH_PATH);xhr.send(JSON.stringify({platform:1,page:{no:switched?3:1,size:switched?60:30},keyword:switched?'运动':'美食'}));};
 const switchSearch=()=>{switched=true;location.href=newUrl;tab.url=newUrl;seed();};
 const window={addEventListener:(_,fn)=>listeners.push(fn),postMessage:message=>queueMicrotask(()=>{
  for(const fn of listeners)void fn({source:window,origin:location.origin,data:message});
 }),fetch:async(url,options)=>{
  const account=options.headers.account_id;
  const authorId=account==='12345678'?'sphOriginalAuthor':'sphNewAuthor';
  requests.push({url,account,body:options.body && JSON.parse(options.body)});
  if(url.startsWith('/cgi-bin/advertiser/finder_publisher/detail')) {
   assert.equal(runtime.collection().accounts[authorId],true,'the list creator must already be visible before its first profile request');
   assert.ok(runtime.collection().recentRows.some(row=>row.authorId===authorId));
  }
  if(url.startsWith('/cgi-bin/advertiser/finder_publisher/detail') && !switched)switchSearch();
  const data=url.includes('get_finder_video_show')?{video_list:[],total_cnt:0}:url===HUXUAN_SEARCH_PATH?{item:[{appid:authorId,nickname:authorId}],total_num:1}:{item:{appid:authorId}};
  return {ok:true,json:async()=>({ret:0,data})};
 }};
 const chrome={tabs:{get:async()=>tab,query:async()=>[tab],sendMessage:async(_id,message)=>{
  if(message.type==='DRA_START_LOOP' && !execute)return {ok:true};
  return new Promise(resolve=>receive(message,null,resolve));
 }},alarms:{create:async()=>{},clear:async()=>{}},runtime:{onMessage:{addListener:fn=>{receive=fn;}},sendMessage:async message=>{
  if(message.type==='DRA_TICK_ERROR')rejectDone(Error(message.error));
  return runtime.message(message,{tab,url:location.href,frameId:0});
 }}};
 globalThis.chrome=chrome;
 vm.runInNewContext(pageBundle.outputFiles[0].text,{window,location,XMLHttpRequest:XHR,URL,URLSearchParams,Headers,AbortController,setTimeout,clearTimeout});
 vm.runInNewContext(bundle.outputFiles[0].text,{window,chrome,location,document:{},crypto,Date,URL,queueMicrotask,setTimeout,clearTimeout});
 runtime=createHuxuanRuntime({settings:()=>({huxuanTarget:{maxPages:5},huxuanDelay:{minSeconds:0,maxSeconds:0}}),authorize:async()=>{},persist:async()=>{if(runtime.state().status==='stopped')resolveDone();},indicators:async()=>{},waitForTab:async()=>tab,ensureContent:async t=>t,savePage:async(page,runId)=>writes.push({page,observations:page.rows.map(row=>normalizeHuxuanObservation(row,page,runId))}),recordScan:()=>{},scheduleUpload:()=>{}});
 seed();
 try {
  await runtime.start(tab.id);
  const runId=runtime.state().runId;
  if(resume) {
   // A saved cursor and partially collected roster belong to the prior search.
   const oldPage={pageUrl:oldUrl,pageNumber:8,queryKey:JSON.stringify(['12345678',{platform:1,keyword:'美食',pageSize:30}]),rows:[{authorId:'sphOriginalAuthor',authorName:'原作者'}],capturedAt:new Date().toISOString()};
   await runtime.message({type:'DRA_HUXUAN_LIST',runId,loopId:runtime.state().loopId,page:oldPage},{tab,url:oldUrl,frameId:0});
   await runtime.pause();switchSearch();execute=true;await runtime.resume();
  }
  await done;
  assert.equal(runtime.state().runId,runId);
  assert.equal(runtime.state().stats.pagesCollected,resume?1:2);
  assert.equal(runtime.state().stats.matched,2,'creators from saved lists remain candidates even when filters change before their profiles finish');
  const lists=requests.filter(request=>request.url===HUXUAN_SEARCH_PATH && !request.body.keyword.startsWith('item_recommend:'));
  assert.deepEqual(lists.map(request=>request.body.page.no),resume?[3]:[1,3]);
  const newParts=writes.filter(write=>write.page.rows[0]?.capture?.authorId==='sphNewAuthor');
  assert.ok(newParts.some(write=>write.page.rows[0].capture.dataset==='complete'));
  assert.ok(newParts.every(write=>write.observations[0].pageUrl===newUrl && write.observations[0].raw.queryKey===runtime.state().queryKey));
  assert.ok(writes.some(write=>write.observations[0].pageUrl===oldUrl));
  const originalDetails=requests.filter(request=>request.url.includes('appid=sphOriginalAuthor'));
  assert.ok(originalDetails.every(request=>request.account==='12345678'));
 } finally {clearTimeout(timeout);if(runtime.active())await runtime.pause();}
});

test('content uses creator settings within a page and page settings at its boundary, including long waits',async()=>{
 const listeners=[],events=[],completed={},rows=[{authorId:'sphFirst',authorName:'第一位'},{authorId:'sphSecond',authorName:'第二位'}];
 let now=100000,start,resolveDone,rejectDone;
 const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});
 const timer=setTimeout(()=>rejectDone(Error('timing integration did not finish')),2000);
 const window={addEventListener:(_,fn)=>listeners.push(fn),postMessage:message=>{
  if(message.direction!=='request')return;
  let data;
  if(message.action==='status')data={ok:true,profileConcurrency:true,queryKey:'query',pageNumber:1};
  if(message.action==='page'){
   events.push({kind:'list',page:message.pageNumber,time:now});
   data={ok:true,page:{rows:message.pageNumber===1?rows:[{authorId:'sphThird',authorName:'第三位'}],pageNumber:message.pageNumber,queryKey:'query',last:message.pageNumber===2,pageUrl:'https://huxuan.qq.com/trade/selection/12345678/selection_list?type=finder-trade'}};
  }
  if(message.action==='profile'){
   events.push({kind:'profile',author:message.authorId,dataset:message.dataset,time:now});
   data={ok:true,capture:{authorId:message.authorId,dataset:message.dataset,pageIndex:message.pageIndex,status:'available',data:message.dataset.startsWith('videos:')?{video_list:[],total_cnt:0}:{}}};
  }
  queueMicrotask(()=>listeners.forEach(fn=>fn({source:window,origin:'https://huxuan.qq.com',data:{channel:HUXUAN_CHANNEL,direction:'response',requestId:message.requestId,...data}})));
 }};
 const chrome={runtime:{onMessage:{addListener:fn=>{start=fn;}},sendMessage:async message=>{
  if(message.type==='DRA_WAIT'){events.push({kind:'wait',duration:message.until-now});now=message.until;return {ok:true};}
  if(message.type==='DRA_HUXUAN_LIST')return {ok:true,checkpoint:{page:message.page,authors:completed}};
  if(message.type==='DRA_HUXUAN_PART'){
   if(message.capture.dataset==='complete'){completed[message.row.authorId]=true;events.push({kind:'complete',author:message.row.authorId,time:now});}
   return {ok:true,summary:message.capture.dataset.startsWith('videos:')?{status:'available',count:0,total:0,fingerprint:'[]'}:{status:'available'}};
  }
  if(message.type==='DRA_HUXUAN_PAGE'){if(message.page.last)resolveDone();return {continue:!message.page.last,authors:completed};}
  if(message.type==='DRA_TICK_ERROR')rejectDone(Error(message.error));
  return {ok:true};
 }}};
 try {
  vm.runInNewContext(bundle.outputFiles[0].text,{window,chrome,location:{origin:'https://huxuan.qq.com'},document:{},crypto,Date:class extends Date {static now(){return now;}},URL,queueMicrotask,setTimeout,clearTimeout});
  start({type:'DRA_START_LOOP',runId:'run',loopId:'loop',settings:{huxuanDelay:{minSeconds:3,maxSeconds:3},huxuanPageDelay:{minSeconds:45,maxSeconds:45}}},null,()=>{});
  await done;
  assert.deepEqual(events.filter(e=>e.kind==='wait').map(e=>e.duration),[3000,20000,20000,5000]);
  assert.equal(events.find(e=>e.kind==='profile'&&e.author==='sphSecond').time-events.find(e=>e.kind==='complete'&&e.author==='sphFirst').time,3000);
  assert.equal(events.find(e=>e.kind==='list'&&e.page===2).time-events.find(e=>e.kind==='complete'&&e.author==='sphSecond').time,45000);
  assert.equal(events.filter(e=>e.kind==='list').length,2);
 } finally {clearTimeout(timer);}
});
