import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {normalizeFeiguaObservation,normalizeXingtuObservation,mergeObservations,saveObservations,xingtuObservedCreators,enableCreatorObservationUpload,pendingObservations,observationRecord,xingtuObservationRecord} from './observations.js';
const page={surface:'library',pageUrl:'https://dy.feigua.cn/app/#/video/library/all',capturedAt:'2026-09-10T00:00:00Z'};
const row={authorName:'甲',videoId:'123456789',profileUrl:'https://dy.feigua.cn/app/#/blogger-detail/index?bloggerId=42',metrics:{播放:'83.9w',点赞:'1.2w',评论:'584',分享:'3.0w',收藏:'1174',传播指数:'21.5',发布时间:'09/03 10:00'},followerCount:'51.3w',rawText:'原始事实'};
test('normalizes video metrics and preserves original display precision and identity',()=>{
 const item=normalizeFeiguaObservation(row,page,'r','browse');
 assert.equal(item.plays,839000);assert.equal(item.spreadIndex,21.5);assert.equal(item.followers,513000);assert.equal(item.raw.metrics.播放,'83.9w');
 assert.equal(item.sourcePlatform,'feigua');assert.equal(item.accountPlatform,'douyin');
 const record=observationRecord({...item,id:'id',sequence:1});
 assert.equal(record.comment_count,584);assert.equal(record.author_href,'');assert.equal(record.rpa_feedback.raw_fields.rawText,'原始事实');
});
test('same-session repeated facts dedupe, changed metrics refresh, another session retains a snapshot',()=>{
 const item=normalizeFeiguaObservation(row,page,'r','browse');
 let result=mergeObservations({},[item]);assert.equal(result.changed.length,1);
 result=mergeObservations(result.saved,[{...item,observedAt:'2026-09-10T01:00:00Z'}]);assert.equal(result.changed.length,0);
 result=mergeObservations(result.saved,[{...item,raw:{...row,metrics:{播放:'90w'}}}]);assert.equal(result.saved.records.length,1);assert.equal(result.changed.length,1);
 result=mergeObservations(result.saved,[{...item,sessionId:'next'}]);assert.equal(result.saved.records.length,2);
});
test('observations have no fixed byte ceiling and preserve prior facts',()=>{
 const saved=mergeObservations({},[normalizeFeiguaObservation(row,page,'r','automatic')]).saved;
 const result=mergeObservations(saved,[normalizeFeiguaObservation({...row,rawText:'大'.repeat(2100000)},page,'next','browse')]);
 assert.equal(result.saved.records.length,2);assert.equal(saved.records[0].raw.rawText,'原始事实');
});
test('different detail tabs retain separate facts and unqueued revisions are never overwritten',()=>{
 const first=normalizeFeiguaObservation({...row,selectedTab:'数据概览'}, {...page,surface:'creator'},'browse','browse');
 let result=mergeObservations({},[{...first,uploadEligible:true}]);
 result=mergeObservations(result.saved,[{...first,uploadEligible:true,raw:{...first.raw,metrics:{播放:'90w'}}}]);
 assert.equal(result.saved.records.length,2);
 const other=normalizeFeiguaObservation({...row,selectedTab:'视频数据'}, {...page,surface:'creator'},'browse','browse');
 result=mergeObservations(result.saved,[other]);assert.equal(result.saved.records.length,3);
});
test('normalizes Xingtu market cards without inventing Douyin identity',()=>{
 const market={surface:'market',pageUrl:'https://www.xingtu.cn/ad/creator/market',capturedAt:'2026-09-15T00:00:00Z'};
 const author={authorName:'乙',xingtuId:'987654',profileUrl:'https://www.xingtu.cn/ad/creator/author/douyin/987654',followerCount:'12.6w',tags:['美食'],prices:{'1-20s':'800'},metrics:{'预期CPM':'23.8'},rawText:'乙'};
 const item=normalizeXingtuObservation(author,market,'r','automatic');
 assert.equal(item.sourcePlatform,'xingtu');assert.equal(item.accountPlatform,'douyin');assert.equal(item.entityKey,'star:987654');assert.equal(item.followers,126000);
 const record=xingtuObservationRecord({...item,id:'id',sequence:1});
 assert.equal(record.rpa_feedback.xingtu_id,'987654');assert.equal(record.xingtu_id,'987654');assert.equal(record.author_href,'');
 assert.equal(record.quote_1_20s,800);
 assert.equal(record.cpm,23.8);
 assert.deepEqual(record.content_tags,['美食']);
});
test('upgrades version 2 observations with an indexed Xingtu creator lookup',async()=>{
 globalThis.chrome={storage:{local:{get:async()=>({}),remove:async()=>{}}}};
 const opened=indexedDB.open('dra-observations',2);
 opened.onupgradeneeded=()=>{
  const db=opened.result;
  const records=db.createObjectStore('records',{keyPath:'id'});
  records.createIndex('sequence','sequence');
  records.createIndex('source','sourcePlatform');
  records.createIndex('sourceSequence',['sourcePlatform','sequence']);
  records.createIndex('pendingSequence',['pending','sequence']);
  records.createIndex('expiry',['cleanupAt','id']);
  db.createObjectStore('heads');db.createObjectStore('meta');
 };
 const db=await new Promise((resolve,reject)=>{opened.onsuccess=()=>resolve(opened.result);opened.onerror=()=>reject(opened.error);});
 await new Promise((resolve,reject)=>{
  const tx=db.transaction('records','readwrite');
  tx.objectStore('records').put({id:'legacy-creator',sequence:1,sourcePlatform:'xingtu',sessionId:'legacy-run',entityKey:'star:987654',mode:'browse',raw:{xingtuId:'987654',followerCount:'12.6w',tags:['旅行']},uploadEligible:true,uploadConfirmed:true});
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
 });
 db.close();
 const found=await xingtuObservedCreators([{id:'history',code:'XINGTU_OBSERVED',runId:'legacy-run',authorId:'987654'}]);
 assert.equal(found.history.followers,'12.6w');
 assert.deepEqual(found.history.tags,['旅行']);
});
test('automatic creator upload queues retained observations only with stable identity',async()=>{
 globalThis.chrome={storage:{local:{get:async()=>({}),remove:async()=>{}}}};
 const market={surface:'market',pageUrl:'https://www.xingtu.cn/ad/creator/market',capturedAt:new Date().toISOString()};
 const [eligible]=await saveObservations([normalizeXingtuObservation({authorName:'待上传',xingtuId:'98765001'},market,'upload-test','browse')]);
 const [withoutIdentity]=await saveObservations([normalizeXingtuObservation({authorName:'仅昵称'},market,'upload-test','automatic')]);
 assert.equal((await pendingObservations()).some(item=>item.id===eligible.id),false);
 assert.deepEqual(await enableCreatorObservationUpload(),{feigua:0,xingtu:1});
 assert.deepEqual(await enableCreatorObservationUpload(),{feigua:0,xingtu:0});
 const pending=await pendingObservations();
 assert.equal(pending.some(item=>item.id===eligible.id),true);
 assert.equal(pending.some(item=>item.id===withoutIdentity.id),false);
});
test('browse history reads persisted Xingtu creator fields by stable ID and session',async()=>{
 globalThis.chrome={storage:{local:{get:async()=>({}),remove:async()=>{}}}};
 const market={surface:'market',pageUrl:'https://www.xingtu.cn/ad/creator/market',capturedAt:new Date().toISOString()};
 const source={authorName:'同名达人',xingtuId:'987654',followerCount:'22585000',tags:['旅行'],metrics:{'预期CPM':'36.6'},prices:{'21-60s':'900000'},city:'广州',gender:'女',xingtuIndex:'88'};
 const [saved]=await saveObservations([normalizeXingtuObservation(source,market,'xingtu-browse:today','browse')]);
 await saveObservations([normalizeXingtuObservation({...source,xingtuId:'123456',followerCount:'100'},market,'other','browse')]);
 await saveObservations([normalizeXingtuObservation({...source,followerCount:'1'},market,'automatic','automatic')]);
 const found=await xingtuObservedCreators([
  {id:'wanted',code:'XINGTU_OBSERVED',runId:'xingtu-browse:today',authorId:'987654'},
  {id:'unknown',code:'XINGTU_OBSERVED',runId:'xingtu-browse:today',authorId:'123456'}
 ]);
 assert.equal(saved.raw.metrics['预期CPM'],'36.6');
 assert.equal(found.wanted.followers,'22585000');
 assert.deepEqual(found.wanted.tags,['旅行']);
 assert.equal(found.wanted.prices['21-60s'],'900000');
 assert.equal(found.unknown,undefined);
});
