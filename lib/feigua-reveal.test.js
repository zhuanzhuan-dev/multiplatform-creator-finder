import test from 'node:test';
import assert from 'node:assert/strict';
import { revealList } from '../content/feigua-page.js';

function fakeList(scrollHeight = 2000, clientHeight = 400, scrollTop = 0) {
  const row = { className: 'list-row', parentElement: null, scrollIntoView() { this.seen = true; } };
  const list = {
    className: 'list-content',
    scrollHeight,
    clientHeight,
    scrollTop,
    parentElement: null,
    querySelector(selector) { return selector === '.list-row' ? row : null; },
    querySelectorAll(selector) {
      if (selector === '.list-row') return [row];
      if (selector.includes('list-content')) return [list];
      return [];
    }
  };
  row.parentElement = list;
  return { row, list };
}

test('revealList scrolls the overflow list to the bottom and brings the last row into view', () => {
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ overflowY: 'auto', overflow: 'auto' });
  try {
    const { row, list } = fakeList();
    const result = revealList({
      body: list,
      documentElement: list,
      querySelector: (selector) => list.querySelector(selector),
      querySelectorAll: (selector) => list.querySelectorAll(selector)
    });
    assert.equal(list.scrollTop, 1600);
    assert.equal(result.atEnd, true);
    assert.equal(result.scrolled, true);
    assert.equal(row.seen, true);
  } finally {
    globalThis.getComputedStyle = previous;
  }
});

test('revealList no-ops when document APIs are missing', () => {
  assert.deepEqual(revealList(null), { scrolled: false, atEnd: true, count: 0 });
});
