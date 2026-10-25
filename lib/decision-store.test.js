import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {writeDecisions,decisionPreview,queryDecisions} from './decision-store.js';

test('history scopes the same creator to its task and keeps observation-time names across pagination',async()=>{
  globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange;
  const now=Date.now(),at=new Date(now-1000).toISOString();
  const entries=Array.from({length:8},(_,i)=>({id:`a-${i}`,sourcePlatform:'douyin',taskId:'task:a',taskName:'原数码规则',runId:'run-a',authorId:'same-creator',occurredAt:new Date(now-1000-i).toISOString(),code:'ACCEPTED',reasons:['手机测评']}));
  await writeDecisions([...entries,{id:'b',sourcePlatform:'douyin',taskId:'task:b',taskName:'另一套规则',runId:'run-b',authorId:'same-creator',occurredAt:at,code:'CATEGORY_BLACKLIST'}],now);
  const preview=await decisionPreview('douyin',now,'task:a');
  assert.equal(preview.total,8);assert.equal(preview.items.length,5);
  assert.equal(preview.items.every(item=>item.taskName==='原数码规则'),true);
  const first=await queryDecisions({taskId:'task:a',limit:5},now);
  assert.equal(first.total,8);assert.deepEqual(first.counts,{good:8,review:0,reject:0});assert.deepEqual(first.runs.map(run=>run.id),['run-a']);
  const next=await queryDecisions({taskId:'task:a',limit:5,cursor:first.nextCursor,asOf:first.asOf},now);
  assert.deepEqual(next.items.map(item=>item.id),['a-5','a-6','a-7']);
  assert.equal((await queryDecisions({taskId:'task:b'},now)).items[0].taskName,'另一套规则');
});

test('existing stored records without task fields remain in their default task history',async()=>{
  globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange;
  const now=Date.now();
  const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('dra-decision-history',1);req.onupgradeneeded=()=>{const store=req.result.createObjectStore('records',{keyPath:'id'});store.createIndex('time',['occurredAtMs','id']);store.createIndex('sourceTime',['sourcePlatform','occurredAtMs','id']);req.result.createObjectStore('meta');};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put({id:'old',occurredAtMs:now-1000,occurredAt:new Date(now-1000).toISOString(),sourcePlatform:'douyin',code:'ACCEPTED',reasons:[]});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  assert.equal((await decisionPreview('douyin',now,'douyin')).total,1);
  assert.equal((await queryDecisions({taskId:'douyin'},now)).items[0].taskName,'默认任务');
  assert.equal((await queryDecisions({taskId:'task:new'},now)).total,0);
});
