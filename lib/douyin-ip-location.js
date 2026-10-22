import { withTimeout } from './runtime-health.js';

export function douyinProfileIdentity(href) {
  try {
    const url = new URL(href);
    const match = url.pathname.match(/^\/user\/(MS4w[\w-]+)\/?$/);
    return url.origin === 'https://www.douyin.com' && match
      ? { secUid: match[1], href: `${url.origin}/user/${match[1]}` } : null;
  } catch { return null; }
}

/** Read the account object rendered by Douyin, independently of its editable city. */
export function readDouyinIpLocation(doc = document, expectedSecUid = '', capturedAt = new Date().toISOString()) {
  const identity = douyinProfileIdentity(doc.location?.href);
  const result = (status, extra = {}) => ({ ipLocation: null, ipLocationText: null,
    ipLocationStatus: status, ipLocationSource: 'douyin_profile',
    ipLocationCapturedAt: capturedAt, ipLocationProfileUrl: identity?.href || null, ...extra });
  if (!identity || expectedSecUid && expectedSecUid !== identity.secUid) return result('identity_mismatch');

  for (const script of doc.scripts) {
    const match = (script.textContent || '').trim().match(/^self\.__pace_f\.push\(([\s\S]+)\)\s*;?$/);
    if (!match) continue;
    let chunk;
    try { chunk = JSON.parse(match[1])[1]; } catch { continue; }
    if (typeof chunk !== 'string') continue;
    for (const line of chunk.split('\n')) {
      let payload;
      try { payload = JSON.parse(line.slice(line.indexOf(':') + 1)); } catch { continue; }
      const user = payload?.[3]?.user?.user;
      if (!user || typeof user !== 'object') continue;
      if (user.secUid !== identity.secUid) return result('identity_mismatch');
      const text = typeof user.ipLocation === 'string' ? user.ipLocation.trim() : '';
      const location = text.replace(/^IP\s*属地\s*[:：]\s*/i, '').trim();
      return location ? result('available', { ipLocation: location, ipLocationText: text }) : result('missing');
    }
  }
  return result('loading');
}

/** Reuse the existing inactive-profile-tab pattern; failures are optional facts. */
export function createDouyinIpLocationReader({ waitForTab, tabs = () => chrome.tabs,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let currentRun = '';
  const cache = new Map();
  return async ({ profileUrl, secUid, windowId, runKey, isCurrent }) => {
    const identity = douyinProfileIdentity(profileUrl);
    const result = (status, extra = {}) => ({ ipLocation: null, ipLocationText: null,
      ipLocationStatus: status, ipLocationSource: 'douyin_profile',
      ipLocationCapturedAt: new Date().toISOString(), ipLocationProfileUrl: identity?.href || null, ...extra });
    if (!identity || identity.secUid !== secUid) return result('identity_mismatch');
    if (!isCurrent()) return result('cancelled');
    if (runKey !== currentRun) { currentRun = runKey; cache.clear(); }
    if (cache.has(secUid)) return cache.get(secUid);
    let tab;
    try {
      tab = await tabs().create({ windowId, url: identity.href, active: false });
      // Optional IP collection gets 15s for navigation, then at most 5 short reads.
      await waitForTab(tab.id, 15_000);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (!isCurrent()) return result('cancelled');
        const response = await withTimeout(tabs().sendMessage(tab.id,
          { type: 'DRA_DOUYIN_IP_READ', secUid }), 3_000);
        if (!isCurrent()) return result('cancelled');
        if (!response?.ok) return result('failed', { ipLocationError: response?.error || '主页脚本未返回结果' });
        const ip = response.ipLocation;
        if (ip?.ipLocationStatus === 'available' || ip?.ipLocationStatus === 'missing') {
          if (ip.ipLocationProfileUrl !== identity.href) return result('identity_mismatch');
          cache.set(secUid, ip);
          return ip;
        }
        if (ip?.ipLocationStatus === 'identity_mismatch') return result('identity_mismatch');
        if (attempt < 4) await sleep(500);
      }
      return result('failed', { ipLocationError: '主页资料尚未加载或页面要求验证' });
    } catch (error) {
      return result(isCurrent() ? 'failed' : 'cancelled', { ipLocationError: error.message });
    } finally {
      if (tab) await tabs().remove(tab.id).catch(() => {});
    }
  };
}
