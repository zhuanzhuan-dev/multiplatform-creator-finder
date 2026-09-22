import { detectRisks } from "./rule-engine.js";
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
    minPlays: 100_000,
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
    { id: "food", name: "美食", score: 20, audience: "广泛", partitions: ["美食"], keywords: ["美食", "探店", "吃播", "做饭", "烹饪", "餐厅", "料理"], enabled: true },
    { id: "vlog", name: "生活/Vlog", score: 15, audience: "18-30", partitions: ["生活"], keywords: ["vlog", "日常", "生活记录", "旅行", "校园"], enabled: true },
    { id: "knowledge", name: "知识/科普", score: 15, audience: "广泛", partitions: ["知识"], keywords: ["科普", "知识", "教程", "干货", "讲解"], enabled: true },
    { id: "sports", name: "体育/运动", score: 15, audience: "广泛", partitions: ["运动"], keywords: ["体育", "运动", "健身", "足球", "篮球", "户外"], enabled: true },
    { id: "digital", name: "数码", score: 10, audience: "贴片合作可选", partitions: ["数码", "科技"], keywords: ["数码", "手机", "电脑", "耳机", "评测", "开箱", "科技"], enabled: true }
  ],
  /** 纯动漫/电影等无商业合作价值内容 */
  contentBlacklist: [
    "纯动漫", "动漫剪辑", "新番", "番剧", "追番", "二次元动画",
    "电影解说", "电影剪辑", "院线电影", "预告片", "片花", "影视综",
    "电视剧解说", "全集剪辑"
  ],
  excludeTnames: ["动漫", "国产动画", "连载动画", "完结动画", "布袋戏", "动态漫·广播剧", "电影", "其他"],
  gameBlacklist: [],
  riskGroups: [],
  /** 每条规则自带播放和发布的比较符。淘汰对上就剔除，理想对上算命中。 */
  playRules: {
    reject: [{ plays: 10_000, playsOp: "<", days: 3, daysOp: ">" }],
    prefer: [{ plays: 100_000, playsOp: ">=", days: 3, daysOp: "<=" }]
  }
});

const PLAY_OPS = new Set(["<", "<=", ">", ">="]);

function ruleOp(value, fallback) {
  return PLAY_OPS.has(value) ? value : fallback;
}

function compareRule(left, op, right) {
  if (op === "<") return left < right;
  if (op === "<=") return left <= right;
  if (op === ">") return left > right;
  return left >= right;
}

function finiteRule(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function bilibiliPlayRules(rules = {}) {
  const source = rules.playRules;
  if (source && (Array.isArray(source.reject) || Array.isArray(source.prefer))) {
    const rows = (list, playsFallback, daysFallback) => (Array.isArray(list) ? list : []).map((row) => ({
      plays: row?.plays === "" ? "" : finiteRule(row?.plays),
      days: row?.days === "" ? "" : finiteRule(row?.days),
      playsOp: ruleOp(row?.playsOp, playsFallback),
      daysOp: ruleOp(row?.daysOp, daysFallback)
    }));
    return {
      reject: rows(source.reject, "<", ">"),
      prefer: rows(source.prefer, ">=", "<=")
    };
  }
  const hard = rules.hard || {};
  const days = finiteRule(hard.earlyPlayWindowDays) ?? 3;
  const rejectPlays = finiteRule(hard.rejectPlaysBelow) ?? 10_000;
  const preferPlays = finiteRule(hard.minPlays) ?? 100_000;
  return {
    reject: [{ plays: rejectPlays, playsOp: "<", days, daysOp: ">" }],
    prefer: [{ plays: preferPlays, playsOp: ">=", days, daysOp: "<=" }]
  };
}

function videoAgeDays(observation, now = Date.now()) {
  const pub = Number(observation.pubdateSeconds);
  if (Number.isFinite(pub) && pub > 0) return (now / 1000 - pub) / 86400;
  const text = observation.publishedTimeText;
  if (!text) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? (now - parsed) / 86400 : Number.NaN;
}

const DEFAULT_PARTITIONS = {
  food: ["美食"],
  vlog: ["生活"],
  knowledge: ["知识"],
  sports: ["运动"],
  digital: ["数码", "科技"]
};

function categoryPartitions(category = {}) {
  if (Array.isArray(category.partitions)) return category.partitions;
  return DEFAULT_PARTITIONS[category.id] || [];
}

function keywordHaystack(observation = {}) {
  return [observation.caption, observation.authorName, observation.rcmdReason, ...(observation.hashtags || [])]
    .filter(Boolean)
    .join("\n");
}

function keywordHits(text, keywords) {
  const normalized = normalizeText(text);
  return (keywords || [])
    .map((keyword) => normalizeText(keyword))
    .filter(Boolean)
    .filter((keyword) => normalized.includes(keyword));
}

function partitionHits(tname, names) {
  const text = normalizeText(tname || "");
  return (names || [])
    .map((name) => normalizeText(name))
    .filter((name) => name && text && (text === name || text.includes(name)));
}

function classifyBilibiliContent(observation, rules = {}) {
  const text = keywordHaystack(observation);
  const matched = [];
  for (const category of rules.positiveCategories || []) {
    if (!category || category.enabled === false) continue;
    const partitions = partitionHits(observation.tname, categoryPartitions(category));
    const keywords = keywordHits(text, category.keywords);
    if (!partitions.length && !keywords.length) continue;
    matched.push({
      id: String(category.id),
      name: category.name || category.id,
      score: Number(category.score || 0),
      audience: category.audience || "未知",
      hits: [...partitions, ...keywords]
    });
  }
  return matched.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name), "zh-CN"));
}

function isExcludedContent(observation, rules) {
  const tname = normalizeText(observation.tname || "");
  for (const name of rules.excludeTnames || []) {
    const needle = normalizeText(name);
    if (needle && tname && (tname === needle || tname.includes(needle))) {
      return { id: "tname", hit: observation.tname };
    }
  }
  const haystack = normalizeText(keywordHaystack(observation));
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

  const risks = detectRisks(keywordHaystack(observation), rules);
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
  if (!Number.isFinite(plays)) {
    return { matched: false, needsReview: true, code: "PLAYS_MISSING", reasons: ["当前播放量未能读取"], matchedGroups: [] };
  }

  const ageDays = videoAgeDays(observation, now);
  const playRules = bilibiliPlayRules(rules);
  if (Number.isFinite(ageDays)) {
    const reject = playRules.reject.find((rule) => finiteRule(rule.plays) != null && finiteRule(rule.days) != null && compareRule(plays, rule.playsOp, rule.plays) && compareRule(ageDays, rule.daysOp, rule.days));
    if (reject) {
      return {
        matched: false,
        code: "PLAYS_HARD_REJECT",
        reasons: [`发布约 ${ageDays.toFixed(1)} 天 ${reject.daysOp} ${reject.days} 天，播放量 ${plays} ${reject.playsOp} ${reject.plays}`],
        matchedGroups: []
      };
    }
  }

  const prefer = Number.isFinite(ageDays)
    ? playRules.prefer.find((rule) => finiteRule(rule.plays) != null && finiteRule(rule.days) != null && compareRule(plays, rule.playsOp, rule.plays) && compareRule(ageDays, rule.daysOp, rule.days))
    : null;

  const categories = classifyBilibiliContent(observation, rules);
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
  if (!prefer) reasons.push("未对上淘汰或理想规则，交人工确认");
  else if (categories.length) reasons.push(`类型：${categories.map((item) => item.name).join("、")}`);
  else reasons.push("内容类别需人工确认");
  if (Number.isFinite(Number(observation.comments))) reasons.push(`评论 ${Number(observation.comments)}（参考）`);

  return {
    matched: true,
    needsReview: !prefer,
    code: prefer ? "HARD_FILTER_PASSED" : "PLAYS_REVIEW",
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
    needsReview: video.needsReview === true || video.needsSemanticReview === true || !Number.isFinite(followers),
    code: video.needsReview || video.needsSemanticReview || !Number.isFinite(followers) ? "ACCEPTED_REVIEW" : "ACCEPTED",
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
    includeDigital: value.includeDigital === true,
    playRules: bilibiliPlayRules(value)
  };
}

export function validateBilibiliRules(rules = {}) {
  const problems = [];
  const hard = rules.hard || {};
  if (!Number.isFinite(numericValue(hard.minVideoDurationSeconds)) || numericValue(hard.minVideoDurationSeconds) < 1) {
    problems.push("B站最短视频时长必须大于 0");
  }
  for (const [label, rows] of [["直接淘汰", rules.playRules?.reject], ["理想", rules.playRules?.prefer]]) {
    for (const row of rows || []) {
      if (!Number.isFinite(numericValue(row?.plays)) || numericValue(row.plays) < 0) problems.push(`${label}规则的播放量必须是非负数`);
      if (!Number.isFinite(numericValue(row?.days)) || numericValue(row.days) < 0) problems.push(`${label}规则的天数必须是非负数`);
    }
  }
  const enabled = (rules.positiveCategories || []).filter((item) => item && item.enabled !== false);
  if (!enabled.length) problems.push("至少保留一个启用的 B 站内容类目");
  return problems;
}
