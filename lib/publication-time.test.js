import test from 'node:test';
import assert from 'node:assert/strict';
import './douyin-page-parser.js';
import { buildObservationRecord, buildIngestBody, encodeIngestBody } from './cloud.js';
const parse = globalThis.DouyinAutoFinderParser.publicationTimeFromText;
const observedAt = '2026-09-08T04:00:00.000Z';

test('publication relative times preserve text and explicitly mark estimated precision', () => {
  for (const [text, expected, precision] of [
    ['· 9小时前', '2026-09-07T19:00:00.000Z', 'hour'],
    ['· 30分钟前', '2026-09-08T03:30:00.000Z', 'minute'],
    ['10秒前', '2026-09-08T03:59:50.000Z', 'second'],
    ['2天前', '2026-09-06T04:00:00.000Z', 'day'],
    ['刚刚', observedAt, 'minute'],
  ]) {
    assert.deepEqual(parse(text, observedAt), { publishedAt: expected, publishedTimeText: text, publishedTimePrecision: precision, publishedTimeEstimated: true });
  }
});

test('explicit publication dates use China time and preserve their actual precision', () => {
  for (const [text, expected, precision, estimated] of [
    ['2026-09-07', '2026-09-06T16:00:00.000Z', 'day', true],
    ['2026-09-08 09:15', '2026-09-08T01:15:00.000Z', 'minute', true],
    ['2026-09-08 09:15:36', '2026-09-08T01:15:36.000Z', 'second', false],
  ]) {
    assert.deepEqual(parse(text, observedAt), { publishedAt: expected, publishedTimeText: text, publishedTimePrecision: precision, publishedTimeEstimated: estimated });
  }
});

test('missing, ambiguous, invalid and future publication dates stay unknown', () => {
  for (const text of ['', '昨天', '09-07', '1个月前', '2026-02-30', '2026-13-01', '2026-09-08 25:00', '2026-09-09', '评论 · 9小时前', '999999999999999天前']) {
    assert.equal(parse(text, observedAt).publishedAt, null, text);
    assert.equal(parse(text, observedAt).publishedTimeEstimated, null, text);
    assert.equal(parse(text, observedAt).publishedTimeText, text);
  }
  assert.equal(parse('9小时前', 'invalid').publishedAt, null);
});

test('publication metadata reaches the serialized upload without replacing observation time', () => {
  const record = buildObservationRecord({ observation: { ...parse('· 9小时前', observedAt), observedAt, publishedTimeSource: 'dom:.video-create-time .time' } });
  const encoded = JSON.parse(encodeIngestBody(buildIngestBody({ sessionId: 'test', startedAt: observedAt, records: [record] })));
  const result = encoded.records[0];
  assert.equal(result.observed_at, observedAt);
  assert.equal(result.rpa_feedback.published_at, '2026-09-07T19:00:00.000Z');
  assert.equal(result.rpa_feedback.published_time_text, '· 9小时前');
  assert.equal(result.rpa_feedback.published_time_estimated, true);
  assert.equal(result.rpa_feedback.published_time_precision, 'hour');
  assert.equal(result.rpa_feedback.published_time_source, 'dom:.video-create-time .time');
  const missing = buildObservationRecord({}).rpa_feedback;
  assert.equal(missing.published_at, null);
  assert.equal(missing.published_time_estimated, null);
});
