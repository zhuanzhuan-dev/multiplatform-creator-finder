const MARKET_API = '/gw/api/gsearch/search_for_author_square';
const digits = value => /^\d{1,30}$/.test(String(value || '')) ? String(value) : '';
const text = value => String(value ?? '').trim().slice(0, 160);

function tags(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? [...new Set(parsed.filter(item => typeof item === 'string').map(text).filter(Boolean))].slice(0, 20) : [];
  } catch { return []; }
}

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function percent(value) {
  const result = number(value);
  return result === null || result > 1 ? '' : `${(result * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

function avatar(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function projectXingtuResponse(requestUrl, payload) {
  let url;
  try { url = new URL(requestUrl, 'https://www.xingtu.cn'); } catch { return null; }
  if (url.protocol !== 'https:' || !['www.xingtu.cn', 'xingtu.cn'].includes(url.hostname) || url.pathname !== MARKET_API) return null;
  const page = Number(payload?.pagination?.page);
  if (!Number.isSafeInteger(page) || page < 1 || page > 500) return null;
  if (payload?.base_resp?.status_code !== 0) return { kind: 'error', page, message: text(payload?.base_resp?.status_message) || '星图列表接口返回错误' };
  if (!Array.isArray(payload.authors) || payload.authors.length > 40) return null;
  const projected = payload.authors.map(author => {
    const fields = author?.attribute_datas || {};
    const xingtuId = digits(author?.star_id);
    if (!xingtuId || fields.id && digits(fields.id) !== xingtuId || !text(fields.nick_name)) return null;
    const prices = {};
    if (number(fields.price_20_60) !== null) prices['21-60s'] = text(fields.price_20_60);
    if (number(fields.price_60) !== null) prices['60s+'] = text(fields.price_60);
    const metrics = {};
    if (number(fields.prospective_20_60_cpm) !== null) metrics['预期CPM'] = text(fields.prospective_20_60_cpm);
    if (number(fields.expected_play_num) !== null) metrics['预期播放量'] = text(fields.expected_play_num);
    if (percent(fields.interact_rate_within_30d)) metrics['互动率'] = percent(fields.interact_rate_within_30d);
    if (percent(fields.play_over_rate_within_30d)) metrics['完播率'] = percent(fields.play_over_rate_within_30d);
    const name = text(fields.nick_name);
    const labels = tags(fields.content_theme_labels_180d);
    return {
      authorName: name, xingtuId, profileUrl: '',
      followerCount: number(fields.follower) === null ? '' : text(fields.follower),
      avatarUrl: avatar(fields.avatar_uri), city: text(fields.city),
      gender: fields.gender === '1' ? '男' : fields.gender === '2' ? '女' : '',
      tags: labels, prices, metrics,
      xingtuIndex: number(fields.star_index) === null ? '' : text(fields.star_index),
      rawText: name, searchText: [name, ...labels].join(' ')
    };
  });
  const rows = projected.filter(Boolean);
  if (!rows.length) return null;
  return { kind: 'list', page, rows, missingIdentityCount: projected.length - rows.length, last: payload.pagination.has_more === false };
}
