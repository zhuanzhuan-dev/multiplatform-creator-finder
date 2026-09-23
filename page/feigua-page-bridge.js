import { projectFeiguaResponse } from '../lib/feigua-api.js';
import { feiguaSignedDetailLink, runFeiguaDetailRequests } from '../lib/feigua-request.js';

(function installFeiguaApiBridge() {
  const CHANNEL = 'DRA_FEIGUA_API_IDENTITY';
  const originalOpen = XMLHttpRequest.prototype.open;
  const updates = new Map();
  let requestSequence = 0;
  const send = result => window.postMessage({ channel: CHANNEL, direction: 'response', result }, location.origin);

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const requestUrl = String(url || '');
    if (/\/api\/v1\/(?:aweme\/search\/list|bloggerdetailoverview\/detail\/(?:mainpart|otherpart))(?:\?|$)/.test(requestUrl)) {
      this.addEventListener('load', function () {
        try {
          const payload = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
          const update = projectFeiguaResponse(requestUrl, payload);
          if (!update) return;
          updates.set(update.kind, update);
          send(update);
        } catch { /* The page can show an error or a non-JSON response. */ }
      }, { once: true });
    }
    return originalOpen.call(this, method, url, ...rest);
  };

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== CHANNEL) return;
    if (event.data?.direction === 'request') {
      for (const update of updates.values()) send(update);
      return;
    }
    if (event.data?.direction === 'cancel') { requestSequence += 1; return; }
    if (event.data?.direction !== 'enrich' || !location.hash.startsWith('#/video/library/all')) return;
    const { key, bloggerIds } = event.data;
    if (!Array.isArray(bloggerIds) || typeof key !== 'string' || key !== [...new Set(bloggerIds)].sort().join(',')) return;
    const hash = location.hash;
    const sequence = ++requestSequence;
    const currentIds = () => [...new Set([...document.querySelectorAll('.list-row .blogger-name[href]')]
      .map(link => feiguaSignedDetailLink(link.href)?.bloggerId).filter(Boolean))].sort().join(',');
    const pageIds = currentIds();
    const isCurrent = () => sequence === requestSequence && location.hash === hash && currentIds() === pageIds;
    const links = [...document.querySelectorAll('.list-row .blogger-name[href]')].map(link => link.href);
    void runFeiguaDetailRequests({
      links, bloggerIds,
      isCurrent,
      emit: update => send(update.kind === 'identity-status' ? { ...update, key } : update),
      wait: () => new Promise(resolve => setTimeout(resolve, 350)),
      fetchJson: async url => {
        const response = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw Error(`飞瓜详情接口 HTTP ${response.status}，身份补数已暂停`);
        return response.json();
      }
    });
  });
  window.addEventListener('hashchange', () => { requestSequence += 1; });
})();
