import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalFeiguaPageUrl, createFeiguaApiCache, projectFeiguaResponse } from './feigua-api.js';
import { feiguaRecord, mergeFeiguaPage, newFeiguaCollection } from './feigua-collection.js';
import { normalizeFeiguaObservation, observationRecord } from './observations.js';

const base = 'https://dy.feigua.cn';
const listUrl = `${base}/api/v1/aweme/search/list?pageIndex=1`;
const mainUrl = `${base}/api/v1/bloggerdetailoverview/detail/mainpart?id=22790952`;
const otherUrl = `${base}/api/v1/bloggerdetailoverview/detail/otherpart?id=22790952`;
const feiguaUrl = 'https://dy.feigua.cn/app/#/blogger-detail/index?bloggerId=22790952';
const douyinUrl = 'https://www.douyin.com/user/MS4wLjABAAAA0iiC7yvDVZLfHd67a_BFJuuBwnAanIsQkuW_FnNda8g';
const secUid = 'MS4wLjABAAAA0iiC7yvDVZLfHd67a_BFJuuBwnAanIsQkuW_FnNda8g';

test('projects only identity fields from observed Feigua API responses', () => {
  const list = projectFeiguaResponse(listUrl, { Code: 200, Data: { AwemeList: [
    { AwemeId: '7686164685000306789', BloggerUid: '896801319697438', BloggerDetailUrl: '#/blogger-detail/index?bloggerId=22790952&sign=secret', BloggerNickName: '人如玉' }
  ] } });
  assert.deepEqual(list, { kind: 'list', rows: [{ videoId: '7686164685000306789', bloggerId: '22790952', bloggerUid: '896801319697438' }] });
  const main = projectFeiguaResponse(mainUrl, { Code: 200, Data: { Id: 22790952, Uid: '896801319697438', UniqueId: 'renruyu55711', DouyinBloggerUrl: douyinUrl } });
  const other = projectFeiguaResponse(otherUrl, { Code: 200, Data: { XingTuId: '7017402077525573640', XingTuUrl: 'https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/7017402077525573640' } });
  assert.equal(main.uid, list.rows[0].bloggerUid);
  assert.equal(main.douyinProfileUrl, douyinUrl);
  assert.equal(main.secUid, secUid);
  assert.equal(other.xingtuId, '7017402077525573640');
  assert.equal(JSON.stringify([list, main, other]).includes('secret'), false);
  assert.equal(projectFeiguaResponse('https://other.example/api/v1/aweme/search/list', { Code: 200, Data: {} }), null);
  assert.equal(projectFeiguaResponse(listUrl, { Code: 11001, Data: { AwemeList: [] } }), null);
});

test('page identity URLs remove Feigua signatures and temporary parameters', () => {
  const signed = `${feiguaUrl}&ts=1790162003&sign=secret`;
  assert.equal(canonicalFeiguaPageUrl(signed), feiguaUrl);
  assert.equal(canonicalFeiguaPageUrl('https://dy.feigua.cn/app/#/video-detail/index?awemeId=123&sign=secret'), 'https://dy.feigua.cn/app/#/video-detail/index?awemeId=123');
  assert.equal(canonicalFeiguaPageUrl('https://dy.feigua.cn/app/#/video/library/all?token=secret'), 'https://dy.feigua.cn/app/#/video/library/all');
  assert.equal(canonicalFeiguaPageUrl('https://other.example/app/#/video/library/all'), '');
  const cache = createFeiguaApiCache();
  assert.equal(cache.enrich({ profileUrl: signed }).profileUrl, feiguaUrl);
});

test('list UID and detail identities remain attached to the same blogger, then enter both upload paths', () => {
  const cache = createFeiguaApiCache();
  cache.receive(projectFeiguaResponse(listUrl, { Code: 200, Data: { AwemeList: [
    { AwemeId: '7686164685000306789', BloggerUid: '896801319697438', BloggerDetailUrl: '#/blogger-detail/index?bloggerId=22790952' }
  ] } }));
  const listRow = cache.enrich({ authorName: '人如玉', profileUrl: feiguaUrl, videoId: '7686164685000306789', title: '作品', followerCount: '170.9w', topics: [], hotWords: [] });
  assert.equal(listRow.uid, '');
  assert.equal(listRow.feiguaBloggerUid, '896801319697438');
  const collection = newFeiguaCollection('run', true);
  mergeFeiguaPage(collection, { fingerprint: 'page1', rows: [listRow], pageUrl: listUrl, capturedAt: '2026-09-23T00:00:00Z' }, []);
  const formal = feiguaRecord(collection.accounts['feigua:blogger:22790952'], 'run');
  assert.equal(formal.uid, undefined);
  assert.equal(formal.rpa_feedback.feigua_blogger_id, '22790952');
  assert.equal(formal.rpa_feedback.feigua_blogger_uid, '896801319697438');

  cache.receive(projectFeiguaResponse(mainUrl, { Code: 200, Data: { Id: 22790952, Uid: '896801319697438', UniqueId: 'renruyu55711', DouyinBloggerUrl: douyinUrl } }));
  cache.receive(projectFeiguaResponse(otherUrl, { Code: 200, Data: { XingTuId: '7017402077525573640', XingTuUrl: 'https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/7017402077525573640' } }));
  const detailRow = cache.enrich({ authorName: '人如玉', profileUrl: feiguaUrl });
  assert.equal(detailRow.douyinProfileUrl, douyinUrl);
  assert.equal(detailRow.secUid, secUid);
  assert.equal(detailRow.xingtuId, '7017402077525573640');
  assert.equal(detailRow.uid, '896801319697438');
  const observation = normalizeFeiguaObservation(detailRow, { surface: 'creator', pageUrl: feiguaUrl, capturedAt: '2026-09-23T00:00:00Z' }, 'browse-run', 'browse');
  const browseRecord = observationRecord(observation);
  assert.equal(browseRecord.author_href, douyinUrl);
  assert.equal(browseRecord.sec_uid, secUid);
  assert.equal(browseRecord.uid, '896801319697438');
  assert.equal(browseRecord.xingtu_id, '7017402077525573640');
  assert.equal(browseRecord.rpa_feedback.unique_id, 'renruyu55711');
  assert.equal(browseRecord.rpa_feedback.feigua_detail_uid, '896801319697438');
  assert.equal(feiguaRecord({ ...collection.accounts['feigua:blogger:22790952'], ...detailRow }, 'run').sec_uid, secUid);
});

test('conflicting list and detail UID stays out of the canonical identity', () => {
  const cache = createFeiguaApiCache();
  cache.receive({ kind: 'list', rows: [{ videoId: '123', bloggerId: '42', bloggerUid: '111' }] });
  cache.receive({ kind: 'main', bloggerId: '42', uid: '222', douyinProfileUrl: douyinUrl });
  const row = cache.enrich({ videoId: '123', profileUrl: 'https://dy.feigua.cn/app/#/blogger-detail/index?bloggerId=42' });
  assert.equal(row.uid, '');
  assert.equal(row.feiguaBloggerUid, '111');
  assert.equal(row.feiguaDetailUid, '222');
});
