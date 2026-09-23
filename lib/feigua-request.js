import { projectFeiguaResponse } from './feigua-api.js';

const ORIGIN = 'https://dy.feigua.cn';
const ROUTE = '#/blogger-detail/index';
const ENDPOINTS = [
  '/api/v1/bloggerdetailoverview/detail/mainpart',
  '/api/v1/bloggerdetailoverview/detail/otherpart'
];

export function feiguaSignedDetailLink(value) {
  try {
    const url = new URL(String(value || ''), `${ORIGIN}/app/`);
    if (url.origin !== ORIGIN || url.pathname !== '/app/') return null;
    const [route, query = ''] = url.hash.split('?');
    if (route !== ROUTE) return null;
    const params = new URLSearchParams(query);
    const bloggerId = params.get('bloggerId') || '';
    const sign = params.get('sign') || '';
    const ts = params.get('ts') || '';
    if (!/^\d{1,30}$/.test(bloggerId) || !/^[0-9a-f]{32,64}$/i.test(sign) || !/^\d{10,13}$/.test(ts)) return null;
    const requestQuery = new URLSearchParams({ id: bloggerId, sign, ts });
    return { bloggerId, urls: ENDPOINTS.map(path => `${ORIGIN}${path}?${requestQuery}`) };
  } catch { return null; }
}

export async function runFeiguaDetailRequests({ links, bloggerIds, fetchJson, emit, wait, isCurrent }) {
  const wanted = new Set((bloggerIds || []).filter(id => /^\d{1,30}$/.test(String(id))).map(String));
  const signed = new Map();
  for (const link of links || []) {
    const request = feiguaSignedDetailLink(link);
    if (request && wanted.has(request.bloggerId)) signed.set(request.bloggerId, request);
  }
  if (!wanted.size) return;
  if (wanted.size > 40 || signed.size !== wanted.size) {
    emit({ kind: 'identity-status', phase: 'blocked', pending: wanted.size - signed.size, error: '当前页飞瓜达人详情链接不完整，身份补数已暂停' });
    return;
  }
  emit({ kind: 'identity-status', phase: 'loading', pending: signed.size });
  let pending = signed.size;
  let lastRequestFinishedAt = 0;
  try {
    for (const request of signed.values()) {
      if (!isCurrent()) return;
      const payloads = await Promise.all(request.urls.map(fetchJson));
      if (!isCurrent()) return;
      const updates = payloads.map((payload, index) => projectFeiguaResponse(request.urls[index], payload));
      if (updates.some(update => !update || update.bloggerId !== request.bloggerId)) throw Error('飞瓜详情身份与列表不一致');
      lastRequestFinishedAt = Date.now();
      updates.forEach(emit);
      pending -= 1;
      emit({ kind: 'identity-status', phase: 'loading', pending });
      if (pending) await wait();
    }
    if (isCurrent()) emit({ kind: 'identity-status', phase: 'done', pending: 0, lastRequestFinishedAt });
  } catch (error) {
    if (isCurrent()) emit({ kind: 'identity-status', phase: 'blocked', pending, error: String(error?.message || error).slice(0, 160) });
  }
}
