import test from 'node:test';
import assert from 'node:assert/strict';
import { feiguaSignedDetailLink, runFeiguaDetailRequests } from './feigua-request.js';

const signed = id => `https://dy.feigua.cn/app/#/blogger-detail/index?bloggerId=${id}&ts=1780000000&sign=${'a'.repeat(32)}`;

test('飞瓜签名只用于构造当前站点详情请求', () => {
  const result = feiguaSignedDetailLink(signed('42'));
  assert.equal(result.bloggerId, '42');
  assert.equal(result.urls.length, 2);
  assert.ok(result.urls.every(url => url.includes('id=42') && url.includes('sign=')));
  assert.equal(feiguaSignedDetailLink(signed('42').replace('dy.feigua.cn', 'example.com')), null);
  assert.equal(feiguaSignedDetailLink(signed('42').replace('sign=', 'other=')), null);
});

test('列表页逐人请求两段详情，输出身份投影后结束', async () => {
  const updates = [], calls = [];
  await runFeiguaDetailRequests({
    links: [signed('42'), signed('43')], bloggerIds: ['42', '43'],
    emit: update => updates.push(update), wait: async () => {}, isCurrent: () => true,
    fetchJson: async url => {
      calls.push(url);
      const id = new URL(url).searchParams.get('id');
      return url.includes('/mainpart')
        ? { Code: 200, Data: { Id: id, Uid: id, DouyinBloggerUrl: `https://www.douyin.com/user/MS4w${'x'.repeat(12)}` } }
        : { Code: 200, Data: { XingTuId: id, XingTuUrl: `https://www.xingtu.cn/ad/creator/${id}` } };
    }
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(updates.map(item => item.kind), ['identity-status', 'main', 'other', 'identity-status', 'main', 'other', 'identity-status', 'identity-status']);
  assert.equal(updates.at(-1).phase, 'done');
  assert.ok(updates.at(-1).lastRequestFinishedAt > 0);
  assert.ok(updates.every(item => !('sign' in item) && !('ts' in item)));
});

test('签名缺失和详情权限响应会阻止整页保存', async () => {
  const missing = [];
  await runFeiguaDetailRequests({ links: [signed('42')], bloggerIds: ['42', '43'], emit: item => missing.push(item), fetchJson: async () => {}, wait: async () => {}, isCurrent: () => true });
  assert.equal(missing.at(-1).phase, 'blocked');
  const rejected = [];
  await runFeiguaDetailRequests({ links: [signed('42')], bloggerIds: ['42'], emit: item => rejected.push(item), fetchJson: async () => ({ Code: 403 }), wait: async () => {}, isCurrent: () => true });
  assert.equal(rejected.at(-1).phase, 'blocked');
  assert.equal(rejected.some(item => item.kind === 'main' || item.kind === 'other'), false);
});
