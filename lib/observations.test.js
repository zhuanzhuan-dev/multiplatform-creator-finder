import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFeiguaObservation,mergeObservations,observationRecord} from './observations.js';
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
