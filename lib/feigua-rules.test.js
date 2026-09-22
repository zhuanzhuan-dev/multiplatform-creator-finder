import test from 'node:test';
import assert from 'node:assert/strict';
import { historyTone } from './decision-history.js';
import { evaluateFeiguaRules } from './feigua-rules.js';
import { newFeiguaCollection, mergeFeiguaPage, feiguaRecord } from './feigua-collection.js';
import { normalizeFeiguaObservation, observationRecord } from './observations.js';
const rules={feiguaKeywords:['喝酒'],feiguaPositiveKeywords:['摄影','美食']};
for(const field of ['title','authorName','hotWords','topics']) {
  test(`matches positive and negative ${field}`,()=>{
    const row = word => ({[field]:['topics','hotWords'].includes(field)?[word]:word});
    assert.equal(evaluateFeiguaRules([row('摄影')],rules).code,'FEIGUA_MATCHED');
    assert.equal(evaluateFeiguaRules([row('摄影喝酒')],rules).code,'FEIGUA_EXCLUDED');
  });
}
test('unknown and empty positive rules stay review; supplied searchText cannot override facts',()=>{
  assert.equal(evaluateFeiguaRules([{title:'普通视频',searchText:'摄影'}],rules).needsReview,true);
  assert.equal(evaluateFeiguaRules([{title:'摄影'}],{...rules,feiguaPositiveKeywords:[]}).needsReview,true);
  assert.equal(evaluateFeiguaRules([{title:'MEME'}],{feiguaKeywords:['meme']}).code,'FEIGUA_EXCLUDED');
});
const row=(title,id)=>({title,videoId:id,authorName:'甲',profileUrl:'https://dy.feigua.cn/app/#/blogger-detail/index?bloggerId=42'});
const page=(n,rows)=>({fingerprint:String(n),rows,pageUrl:'https://dy.feigua.cn/app/#/video/library/all',capturedAt:'2026-09-22T00:00:00Z'});
test('cross-page positive upgrade, restart and negative veto, idempotent events',()=>{
 let c=newFeiguaCollection('r',true);c.positiveKeywords=rules.feiguaPositiveKeywords;
 assert.equal(mergeFeiguaPage(c,page(1,[row('普通','1')]),rules.feiguaKeywords).events[0].code,'FEIGUA_PENDING_REVIEW');
 assert.equal(mergeFeiguaPage(c,page(2,[row('摄影','2')]),rules.feiguaKeywords).events[0].code,'FEIGUA_MATCHED');
 assert.equal(feiguaRecord(Object.values(c.accounts)[0],'r').rpa_feedback.review_required,false);
 c=JSON.parse(JSON.stringify(c));
 assert.equal(mergeFeiguaPage(c,page(2,[row('摄影','2')]),rules.feiguaKeywords).events.length,0);
 assert.equal(mergeFeiguaPage(c,page(3,[row('喝酒','3')]),rules.feiguaKeywords).events[0].code,'FEIGUA_EXCLUDED');
 mergeFeiguaPage(c,page(4,[row('美食','4')]),rules.feiguaKeywords);
 assert.equal(Object.keys(c.accounts).length,0);
});
test('upload records carry actual three-way decision and reason',()=>{
 for(const title of ['摄影','喝酒','普通']) {
  const source=row(title,'1'),decision=evaluateFeiguaRules([source],rules);
  const record=observationRecord({...normalizeFeiguaObservation({...source,ruleDecision:decision},page(1,[source]),'r','automatic'),id:'id',sequence:1});
  assert.equal(record.rpa_feedback.review_required,decision.needsReview);
  assert.equal(record.rpa_feedback.finder_decision,decision.code);
 }
});

test('history filters agree with Feigua three-way labels',()=>{
 assert.equal(historyTone('FEIGUA_MATCHED'),'good');
 assert.equal(historyTone('FEIGUA_PENDING_REVIEW'),'review');
 assert.equal(historyTone('FEIGUA_EXCLUDED'),'reject');
});
