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
  if (min != null && (!Number.isFinite(Number(min)) || Number(min) < 0)) problems.push("minFollowers 必须是非负数");
  if (max != null && (!Number.isFinite(Number(max)) || Number(max) < 0)) problems.push("maxFollowers 必须是非负数");
  if (min != null && max != null && Number(min) > Number(max)) problems.push("minFollowers 不能大于 maxFollowers");
  if (!Number.isFinite(Number(rules.hard?.minVideoDurationSeconds)) || Number(rules.hard.minVideoDurationSeconds) < 1) problems.push("最短视频时长必须大于 0");
  if (!Number.isFinite(Number(rules.hard?.minVideoLikes)) || Number(rules.hard.minVideoLikes) < 0) problems.push("最低点赞数必须是非负数");
  const lowFollowerRule = rules.lowFollowerNewAccount || {};
  if (lowFollowerRule.enabled !== false) {
    if (!Number.isInteger(Number(lowFollowerRule.maxVideos)) || Number(lowFollowerRule.maxVideos) < 1) problems.push("低粉新号最大作品数必须是正整数");
    if (!Number.isFinite(Number(lowFollowerRule.minAverageLikes)) || Number(lowFollowerRule.minAverageLikes) < 0) problems.push("低粉新号最低均赞必须是非负数");
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
  // V2 不再依据恐怖、僵尸、暴力等内容风险词自动淘汰账号。
  // 仅保留业务明确指定的游戏黑名单。
  const gameHits = keywordMatches(text, rules.gameBlacklist);
  if (gameHits.length) risks.push({ id: "game-blacklist", name: "游戏黑名单", hits: gameHits });
  return risks;
}

export function evaluateVideoRules(video = {}, rules = {}) {
  if (video.blockedReason) return { matched: false, blocked: true, code: "BLOCKED", reasons: [video.blockedReason], matchedGroups: [] };
  if (video.isLive && !rules.includeLive) return { matched: false, code: "LIVE_SKIPPED", reasons: ["直播卡片不采集"], matchedGroups: [] };

  const haystack = videoKeywordText(video);
  const risks = detectRisks(haystack, rules);
  if (risks.length) return { matched: false, code: "RISK_FILTERED", reasons: risks.map((risk) => `${risk.name}：${risk.hits.join("、")}`), risks, matchedGroups: [] };

  const duration = video.durationSeconds == null || video.durationSeconds === ""
    ? Number.NaN
    : Number(video.durationSeconds);
  if (!Number.isFinite(duration)) return { matched: false, needsReview: true, code: "DURATION_MISSING", reasons: ["当前视频时长未能读取"], matchedGroups: [] };
  if (duration < Number(rules.hard?.minVideoDurationSeconds || 60)) return { matched: false, code: "VIDEO_TOO_SHORT", reasons: [`视频时长 ${duration} 秒，低于规则下限`], matchedGroups: [] };

  const likes = video.likes == null || video.likes === ""
    ? Number.NaN
    : Number(video.likes);
  if (!Number.isFinite(likes)) return { matched: false, needsReview: true, code: "LIKES_MISSING", reasons: ["当前视频点赞数未能读取"], matchedGroups: [] };
  if (likes < Number(rules.hard?.minVideoLikes || 3000)) return { matched: false, code: "LIKES_TOO_LOW", reasons: [`当前点赞 ${likes}，低于规则下限`], matchedGroups: [] };

  const categories = classifyContent(haystack, rules);
  const matchedGroups = categories.map((category) => category.id);
  const reasons = [`视频 ${duration} 秒`, `当前点赞 ${likes}`];
  if (categories.length) reasons.push(`类型：${categories.map((category) => category.name).join("、")}`);
  else reasons.push("账号类型待主页复核");
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
  const averageLikes = Number(profile.averageLikes);
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

export function evaluateCreatorRules(profile = {}, rules = {}) {
  const followers = Number(profile.followers);
  const min = rules.hard?.minFollowers;
  const max = rules.hard?.maxFollowers;
  if (max != null && (!Number.isFinite(followers) || followers > Number(max))) {
    return { matched: false, code: "FOLLOWERS_TOO_HIGH", reasons: ["粉丝量高于规则上限"] };
  }
  const lowFollowerException = min != null
    && Number.isFinite(followers)
    && followers < Number(min)
    && lowFollowerNewAccountQualifies(profile, rules);
  if (min != null && (!Number.isFinite(followers) || followers < Number(min)) && !lowFollowerException) {
    return { matched: false, code: "FOLLOWERS_TOO_LOW", reasons: ["粉丝量低于规则下限，且未满足低粉新号例外"] };
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
      reasons: [`低粉新号例外：粉丝 ${followers}；主页作品 ${videoCount} 条；主页均赞 ${Number(profile.averageLikes)}`],
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
  else reasons.push("账号类型未自动识别：需复核");

  let level = "B";
  if (followers >= 100_000 && followers <= 3_000_000 && averageLikes >= 4_000 && bestCategory) level = "S";
  else if (followers >= 10_000 && followers <= 1_000_000 && averageLikes >= 3_000 && bestCategory) level = "A";
  return { score, level, filtered: false, reasons, bestCategory: bestCategory || null };
}
