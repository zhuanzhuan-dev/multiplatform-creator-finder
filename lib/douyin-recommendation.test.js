import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendationState, recommendationAdvanced } from './douyin-recommendation.js';

test('author playback is identified even when its URL and outer card are still recommendation', () => {
  const card = { querySelector: () => ({id:'slideMode',getAttribute:()=> 'author-video'}) };
  assert.equal(recommendationState({}, {visibleFeedItem:()=>card}).mode, 'author');
});
test('navigation confirms recommendation movement, without requiring a different creator', () => {
  const card = {};
  const before = {card,mode:'recommendation',videoId:'first',secUid:'same-author'};
  assert.equal(recommendationAdvanced(before,{...before,mode:'author',videoId:'second'},'first','second'),false);
  assert.equal(recommendationAdvanced(before,{...before,videoId:'second'},'first','second'),true);
  assert.equal(recommendationAdvanced(before,before,'first','first'),false);
  assert.equal(recommendationAdvanced(before,before,'first','changing-caption'),false);
  assert.equal(recommendationAdvanced(before,{card:{},mode:'recommendation'},'first','second'),true);
});
