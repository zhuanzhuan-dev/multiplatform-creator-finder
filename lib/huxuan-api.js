export const HUXUAN_SEARCH_PATH = '/cgi-bin/advertiser/finder_publisher/search';
export const HUXUAN_CHANNEL = 'DRA_HUXUAN_API';
export const huxuanId = value => typeof value === 'string' && /^sph[A-Za-z0-9_-]{3,125}$/.test(value) ? value : '';
const text = value => typeof value === 'string' ? value.trim().slice(0, 500) : '';
const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
function media(value) { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; } }

export function huxuanContext(input) {
  try {
    const url = new URL(input);
    const accountId = /^\/trade\/selection\/(\d+)\/selection_list\/?$/.exec(url.pathname)?.[1];
    return url.origin === 'https://huxuan.qq.com' && accountId && url.searchParams.get('type') === 'finder-trade' ? { accountId, pageUrl: url.origin + url.pathname + '?type=finder-trade' } : null;
  } catch { return null; }
}
export function huxuanQueryKey(body, accountId) {
  const { page, ...query } = body;
  return JSON.stringify([accountId, {...query,pageSize:page?.size}]);
}
export function projectHuxuanResponse(payload, {pageNumber, pageSize, accountId, pageUrl}) {
  if (payload?.ret !== 0 || payload?.data?.ret || payload?.data?.code) throw Error(`互选接口：${text(payload?.msg || payload?.data?.msg) || '返回失败'}（${payload?.ret ?? '未知'}）`);
  const items = payload.data?.item;
  if (!Array.isArray(items) || items.length > 100) throw Error('互选列表响应缺少作者数组');
  const rows = items.map(item => {
    const authorId = huxuanId(item.appid);
    if (!authorId || !text(item.nickname)) return null;
    const price = value => { const n = number(value); return n === null ? null : n / 100; };
    return {
      authorId, authorName: text(item.nickname), avatarUrl: media(item.avatar),
      profileUrl: `https://huxuan.qq.com/trade/selection/${accountId}/finder_trade_detail?id=${encodeURIComponent(authorId)}`,
      followerCount: text(item.fans_num_level), city: text(item.city_label), synopsis: text(item.synopsis),
      tags: [item.category_level1, item.category_level2, item.auth_profession].filter(x => typeof x === 'string' && x.trim()).map(text),
      shortPrice: price(item.short_video_price), longPrice: price(item.long_video_price),
      metrics: { averagePlays: text(item.avg_read_count), medianPlays: text(item.median_read_count), averageInteractions: text(item.avg_interaction_count), interactionRate: number(item.interaction_rate), completionRate: number(item.play_finish_rate), expectedCpm: number(item.expected_cpm), expectedCpe: number(item.expected_cpe) },
      pageUrl
    };
  }).filter(Boolean);
  if (items.length && !rows.length) throw Error('互选列表缺少稳定作者 ID，已暂停采集');
  const total = number(payload.data.total_num);
  return { rows, pageNumber, pageUrl, capturedAt: new Date().toISOString(), total,
    missingIdentityCount: items.length - rows.length,
    last: items.length < pageSize || total !== null && pageNumber * pageSize >= total,
    fingerprint: JSON.stringify([pageNumber, rows.map(row => row.authorId)]) };
}
