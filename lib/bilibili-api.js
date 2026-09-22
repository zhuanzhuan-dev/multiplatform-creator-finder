import { encWbi, getWbiKeys } from "./bilibili-wbi.js";

export const BILIBILI_HOME_URL = "https://www.bilibili.com/";
export const BILIBILI_POPULAR_URL = "https://www.bilibili.com/v/popular/all";
export const BILIBILI_PAGE_SIZE = 30;
export const BILIBILI_POPULAR_PAGE_SIZE = 20;
export const BILIBILI_SPACE_PAGE_SIZE = 30;
const OBSERVATION_JSON_BUDGET = 90_000;

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

export async function fetchBilibiliRelationStat(mid, fetchImpl = fetch) {
  const id = Number(mid);
  if (!Number.isFinite(id) || id <= 0) return null;
  const response = await apiGet("/x/relation/stat", { vmid: id }, fetchImpl);
  if (!response.ok) return null;
  const json = await response.json();
  if (json?.code !== 0 || !json.data || typeof json.data !== "object") return null;
  return json.data;
}

export async function fetchBilibiliFollowerCount(mid, fetchImpl = fetch) {
  const stat = await fetchBilibiliRelationStat(mid, fetchImpl);
  const followers = Number(stat?.follower);
  return Number.isFinite(followers) ? followers : null;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function preferNumber(primary, fallback) {
  const first = finiteOrNull(primary);
  return first == null ? finiteOrNull(fallback) : first;
}

export function parseBilibiliClockLength(text) {
  const parts = String(text || "").split(":").map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function mapBilibiliView(data) {
  if (!data?.bvid) return null;
  const stat = data.stat || {};
  const pub = Number(data.pubdate);
  return {
    videoId: String(data.bvid),
    aid: finiteOrNull(data.aid),
    title: String(data.title || ""),
    description: String(data.desc || ""),
    coverUrl: String(data.pic || ""),
    durationSeconds: finiteOrNull(data.duration),
    likes: finiteOrNull(stat.like),
    comments: finiteOrNull(stat.reply),
    danmaku: finiteOrNull(stat.danmaku),
    favorites: finiteOrNull(stat.favorite),
    plays: finiteOrNull(stat.view),
    shares: finiteOrNull(stat.share),
    coins: finiteOrNull(stat.coin),
    pubdateSeconds: Number.isFinite(pub) && pub > 0 ? pub : null,
    publishedTimeText: Number.isFinite(pub) && pub > 0 ? new Date(pub * 1000).toISOString() : "",
    tname: String(data.tname || ""),
    tid: finiteOrNull(data.tid),
    copyright: finiteOrNull(data.copyright),
    partCount: finiteOrNull(data.videos)
  };
}

export function mapBilibiliSpaceItem(item) {
  if (!item?.bvid) return null;
  const created = Number(item.created);
  return {
    ...item,
    videoId: String(item.bvid),
    title: String(item.title || ""),
    coverUrl: String(item.pic || ""),
    description: String(item.description || ""),
    durationSeconds: parseBilibiliClockLength(item.length),
    plays: finiteOrNull(item.play),
    comments: finiteOrNull(item.comment),
    danmaku: finiteOrNull(item.video_review),
    pubdateSeconds: Number.isFinite(created) && created > 0 ? created : null,
    beforeUrl: `https://www.bilibili.com/video/${item.bvid}`,
    authorId: item.mid != null ? String(item.mid) : "",
    isUnion: item.is_union_video === 1
  };
}

export function applyBilibiliView(observation, view) {
  if (!view) return { ...observation };
  return {
    ...observation,
    caption: observation.caption || view.title || "",
    description: view.description || observation.description || "",
    coverUrl: observation.coverUrl || view.coverUrl || "",
    durationSeconds: preferNumber(view.durationSeconds, observation.durationSeconds),
    likes: preferNumber(view.likes, observation.likes),
    comments: preferNumber(view.comments, observation.comments),
    danmaku: preferNumber(view.danmaku, observation.danmaku),
    favorites: preferNumber(view.favorites, observation.favorites),
    plays: preferNumber(view.plays, observation.plays),
    shares: preferNumber(view.shares, observation.shares),
    coins: preferNumber(view.coins, observation.coins),
    pubdateSeconds: preferNumber(view.pubdateSeconds, observation.pubdateSeconds),
    publishedTimeText: view.publishedTimeText || observation.publishedTimeText || "",
    tname: observation.tname || view.tname || "",
    tid: observation.tid ?? view.tid,
    copyright: view.copyright ?? observation.copyright,
    partCount: view.partCount,
    viewDetail: view.viewDetail || null
  };
}

function withinObservationBudget(observation) {
  return JSON.stringify(observation).length <= OBSERVATION_JSON_BUDGET;
}

export function clipBilibiliObservation(observation) {
  const next = { ...observation };
  if (withinObservationBudget(next)) return next;
  if (next.viewDetail && typeof next.viewDetail === "object" && next.viewDetail.ugc_season != null) {
    next.viewDetail = { ...next.viewDetail, ugc_season: null };
    next.viewDetailClipped = [...(next.viewDetailClipped || []), "ugc_season"];
    if (withinObservationBudget(next)) return next;
  }
  next.raw = null;
  if (withinObservationBudget(next)) return next;
  const archives = Array.isArray(next.authorArchives) ? next.authorArchives.map((item) => ({ ...item, description: "" })) : [];
  next.authorArchives = archives;
  if (JSON.stringify(next).length <= OBSERVATION_JSON_BUDGET) return next;
  if (archives.length > 60) {
    next.authorArchives = archives.slice(0, 60);
    next.authorArchivesTruncated = true;
  }
  return next;
}

export async function fetchBilibiliView(bvid, fetchImpl = fetch) {
  const id = String(bvid || "");
  if (!/^BV[\w]+$/i.test(id)) throw new Error("视频 bvid 无效");
  await getWbiKeys(fetchImpl);
  const params = await encWbi({ bvid: id }, fetchImpl);
  const response = await apiGet("/x/web-interface/wbi/view", params, fetchImpl, `https://www.bilibili.com/video/${id}`);
  if (!response.ok) throw new Error(`B 站视频详情失败（HTTP ${response.status}）`);
  const json = await response.json();
  if (json?.code !== 0) throw new Error(json?.message || "B 站视频详情返回错误");
  const mapped = mapBilibiliView(json.data);
  if (!mapped) throw new Error("B 站视频详情缺少 bvid");
  return { ...mapped, viewDetail: json.data };
}

export async function fetchBilibiliSpacePage(mid, page = 1, pageSize = BILIBILI_SPACE_PAGE_SIZE, fetchImpl = fetch) {
  const id = Number(mid);
  if (!Number.isFinite(id) || id <= 0) throw new Error("B 站 mid 无效");
  await getWbiKeys(fetchImpl);
  const params = await encWbi({
    mid: id,
    pn: Math.max(1, Number(page) || 1),
    ps: Math.max(1, Number(pageSize) || BILIBILI_SPACE_PAGE_SIZE),
    order: "pubdate",
    platform: "web"
  }, fetchImpl);
  const response = await apiGet("/x/space/wbi/arc/search", params, fetchImpl, `https://space.bilibili.com/${id}/video`);
  if (!response.ok) throw new Error(`B 站投稿列表失败（HTTP ${response.status}）`);
  const json = await response.json();
  if (json?.code !== 0) throw new Error(json?.message || "B 站投稿列表返回错误");
  const list = Array.isArray(json.data?.list?.vlist) ? json.data.list.vlist : [];
  const total = Number(json.data?.page?.count);
  const pn = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Number(pageSize) || BILIBILI_SPACE_PAGE_SIZE);
  return {
    items: list.map(mapBilibiliSpaceItem).filter(Boolean),
    total: Number.isFinite(total) ? total : null,
    page: pn,
    exhausted: list.length === 0 || (Number.isFinite(total) && pn * ps >= total),
    partitions: json.data?.list?.tlist ?? null,
    episodicButton: json.data?.episodic_button ?? null
  };
}

export async function enrichMatchedBilibili(observation, {
  fetchImpl = fetch,
  settings = {},
  delay = async () => {},
  random = Math.random
} = {}) {
  const wait = async () => {
    const seconds = sampleBilibiliEnrichSeconds(settings, random);
    if (seconds > 0) await delay(seconds);
  };

  let view = null;
  let followers = null;
  let relationStat = null;
  let archives = [];
  let archiveCount = null;
  let archivesComplete = false;
  let partitions = null;
  let episodicButton = null;

  await wait();
  try {
    view = await fetchBilibiliView(observation.videoId, fetchImpl);
  } catch {
    view = null;
  }

  await wait();
  try {
    relationStat = await fetchBilibiliRelationStat(observation.authorId, fetchImpl);
    const count = Number(relationStat?.follower);
    followers = Number.isFinite(count) ? count : null;
  } catch {
    relationStat = null;
    followers = null;
  }

  await wait();
  try {
    const batch = await fetchBilibiliSpacePage(observation.authorId, 1, BILIBILI_SPACE_PAGE_SIZE, fetchImpl);
    archives = batch.items;
    archiveCount = batch.total;
    archivesComplete = batch.exhausted === true;
    partitions = batch.partitions;
    episodicButton = batch.episodicButton;
  } catch {
    archives = [];
    archivesComplete = false;
  }

  const merged = applyBilibiliView(observation, view);
  merged.authorArchives = archives;
  merged.authorArchiveCount = archiveCount;
  merged.authorArchivesComplete = archivesComplete;
  merged.relationStat = relationStat;
  merged.authorArchivePartitions = partitions;
  merged.authorEpisodicButton = episodicButton;

  return {
    observation: clipBilibiliObservation(merged),
    followers,
    relationStat,
    view,
    archives,
    archiveCount,
    archivesComplete,
    partitions,
    episodicButton,
    matched: true
  };
}

export function bilibiliFeedbackFields(observation = {}, profile = null) {
  return {
    play_count: observation.plays ?? null,
    comment_count: observation.comments ?? null,
    danmaku_count: observation.danmaku ?? null,
    coin_count: observation.coins ?? null,
    share_count: observation.shares ?? null,
    desc: observation.description || "",
    author_video_count: profile?.videoCount ?? observation.authorArchiveCount ?? null,
    author_archives_complete: Boolean(profile?.archivesComplete || observation.authorArchivesComplete),
    author_archives: Array.isArray(observation.authorArchives) ? observation.authorArchives : [],
    author_archive_partitions: observation.authorArchivePartitions || null,
    author_episodic_button: observation.authorEpisodicButton || null,
    view_detail: observation.viewDetail || null,
    view_detail_clipped: observation.viewDetailClipped || null,
    feed_item: observation.raw || null,
    relation_stat: observation.relationStat || null,
    tname: observation.tname || "",
    feed_surface: observation.feedSurface || "recommend",
    rcmd_reason: observation.rcmdReason || ""
  };
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

export function mapBilibiliProfile(observation, followers, extra = {}) {
  const archives = Array.isArray(extra.archives) ? extra.archives : (Array.isArray(observation.authorArchives) ? observation.authorArchives : []);
  const archiveCount = extra.archiveCount ?? observation.authorArchiveCount ?? archives.length;
  const archivesComplete = extra.archivesComplete === true || observation.authorArchivesComplete === true;
  return {
    authorName: observation.authorName || "",
    avatarUrl: observation.avatarUrl || "",
    profileUrl: observation.profileUrl || "",
    followers: Number.isFinite(followers) ? followers : null,
    bilibiliMid: observation.authorId || "",
    ready: archives.length > 0 || extra.view != null || observation.viewDetail != null,
    videoCount: Number.isFinite(Number(archiveCount)) ? Number(archiveCount) : archives.length,
    worksListComplete: archivesComplete,
    recentVideos: archives.slice(0, 24).map((item) => ({
      videoId: item.videoId,
      coverUrl: item.coverUrl,
      videoUrl: item.beforeUrl || ""
    })),
    authorArchives: archives,
    archivesComplete,
    view: slimBilibiliView(extra.view)
  };
}

function slimBilibiliView(view) {
  if (!view || typeof view !== "object") return null;
  const { viewDetail, ...slim } = view;
  return slim;
}

export function sampleBilibiliBatchSeconds(settings = {}, random = Math.random) {
  const min = Math.max(1, Number(settings.bilibiliBatchDelay?.minSeconds) || 5);
  const max = Math.max(min, Number(settings.bilibiliBatchDelay?.maxSeconds) || 12);
  return Number((min + (max - min) * random()).toFixed(1));
}

export function sampleBilibiliEnrichSeconds(settings = {}, random = Math.random) {
  const min = Math.max(3, Number(settings.bilibiliEnrichDelay?.minSeconds) || 8);
  const max = Math.max(min, Number(settings.bilibiliEnrichDelay?.maxSeconds) || 16);
  return Number((min + (max - min) * random()).toFixed(1));
}
