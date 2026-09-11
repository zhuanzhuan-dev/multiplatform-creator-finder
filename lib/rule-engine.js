import { contentSkipDecision } from "./content-type.js";
import { numericValue } from "./numeric.js";
import { normalizeText } from "./normalizers.js";

function enabledCategories(rules) {
  return (rules.positiveCategories || []).filter((group) => group && group.enabled !== false);
}

function keywordMatches(text, keywords) {
  const normalized = normalizeText(text);
  return (keywords || [])
    .map((keyword) => normalizeText(keyword))
    .filter(Boolean)
    .filter((keyword) => normalized.includes(keyword));
}

function videoKeywordText(video = {}) {
  const structured = [video.caption, video.authorName, ...(video.hashtags || [])].filter(Boolean).join("\n");
  return structured || String(video.cardText || "");
}

export function validateRules(rules = {}) {
  const problems = [];
  if (enabledCategories(rules).length === 0) problems.push("至少保留一个启用的账号类型");
  for (const group of enabledCategories(rules)) {
    if (!String(group.id || "").trim()) problems.push("账号类型缺少 id");
    if (!Array.isArray(group.keywords) || group.keywords.filter(Boolean).length === 0) {
      problems.push(`账号类型 ${group.name || group.id || "未命名"} 没有关键词`);
    }
  }
  const min = rules.hard?.minFollowers;
  const max = rules.hard?.maxFollowers;
  if (min != null && (!Number.isFinite(numericValue(min)) || numericValue(min) < 0)) problems.push("minFollowers 必须是非负数");
  if (max != null && (!Number.isFinite(numericValue(max)) || numericValue(max) < 0)) problems.push("maxFollowers 必须是非负数");
  if (min != null && max != null && numericValue(min) > numericValue(max)) problems.push("minFollowers 不能大于 maxFollowers");
  if (!Number.isFinite(numericValue(rules.hard?.minVideoDurationSeconds)) || numericValue(rules.hard.minVideoDurationSeconds) < 1) problems.push("最短视频时长必须大于 0");
  if (!Number.isFinite(numericValue(rules.hard?.minVideoLikes)) || numericValue(rules.hard.minVideoLikes) < 0) problems.push("最低点赞数必须是非负数");
  const lowFollowerRule = rules.lowFollowerNewAccount || {};
  if (lowFollowerRule.enabled !== false) {
    if (!Number.isInteger(numericValue(lowFollowerRule.maxVideos)) || numericValue(lowFollowerRule.maxVideos) < 1) problems.push("低粉新号最大作品数必须是正整数");
    if (!Number.isFinite(numericValue(lowFollowerRule.minAverageLikes)) || numericValue(lowFollowerRule.minAverageLikes) < 0) problems.push("低粉新号最低均赞必须是非负数");
  }
  if (!Number.isFinite(numericValue(rules.hard?.preferredVideoLikes)) || numericValue(rules.hard.preferredVideoLikes) < 0) problems.push("优选点赞数必须是非负数");
  for (const group of rules.positiveCategories || []) {
    const score = numericValue(group.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) problems.push(`账号类型 ${group.name || group.id || "未命名"} 的加分必须在 0–100 之间`);
  }
  return problems;
}

export function classifyContent(text, rules = {}) {
  const matched = [];
  for (const category of enabledCategories(rules)) {
    const hits = keywordMatches(text, category.keywords);
    if (hits.length) matched.push({ id: String(category.id), name: category.name || category.id, score: Number(category.score || 0), audience: category.audience || "未知", hits });
  }
  return matched.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-CN"));
}

export function detectRisks(text, rules = {}) {
  const risks = [];
  // Persisted gameBlacklist is the existing storage field for user-defined exclusions.
  const gameHits = keywordMatches(text, rules.gameBlacklist);
  if (gameHits.length) risks.push({ id: "game-blacklist", name: "排除关键词", hits: gameHits });
  return risks;
}

export function evaluateVideoRules(video = {}, rules = {}) {
  if (video.blockedReason) return { matched: false, blocked: true, code: "BLOCKED", reasons: [video.blockedReason], matchedGroups: [] };
  const skip = contentSkipDecision(video);
  if (skip) return { matched: false, ...skip, matchedGroups: [] };

  const haystack = videoKeywordText(video);
  const risks = detectRisks(haystack, rules);
  if (risks.length) return { matched: false, code: "RISK_FILTERED", reasons: risks.map((risk) => `${risk.name}：${risk.hits.join("、")}`), risks, matchedGroups: [] };

  const duration = video.durationSeconds == null || video.durationSeconds === ""
    ? Number.NaN
    : Number(video.durationSeconds);
  if (!Number.isFinite(duration)) return { matched: false, needsReview: true, code: "DURATION_MISSING", reasons: ["当前视频时长未能读取"], matchedGroups: [] };
  if (duration < Number(rules.hard?.minVideoDurationSeconds || 60)) return { matched: false, code: "VIDEO_TOO_SHORT", reasons: [`当前视频时长 ${duration} 秒，低于设置的最短时长 ${Number(rules.hard?.minVideoDurationSeconds || 60)} 秒`], matchedGroups: [] };

  const likes = video.likes == null || video.likes === ""
    ? Number.NaN
    : Number(video.likes);
  if (!Number.isFinite(likes)) return { matched: false, needsReview: true, code: "LIKES_MISSING", reasons: ["当前视频点赞数未能读取"], matchedGroups: [] };
  if (likes < Number(rules.hard?.minVideoLikes ?? 3000)) return { matched: false, code: "LIKES_TOO_LOW", reasons: [`当前点赞数 ${likes}，低于设置的最低点赞数 ${Number(rules.hard?.minVideoLikes ?? 3000)}`], matchedGroups: [] };

  const categories = classifyContent(haystack, rules);
  const matchedGroups = categories.map((category) => category.id);
  const reasons = [`视频 ${duration} 秒`, `当前点赞 ${likes}`];
  if (categories.length) reasons.push(`类型：${categories.map((category) => category.name).join("、")}`);
  else reasons.push("内容类别需人工确认");
  return { matched: true, code: "HARD_FILTER_PASSED", reasons, matchedGroups, categories, needsSemanticReview: categories.length === 0 };
}

export function lowFollowerNewAccountQualifies(profile = {}, rules = {}) {
  const config = rules.lowFollowerNewAccount || {};
  if (config.enabled === false) return false;
  if (config.requireCompleteWorksList !== false && profile.worksListComplete !== true) return false;

  const followers = Number(profile.followers);
  const minFollowers = Number(rules.hard?.minFollowers);
  const parsedVideoCount = Number(profile.videoCount);
  const videoCount = Number.isFinite(parsedVideoCount)
    ? parsedVideoCount
    : Array.isArray(profile.recentVideos)
      ? profile.recentVideos.length
      : Number.NaN;
  const averageLikes = profile.averageLikes == null || profile.averageLikes === "" ? Number.NaN : Number(profile.averageLikes);
  const maxVideos = Number(config.maxVideos);
  const minAverageLikes = Number(config.minAverageLikes);

  return Number.isFinite(followers)
    && Number.isFinite(minFollowers)
    && followers < minFollowers
    && Number.isInteger(videoCount)
    && videoCount >= 1
    && Number.isInteger(maxVideos)
    && videoCount <= maxVideos
    && Number.isFinite(averageLikes)
    && Number.isFinite(minAverageLikes)
    && averageLikes >= minAverageLikes;
}

function lowFollowerFailureReason(profile, rules) {
  const config = rules.lowFollowerNewAccount || {};
  if (config.enabled === false) return "低粉新号例外未开启";
  const failures = [];
  if (config.requireCompleteWorksList !== false && profile.worksListComplete !== true) failures.push("作品列表尚未完整加载，设置要求完整作品列表");
  const count = Number.isFinite(Number(profile.videoCount)) ? Number(profile.videoCount) : Array.isArray(profile.recentVideos) ? profile.recentVideos.length : Number.NaN;
  if (!Number.isInteger(count) || count < 1) failures.push("有效作品数量未能读取，至少需要 1 条作品");
  else if (!Number.isInteger(Number(config.maxVideos))) failures.push("例外的作品数量上限未有效设置");
  else if (count > Number(config.maxVideos)) failures.push(`当前作品 ${count} 条，超过例外设置的上限 ${Number(config.maxVideos)} 条`);
  const average = profile.averageLikes == null || profile.averageLikes === "" ? Number.NaN : Number(profile.averageLikes);
  if (!Number.isFinite(average)) failures.push("主页平均点赞数未能读取");
  else if (!Number.isFinite(Number(config.minAverageLikes))) failures.push("例外的最低平均点赞数未有效设置");
  else if (average < Number(config.minAverageLikes)) failures.push(`当前主页平均点赞数 ${average}，低于例外设置的最低平均点赞数 ${Number(config.minAverageLikes)}`);
  return `低粉新号例外未通过：${failures.join("；") || "例外条件数据不完整"}`;
}

export function evaluateCreatorRules(profile = {}, rules = {}) {
  const followers = profile.followers == null || profile.followers === "" ? Number.NaN : Number(profile.followers);
  const min = rules.hard?.minFollowers;
  const max = rules.hard?.maxFollowers;
  if (!Number.isFinite(followers) && (min != null || max != null)) {
    return { matched: false, needsReview: true, code: "FOLLOWERS_MISSING", reasons: [`当前粉丝量未能读取，无法核对设置的粉丝范围（最低 ${min ?? "未设置"}，最高 ${max ?? "未设置"}）`] };
  }
  if (max != null && followers > Number(max)) {
    return { matched: false, code: "FOLLOWERS_TOO_HIGH", reasons: [`当前粉丝量 ${followers}，高于设置的粉丝上限 ${Number(max)}`] };
  }
  const lowFollowerException = min != null
    && Number.isFinite(followers)
    && followers < Number(min)
    && lowFollowerNewAccountQualifies(profile, rules);
  if (min != null && (!Number.isFinite(followers) || followers < Number(min)) && !lowFollowerException) {
    return { matched: false, code: "FOLLOWERS_TOO_LOW", reasons: [`当前粉丝量 ${followers}，低于设置的粉丝下限 ${Number(min)}；${lowFollowerFailureReason(profile, rules)}`] };
  }
  const profileText = [profile.authorName, profile.bio, profile.douyinId, ...(profile.recentVideos || []).flatMap((video) => [video.text, video.coverAlt])].filter(Boolean).join("\n");
  const risks = detectRisks(profileText, rules);
  if (risks.length) return { matched: false, code: "PROFILE_RISK_FILTERED", reasons: risks.map((risk) => `${risk.name}：${risk.hits.join("、")}`), risks };
  const categories = classifyContent(profileText, rules);
  if (lowFollowerException) {
    const videoCount = Number.isFinite(Number(profile.videoCount)) ? Number(profile.videoCount) : profile.recentVideos.length;
    return {
      matched: true,
      code: "LOW_FOLLOWER_NEW_ACCOUNT_OK",
      reasons: [`低粉新号例外通过：当前粉丝 ${followers}（常规下限 ${Number(min)}）；主页作品 ${videoCount} 条（例外上限 ${Number(rules.lowFollowerNewAccount?.maxVideos)} 条）；主页平均点赞数 ${Number(profile.averageLikes)}（例外下限 ${Number(rules.lowFollowerNewAccount?.minAverageLikes)}）`],
      categories,
      lowFollowerException: true,
      needsSemanticReview: true
    };
  }
  return { matched: true, code: "PROFILE_OK", reasons: ["达人主页通过账号级硬规则"], categories, needsSemanticReview: categories.length === 0 };
}

export function scoreCreator({ profile = {}, observation = {}, categories = [], risks = [], rules = {} } = {}) {
  if (risks.length) return { score: 0, level: "C", filtered: true, reasons: ["存在内容风险"] };
  const followers = Number(profile.followers);
  const averageLikes = Number.isFinite(Number(profile.averageLikes)) ? Number(profile.averageLikes) : Number(observation.likes);
  const reasons = [];
  let score = 0;

  if (averageLikes >= 10_000) { score += 20; reasons.push("平均点赞10000+：+20"); }
  else if (averageLikes >= 4_000) { score += 10; reasons.push("平均点赞4000-10000：+10"); }
  else if (averageLikes >= 3_000) reasons.push("平均点赞3000-4000：基础通过");

  if (followers >= 100_000 && followers <= 1_000_000) { score += 20; reasons.push("粉丝10-100万：+20"); }
  else if ((followers >= 10_000 && followers < 100_000) || (followers > 1_000_000 && followers <= 5_000_000)) { score += 10; reasons.push("粉丝区间：+10"); }

  const bestCategory = [...categories].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  if (bestCategory) { score += Number(bestCategory.score || 0); reasons.push(`${bestCategory.name}：+${bestCategory.score || 0}`); }
  else reasons.push("内容类别未识别：需人工确认");

  let level = "B";
  if (followers >= 100_000 && followers <= 3_000_000 && averageLikes >= 4_000 && bestCategory) level = "S";
  else if (followers >= 10_000 && followers <= 1_000_000 && averageLikes >= 3_000 && bestCategory) level = "A";
  return { score, level, filtered: false, reasons, bestCategory: bestCategory || null };
}
