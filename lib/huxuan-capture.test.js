import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { collectHuxuanProfiles, huxuanCaptureKey, huxuanCaptureRows, huxuanCaptureSummary } from './huxuan-capture.js';
import { huxuanProfileRequest, huxuanDateRange, HUXUAN_PROFILE_DATASETS } from './huxuan-api.js';
import { normalizeHuxuanObservation, huxuanObservationRecord } from './huxuan-collection.js';

const row={authorId:'sphFixtureOne',authorName:'样例达人',tags:['生活'],listFields:{appid:'sphFixtureOne',nickname:'样例达人',new_field:42}};
const range={beginDate:'20260514',endDate:'20261110'};
const pageUrl='https://huxuan.qq.com/trade/selection/12345678/selection_list?type=finder-trade';
const capture=(dataset,data,pageIndex=null)=>({authorId:row.authorId,dataset,pageIndex,status:'available',capturedAt:'2026-11-10T06:00:00.000Z',data});

function harness({failAt,duplicate=false,unavailable=false}={}) {
  const completed={},saved=[],calls=[];
  let failure=failAt;
  const run=(checkpoint={})=>collectHuxuanProfiles({rows:[row],videoMaxPages:2,checkpoint:{range,...checkpoint},active:()=>true,wait:async()=>{},progress:async()=>{},
    request:async(id,dataset,{pageIndex})=>{
      calls.push(`${dataset}:${pageIndex}`);
      if (failure===dataset) {failure=null;return {ok:false,error:'未登录'};}
      if(unavailable&&dataset==='insight')return {ok:false,unavailable:true,error:'权限不足'};
      const data=dataset.startsWith('videos:')?{total_cnt:3,video_list:pageIndex===0||duplicate?[{export_id:'a'},{export_id:'b'}]:[{export_id:'c'}]}:{field:dataset};
      return {ok:true,capture:capture(dataset,data,pageIndex)};
    },
    save:async(r,value)=>{saved.push(value);const summary=huxuanCaptureSummary(value);completed[huxuanCaptureKey(r.authorId,value.dataset,value.pageIndex)]=summary;return summary;},
  });
  return {run,completed,saved,calls};
}

test('homepage capture covers every section and all work pages before declaring a creator complete',async()=>{
  const h=harness({unavailable:true});await h.run();
  assert.deepEqual(h.saved.slice(0,9).map(s=>s.dataset),['list',...HUXUAN_PROFILE_DATASETS]);
  assert.equal(h.saved.find(s=>s.dataset==='insight').status,'unavailable');
  assert.deepEqual(h.saved.filter(s=>s.dataset==='videos:0').map(s=>s.pageIndex),[0,1]);
  assert.deepEqual(h.saved.filter(s=>s.dataset==='videos:1').map(s=>s.pageIndex),[0,1]);
  assert.equal(h.saved.at(-1).dataset,'complete');
  const before=h.calls.length;
  await h.run({completed:h.completed,authors:{[row.authorId]:true}});
  assert.equal(h.calls.length,before);
});

test('login failure retains saved sections; resumption retries only the unsaved request',async()=>{
  const h=harness({failAt:'score'});
  await assert.rejects(h.run(),/未登录/);
  assert.deepEqual(h.saved.map(s=>s.dataset),['list','detail','persona']);
  const before=h.calls.length;
  await h.run({completed:h.completed});
  assert.equal(h.calls[before],'score:null');
  assert.equal(h.saved.filter(s=>s.dataset==='detail').length,1);
  assert.equal(h.saved.at(-1).dataset,'complete');
});

test('a repeated work page fails before checkpointing it so resume can fetch a corrected page',async()=>{
  const h=harness({duplicate:true});
  await assert.rejects(h.run(),/重复返回/);
  assert.equal(h.completed[huxuanCaptureKey(row.authorId,'videos:0',1)],undefined);
  assert.equal(h.saved.some(s=>s.dataset==='complete'),false);
});

test('large Chinese response is durably stored, losslessly split and fits the upload byte limit',async()=>{
  globalThis.indexedDB=indexedDB;globalThis.IDBKeyRange=IDBKeyRange;
  globalThis.chrome={storage:{local:{get:async()=>({}),remove:async()=>{}}}};
  const {saveObservations,pendingObservations}=await import('./observations.js');
  const data={cloud_graphs:[{name:'完整画像',values:['中文🌟"\\\n'.repeat(30000)]}]};
  const rows=huxuanCaptureRows(row,capture('insight',data));
  assert.ok(rows.length>1);
  const stored=await saveObservations(rows.map(r=>normalizeHuxuanObservation(r,{pageUrl},'huxuan-large-fixture')));
  assert.equal(stored.length,rows.length);
  const pending=(await pendingObservations()).filter(o=>o.sessionId==='huxuan-large-fixture');
  const records=pending.map(huxuanObservationRecord);
  for(const record of records)assert.ok(new TextEncoder().encode(JSON.stringify(record)).length<300_000);
  const fragments=records.map(r=>r.rpa_feedback.raw_fields.capture).sort((a,b)=>a.fragmentIndex-b.fragmentIndex);
  assert.deepEqual(JSON.parse(fragments.map(p=>p.data).join('')),data);
  assert.equal(new Set(pending.map(p=>p.viewKey)).size,rows.length);
});

test('request contracts match homepage methods, classification and date range without arbitrary endpoints',()=>{
  assert.equal(huxuanProfileRequest(row.authorId,'detail').params.inner_from,'selection_list');
  assert.equal(huxuanProfileRequest(row.authorId,'near:3').params.video_type,3);
  assert.equal(huxuanProfileRequest(row.authorId,'videos:1',{...range,pageIndex:2}).params.page_index,2);
  assert.deepEqual(huxuanDateRange(new Date(2026,10,10)),range);
  assert.throws(()=>huxuanProfileRequest(row.authorId,'/arbitrary'),/栏目/);
  assert.throws(()=>huxuanProfileRequest('nickname','detail'),/身份/);
});

test('wait once between creators and before extra work pages, never between homepage endpoints',async()=>{
 const events=[],rows=[row,{...row,authorId:'sphSecondAuthor',authorName:'第二位'}];
 await collectHuxuanProfiles({rows,parallel:true,videoMaxPages:2,checkpoint:{range},active:()=>true,
  wait:async()=>events.push('creator-wait'),waitPage:async()=>events.push('page-wait'),progress:async()=>{},
  request:async(id,dataset,{pageIndex})=>{events.push(`${id}:${dataset}:${pageIndex}`);return {ok:true,capture:{authorId:id,dataset,pageIndex,status:'available',data:dataset.startsWith('videos:')?{total_cnt:2,video_list:[{export_id:`${dataset}-${pageIndex}`}]}:{}}};},
  save:async(r,value)=>{events.push(`${r.authorId}:saved:${value.dataset}`);return huxuanCaptureSummary(value);}
 });
 assert.equal(events.filter(x=>x==='creator-wait').length,1);
 assert.equal(events.filter(x=>x==='page-wait').length,4);
 const waiting=events.indexOf('creator-wait');
 assert.ok(waiting>events.indexOf(`${row.authorId}:saved:complete`));
 assert.ok(waiting<events.indexOf('sphSecondAuthor:detail:null'));
 for(let i=0;i<events.length;i++)if(events[i]==='page-wait')assert.match(events[i+1],/:videos:[01]:1$/);
});

test('independent sections overlap and successful in-flight sections remain durable on failure',async()=>{
 const saved=[],pending=[],checkpoint={completed:{},range};let requests=0;
 const run=collectHuxuanProfiles({rows:[row],parallel:true,checkpoint,active:()=>true,wait:async()=>assert.fail('one creator has no creator wait'),progress:async()=>{},
  request:async(id,dataset)=>{
   requests++;
   if(dataset==='detail')return {ok:true,capture:capture(dataset,{})};
   return new Promise(resolve=>pending.push({dataset,resolve}));
  },
  save:async(r,value)=>{saved.push(value.dataset);const summary=huxuanCaptureSummary(value);checkpoint.completed[huxuanCaptureKey(r.authorId,value.dataset,value.pageIndex)]=summary;return summary;}
 });
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(pending.length,HUXUAN_PROFILE_DATASETS.length-1,'all independent requests start before any returns');
 pending[0].resolve({ok:false,error:'HTTP 429'});
 for(const entry of pending.slice(1))entry.resolve({ok:true,capture:capture(entry.dataset,{})});
 await assert.rejects(run,/HTTP 429/);
 assert.equal(requests,HUXUAN_PROFILE_DATASETS.length,'failure must not start work pagination or another creator');
 assert.ok(saved.includes('score'));assert.equal(saved.includes('complete'),false);
 assert.equal(checkpoint.completed[huxuanCaptureKey(row.authorId,'persona')],undefined);
});

test('pausing while progress is persisted prevents the next external request',async()=>{
 let running=true,calls=0;
 await assert.rejects(collectHuxuanProfiles({rows:[row],checkpoint:{completed:{[huxuanCaptureKey(row.authorId,'list')]:{status:'available'}}},active:()=>running,parallel:true,wait:async()=>{},progress:async()=>{running=false;},request:async()=>{calls++;},save:async()=>{}}),/已暂停/);
 assert.equal(calls,0);
});

for (const limit of [undefined,1,3]) test(`video page cap ${limit ?? 'default'} stops without exhausting a creator history`,async()=>{
 const calls=[],saved=[];
 await collectHuxuanProfiles({rows:[row],videoMaxPages:limit,checkpoint:{range},active:()=>true,wait:async()=>{},waitPage:async()=>{},progress:async()=>{},
 request:async(id,dataset,{pageIndex})=>{calls.push({dataset,pageIndex});return {ok:true,capture:capture(dataset,dataset.startsWith('videos:')?{total_cnt:54,video_list:[{export_id:`work-${pageIndex}`}]}:{},pageIndex)};},
 save:async(r,c)=>{saved.push(c);return huxuanCaptureSummary(c);}});
 for(const dataset of ['videos:0','videos:1'])assert.deepEqual(calls.filter(c=>c.dataset===dataset).map(c=>c.pageIndex),Array.from({length:limit ?? 1},(_,i)=>i));
 assert.equal(saved.at(-1).dataset,'complete');
 assert.equal(saved.at(-1).data.videoMaxPages,limit ?? 1);
});
