import test from 'node:test';
import assert from 'node:assert/strict';
import { newFeiguaCollection, mergeFeiguaPage, feiguaRecord } from './feigua-collection.js';
const row = (title = '美食教程', name = '达人甲') => ({ authorName: name, title, followerCount: '12.6w', videoId: title, topics: [], hotWords: [], profileUrl: 'https://dy.feigua.cn/app/#/blogger-detail/index?bloggerId=42' });
const page = (id, rows) => ({ fingerprint: id, rows, pageUrl: 'https://dy.feigua.cn/app/#/video/library/all', capturedAt: new Date().toISOString() });
test('later-page exclusion removes earlier candidate and survives restart', () => {
  let c = newFeiguaCollection('run', true);
  mergeFeiguaPage(c, page('1', [row()]), ['恐怖']);
  assert.equal(Object.keys(c.accounts).length, 1);
  c = JSON.parse(JSON.stringify(c));
  mergeFeiguaPage(c, page('2', [row('恐怖故事')]), ['恐怖']);
  assert.equal(Object.keys(c.accounts).length, 0);
  mergeFeiguaPage(c, page('3', [row('普通作品')]), ['恐怖']);
  assert.equal(Object.keys(c.accounts).length, 0);
  assert.equal(Object.keys(c.excluded).length, 1);
});
test('replaying a page is idempotent and updates follower text', () => {
  const c = newFeiguaCollection('run', true), p = page('1', [row()]);
  assert.equal(mergeFeiguaPage(c, p, []).fresh.length, 1);
  p.rows[0].followerCount = '13w';
  assert.equal(mergeFeiguaPage(c, p, []).fresh.length, 0);
  assert.equal(c.accounts['feigua:blogger:42'].followerCount, '13w');
  assert.equal(c.pages.length, 1);
});
test('backend recomputes exclusion text instead of trusting content searchText', () => {
  const c = newFeiguaCollection('run', true);
  mergeFeiguaPage(c, page('1', [{...row('普通作品'), hotWords: ['MEME'], searchText: 'safe'}]), ['meme']);
  assert.equal(Object.keys(c.accounts).length, 0);
});
test('cloud record preserves provenance without inventing Douyin identity', () => {
  const c = newFeiguaCollection('run', true);
  mergeFeiguaPage(c, page('1', [row()]), []);
  const r = feiguaRecord(c.accounts['feigua:blogger:42'], 'run');
  assert.equal(r.author_href, '');
  assert.equal(r.rpa_feedback.source_platform, 'feigua');
  assert.equal(r.rpa_feedback.followers, 126000);
  assert.equal(r.rpa_feedback.review_required, true);
  assert.equal(r.rpa_feedback.feigua_profile_url, row().profileUrl);
  assert.equal(r.transition_ok, null);
});

test('duplicate DOM rows count one observed video', () => {
 const c=newFeiguaCollection('run',true);
 assert.equal(mergeFeiguaPage(c,page('1',[row(),row()]),[]).fresh.length,1);
 assert.equal(c.seen.length,1);
});
test('preserves per-video fields, refreshes replay metrics and keeps account avatar', () => {
  const c = newFeiguaCollection('run', true);
  mergeFeiguaPage(c, page('1', [{...row('一'), avatarUrl:'https://example.com/avatar.jpg', metrics:{播放:'83.9w',点赞:'1.2w'}, rawText:'视频一'}, {...row('二'),metrics:{播放:'34.9w'}}]), []);
  let a=c.accounts['feigua:blogger:42'];
  assert.equal(a.videos.length,2);
  assert.equal(a.videos[0].rawText,'视频一');
  const replay=mergeFeiguaPage(c,page('1',[{...row('一'),metrics:{播放:'84w',点赞:'1.3w'}}]),[]);
  assert.equal(replay.fresh.length,0);
  a=JSON.parse(JSON.stringify(c.accounts['feigua:blogger:42']));
  assert.equal(a.avatarUrl,'https://example.com/avatar.jpg');
  assert.equal(a.videos.length,2);
  assert.equal(a.videos[0].metrics.播放,'84w');
  assert.equal(a.videos[1].metrics.播放,'34.9w');
  assert.equal(feiguaRecord(a,'run').rpa_feedback.feigua_videos.length,2);
});
