import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {readFile} from 'node:fs/promises';
let serial=0;
async function setup(legacy,options={}) {
  const data={draObservations:legacy,draOutbox:[{id:'pending'}]};
  globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange;
  globalThis.chrome={storage:{local:{get:async()=>structuredClone(data),remove:async key=>{
    if(options.failCleanup)throw Error('cleanup interrupted');delete data[key];
  },set:async()=>{throw Error('Resource::kQuotaBytes quota exceeded');}}}};
  const store=await import(`./observations.js?storage-test=${++serial}`);
  return {store,data};
}
const input=(id,extra={})=>({sourcePlatform:'feigua',sessionId:'browse',surface:'video',entityKey:id,observedAt:'2026-09-10T00:00:00Z',raw:{title:id},...extra});
test('migrates old data once and preserves IDs and queue flags across an interrupted cleanup',async()=>{
 const legacy={records:[{...input('old'),id:'old-id',sequence:4,queuedId:'old-id',uploadEligible:true}],sequence:9};
 const {store,data}=await setup(legacy,{failCleanup:true});
 assert.equal((await store.exportObservations())[0].id,'old-id');assert.ok(data.draObservations);
 await store.saveObservations([input('new')]);
 const restarted=await import(`./observations.js?restart=${++serial}`);
 const records=await restarted.exportObservations();
 assert.equal(records.length,2);assert.equal(records[1].sequence,10);
 assert.equal(records[0].queuedId,'old-id');assert.equal((await restarted.pendingObservations()).length,0);
 assert.deepEqual(data.draOutbox,[{id:'pending'}]);
});
test('successful migration releases old local storage; invalid migration preserves the original',async()=>{
 const {store,data}=await setup({records:[{...input('a'),id:'a',sequence:1}],sequence:1});
 await store.observationStatus();assert.equal(data.draObservations,undefined);
 const broken=await setup({records:[{...input('b'),sequence:1}],sequence:1});
 await assert.rejects(broken.store.exportObservations(),/格式异常/);
 assert.equal(broken.data.draObservations.records.length,1);
});
test('stores more than 6000 records and 6 MB without rewriting chrome local storage',async()=>{
 const {store,data}=await setup();
 await store.saveObservations(Array.from({length:6100},(_,i)=>input(`video-${i}`,{raw:{text:'a'.repeat(1100)}})));
 assert.equal((await store.observationStatus()).count,6100);
 assert.equal((await store.exportObservations()).length,6100);
 assert.equal(data.draObservations,undefined);
 const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
 assert.ok(manifest.permissions.includes('unlimitedStorage'));
});
test('transaction abort preserves earlier records and permits retry',async()=>{
 const {store}=await setup();await store.saveObservations([input('old')]);
 await assert.rejects(store.saveObservations([input('new'),input('bad',{raw:{notCloneable(){}}})]));
 assert.equal((await store.exportObservations()).length,1);
 await store.saveObservations([input('new')]);assert.equal((await store.exportObservations()).length,2);
});
test('concurrent saves dedupe, pending revisions survive and pending reads stay bounded',async()=>{
 const {store}=await setup();
 await Promise.all([store.saveObservations([input('same')]),store.saveObservations([input('same')])]);
 assert.equal((await store.exportObservations()).length,1);
 await store.saveObservations([input('queued',{uploadEligible:true})]);
 await store.saveObservations([input('queued',{uploadEligible:true,raw:{title:'changed'}})]);
 let pending=await store.pendingObservations();assert.equal(pending.length,2);
 await store.markObservationsQueued([pending[0].id]);assert.equal((await store.pendingObservations()).length,1);
 await store.saveObservations(Array.from({length:260},(_,i)=>input(`pending-${i}`,{uploadEligible:true})));
 pending=await store.pendingObservations();assert.equal(pending.length,250);
 assert.ok(pending.every((item,i)=>!i || item.sequence>pending[i-1].sequence));
});

test('24-hour retention preserves pending and failed uploads until actual server acknowledgement',async()=>{
 const {store}=await setup();const now=Date.parse('2026-09-12T00:00:00Z');
 await store.saveObservations([input('local'),input('pending',{uploadEligible:true}),input('queued',{uploadEligible:true}),input('recent',{observedAt:new Date(now-1000).toISOString()})]);
 const queued=(await store.pendingObservations()).find(item=>item.entityKey==='queued');
 await store.markObservationsQueued([queued.id]);
 assert.equal(await store.cleanupObservations({now}),1);
 assert.equal((await store.exportObservations()).length,3);
 await store.markObservationsUploaded([queued.id]);
 assert.equal(await store.cleanupObservations({now}),1);
 assert.deepEqual((await store.exportObservations()).map(item=>item.entityKey),['pending','recent']);
});
test('reobservation refreshes expiry, protected queue references survive and cleanup spans batches',async()=>{
 const {store}=await setup();const now=Date.parse('2026-09-12T00:00:00Z');
 await store.saveObservations(Array.from({length:510},(_,i)=>input(`old-${i}`)));
 await store.saveObservations([input('old-0',{observedAt:new Date(now-1000).toISOString()})]);
 const protect=JSON.stringify(['browse','old-1']);
 assert.equal(await store.cleanupObservations({now,protectedEntities:[protect]}),508);
 assert.equal((await store.exportObservations()).length,2);
 assert.equal(await store.cleanupObservations({now}),1);
 await store.saveObservations([input('old-2',{observedAt:new Date(now).toISOString()})]);
 assert.equal((await store.exportObservations()).length,2);
});
test('queued revisions stay retained and deleting an expired predecessor preserves the latest head',async()=>{
 const {store}=await setup();const now=Date.parse('2026-09-12T00:00:00Z');
 await store.saveObservations([input('same',{uploadEligible:true})]);
 const old=(await store.exportObservations())[0];await store.markObservationsQueued([old.id]);
 await store.saveObservations([input('same',{uploadEligible:true,raw:{title:'new'},observedAt:new Date(now).toISOString()})]);
 assert.equal((await store.exportObservations()).length,2);
 await store.markObservationsUploaded([old.id]);await store.cleanupObservations({now});
 assert.equal((await store.exportObservations()).length,1);
 const changes=await store.saveObservations([input('same',{uploadEligible:true,raw:{title:'new'},observedAt:new Date(now+1000).toISOString()})]);
 assert.equal(changes.length,0);
});

test('upgrades existing version-one IndexedDB records before applying retention',async()=>{
 const {store}=await setup();
 await new Promise((resolve,reject)=>{
  const request=indexedDB.open('dra-observations',1);
  request.onupgradeneeded=()=>{
   const db=request.result,records=db.createObjectStore('records',{keyPath:'id'});
   records.createIndex('sequence','sequence');records.createIndex('source','sourcePlatform');
   records.createIndex('sourceSequence',['sourcePlatform','sequence']);records.createIndex('pendingSequence',['pending','sequence']);
   db.createObjectStore('heads');db.createObjectStore('meta');
  };
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{
   const db=request.result,tx=db.transaction(['records','heads','meta'],'readwrite');
   tx.objectStore('records').put({...input('legacy'),id:'legacy',sequence:1,key:'legacy'});
   tx.objectStore('meta').put(true,'migrated');tx.objectStore('meta').put(1,'sequence');
   tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);
  };
 });
 assert.equal(await store.cleanupObservations({now:Date.parse('2026-09-12T00:00:00Z')}),1);
 assert.equal((await store.exportObservations()).length,0);
});
