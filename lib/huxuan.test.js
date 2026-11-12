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
 assert.equal(huxuanQueryKey({order_by:3,keyword:'美食',page:{size:2,no:1},platform:1},'83740018'),key);
 assert.notEqual(huxuanQueryKey({...query,keyword:'运动'},'83740018'),key);
});

async function harness({savePage=async()=>{},maxPages=2,recordDecision=()=>{}}={}) {
 const sent=[],saved=[];
 const tab={id:17,windowId:1,url};
 globalThis.chrome={tabs:{get:async()=>tab,query:async()=>[tab],update:async()=>tab,sendMessage:async(_,msg)=>{sent.push(msg);return {ok:true,running:true,runId:runtime.state().runId,loopId:runtime.state().loopId};}},alarms:{create:async()=>{},clear:async()=>{}}};
 const runtime=createHuxuanRuntime({settings:()=>({...defaultHuxuanSettings(),huxuanTarget:{maxPages}}),authorize:async()=>{},persist:async()=>{saved.push(structuredClone(runtime.storage()));},indicators:async()=>{},waitForTab:async id=>chrome.tabs.get(id),ensureContent:async t=>t,savePage,recordDecision,recordScan:()=>{},scheduleUpload:()=>{}});
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
test('storage errors keep the current page retryable; stale and foreign messages reject',async()=>{
 let fail=true;
 const h=await harness({savePage:async()=>{if(fail)throw Error('disk full');}});
 await assert.rejects(h.message({type:'DRA_HUXUAN_PAGE',page:page()}),/disk full/);
 assert.equal(h.runtime.state().nextPage,null);
 await assert.rejects(h.message({type:'DRA_HUXUAN_LIST',page:page()}),/disk full/);
 assert.equal(h.runtime.state().stats.matched,0,'a failed list save must not advertise candidates');
 assert.deepEqual(h.runtime.collection().recentRows,[]);
 fail=false;
 await h.message({type:'DRA_HUXUAN_PAGE',page:page()});
 await assert.rejects(h.message({type:'DRA_HUXUAN_PAGE',page:page(2)},{tab:{...h.tab,id:20},url}),/当前互选任务/);
 await assert.rejects(h.message({type:'DRA_HUXUAN_PAGE',page:page(2)},{tab:h.tab,url,frameId:1}),/当前互选任务/);
 const stale=h.runtime.state().loopId;
 await h.runtime.pause();await h.runtime.resume();
 await assert.rejects(h.message({type:'DRA_HUXUAN_PAGE',page:page(2),loopId:stale}),/当前互选任务/);
 await h.runtime.stop();
});
test('one run accumulates pages and creators across filters and advertising accounts',async()=>{
 const writes=[];const h=await harness({savePage:async p=>writes.push(p),maxPages:3});
 const runId=h.runtime.state().runId;
 await h.message({type:'DRA_HUXUAN_PAGE',page:page(1)});
 const switched={...page(1),queryKey:'other-query',pageUrl:url.replace('83740018','12345678')};
 switched.rows=switched.rows.map(row=>({...row,authorId:'sphDifferentAuthor'}));
 assert.equal((await h.message({type:'DRA_HUXUAN_PAGE',page:switched})).continue,true);
 assert.equal(h.runtime.state().runId,runId);
 assert.equal(h.runtime.state().stats.pagesCollected,2);
 assert.equal(h.runtime.state().stats.matched,2);
 assert.equal(h.runtime.state().queryKey,'other-query');
 assert.equal(h.runtime.state().nextPage,2);
 assert.equal(writes.length,2);
 await h.runtime.stop();
});
test('switching filters replaces only the unfinished roster and preserves saved observations',async()=>{
 const writes=[];const h=await harness({savePage:async p=>writes.push(p)});
 await h.message({type:'DRA_HUXUAN_LIST',page:page(1)});
 assert.equal(h.runtime.collection().listPages.length,1);
 await h.message({type:'DRA_HUXUAN_LIST',page:page(1)});
 assert.equal(h.runtime.collection().listPages.length,1,'reusing a saved roster must not count another request');
 assert.equal(h.runtime.state().stats.scanned,1,'reusing a checkpoint must not register its creators twice');
 const changed={...page(3),queryKey:'new-query',rows:[{...page().rows[0],authorId:'sphDifferentAuthor'}]};
 const result=await h.message({type:'DRA_HUXUAN_LIST',page:changed});
 assert.equal(result.checkpoint.page.queryKey,'new-query');
 assert.equal(result.checkpoint.page.rows[0].authorId,'sphDifferentAuthor');
 assert.equal(h.runtime.state().nextPage,3);
 assert.equal(writes.length,2);
 assert.equal(h.runtime.collection().listPages.length,2);
 assert.equal(h.runtime.collection().pages.length,0,'list requests count before full profiles finish');
 assert.equal(h.runtime.state().stats.matched,2,'both lists must expose their candidates before profiles finish');
 await h.runtime.stop();
});
test('worker restart resumes only by explicit action and retains saved page and account query',async()=>{
 const h=await harness();
 await h.message({type:'DRA_HUXUAN_PAGE',page:page()});
 const stored=structuredClone(h.runtime.storage());
 stored.draHuxuanState.queryKey=JSON.stringify(['83740018',{platform:1,keyword:'美食',order_by:3,pageSize:2}]);
 stored.draHuxuanCollection.pages=[1];
 delete stored.draHuxuanCollection.listPages;
 const next=await harness();
 next.runtime.restore(stored);
 assert.equal(next.runtime.state().status,'paused');
 assert.equal(next.runtime.state().nextPage,2);
 assert.equal(next.runtime.state().queryKey,key);
 assert.equal(next.runtime.collection().pages.length,1);
 assert.deepEqual(next.runtime.collection().pages,[JSON.stringify([key,1])]);
 assert.deepEqual(next.runtime.collection().listPages,[JSON.stringify([key,1])]);
 await next.runtime.stop();
});

test('opening Huxuan reuses an existing homepage and opens a visible tab only when none exists',async()=>{
 const h=await harness();
 const home={id:23,windowId:1,url:'https://huxuan.qq.com/',active:true,status:'complete'};
 const opened=[];
 const tabs=new Map([[home.id,home]]);
 globalThis.chrome.tabs.get=async id=>tabs.get(id);
 globalThis.chrome.tabs.query=async()=>[home];
 globalThis.chrome.tabs.update=async id=>tabs.get(id);
 globalThis.chrome.tabs.create=async options=>{opened.push(options);const tab={...home,id:24,...options};tabs.set(tab.id,tab);return tab;};
 assert.equal((await h.runtime.openPage({windowId:1})).id,home.id);
 assert.equal(opened.length,0,'an already-open homepage must be reused');
 globalThis.chrome.tabs.query=async()=>[];
 await h.runtime.openPage({windowId:1,focusTab:false});
 assert.equal(opened.length,1);
 assert.equal(opened[0].active,true,'opening a missing site must show the page to the user');
});

test('resuming Huxuan prefers the user current list over the old bound list without navigating',async()=>{
 const h=await harness();
 await h.runtime.pause();
 const current={...h.tab,id:23,url:url.replace('83740018','12345678'),active:true};
 globalThis.chrome.tabs.query=async()=>[h.tab,current];
 globalThis.chrome.tabs.get=async id=>id===current.id?current:h.tab;
 globalThis.chrome.tabs.update=async()=>assert.fail('resume must preserve the selected page');
 await h.runtime.resume({windowId:1,tabId:current.id});
 assert.equal(h.runtime.state().feedTabId,current.id);
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
 assert.equal(h.runtime.state().stats.scanned,1);
 assert.equal(h.runtime.state().stats.duplicates,0);
});

test('an older unfinished roster restores visible candidates and history once without recapturing profiles',async()=>{
 const h=await harness();
 const initial=page();
 await h.message({type:'DRA_HUXUAN_LIST',page:initial});
 const stored=structuredClone(h.runtime.storage());
 // Previous builds persisted the roster and section checkpoints, while
 // candidates and history remained empty until the entire page completed.
 delete stored.draHuxuanCollection.capture.candidatesRegistered;
 stored.draHuxuanCollection.accounts={};stored.draHuxuanCollection.recentRows=[];
 Object.assign(stored.draHuxuanState.stats,{matched:0,scanned:0,duplicates:0});
 const events=[],writes=[];
 const restored=await harness({recordDecision:(...args)=>events.push(args),savePage:async p=>writes.push(p)});
 restored.runtime.restore(stored);
 assert.equal(restored.runtime.state().status,'paused');
 assert.equal(restored.runtime.state().stats.matched,1);
 assert.equal(restored.runtime.collection().recentRows[0].authorName,initial.rows[0].authorName);
 assert.equal(restored.runtime.collection().recentRows[0].observedAt,initial.capturedAt);
 assert.equal(events.length,1);
 assert.equal(restored.runtime.collection().pages.length,0);
 assert.equal(restored.runtime.collection().listPages.length,1);
 restored.runtime.restore(structuredClone(restored.runtime.storage()));
 await restored.runtime.resume();
 await restored.message({type:'DRA_HUXUAN_LIST',page:initial});
 assert.equal(writes.length,0,'restoration must use the durable roster without external recapture');
 await restored.message({type:'DRA_HUXUAN_PAGE',page:initial});
 assert.equal(events.length,1,'finishing the page and restarting must not duplicate history');
 assert.equal(restored.runtime.state().stats.scanned,1);
 assert.equal(restored.runtime.state().stats.duplicates,0);
 await restored.runtime.stop();
});

test('runtime accepts a creator complete after the default first video page despite a larger total',async()=>{
 const h=await harness(),list=page(),row=list.rows[0];
 const registered=await h.message({type:'DRA_HUXUAN_LIST',page:list});
 await collectHuxuanProfiles({rows:[row],checkpoint:registered.checkpoint,active:()=>true,wait:async()=>{},progress:async()=>{},
 request:async(authorId,dataset,{pageIndex})=>({ok:true,capture:{authorId,dataset,pageIndex,status:'available',capturedAt:list.capturedAt,data:dataset.startsWith('videos:')?{total_cnt:54,video_list:[{export_id:'first'}]}:{}}}),
 save:async(r,capture,metadata)=>(await h.message({type:'DRA_HUXUAN_PART',row:r,capture,pageNumber:1,pageUrl:url,queryKey:key,...metadata})).summary});
 assert.equal(h.runtime.collection().enrichedAccounts[row.authorId],true);
 assert.equal(h.runtime.collection().capture.completed[`${row.authorId}:videos:0:1`],undefined);
 await h.runtime.pause();
});
