import test from 'node:test';
import assert from 'node:assert/strict';
import { newXingtuCollection, mergeXingtuPage, xingtuRecord } from './xingtu-collection.js';

const row = (name = '达人甲', extra = {}) => ({
  authorName: name,
  followerCount: '12.6w',
  xingtuId: extra.xingtuId || '42',
  profileUrl: `https://www.xingtu.cn/ad/creator/author/douyin/${extra.xingtuId || '42'}`,
  tags: extra.tags || ['美食'],
  prices: extra.prices || { '1-20s': '800' },
  metrics: extra.metrics,
  city: extra.city,
  gender: extra.gender,
  rawText: extra.rawText || `${name}\n粉丝数 12.6w\n内容类型：${(extra.tags || ['美食']).join(' ')}`
});
const page = (id, rows) => ({ fingerprint: id, rows, pageUrl: 'https://www.xingtu.cn/ad/creator/market', capturedAt: new Date().toISOString() });

test('later-page exclusion removes earlier candidate and survives restart', () => {
  let c = newXingtuCollection('run', true);
  mergeXingtuPage(c, page('1', [row()]), ['游戏']);
  assert.equal(Object.keys(c.accounts).length, 1);
  c = JSON.parse(JSON.stringify(c));
  mergeXingtuPage(c, page('2', [row('达人甲', { tags: ['游戏'], rawText: '达人甲\n粉丝数 12.6w\n内容类型：游戏' })]), ['游戏']);
  assert.equal(Object.keys(c.accounts).length, 0);
  mergeXingtuPage(c, page('3', [row()]), ['游戏']);
  assert.equal(Object.keys(c.accounts).length, 0);
  assert.equal(Object.keys(c.excluded).length, 1);
});

test('replaying a page is idempotent and updates follower text', () => {
  const c = newXingtuCollection('run', true);
  const p = page('1', [row()]);
  assert.equal(mergeXingtuPage(c, p, []).fresh.length, 1);
  p.rows[0].followerCount = '13w';
  assert.equal(mergeXingtuPage(c, p, []).fresh.length, 0);
  assert.equal(c.accounts['xingtu:star:42'].followerCount, '13w');
  assert.equal(c.pages.length, 1);
});

test('market table metrics persist on the candidate and cloud record', () => {
  const c = newXingtuCollection('run', true);
  mergeXingtuPage(c, page('1', [row('陈翔六点半', {
    metrics: { 预期CPM: '28.6', 预期播放量: '1,327w' },
    city: '昆明市',
    gender: '男',
    rawText: '陈翔六点半\n男\n昆明市\n28.6\n1,327w\n2.3%\n7.9%\n100%'
  })]), []);
  const account = c.accounts['xingtu:star:42'];
  assert.equal(account.metrics['预期CPM'], '28.6');
  assert.equal(account.city, '昆明市');
  assert.equal(xingtuRecord(account, 'run').rpa_feedback.metrics['预期播放量'], '1,327w');
});

test('cloud record preserves Xingtu provenance without inventing Douyin identity', () => {
  const c = newXingtuCollection('run', true);
  mergeXingtuPage(c, page('1', [row()]), []);
  const r = xingtuRecord(c.accounts['xingtu:star:42'], 'run');
  assert.equal(r.author_href, '');
  assert.equal(r.rpa_feedback.source_platform, 'xingtu');
  assert.equal(r.rpa_feedback.followers, 126000);
  assert.equal(r.rpa_feedback.review_required, true);
  assert.equal(r.rpa_feedback.xingtu_id, '42');
  assert.equal(r.xingtu_id, '42');
  assert.equal(r.rpa_feedback.xingtu_profile_url, row().profileUrl);
});
