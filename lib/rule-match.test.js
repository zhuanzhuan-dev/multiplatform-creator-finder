import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { mergeRules } from './defaults.js';
import { decideKuaishou } from './kuaishou-task.js';
import { decideBilibili, mergeBilibiliRules } from './bilibili-rules.js';
import { evaluateFeiguaRules } from './feigua-rules.js';
import { captureRuleMatch } from './rule-match.js';
import { normalizeHistoryEntry } from './decision-history.js';
import { writeDecisions, queryDecisions } from './decision-store.js';

const rules = () => mergeRules({
  hard: {minVideoDurationSeconds: 75, minVideoLikes: 4200, minFollowers: 1234, maxFollowers: 56789},
  positiveCategories: [{id:'digital',name:'数码测评',keywords:['手机测评'],score:15,enabled:true}],
});
const video = {sourcePlatform:'kuaishou',contentType:'video',caption:'手机测评',durationSeconds:90,likes:5000};
const profile = {followers:8000,averageLikes:null,kuaishouId:'fixture'};

test('completed feed judgment retains keyword, hard gates and the actual scoring source', () => {
  const decision = decideKuaishou(video, profile, rules());
  assert.equal(decision.matched, true);
  const reasons = decision.reasons.join('\n');
  for (const pattern of [/90.*75/, /5000.*4200/, /数码测评.*手机测评/, /8000.*1234.*56789/, /当前视频点赞（主页均赞未读到） 5000/]) assert.match(reasons, pattern);
  assert.equal(decideKuaishou({...video, likes:null}, profile, rules()).code, 'LIKES_MISSING');
  assert.equal(decideKuaishou({...video, likes:4199}, profile, rules()).code, 'LIKES_TOO_LOW');
});

test('Bilibili explains its matched comparator and distinguishes partition from keyword evidence', () => {
  const now = Date.now();
  const rules = mergeBilibiliRules({playRules:{reject:[],prefer:[{plays:120000,playsOp:'>',days:2,daysOp:'<='}]}});
  const input = {contentType:'video',caption:'普通标题',authorName:'测试账号',tname:'美食',durationSeconds:90,plays:150000,pubdateSeconds:now/1000-86400};
  const decision = decideBilibili(input, {followers:8000}, rules, now);
  assert.equal(decision.code, 'ACCEPTED');
  assert.match(decision.reasons.join('\n'), /理想规则命中：播放 150000 > 120000.*1.0 天 <= 2 天/);
  assert.match(decision.reasons.join('\n'), /分区命中「美食」/);
  assert.doesNotMatch(decision.reasons.join('\n'), /关键词命中/);
  const review = decideBilibili({...input,plays:120000}, {followers:8000}, rules, now);
  assert.equal(review.code, 'ACCEPTED_REVIEW');
  assert.doesNotMatch(review.reasons.join('\n'), /理想规则命中/);
});

test('Feigua captures actual positive keywords and preserves negative/review outcomes', () => {
  const rules = {feiguaPositiveKeywords:['手机测评','旅行'],feiguaKeywords:['喝酒']};
  const decision = evaluateFeiguaRules([{title:'新款手机测评'}], rules);
  const captured = captureRuleMatch(decision, {route:{label:'飞瓜视频库'}}, 'feigua');
  assert.deepEqual(captured.matchedItems, ['手机测评']);
  assert.equal(evaluateFeiguaRules([{title:'喝酒 手机测评'}], rules).code, 'FEIGUA_EXCLUDED');
  assert.equal(evaluateFeiguaRules([{title:'普通内容'}], rules).code, 'FEIGUA_PENDING_REVIEW');
  rules.feiguaPositiveKeywords[0]='美食';
  assert.deepEqual(captured.matchedItems, ['手机测评']);
});

test('durable history keeps complete capture-time evidence and separate run attribution for one author', async () => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
  const now=Date.now();
  const decision = decideKuaishou(video,profile,rules());
  const first = normalizeHistoryEntry({id:'first',occurredAt:new Date(now-1000).toISOString(),sourcePlatform:'kuaishou',authorId:'same-author',runId:'run-1',code:decision.code,reasons:decision.reasons,
    ruleMatch:captureRuleMatch(decision,{route:{label:'快手数码任务'}},'kuaishou')});
  const second = {...first,id:'second',runId:'run-2',ruleMatch:captureRuleMatch({...decision,categories:[{name:'旅行'}],reasons:['命中关键词：旅行']},{route:{label:'快手旅行任务'}},'kuaishou')};
  await writeDecisions([first,second],now);
  first.reasons.push('后来修改的规则');
  const found=await queryDecisions({query:'数码任务'},now);
  assert.equal(found.total,1);
  assert.ok(found.items[0].reasons.length>4, 'hard gates and keyword evidence survive the old four-reason limit');
  assert.equal(found.items[0].reasons.includes('后来修改的规则'),false);
  assert.equal((await queryDecisions({runId:'run-2',query:'旅行'},now)).total,1);
  assert.equal((await queryDecisions({authorId:'same-author'},now)).total,2);
});

test('legacy and collection-only records retain their original meanings', () => {
  const legacy=normalizeHistoryEntry({occurredAt:new Date().toISOString(),code:'ACCEPTED',reasons:['已有判断']});
  assert.equal(legacy.ruleMatch,null);
  assert.deepEqual(legacy.reasons,['已有判断']);
  for (const [platform,code] of [['xingtu','XINGTU_OBSERVED'],['huxuan','HUXUAN_CANDIDATE_REVIEW']]) {
    const match=captureRuleMatch({code,reasons:['页面已采集，待人工复核']},{},platform);
    assert.match(match.ruleName,/采集$/);
    assert.deepEqual(match.matchedItems,[]);
  }
});
