export const HUXUAN_SEARCH_PATH = '/cgi-bin/advertiser/finder_publisher/search';
export const HUXUAN_CHANNEL = 'DRA_HUXUAN_API';
export const huxuanId = value => typeof value === 'string' && /^sph[A-Za-z0-9_-]{3,125}$/.test(value) ? value : '';
const text = value => typeof value === 'string' ? value.trim().slice(0, 500) : '';
const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
function media(value) { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; } }

// Business fields (including the creator's cooperation contacts) stay intact.
// Authentication and request tracking only belong to the live page session.
const sessionFields = new Set(['access_token','refresh_token','token','r0_token','session_id','authorization','cookie','cookies','set-cookie','password','service_role','secret','view_id','trace_id']);
export function huxuanBusinessData(value) {
  if (Array.isArray(value)) return value.map(huxuanBusinessData);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !sessionFields.has(key.toLowerCase())).map(([key, child]) => [key, huxuanBusinessData(child)]));
}

export function assertHuxuanSuccess(payload) {
  if (payload?.ret !== 0 || payload?.data?.ret || payload?.data?.code) {
    const error = Error(`互选接口：${text(payload?.msg || payload?.data?.msg) || '返回失败'}（${payload?.ret || payload?.data?.ret || payload?.data?.code || '未知'}）`);
    error.unavailable = /无权限|权限不足|未开通|无权访问|没有权限/.test(error.message);
    throw error;
  }
}

export const HUXUAN_PROFILE_DATASETS = ['detail','persona','score','insight','recommendations','near:0','near:3','near:1'];
export function huxuanDateRange(now = new Date()) {
  const format = date => `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`;
  const begin = new Date(now); begin.setDate(begin.getDate()-180);
  return {beginDate:format(begin),endDate:format(now)};
}

export function huxuanProfileRequest(authorId, dataset, {pageIndex = 0, beginDate, endDate} = {}) {
  if (!huxuanId(authorId)) throw Error('互选达人身份无效');
  const base = '/cgi-bin/advertiser/finder_publisher/';
  if (dataset === 'detail') return {path:base+'detail',params:{appid:authorId,inner_from:'selection_list'}};
  if (dataset === 'persona') return {path:'/cgi-bin/advertiser/ai_search/batch_get_publisher_persona',body:{flow_type:2,appid_list:[authorId]}};
  if (dataset === 'score') return {path:'/cgi-bin/proxy/get_finder_publisher_score',params:{appid:authorId}};
  if (dataset === 'insight') return {path:base+'crystal_insight_detail',body:{appid:authorId}};
  if (dataset === 'recommendations') return {path:HUXUAN_SEARCH_PATH,body:{excluded_appid:authorId,excluded_default:1,page:{no:1,size:30},keyword:`item_recommend:${authorId}`,platform:1}};
  if (/^near:[013]$/.test(dataset)) return {path:base+'near_videos',params:{appid:authorId,video_type:Number(dataset.split(':')[1]),version:2}};
  if (/^videos:[01]$/.test(dataset) && Number.isInteger(pageIndex) && pageIndex >= 0 && /^\d{8}$/.test(beginDate) && /^\d{8}$/.test(endDate) && beginDate <= endDate) {
    return {path:base+'get_finder_video_show',params:{appid:authorId,show_type:0,video_type:Number(dataset.split(':')[1]),begin_date:beginDate,end_date:endDate,page_index:pageIndex,version:2}};
  }
  throw Error('互选主页采集栏目或分页参数无效');
}

export function huxuanContext(input) {
  try {
    const url = new URL(input);
    const accountId = /^\/trade\/selection\/(\d+)\/selection_list\/?$/.exec(url.pathname)?.[1];
    return url.origin === 'https://huxuan.qq.com' && accountId && url.searchParams.get('type') === 'finder-trade' ? { accountId, pageUrl: url.origin + url.pathname + '?type=finder-trade' } : null;
  } catch { return null; }
}
export function huxuanQueryKey(body, accountId) {
  const { page, ...query } = body;
  return JSON.stringify([accountId, {...huxuanBusinessData(query),pageSize:page?.size}]);
}
export function projectHuxuanResponse(payload, {pageNumber, pageSize, accountId, pageUrl}) {
  assertHuxuanSuccess(payload);
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
      pageUrl, listFields:huxuanBusinessData(item)
    };
  }).filter(Boolean);
  if (items.length && !rows.length) throw Error('互选列表缺少稳定作者 ID，已暂停采集');
  const total = number(payload.data.total_num);
  return { rows, pageNumber, pageUrl, capturedAt: new Date().toISOString(), total,
    missingIdentityCount: items.length - rows.length,
    last: items.length < pageSize || total !== null && pageNumber * pageSize >= total,
    fingerprint: JSON.stringify([pageNumber, rows.map(row => row.authorId)]) };
}
