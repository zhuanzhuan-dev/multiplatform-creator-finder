import { projectXingtuResponse } from '../lib/xingtu-api.js';

(function installXingtuApiBridge() {
  const CHANNEL = 'DRA_XINGTU_MARKET_API';
  const originalOpen = XMLHttpRequest.prototype.open;
  let latest = null;
  let requestSequence = 0;
  const send = result => window.postMessage({ channel: CHANNEL, direction: 'response', result }, location.origin);

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const requestUrl = String(url || '');
    if (/\/gw\/api\/gsearch\/search_for_author_square(?:\?|$)/.test(requestUrl)) {
      const sequence = ++requestSequence;
      latest = null;
      window.postMessage({ channel: CHANNEL, direction: 'loading' }, location.origin);
      this.addEventListener('load', function () {
        try {
          const payload = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
          const update = projectXingtuResponse(requestUrl, payload);
          if (update && sequence === requestSequence) { latest = update; send(update); }
        } catch { /* An unreadable response must not create an observation. */ }
      }, { once: true });
    }
    return originalOpen.call(this, method, url, ...rest);
  };

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== CHANNEL || event.data?.direction !== 'request') return;
    if (latest) send(latest);
  });
})();
