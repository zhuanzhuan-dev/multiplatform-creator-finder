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
  const run=(checkpoint={})=>collectHuxuanProfiles({rows:[row],checkpoint:{range,...checkpoint},active:()=>true,wait:async()=>{},progress:async()=>{},
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
