import test from 'node:test';
import assert from 'node:assert/strict';
import { installProfileIpCapture, profileIpFact, profileRequestIdentity } from './douyin-profile-api.js';
const uid = 'MS4wLjABAAAAcreator';
const url = `https://www.douyin.com/aweme/v1/web/user/profile/other/?sec_user_id=${uid}`;
const payload = { status_code: 0, user: { sec_uid: uid, ip_location: 'IP属地：上海', city: '重庆' } };
const drain = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const pending = [];
  class Xhr extends EventTarget {
    open(method, url) { this.method = method; this.url = url; }
    finish(body, status = 200) { this.status = status; this.responseText = JSON.stringify(body); this.dispatchEvent(new Event('load')); }
  }
  const host = { XMLHttpRequest: Xhr, fetch: (...args) => new Promise((resolve, reject) => pending.push({args, resolve, reject})) };
  const read = installProfileIpCapture(host);
  return { host, read, pending };
}
const response = body => ({ ok: true, clone: () => ({ json: async () => body }) });

test('only the successful matching platform profile supplies IP, never editable province/city', () => {
  assert.equal(profileRequestIdentity(url), uid);
  assert.equal(profileRequestIdentity(url, 'OPTIONS'), null);
  assert.equal(profileRequestIdentity(url.replace('www.douyin.com','example.com')), null);
  assert.equal(profileIpFact(uid, payload).ipLocation, '上海');
  assert.equal(profileIpFact(uid, { ...payload, user: { sec_uid: uid, city: '重庆' } }).ipLocationStatus, 'missing');
  assert.equal(profileIpFact('MS4wOther', payload), null);
  assert.equal(profileIpFact(uid, { ...payload, status_code: 8 }), null);
});

test('fetch capture preserves the website response and never initiates its own request', async () => {
  const f = fixture();
  assert.equal(f.pending.length, 0);
  const promise = f.host.fetch(url);
  const actual = response(payload);
  f.pending[0].resolve(actual);
  assert.equal(await promise, actual);
  await drain();
  assert.equal(f.read(uid).ipLocation, '上海');
  assert.equal(f.read('MS4wOther'), null);
  assert.equal(f.pending.length, 1);
});

test('the sidebar profile host observed in Chrome supplies IP without an extra request', async () => {
  const sidebarUrl = url.replace('www.douyin.com', 'www-hj.douyin.com');
  assert.equal(profileRequestIdentity(sidebarUrl), uid);
  assert.equal(profileRequestIdentity(sidebarUrl.replace('www-hj.douyin.com', 'www-hj.douyin.com.example.com')), null);
  assert.equal(profileRequestIdentity(sidebarUrl.replace('https:', 'http:')), null);
  const f = fixture();
  const xhr = new f.host.XMLHttpRequest();
  xhr.open('GET', sidebarUrl);
  xhr.finish({...payload,user:{sec_uid:uid,ip_location:'IP属地：北京'}});
  assert.equal(f.read(uid).ipLocation, '北京');
  assert.equal(f.pending.length, 0);
});

test('XHR and Request inputs capture matching IP; malformed and unsuccessful replies remain unknown', async () => {
  const f = fixture();
  const xhr = new f.host.XMLHttpRequest();
  xhr.open('GET', url); xhr.finish(payload);
  assert.equal(f.read(uid).ipLocation, '上海');
  const other = 'MS4wOther';
  const p = f.host.fetch(new Request(url.replace(uid,other)));
  f.pending[0].resolve(response({...payload,user:{sec_uid:other,ip_location:'IP属地：河南'}}));
  await p; await drain();
  assert.equal(f.read(other).ipLocation, '河南');
  xhr.open('GET',url); xhr.finish({...payload,user:{sec_uid:uid,ip_location:'错误'}},500);
  assert.equal(f.read(uid).ipLocation, '上海');
});

test('out-of-order responses cannot replace a newer observation for the same creator', async () => {
  const f = fixture();
  const old = f.host.fetch(url), latest = f.host.fetch(url);
  f.pending[1].resolve(response({...payload,user:{sec_uid:uid,ip_location:'IP属地：北京'}}));
  await latest; await drain();
  f.pending[0].resolve(response(payload));await old;await drain();
  assert.equal(f.read(uid).ipLocation, '北京');
});
