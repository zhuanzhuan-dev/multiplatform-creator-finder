// Only project identity fields from responses the signed-in Feigua page already loaded.
const LIST = '/api/v1/aweme/search/list';
const MAIN = '/api/v1/bloggerdetailoverview/detail/mainpart';
const OTHER = '/api/v1/bloggerdetailoverview/detail/otherpart';

const digits = value => /^\d+$/.test(String(value || '')) ? String(value) : '';

export function feiguaBloggerId(value) {
  try {
    const url = new URL(String(value || ''), 'https://dy.feigua.cn/app/');
    if (url.hostname !== 'dy.feigua.cn') return '';
    const route = url.hash.split('?');
    if (route[0] !== '#/blogger-detail/index') return '';
    return digits(new URLSearchParams(route[1] || '').get('bloggerId'));
  } catch { return ''; }
}

export function canonicalFeiguaPageUrl(value) {
  try {
    const url = new URL(String(value || ''), 'https://dy.feigua.cn/app/');
    if (url.origin !== 'https://dy.feigua.cn' || url.pathname !== '/app/') return '';
    const [route, query = ''] = url.hash.split('?');
    if (route === '#/video/library/all') return 'https://dy.feigua.cn/app/#/video/library/all';
    const params = new URLSearchParams(query);
    if (route === '#/blogger-detail/index') {
      const id = digits(params.get('bloggerId'));
      return id ? `https://dy.feigua.cn/app/#/blogger-detail/index?bloggerId=${id}` : '';
    }
    if (route === '#/video-detail/index') {
      const id = digits(params.get('awemeId'));
      return id ? `https://dy.feigua.cn/app/#/video-detail/index?awemeId=${id}` : '';
    }
    return '';
  } catch { return ''; }
}

function douyinProfile(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname === 'www.douyin.com' && /^\/user\/MS4w[A-Za-z0-9_-]{8,}\/?$/.test(url.pathname)
      ? `${url.origin}${url.pathname.replace(/\/$/, '')}` : '';
  } catch { return ''; }
}

function douyinSecUid(profileUrl) {
  return douyinProfile(profileUrl).split('/').at(-1) || '';
}

function xingtuProfile(value, id) {
  try {
    const url = new URL(String(value || ''));
    return id && url.protocol === 'https:' && (url.hostname === 'www.xingtu.cn' || url.hostname === 'xingtu.cn') && url.pathname.endsWith(`/${id}`)
      ? `${url.origin}${url.pathname}` : '';
  } catch { return ''; }
}

export function projectFeiguaResponse(requestUrl, payload) {
  let url;
  try { url = new URL(requestUrl, 'https://dy.feigua.cn'); } catch { return null; }
  if (url.origin !== 'https://dy.feigua.cn' || payload?.Code !== 200 || !payload.Data) return null;
  if (url.pathname === LIST && Array.isArray(payload.Data.AwemeList)) {
    return { kind: 'list', rows: payload.Data.AwemeList.map(item => ({
      videoId: digits(item?.AwemeId),
      bloggerId: feiguaBloggerId(item?.BloggerDetailUrl),
      bloggerUid: digits(item?.BloggerUid)
    })).filter(item => item.videoId).slice(0, 100) };
  }
  if (url.pathname === MAIN) {
    const data = payload.Data;
    const bloggerId = digits(data.Id);
    const douyinProfileUrl = douyinProfile(data.DouyinBloggerUrl);
    return bloggerId ? { kind: 'main', bloggerId, uid: digits(data.Uid), uniqueId: String(data.UniqueId || '').trim().slice(0, 100), douyinProfileUrl, secUid: douyinSecUid(douyinProfileUrl) } : null;
  }
  if (url.pathname === OTHER) {
    const bloggerId = digits(url.searchParams.get('id'));
    const xingtuId = digits(payload.Data.XingTuId);
    return bloggerId ? { kind: 'other', bloggerId, xingtuId, xingtuUrl: xingtuProfile(payload.Data.XingTuUrl, xingtuId) } : null;
  }
  return null;
}

export function createFeiguaApiCache() {
  let list = new Map();
  const details = new Map();
  return {
    receive(update) {
      if (update?.kind === 'list' && Array.isArray(update.rows)) {
        list = new Map(update.rows.filter(item => digits(item?.videoId)).map(item => [String(item.videoId), item]));
      } else if ((update?.kind === 'main' || update?.kind === 'other') && digits(update.bloggerId)) {
        const id = String(update.bloggerId);
        details.set(id, { ...details.get(id), ...update });
        if (details.size > 20) details.delete(details.keys().next().value);
      }
    },
    enrich(row) {
      const fromList = list.get(String(row?.videoId || ''));
      const bloggerId = fromList?.bloggerId || digits(row?.bloggerId) || feiguaBloggerId(row?.profileUrl);
      const fromDetail = details.get(bloggerId);
      const bloggerUid = fromList?.bloggerUid || digits(row?.feiguaBloggerUid);
      const detailUid = fromDetail?.uid || digits(row?.feiguaDetailUid);
      const uidAgrees = !bloggerUid || !detailUid || bloggerUid === detailUid;
      return { ...row,
        bloggerId: bloggerId || '',
        profileUrl: bloggerId ? `https://dy.feigua.cn/app/#/blogger-detail/index?bloggerId=${bloggerId}` : '',
        feiguaBloggerUid: bloggerUid || '',
        feiguaDetailUid: detailUid || '',
        uid: uidAgrees && fromDetail?.douyinProfileUrl ? detailUid : '',
        secUid: fromDetail?.secUid || '',
        uniqueId: fromDetail?.uniqueId || row?.uniqueId || '',
        douyinProfileUrl: fromDetail?.douyinProfileUrl || row?.douyinProfileUrl || '',
        xingtuId: fromDetail?.xingtuId || row?.xingtuId || '',
        xingtuUrl: fromDetail?.xingtuUrl || row?.xingtuUrl || ''
      };
    }
  };
}
