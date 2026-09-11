import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVideoRules, evaluateCreatorRules } from './rule-engine.js';
const rules = { hard: { minVideoDurationSeconds: 75, minVideoLikes: 4200, minFollowers: 1234, maxFollowers: 56789 }, lowFollowerNewAccount: { enabled: true, requireCompleteWorksList: true, maxVideos: 8, minAverageLikes: 6500 } };
test('rejections report observed values and effective customized thresholds', () => {
  assert.match(evaluateVideoRules({contentType:'video',durationSeconds:39,likes:2000},rules).reasons[0], /39.*75/);
  assert.match(evaluateVideoRules({contentType:'video',durationSeconds:90,likes:2000},rules).reasons[0], /2000.*4200/);
  assert.match(evaluateCreatorRules({followers:60000},rules).reasons[0], /60000.*56789/);
  const reason=evaluateCreatorRules({followers:100,videoCount:12,averageLikes:1000,worksListComplete:false},rules).reasons[0];
  for(const pattern of [/100.*1234/,/12.*8/,/1000.*6500/,/尚未完整加载/])assert.match(reason,pattern);
  assert.match(evaluateCreatorRules({followers:100},{...rules,lowFollowerNewAccount:{enabled:false}}).reasons[0],/未开启/);
});
test('missing followers are reported as unreadable rather than above or below limits', () => {
  for(const followers of [undefined,null,'','invalid'])assert.equal(evaluateCreatorRules({followers},rules).code,'FOLLOWERS_MISSING');
  assert.equal(evaluateCreatorRules({followers:1234},rules).matched,true);
  assert.equal(evaluateCreatorRules({followers:56789},rules).matched,true);
});
