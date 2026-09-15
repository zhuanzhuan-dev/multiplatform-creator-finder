import { classifyContent, detectRisks } from "./rule-engine.js";
import { contentSkipDecision } from "./content-type.js";
import { numericValue } from "./numeric.js";
import { normalizeText } from "./normalizers.js";

/** B 站筛选默认：播放量/时长门槛，不复用抖音点赞逻辑。 */
export const DEFAULT_BILIBILI_RULES = Object.freeze({
  version: 1,
  platform: "bilibili",
  includeLive: false,
  hard: {
    minVideoDurationSeconds: 60,
    /** 发布后 earlyPlayWindowDays 天内（及之后准入）播放量下限 */
    minPlays: 100_000,
    /** 播放量低于此值直接剔除 */
    rejectPlaysBelow: 10_000,
    earlyPlayWindowDays: 3,
    minFollowers: null,
    maxFollowers: null,
    minVideoLikes: null,
    preferredVideoLikes: null
  },
  /** 数码类默认不纳入；需要贴片合作时再打开 */
  includeDigital: false,
  lowFollowerNewAccount: {
    enabled: false,
    maxVideos: 10,
    minAverageLikes: 0,
    requireCompleteWorksList: false
  },
  positiveCategories: [
    { id: "food", name: "美食", score: 20, audience: "广泛", keywords: ["美食", "探店", "吃播", "做饭", "烹饪", "餐厅", "料理"], enabled: true },
    { id: "vlog", name: "生活/Vlog", score: 15, audience: "18-30", keywords: ["vlog", "日常", "生活记录", "旅行", "校园"], enabled: true },
    { id: "knowledge", name: "知识/科普", score: 15, audience: "广泛", keywords: ["科普", "知识", "教程", "干货", "讲解"], enabled: true },
    { id: "sports", name: "体育/运动", score: 15, audience: "广泛", keywords: ["体育", "运动", "健身", "足球", "篮球", "户外"], enabled: true },
    { id: "digital", name: "数码", score: 10, audience: "贴片合作可选", keywords: ["数码", "手机", "电脑", "耳机", "评测", "开箱", "科技"], enabled: true }
  ],
  /** 纯动漫/电影等无商业合作价值内容 */
  contentBlacklist: [
    "纯动漫", "动漫剪辑", "新番", "番剧", "追番", "二次元动画",
    "电影解说", "电影剪辑", "院线电影", "预告片", "片花", "影视综",
    "电视剧解说", "全集剪辑"
  ],
  excludeTnames: ["动漫", "国产动画", "连载动画", "完结动画", "布袋戏", "动态漫·广播剧", "电影", "其他"],
  gameBlacklist: [],
  riskGroups: []
});

function videoAgeDays(observation, now = Date.now()) {
  const pub = Number(observation.pubdateSeconds);
  if (Number.isFinite(pub) && pub > 0) return (now / 1000 - pub) / 86400;
  const text = observation.publishedTimeText;
  if (!text) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? (now - parsed) / 86400 : Number.NaN;
}

function contentHaystack(observation = {}) {
  return [observation.caption, observation.authorName, observation.tname, observation.rcmdReason, ...(observation.hashtags || [])]
    .filter(Boolean)
    .join("\n");
}

function isExcludedContent(observation, rules) {
  const tname = normalizeText(observation.tname || "");
  for (const name of rules.excludeTnames || []) {
    const needle = normalizeText(name);
    if (needle && tname && (tname === needle || tname.includes(needle))) {
      return { id: "tname", hit: observation.tname };
    }
  }
  const haystack = normalizeText(contentHaystack(observation));
  for (const word of rules.contentBlacklist || []) {
    const needle = normalizeText(word);
    if (needle && haystack.includes(needle)) return { id: "keyword", hit: word };
  }
  if (observation.isOgv === true) return { id: "ogv", hit: "OGV/影视内容" };
  return null;
}

function digitalOnlyMatch(categories = []) {
  return categories.length > 0 && categories.every((item) => item.id === "digital");
}

export function evaluateBilibiliVideoRules(observation = {}, rules = {}, now = Date.now()) {
  if (observation.blockedReason) {
    return { matched: false, blocked: true, code: "BLOCKED", reasons: [observation.blockedReason], matchedGroups: [] };
  }
  const skip = contentSkipDecision(observation);
  if (skip) return { matched: false, ...skip, matchedGroups: [] };

  const excluded = isExcludedContent(observation, rules);
  if (excluded) {
    return {
      matched: false,
      code: "CONTENT_EXCLUDED",
      reasons: [`剔除无合作价值内容（${excluded.hit}）`],
      matchedGroups: []
    };
  }

  const risks = detectRisks(contentHaystack(observation), rules);
  if (risks.length) {
    return { matched: false, code: "RISK_FILTERED", reasons: risks.map((risk) => `${risk.name}：${risk.hits.join("、")}`), risks, matchedGroups: [] };
  }

  const duration = observation.durationSeconds == null || observation.durationSeconds === ""
    ? Number.NaN
    : Number(observation.durationSeconds);
  const minDuration = Number(rules.hard?.minVideoDurationSeconds ?? 60);
  if (!Number.isFinite(duration)) {
    return { matched: false, needsReview: true, code: "DURATION_MISSING", reasons: ["当前视频时长未能读取"], matchedGroups: [] };
  }
  if (duration < minDuration) {
    return { matched: false, code: "VIDEO_TOO_SHORT", reasons: [`当前视频时长 ${duration} 秒，低于设置的最短时长 ${minDuration} 秒`], matchedGroups: [] };
  }

  const plays = observation.plays == null || observation.plays === "" ? Number.NaN : Number(observation.plays);
  const rejectBelow = Number(rules.hard?.rejectPlaysBelow ?? 10_000);
  const minPlays = Number(rules.hard?.minPlays ?? 100_000);
  const earlyDays = Number(rules.hard?.earlyPlayWindowDays ?? 3);
  if (!Number.isFinite(plays)) {
    return { matched: false, needsReview: true, code: "PLAYS_MISSING", reasons: ["当前播放量未能读取"], matchedGroups: [] };
  }
  if (plays < rejectBelow) {
    return { matched: false, code: "PLAYS_HARD_REJECT", reasons: [`播放量 ${plays}，低于直接剔除线 ${rejectBelow}`], matchedGroups: [] };
  }

  const ageDays = videoAgeDays(observation, now);
  if (Number.isFinite(ageDays) && ageDays <= earlyDays && plays < minPlays) {
    return {
      matched: false,
      code: "PLAYS_TOO_LOW_EARLY",
      reasons: [`发布约 ${ageDays.toFixed(1)} 天（窗口 ${earlyDays} 天），播放量 ${plays}，低于准入 ${minPlays}`],
      matchedGroups: []
    };
  }
  if (plays < minPlays) {
    return {
      matched: false,
      code: "PLAYS_TOO_LOW",
      reasons: [`播放量 ${plays}，低于准入 ${minPlays}`],
      matchedGroups: []
    };
  }

  const categories = classifyContent(contentHaystack(observation), rules);
  if (rules.includeDigital === false && digitalOnlyMatch(categories)) {
    return {
      matched: false,
      code: "DIGITAL_EXCLUDED",
      reasons: ["当前为数码类匹配，设置未纳入数码账号"],
      matchedGroups: categories.map((item) => item.id),
      categories
    };
  }

  const matchedGroups = categories.map((item) => item.id);
  const reasons = [`视频 ${duration} 秒`, `播放 ${plays}`];
  if (Number.isFinite(ageDays)) reasons.push(`发布约 ${ageDays.toFixed(1)} 天`);
  if (categories.length) reasons.push(`类型：${categories.map((item) => item.name).join("、")}`);
  else reasons.push("内容类别需人工确认");
  if (Number.isFinite(Number(observation.comments))) reasons.push(`评论 ${Number(observation.comments)}（参考）`);

  return {
    matched: true,
    code: "HARD_FILTER_PASSED",
    reasons,
    matchedGroups,
    categories,
    needsSemanticReview: categories.length === 0
  };
}

export function decideBilibili(observation, profile, rules, now = Date.now()) {
  const video = evaluateBilibiliVideoRules(observation, rules, now);
  if (!video.matched) return video;

  // B 站主门槛在播放量；粉丝仅作补充，缺失不阻断命中。
  const followers = profile?.followers == null || profile.followers === "" ? Number.NaN : Number(profile.followers);
  const maxFollowers = rules.hard?.maxFollowers;
  if (maxFollowers != null && Number.isFinite(followers) && followers > Number(maxFollowers)) {
    return { matched: false, code: "FOLLOWERS_TOO_HIGH", reasons: [`粉丝 ${followers}，高于上限 ${Number(maxFollowers)}`] };
  }

  return {
    matched: true,
    needsReview: video.needsSemanticReview === true || !Number.isFinite(followers),
    code: video.needsSemanticReview || !Number.isFinite(followers) ? "ACCEPTED_REVIEW" : "ACCEPTED",
    reasons: [
      ...video.reasons,
      Number.isFinite(followers) ? `粉丝 ${followers}` : "粉丝数未读全，交人工确认"
    ],
    categories: video.categories,
    score: {
      level: video.needsSemanticReview || !Number.isFinite(followers) ? "B" : "A",
      reasons: video.reasons
    }
  };
}

export function mergeBilibiliRules(value = {}) {
  return {
    ...DEFAULT_BILIBILI_RULES,
    ...value,
    hard: { ...DEFAULT_BILIBILI_RULES.hard, ...(value.hard || {}) },
    lowFollowerNewAccount: {
      ...DEFAULT_BILIBILI_RULES.lowFollowerNewAccount,
      ...(value.lowFollowerNewAccount || {})
    },
    version: DEFAULT_BILIBILI_RULES.version,
    platform: "bilibili",
    positiveCategories: Array.isArray(value.positiveCategories)
      ? value.positiveCategories
      : DEFAULT_BILIBILI_RULES.positiveCategories,
    contentBlacklist: Array.isArray(value.contentBlacklist)
      ? value.contentBlacklist
      : DEFAULT_BILIBILI_RULES.contentBlacklist,
    excludeTnames: Array.isArray(value.excludeTnames)
      ? value.excludeTnames
      : DEFAULT_BILIBILI_RULES.excludeTnames,
    gameBlacklist: Array.isArray(value.gameBlacklist) ? value.gameBlacklist : DEFAULT_BILIBILI_RULES.gameBlacklist,
    includeDigital: value.includeDigital === true
  };
}

export function validateBilibiliRules(rules = {}) {
  const problems = [];
  const hard = rules.hard || {};
  if (!Number.isFinite(numericValue(hard.minVideoDurationSeconds)) || numericValue(hard.minVideoDurationSeconds) < 1) {
    problems.push("B站最短视频时长必须大于 0");
  }
  if (!Number.isFinite(numericValue(hard.minPlays)) || numericValue(hard.minPlays) < 0) {
    problems.push("B站准入播放量必须是非负数");
  }
  if (!Number.isFinite(numericValue(hard.rejectPlaysBelow)) || numericValue(hard.rejectPlaysBelow) < 0) {
    problems.push("B站直接剔除播放量必须是非负数");
  }
  if (numericValue(hard.rejectPlaysBelow) > numericValue(hard.minPlays)) {
    problems.push("B站直接剔除线不能高于准入播放量");
  }
  if (!Number.isFinite(numericValue(hard.earlyPlayWindowDays)) || numericValue(hard.earlyPlayWindowDays) < 1) {
    problems.push("B站早期播放窗口必须是至少 1 天");
  }
  const enabled = (rules.positiveCategories || []).filter((item) => item && item.enabled !== false);
  if (!enabled.length) problems.push("至少保留一个启用的 B 站内容类目");
  return problems;
}
