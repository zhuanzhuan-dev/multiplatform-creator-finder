const CHANNEL = 'DRA_XINGTU_MARKET_API';
let latest = null;
let pending = false;

export function installXingtuApiCache() {
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== CHANNEL) return;
    if (event.data.direction === 'loading') { latest = null; pending = true; }
    if (event.data.direction === 'response') {
      const result = event.data.result;
      if (Number.isSafeInteger(result?.page) && result.page >= 1 && (result.kind === 'error' || result.kind === 'list' && Array.isArray(result.rows) && result.rows.every(row => /^\d{1,30}$/.test(row?.xingtuId || '') && row?.authorName))) {
        latest = result;
        pending = false;
      }
    }
    document.dispatchEvent(new Event('dra-xingtu-api-update'));
  });
  window.postMessage({ channel: CHANNEL, direction: 'request' }, location.origin);
}

export function xingtuApiPage(number) {
  return !pending && latest?.kind === 'list' && String(latest.page) === String(number) ? latest : null;
}

export function xingtuApiProblem(number) {
  return !pending && latest?.kind === 'error' && String(latest.page) === String(number) ? latest.message : '';
}
