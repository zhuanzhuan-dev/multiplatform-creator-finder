import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { structuredFeedIdentity } from './structured-feed-identity.js';
const samples = JSON.parse(readFileSync(new URL('./fixtures/feed-content-types.json', import.meta.url)));
function card(sample, depth = 6) {
  const marker = { getAttribute: () => 'feed-live', closest: () => null, getBoundingClientRect: () => ({ width: 300, height: 500 }) };
  let fiber = { memoizedProps: { isActive: true, item: sample.item } };
  for (let i = 0; i < depth; i++) fiber = { memoizedProps: {}, return: fiber };
  return { __reactFiber$test: fiber, getAttribute: name => name === 'data-e2e-vid' ? sample.domId : '',
    querySelector: () => null, querySelectorAll: selector => selector === '[data-e2e="feed-live"]' && sample.liveMarker ? [marker] : [] };
}
test('all captured recommendation snapshots retain their verified content type', () => {
  assert.ok(samples.length >= 760);
  for (const sample of samples) assert.equal(structuredFeedIdentity(card(sample)).contentType, sample.expected, sample.item.awemeId);
});
test('unknown, stale, inactive and conflicting items stay pending', () => {
  const sample = samples.find(s => s.expected === 'video');
  for (const changed of [
    { ...sample, domId: 'different' },
    { ...sample, item: { ...sample.item, awemeType: 999 } },
    { ...sample, item: { ...sample.item, mediaType: null } },
    { ...sample, liveMarker: true },
    { ...sample, domId: '' },
  ]) assert.equal(structuredFeedIdentity(card(changed)).contentType, 'unknown');
  const inactive = card(sample, 0);
  inactive.__reactFiber$test.memoizedProps.isActive = false;
  inactive.__reactFiber$test.return = card(sample, 0).__reactFiber$test;
  assert.equal(structuredFeedIdentity(inactive).contentType, 'unknown');
  assert.equal(structuredFeedIdentity(card(sample, 18)).contentType, 'unknown');
});
test('live requires both the current room identity and its visible content marker', () => {
  const sample = samples.find(s => s.expected === 'live');
  for (const changed of [
    { ...sample, liveMarker: false },
    { ...sample, item: { ...sample.item, cellRoom: { rawdata: { id_str: 'different' } } } },
  ]) assert.equal(structuredFeedIdentity(card(changed)).contentType, 'unknown');
});
