import { encWbi, getWbiKeys } from "./bilibili-wbi.js";

export const BILIBILI_HOME_URL = "https://www.bilibili.com/";
export const BILIBILI_POPULAR_URL = "https://www.bilibili.com/v/popular/all";
export const BILIBILI_PAGE_SIZE = 30;
export const BILIBILI_POPULAR_PAGE_SIZE = 20;

function apiGet(path, params, fetchImpl, referer = BILIBILI_HOME_URL) {
  const query = new URLSearchParams(params).toString();
  return fetchImpl(`https://api.bilibili.com${path}?${query}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      Referer: referer
    }
  });
}

export async function readBilibiliNav(fetchImpl = fetch) {
  const response = await apiGet("/x/web-interface/nav", {}, fetchImpl);
  if (!response.ok) throw new Error(`读取 B 站登录态失败（HTTP ${response.status}）`);
  const json = await response.json();
  if (json?.code !== 0) throw new Error(json?.message || "读取 B 站登录态失败");
  return json.data || {};
}

export async function assertBilibiliLoggedIn(fetchImpl = fetch) {
  const nav = await readBilibiliNav(fetchImpl);
  if (!nav.isLogin) throw new Error("请先在 B 站网页登录，再开始采集");
  return nav;
}

export async function fetchBilibiliRecommend(freshIdx = 1, pageSize = BILIBILI_PAGE_SIZE, fetchImpl = fetch) {
  await getWbiKeys(fetchImpl);
  const params = await encWbi({
    fresh_type: 8,
    fresh_idx_1h: freshIdx,
    fresh_idx: freshIdx,
    ps: pageSize,
    web_location: 1430650,
    feed_version: "V8",
    homepage_ver: 1
  }, fetchImpl);
  const response = await apiGet("/x/web-interface/wbi/index/top/feed/rcmd", params, fetchImpl);
  if (!response.ok) throw new Error(`B 站推荐接口失败（HTTP ${response.status}）`);
  const json = await response.json();
  if (json?.code === -62011) return { items: [], exhausted: true, mid: null };
  if (json?.code !== 0) throw new Error(json?.message || "B 站推荐接口返回错误");
  return { items: Array.isArray(json.data?.item) ? json.data.item : [], exhausted: false, mid: json.data?.mid ?? null };
}

export async function fetchBilibiliPopular(page = 1, pageSize = BILIBILI_POPULAR_PAGE_SIZE, fetchImpl = fetch) {
  const response = await apiGet(
    "/x/web-interface/popular",
    { pn: page, ps: pageSize },
    fetchImpl,
    BILIBILI_POPULAR_URL
  );
  if (!response.ok) throw new Error(`B 站综合热门接口失败（HTTP ${response.status}）`);
  const json = await response.json();
  if (json?.code !== 0) throw new Error(json?.message || "B 站综合热门接口返回错误");
  return {
    items: Array.isArray(json.data?.list) ? json.data.list : [],
    exhausted: json.data?.no_more === true,
    page
  };
}

export async function fetchBilibiliFollowerCount(mid, fetchImpl = fetch) {
  const id = Number(mid);
  if (!Number.isFinite(id) || id <= 0) return null;
  const response = await apiGet("/x/relation/stat", { vmid: id }, fetchImpl);
  if (!response.ok) return null;
  const json = await response.json();
  if (json?.code !== 0) return null;
  const followers = Number(json.data?.follower);
  return Number.isFinite(followers) ? followers : null;
}

function mapOwnerFields(owner, bvid, title, pic, duration, pubdate, stat, extra = {}) {
  const mid = owner?.mid;
  if (!Number.isFinite(Number(mid)) || Number(mid) <= 0 || !bvid) return null;
  const authorId = String(mid);
  const pub = Number(pubdate);
  return {
    sourcePlatform: "bilibili",
    videoId: String(bvid),
    authorId,
    authorName: String(owner?.name || ""),
    avatarUrl: String(owner?.face || ""),
    profileUrl: `https://space.bilibili.com/${authorId}`,
    caption: String(title || ""),
    coverUrl: String(pic || ""),
    durationSeconds: Number.isFinite(Number(duration)) ? Number(duration) : null,
    likes: Number.isFinite(Number(stat?.like)) ? Number(stat.like) : null,
    comments: Number.isFinite(Number(stat?.reply)) ? Number(stat.reply) : null,
    danmaku: Number.isFinite(Number(stat?.danmaku)) ? Number(stat.danmaku) : null,
    favorites: Number.isFinite(Number(stat?.favorite)) ? Number(stat.favorite) : null,
    plays: Number.isFinite(Number(stat?.view)) ? Number(stat.view) : null,
    shares: Number.isFinite(Number(stat?.share)) ? Number(stat.share) : null,
    pubdateSeconds: Number.isFinite(pub) && pub > 0 ? pub : null,
    publishedTimeText: Number.isFinite(pub) && pub > 0 ? new Date(pub * 1000).toISOString() : "",
    beforeUrl: String(extra.uri || `https://www.bilibili.com/video/${bvid}`),
    contentType: "video",
    tname: String(extra.tname || ""),
    tid: Number.isFinite(Number(extra.tid)) ? Number(extra.tid) : null,
    isOgv: extra.isOgv === true,
    feedSurface: extra.feedSurface || "recommend",
    observedAt: extra.observedAt || new Date().toISOString(),
    rcmdReason: extra.rcmdReason || "",
    raw: extra.raw || null
  };
}

export function mapBilibiliRecommendItem(item, observedAt = new Date().toISOString()) {
  if (!item || item.goto !== "av" || !item.bvid) return null;
  return mapOwnerFields(item.owner, item.bvid, item.title, item.pic, item.duration, item.pubdate, item.stat, {
    uri: item.uri,
    tname: item.tname,
    tid: item.tid,
    isOgv: Boolean(item.ogv_info),
    feedSurface: "recommend",
    observedAt,
    rcmdReason: item.rcmd_reason?.content || "",
    raw: item
  });
}

export function mapBilibiliPopularItem(item, observedAt = new Date().toISOString()) {
  if (!item?.bvid) return null;
  return mapOwnerFields(item.owner, item.bvid, item.title, item.pic, item.duration, item.pubdate, item.stat, {
    uri: item.short_link_v2,
    tname: item.tname,
    tid: item.tid,
    isOgv: item.is_ogv === true,
    feedSurface: "popular",
    observedAt,
    rcmdReason: item.rcmd_reason?.content || "",
    raw: item
  });
}

export function mapBilibiliProfile(observation, followers) {
  return {
    authorName: observation.authorName || "",
    avatarUrl: observation.avatarUrl || "",
    profileUrl: observation.profileUrl || "",
    followers: Number.isFinite(followers) ? followers : null,
    bilibiliMid: observation.authorId || ""
  };
}

export function sampleBilibiliBatchSeconds(settings = {}, random = Math.random) {
  const min = Math.max(1, Number(settings.bilibiliBatchDelay?.minSeconds) || 5);
  const max = Math.max(min, Number(settings.bilibiliBatchDelay?.maxSeconds) || 12);
  return Number((min + (max - min) * random()).toFixed(1));
}
