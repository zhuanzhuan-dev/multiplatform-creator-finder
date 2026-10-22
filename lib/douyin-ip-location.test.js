import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { createDouyinIpLocationReader, readDouyinIpLocation } from './douyin-ip-location.js';
import { normalizeDouyinObservation, saveObservations, exportObservations } from './observations.js';
import { buildObservationRecord } from './cloud.js';

const secUid = 'MS4wLjABAAAAcreator';
const href = `https://www.douyin.com/user/${secUid}`;
const at = '2026-10-20T06:40:00.000Z';
function documentFor(user = {}, profileUrl = href) {
  const chunk = `7:${JSON.stringify(['$', '$L9', null, { user: { user: { secUid, city: '重庆', district: '江北', ...user } } }])}\n`;
  return { location: { href: profileUrl }, scripts: [
    { textContent: 'self.__pace_f.push([1,"unrelated"])' },
    { textContent: `self.__pace_f.push(${JSON.stringify([1, chunk])})` },
  ] };
}

test('platform IP is independent of editable city and retains source and observation time', () => {
  const ip = readDouyinIpLocation(documentFor({ ipLocation: 'IP属地：上海' }), secUid, at);
  assert.deepEqual(ip, { ipLocation: '上海', ipLocationText: 'IP属地：上海', ipLocationStatus: 'available',
    ipLocationSource: 'douyin_profile', ipLocationCapturedAt: at, ipLocationProfileUrl: href });
});

test('missing IP stays unknown; another account or redirect never supplies a fact', () => {
  for (const ipLocation of [undefined, '', 'IP属地：']) {
    const ip = readDouyinIpLocation(documentFor({ ipLocation, desc: 'IP属地：广东' }), secUid, at);
    assert.equal(ip.ipLocation, null);
    assert.equal(ip.ipLocationStatus, 'missing');
  }
  for (const doc of [documentFor({ secUid: 'MS4wOther', ipLocation: 'IP属地：广东' }),
    documentFor({ ipLocation: 'IP属地：广东' }, 'https://www.douyin.com/user/MS4wOther'),
    documentFor({ ipLocation: 'IP属地：广东' }, 'https://example.com/user/MS4wLjABAAAAcreator')]) {
    assert.equal(readDouyinIpLocation(doc, secUid, at).ipLocationStatus, 'identity_mismatch');
    assert.equal(readDouyinIpLocation(doc, secUid, at).ipLocation, null);
  }
  assert.equal(readDouyinIpLocation({ location: { href }, scripts: [] }, secUid).ipLocationStatus, 'loading');
});

function readerFixture({ wait = async () => {}, response, sendError } = {}) {
  const created = [], removed = [], messages = [];
  const ip = readDouyinIpLocation(documentFor({ ipLocation: 'IP属地：上海' }), secUid, at);
  const reader = createDouyinIpLocationReader({ waitForTab: wait, sleep: async () => {}, tabs: () => ({
    create: async options => { created.push(options); return { id: 42 }; },
    remove: async id => { removed.push(id); },
    sendMessage: async (_id, message) => {
      messages.push(message);
      if (sendError) throw sendError;
      return response || { ok: true, ipLocation: ip };
    },
  }) });
  return { created, removed, messages, read: extra => reader({ profileUrl: href, secUid,
    windowId: 1, runKey: 'run:loop', isCurrent: () => true, ...extra }) };
}

test('inactive profile tab closes and confirmed facts are reused within the run', async () => {
  const f = readerFixture();
  assert.equal((await f.read()).ipLocation, '上海');
  assert.equal((await f.read()).ipLocation, '上海');
  assert.deepEqual(f.created, [{ windowId: 1, url: href, active: false }]);
  assert.deepEqual(f.removed, [42]);
  assert.deepEqual(f.messages, [{ type: 'DRA_DOUYIN_IP_READ', secUid }]);
  await f.read({ runKey: 'next:loop' });
  assert.equal(f.created.length, 2);
});

test('navigation/read failure and pause remain optional results and always close the tab', async () => {
  for (const config of [{ wait: async () => { throw Error('load timeout'); } },
    { sendError: Error('content disconnected') }, { response: { ok: true, ipLocation: { ipLocationStatus: 'loading' } } }]) {
    const f = readerFixture(config);
    assert.equal((await f.read()).ipLocationStatus, 'failed');
    assert.deepEqual(f.removed, [42]);
  }
  let current = true;
  const f = readerFixture({ wait: async () => { current = false; } });
  assert.equal((await f.read({ isCurrent: () => current })).ipLocationStatus, 'cancelled');
  assert.equal(f.messages.length, 0);
  assert.deepEqual(f.removed, [42]);
});

test('local durable observation and upload both retain the same IP fact', async () => {
  globalThis.chrome = { storage: { local: { get: async () => ({}), remove: async () => {} } } };
  const profile = { ready: true, authorName: 'Troy', secUid, profileUrl: href,
    ...readDouyinIpLocation(documentFor({ ipLocation: 'IP属地：上海' }), secUid, at) };
  const observation = { videoId: 'ip-test-video', authorName: 'Troy', profileUrl: href };
  await saveObservations([normalizeDouyinObservation(observation, profile, 'ip-test-run')]);
  const stored = (await exportObservations()).find(v => v.sessionId === 'ip-test-run');
  assert.equal(stored.raw.profile.ipLocation, '上海');
  const record = buildObservationRecord({ observation: stored.raw, profile: stored.raw.profile });
  assert.equal(record.rpa_feedback.ip_location, '上海');
  assert.equal(record.rpa_feedback.ip_location_profile_url, href);
  assert.equal(record.rpa_feedback.no_profile_navigation, false);
});
