import test from 'node:test';
import assert from 'node:assert/strict';
import { projectXingtuResponse } from './xingtu-api.js';

const url = 'https://www.xingtu.cn/gw/api/gsearch/search_for_author_square';
const payload = {
  base_resp: { status_code: 0, status_message: '' },
  pagination: { page: 3, limit: 20, has_more: true },
  authors: [{
    star_id: '6734629370385661955',
    attribute_datas: {
      id: '6734629370385661955', nick_name: '示例达人', follower: '1955319',
      gender: '1', city: '武汉市', avatar_uri: 'https://example.com/avatar.webp',
      content_theme_labels_180d: '["篮球资讯","篮球动态"]',
      price_20_60: '50000', price_60: '233100',
      prospective_20_60_cpm: '44.7644', expected_play_num: '1116958',
      interact_rate_within_30d: '0.0152', play_over_rate_within_30d: '0.2357'
    }
  }]
};

test('从页面已加载的星图列表响应提取稳定身份、字段和页码', () => {
  const result = projectXingtuResponse(url, payload);
  assert.equal(result.kind, 'list');
  assert.equal(result.page, 3);
  assert.equal(result.last, false);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].xingtuId, '6734629370385661955');
  assert.equal(result.rows[0].followerCount, '1955319');
  assert.deepEqual(result.rows[0].tags, ['篮球资讯', '篮球动态']);
  assert.equal(result.rows[0].prices['21-60s'], '50000');
  assert.equal(result.rows[0].metrics['互动率'], '1.5%');
  assert.equal(result.rows[0].profileUrl, '');
});

test('拒绝缺少稳定身份、身份冲突和非星图来源', () => {
  assert.equal(projectXingtuResponse(url, { ...payload, authors: [{ star_id: '', attribute_datas: { nick_name: '同名' } }] }), null);
  assert.equal(projectXingtuResponse(url, { ...payload, authors: [{ star_id: '123', attribute_datas: { id: '456', nick_name: '甲' } }] }), null);
  assert.equal(projectXingtuResponse('https://other.example/gw/api/gsearch/search_for_author_square', payload), null);
  const mixed = projectXingtuResponse(url, { ...payload, authors: [payload.authors[0], { star_id: '', attribute_datas: { nick_name: '同名' } }] });
  assert.equal(mixed.rows.length, 1);
  assert.equal(mixed.missingIdentityCount, 1);
});

test('业务错误不会被当作空页或完成页', () => {
  assert.deepEqual(projectXingtuResponse(url, { ...payload, base_resp: { status_code: 11001, status_message: '用户未登录' } }), { kind: 'error', page: 3, message: '用户未登录' });
  assert.equal(projectXingtuResponse(url, { ...payload, authors: [], pagination: { ...payload.pagination, has_more: true } }), null);
  assert.equal(projectXingtuResponse(url, { ...payload, pagination: { ...payload.pagination, has_more: false } }).last, true);
});
