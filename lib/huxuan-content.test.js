import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { HUXUAN_CHANNEL } from './huxuan-api.js';

const bundle=await build({entryPoints:[new URL('../content/huxuan-content.js',import.meta.url).pathname],bundle:true,format:'iife',write:false,platform:'browser'});

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
