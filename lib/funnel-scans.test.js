import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { funnelScan } from './funnel-scans.js';
import { writeDecisions, cleanupDecisions, decisionPreview, pendingFunnelScans, removeFunnelScans } from './decision-store.js';

const make = (source, observation = {}, extra = {}) => funnelScan({code:'ACCEPTED'}, observation, null, {route:{platform:source},runId:'run-1', ...extra}, 'user-1', '1.1.29', 'event-1', '2026-10-26T01:00:00Z');

test('scans use stable platform identities and retain unidentified observations without treating names as keys', () => {
  assert.deepEqual([make('douyin',{secUid:' AbC '}).identityKind,make('douyin',{secUid:' AbC '}).identityValue], ['sec_uid','AbC']);
  assert.equal(make('kuaishou',{authorId:'ks-1'}).identityKind,'kuaishou_id');
  assert.equal(make('bilibili',{authorId:'123'}).identityKind,'bilibili_id');
  assert.equal(make('huxuan',{authorId:'wx-1'}).identityKind,'wechat_channels_id');
  assert.equal(make('xingtu',{xingtuId:'x1'}).identityKind,'xingtu_id');
  assert.equal(make('feigua',{bloggerId:'f1'}).identityKind,'feigua_blogger_id');
  assert.equal(make('douyin',{authorName:'昵称'}).identityValue,null);
  assert.equal(make('douyin',{}),null);
  assert.equal(make('douyin',{secUid:'a'},{runSettings:{dryRun:true}}),null);
  assert.equal(make('unexpected',{secUid:'a'}),null);
});

test('scan outbox survives history cleanup, isolates users and removes only acknowledged events', async () => {
  globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange;
  const now=Date.now(), scan=make('douyin',{secUid:'a'});
  await writeDecisions([{id:'event-1',occurredAt:new Date(now).toISOString(),sourcePlatform:'douyin',code:'ACCEPTED',funnelScan:scan},
    {id:'event-2',occurredAt:new Date(now).toISOString(),sourcePlatform:'douyin',code:'ACCEPTED',funnelScan:{...scan,id:'event-2',userId:'user-2'}}],now);
  await cleanupDecisions(now+3*24*60*60*1000);
  assert.deepEqual((await pendingFunnelScans('user-1')).map(row=>row.id),['event-1']);
  assert.deepEqual((await pendingFunnelScans('user-2')).map(row=>row.id),['event-2']);
  await removeFunnelScans(['event-1']);
  assert.deepEqual(await pendingFunnelScans('user-1'),[]);
  assert.equal((await pendingFunnelScans('user-2')).length,1);
});

test('a funnel storage failure leaves normal decision history usable', async () => {
  globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange;
  const open=indexedDB.open.bind(indexedDB);
  indexedDB.open=(name,...args)=>{
    if(name!=='dra-funnel-scans') return open(name,...args);
    const request={error:new Error('storage unavailable')};
    queueMicrotask(()=>request.onerror());
    return request;
  };
  const now=Date.now(), at=new Date(now-1000).toISOString(), scan=make('douyin',{secUid:'a'});
  const log=console.error; console.error=()=>{};
  try {
    await writeDecisions([{id:'event-1',occurredAt:at,sourcePlatform:'douyin',code:'ACCEPTED',funnelScan:scan},
      {id:'event-2',occurredAt:at,sourcePlatform:'douyin',code:'PROFILE_INCOMPLETE',funnelOnly:true,funnelScan:{...scan,id:'event-2'}}],now);
    const history=await decisionPreview('douyin',now);
    assert.equal(history.total,1);
    assert.equal(history.items[0].code,'ACCEPTED');
  } finally { console.error=log; }
});
