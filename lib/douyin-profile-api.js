const PROFILE_PATH = '/aweme/v1/web/user/profile/other/';
const PROFILE_ORIGINS = new Set(['https://www.douyin.com', 'https://www-hj.douyin.com']);

export function profileRequestIdentity(url, method = 'GET') {
  try {
    const parsed = new URL(url, 'https://www.douyin.com');
    const secUid = parsed.searchParams.get('sec_user_id');
    return method.toUpperCase() === 'GET' && PROFILE_ORIGINS.has(parsed.origin)
      && parsed.pathname === PROFILE_PATH && /^MS4w[\w-]+$/.test(secUid || '') ? secUid : null;
  } catch { return null; }
}

export function profileIpFact(secUid, payload, capturedAt = new Date().toISOString()) {
  const user = payload?.user;
  if (payload?.status_code !== 0 || !secUid || user?.sec_uid !== secUid) return null;
  const text = typeof user.ip_location === 'string' ? user.ip_location.trim() : '';
  const ipLocation = text.replace(/^IP\s*属地\s*[:：]\s*/i, '').trim();
  return { secUid, ipLocation: ipLocation || null, ipLocationText: text || null,
    ipLocationStatus: ipLocation ? 'available' : 'missing', ipLocationSource: 'douyin_profile_api',
    ipLocationCapturedAt: capturedAt, ipLocationProfileUrl: `https://www.douyin.com/user/${secUid}` };
}

/** Observe requests the site already makes; never issue a profile request ourselves. */
export function installProfileIpCapture(host) {
  const facts = new Map();
  let sequence = 0;
  const remember = (secUid, payload, order) => {
    const fact = profileIpFact(secUid, payload);
    if (!fact || (facts.get(secUid)?.order || 0) > order) return;
    facts.delete(secUid);
    facts.set(secUid, { order, fact });
    if (facts.size > 100) facts.delete(facts.keys().next().value);
  };
  const originalFetch = host.fetch;
  host.fetch = function (input, init) {
    const secUid = profileRequestIdentity(typeof input === 'string' || input instanceof URL ? String(input) : input?.url,
      init?.method || input?.method || 'GET');
    const order = ++sequence;
    const promise = originalFetch.apply(this, arguments);
    if (secUid) void promise.then(response => {
      if (response.ok) return response.clone().json().then(payload => remember(secUid, payload, order));
    }).catch(() => {});
    return promise;
  };
  const originalOpen = host.XMLHttpRequest.prototype.open;
  host.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const secUid = profileRequestIdentity(String(url), String(method));
    const order = ++sequence;
    if (secUid) this.addEventListener('load', function () {
      try {
        if (this.status >= 200 && this.status < 300) remember(secUid,
          this.responseType === 'json' ? this.response : JSON.parse(this.responseText), order);
      } catch { /* Invalid or cancelled responses cannot supply an IP fact. */ }
    }, { once: true });
    return originalOpen.call(this, method, url, ...rest);
  };
  return secUid => facts.get(secUid)?.fact || null;
}
