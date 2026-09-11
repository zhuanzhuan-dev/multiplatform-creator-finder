import test from 'node:test';
import assert from 'node:assert/strict';
import './douyin-page-parser.js';
import { contentSkipDecision } from './content-type.js';

const identify = globalThis.DouyinAutoFinderParser.feedContentIdentity;
function node({ tag = 'DIV', marker = '', text = '', hidden = false, caption = false, duration = NaN } = {}) {
  return {
    tagName: tag, textContent: text, duration, children: [],
    getAttribute: (name) => name === 'data-e2e' ? marker : null,
    getBoundingClientRect: () => ({ width: 300, height: 300 }),
    closest: (selector) => selector.includes('[hidden]') ? (hidden ? {} : null) : caption ? {} : null,
  };
}
function card(children) {
  return { ...node(), querySelectorAll: (selector) => selector === 'span' ? [] : children };
}

test('video remains eligible after native player metadata or dedicated marker disappears', () => {
  for (const children of [
    [node({ tag: 'VIDEO', duration: 120 })],
    [node({ tag: 'VIDEO' })],
    [node({ text: '00:07 / 31:10' })],
    [node({ tag: 'VIDEO', hidden: true }), node({ text: '00:06 / 12:39' })],
  ]) {
    const result = identify(card(children));
    assert.equal(result.contentType, 'video');
    assert.equal(contentSkipDecision(result), null);
  }
});

test('explicit live and photo signals still take precedence over a playback clock', () => {
  for (const [marker, expected] of [['feed-live', 'live'], ['feed-photo', 'photo']]) {
    assert.equal(identify(card([node({ marker }), node({ text: '00:07 / 31:10' })])).contentType, expected);
  }
});

test('recommendation cards default to video without player signals', () => {
  for (const children of [[], [node({ text: '00:07 / 31:10', caption: true })], [node({ tag: 'VIDEO', hidden: true })]]) {
    const result = identify(card(children));
    assert.equal(result.contentType, 'video');
    assert.ok(result.typeEvidence.includes('recommendation card defaults to video'));
    assert.equal(contentSkipDecision(result), null);
  }
});

test('default video does not bypass explicit ads', () => {
  const result = identify(card([node({ marker: 'feed-ad' })]));
  assert.equal(result.contentType, 'video');
  assert.equal(contentSkipDecision(result).code, 'AD_SKIPPED');
});
