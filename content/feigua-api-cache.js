import { createFeiguaApiCache } from '../lib/feigua-api.js';

const CHANNEL = 'DRA_FEIGUA_API_IDENTITY';
const cache = createFeiguaApiCache();
let identity = { key: '', phase: 'idle', pending: 0, error: '' };

export function installFeiguaApiCache() {
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== CHANNEL || event.data?.direction !== 'response') return;
    if (event.data.result?.kind === 'identity-status') {
      if (event.data.result.key !== identity.key) return;
      identity = { ...identity, ...event.data.result };
    } else cache.receive(event.data.result);
    document.dispatchEvent(new Event('dra-feigua-api-update'));
  });
  window.postMessage({ channel: CHANNEL, direction: 'request' }, location.origin);
}

export function enrichFeiguaRow(row) { return cache.enrich(row); }

export function cancelFeiguaIdentities() {
  identity = { key: '', phase: 'idle', pending: 0, error: '' };
  window.postMessage({ channel: CHANNEL, direction: 'cancel' }, location.origin);
}

export function requestFeiguaIdentities(rows) {
  const bloggerIds = [...new Set((rows || []).map(row => row.bloggerId).filter(id => /^\d{1,30}$/.test(String(id))))].sort();
  if (!bloggerIds.length) return { phase: 'done', pending: 0, error: '' };
  const key = bloggerIds.join(',');
  if (identity.key !== key) {
    identity = { key, phase: 'loading', pending: bloggerIds.length, error: '' };
    window.postMessage({ channel: CHANNEL, direction: 'enrich', key, bloggerIds }, location.origin);
  }
  return identity;
}
