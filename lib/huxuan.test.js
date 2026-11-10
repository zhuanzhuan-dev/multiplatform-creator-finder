import test from 'node:test';
import assert from 'node:assert/strict';
import { projectHuxuanResponse, huxuanContext, huxuanQueryKey } from './huxuan-api.js';
import { createHuxuanRuntime, defaultHuxuanSettings } from './huxuan-task.js';
import { normalizeHuxuanObservation, huxuanObservationRecord } from './huxuan-collection.js';
import { collectHuxuanProfiles } from './huxuan-capture.js';

const url='https://huxuan.qq.com/trade/selection/83740018/selection_list?type=finder-trade';
const query={platform:1,page:{no:1,size:2},keyword:'美食',order_by:3};
const key=huxuanQueryKey(query,'83740018');
const fixture={ret:0,data:{total_num:10000,item:[{appid:'sphubNYn8stSgto',nickname:'小糖糖女士',fans_num_level:'500万+',avg_read_count:'300万+',short_video_price:'15000000',long_video_price:'21000000',avatar:'https://example.com/avatar.png',contact_info:{phone:'business-contact',access_token:'must-not-leave-page'},fans_num_growth_range:'5千~1万',index_content:98.6,mcn_name:'示例MCN',more_data:{future_business_field:0}}]}};
const page=(n=1)=>({...projectHuxuanResponse(fixture,{pageNumber:n,pageSize:1,accountId:'83740018',pageUrl:url}),queryKey:key});

test('Huxuan preserves every business field, original values and cooperation contacts while excluding session credentials',()=>{
 const data=page();
 assert.equal(data.rows[0].shortPrice,150000);
 assert.equal(data.rows[0].longPrice,210000);
 assert.equal(data.rows[0].followerCount,'500万+');
 assert.equal(data.rows[0].metrics.averagePlays,'300万+');
 assert.equal(JSON.stringify(data).includes('must-not-leave-page'),false);
 assert.equal(data.rows[0].listFields.contact_info.phone,'business-contact');
 assert.equal(data.rows[0].listFields.fans_num_growth_range,'5千~1万');
 assert.equal(data.rows[0].listFields.index_content,98.6);
 assert.equal(data.rows[0].listFields.more_data.future_business_field,0);
 const observation={...normalizeHuxuanObservation(data.rows[0],data,'run'),id:'observation:1',sequence:1};
 const record=huxuanObservationRecord(observation);
 assert.equal(record.record_id,observation.id);
 assert.equal(record.account_platform,'wechat_channels');
 assert.equal(record.source_platform,'huxuan');
 assert.equal(record.wechat_channels_id,'sphubNYn8stSgto');
 assert.equal(record.quote_1_60s,150000);
 assert.equal(record.quote_21_60s,undefined);
 assert.equal(record.rpa_feedback.followers_text,'500万+');
 assert.ok(record.followers == null);
});
test('login failure, invalid identity and wrong page surfaces cannot masquerade as results',()=>{
 assert.throws(()=>projectHuxuanResponse({ret:100005,msg:'未登录'},{}),/未登录/);
 assert.throws(()=>projectHuxuanResponse({ret:0,data:{item:[{nickname:'no id'}]}},{}),/稳定作者 ID/);
 assert.equal(huxuanContext(url).accountId,'83740018');
 assert.equal(huxuanContext(url.replace('finder-trade','mp-trade')),null);
 assert.equal(huxuanContext(url.replace('huxuan.qq.com','evil.test')),null);
 assert.equal(huxuanQueryKey({...query,page:{no:3,size:2}},'83740018'),key);
 assert.notEqual(huxuanQueryKey({...query,keyword:'运动'},'83740018'),key);
});

async function harness({savePage=async()=>{},maxPages=2}={}) {
 const sent=[],saved=[];
 const tab={id:17,windowId:1,url};
 globalThis.chrome={tabs:{get:async()=>tab,query:async()=>[tab],update:async()=>tab,sendMessage:async(_,msg)=>{sent.push(msg);return {ok:true,running:true,runId:runtime.state().runId,loopId:runtime.state().loopId};}},alarms:{create:async()=>{},clear:async()=>{}}};
 const runtime=createHuxuanRuntime({settings:()=>({...defaultHuxuanSettings(),huxuanTarget:{maxPages}}),authorize:async()=>{},persist:async()=>{saved.push(structuredClone(runtime.storage()));},indicators:async()=>{},waitForTab:async()=>tab,ensureContent:async t=>t,savePage,recordScan:()=>{},scheduleUpload:()=>{}});
 const message=(data,sender={tab,url,frameId:0})=>runtime.message({runId:runtime.state().runId,loopId:runtime.state().loopId,...data},sender);
 await runtime.start(tab.id);
 return {runtime,message,sent,saved,tab};
}
test('pages persist before advancing; deduplication, pause/resume and task limit retain stable progress',async()=>{
 const writes=[];
 const h=await harness({savePage:async p=>writes.push(p.pageNumber)});
 assert.deepEqual(await h.message({type:'DRA_HUXUAN_PAGE',page:page(1)}),{continue:true});
 assert.equal(h.runtime.state().nextPage,2);
 const oldLoop=h.runtime.state().loopId;
 await h.runtime.pause();
 await h.runtime.resume();
 assert.notEqual(h.runtime.state().loopId,oldLoop);
 assert.equal(h.sent.filter(m=>m.type==='DRA_START_LOOP').at(-1).nextPage,2);
 assert.equal((await h.message({type:'DRA_HUXUAN_PAGE',page:page(2)})).continue,false);
 assert.deepEqual(writes,[1,2]);
 assert.equal(h.runtime.state().stats.matched,1);
 assert.equal(h.runtime.state().stats.duplicates,1);
 assert.equal(h.runtime.state().stats.pagesCollected,2);
 assert.equal(h.runtime.state().status,'stopped');
 assert.equal(h.runtime.collection().finalized,true);
});
test('storage errors keep the current page retryable; changed query, stale and foreign messages reject',async()=>{
 let fail=true;
 const h=await harness({savePage:async()=>{if(fail)throw Error('disk full');}});
 await assert.rejects(h.message({type:'DRA_HUXUAN_PAGE',page:page()}),/disk full/);
 assert.equal(h.runtime.state().nextPage,null);
 fail=false;
 await h.message({type:'DRA_HUXUAN_PAGE',page:page()});
 await assert.rejects(h.message({type:'DRA_HUXUAN_PAGE',page:{...page(2),queryKey:'changed'}}),/筛选条件/);
 await assert.rejects(h.message({type:'DRA_HUXUAN_PAGE',page:page(2)},{tab:{...h.tab,id:20},url}),/当前互选任务/);
 await assert.rejects(h.message({type:'DRA_HUXUAN_PAGE',page:page(2)},{tab:h.tab,url,frameId:1}),/当前互选任务/);
 const stale=h.runtime.state().loopId;
 await h.runtime.pause();await h.runtime.resume();
 await assert.rejects(h.message({type:'DRA_HUXUAN_PAGE',page:page(2),loopId:stale}),/当前互选任务/);
 await h.runtime.stop();
});
test('worker restart resumes only by explicit action and retains saved page and account query',async()=>{
 const h=await harness();
 await h.message({type:'DRA_HUXUAN_PAGE',page:page()});
 const stored=structuredClone(h.runtime.storage());
 const next=await harness();
 next.runtime.restore(stored);
 assert.equal(next.runtime.state().status,'paused');
 assert.equal(next.runtime.state().nextPage,2);
 assert.equal(next.runtime.state().queryKey,key);
 assert.equal(next.runtime.collection().pages.length,1);
 await next.runtime.stop();
});
test('homepage capture checkpoints each section and only advances a list page after durable completion',async()=>{
 const writes=[];const h=await harness({savePage:async p=>writes.push(p),maxPages:1});
 const list=page();const row=list.rows[0];
 let fail=true;
 const run=()=>collectHuxuanProfiles({rows:[row],checkpoint:h.sent.filter(m=>m.type==='DRA_START_LOOP').at(-1).checkpoint,active:()=>h.runtime.active(),wait:async()=>{},progress:async()=>{},
  request:async(authorId,dataset,{pageIndex})=>{
   if(dataset==='persona' && fail) {fail=false;return {ok:false,error:'暂时失败'};}
   return {ok:true,capture:{authorId,dataset,pageIndex,status:'available',capturedAt:list.capturedAt,data:dataset.startsWith('videos:')?{total_cnt:1,video_list:[{export_id:'fixture-work'}]}:{fact:dataset}}};
  },
  save:async(r,capture,metadata)=>(await h.message({type:'DRA_HUXUAN_PART',row:r,capture,pageNumber:1,pageUrl:url,queryKey:key,...metadata})).summary,
 });
 await assert.rejects(run(),/暂时失败/);
 assert.equal(h.runtime.state().nextPage,1);
 assert.equal(h.runtime.state().stats.pagesCollected || 0,0);
 await assert.rejects(h.message({type:'DRA_HUXUAN_PAGE',page:{...list,profileCollection:true}}),/主页尚未全部保存/);
 const snapshot=structuredClone(h.runtime.storage());
 await h.runtime.pause();h.runtime.restore(snapshot);await h.runtime.resume();
 const before=writes.length;
 await run();
 assert.equal(writes[before].rows[0].capture.dataset,'persona');
 assert.equal(writes.filter(p=>p.rows[0]?.capture?.dataset==='detail').length,1);
 await h.message({type:'DRA_HUXUAN_PAGE',page:{...list,profileCollection:true}});
 assert.equal(h.runtime.state().nextPage,2);
 assert.equal(h.runtime.state().status,'stopped');
 assert.equal(h.runtime.collection().capture,null);
 assert.equal(h.runtime.collection().enrichedAccounts[row.authorId],true);
});
test('the durable list-page roster survives restart and is reused when live sorting changes',async()=>{
 const writes=[];const h=await harness({savePage:async p=>writes.push(structuredClone(p))});
 const initial=page();
 const registered=await h.message({type:'DRA_HUXUAN_LIST',page:initial});
 assert.equal(writes[0].rows[0].listFields.index_content,98.6);
 assert.equal(registered.checkpoint.page.rows[0].listFields,undefined);
 assert.ok(registered.checkpoint.completed[`${initial.rows[0].authorId}:list:`]);
 const snapshot=structuredClone(h.runtime.storage());
 await h.runtime.pause();h.runtime.restore(snapshot);await h.runtime.resume();
 const resumed=h.sent.filter(m=>m.type==='DRA_START_LOOP').at(-1).checkpoint;
 assert.equal(resumed.page.rows[0].authorId,initial.rows[0].authorId);
 const changed={...initial,rows:[{...initial.rows[0],authorId:'sphDifferentAuthor'}]};
 const reused=await h.message({type:'DRA_HUXUAN_LIST',page:changed});
 assert.equal(reused.checkpoint.page.rows[0].authorId,initial.rows[0].authorId);
 assert.equal(writes.length,1);
});
