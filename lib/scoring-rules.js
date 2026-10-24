import { numericValue } from './numeric.js';

export const DEFAULT_SCORING = {
  likes: [{ min: 10000, points: 20 }, { min: 4000, points: 10 }],
  followers: [{ min: 100000, max: 1000000, points: 20 }, { min: 10000, max: 5000000, points: 10 }],
  levels: {
    S: { enabled: true, minFollowers: 100000, maxFollowers: 3000000, minAverageLikes: 4000, requireCategory: true },
    A: { enabled: true, minFollowers: 10000, maxFollowers: 1000000, minAverageLikes: 3000, requireCategory: true }
  }
};

// Persisted pre-1.1.24 preferences become explicit scoring rules on first load.
export function mergeScoring(rules = {}) {
  const defaults = structuredClone(DEFAULT_SCORING);
  const preferred = numericValue(rules.hard?.preferredVideoLikes);
  if (Number.isFinite(preferred) && preferred >= 0) {
    defaults.likes[1].min = preferred;
    defaults.levels.S.minAverageLikes = preferred;
  }
  const saved = rules.scoring || {};
  return {
    likes: structuredClone(saved.likes ?? defaults.likes),
    followers: structuredClone(saved.followers ?? defaults.followers),
    levels: {
      S: { ...defaults.levels.S, ...saved.levels?.S },
      A: { ...defaults.levels.A, ...saved.levels?.A }
    }
  };
}

export function validateScoring(scoring) {
  const problems = [];
  const nonnegative = value => Number.isFinite(numericValue(value)) && numericValue(value) >= 0;
  for (const [kind, label] of [['likes', '均赞'], ['followers', '粉丝']]) {
    const rows = scoring[kind];
    if (!Array.isArray(rows)) { problems.push(`${label}加分规则必须是列表`); continue; }
    for (const row of rows) {
      if (!nonnegative(row?.min)) problems.push(`${label}加分下限必须是非负数`);
      if (!nonnegative(row?.points) || numericValue(row.points) > 100) problems.push(`${label}加分必须在 0–100 之间`);
      if (kind === 'followers' && row?.max != null && (!nonnegative(row.max) || numericValue(row.max) < numericValue(row.min))) problems.push('粉丝加分上限必须大于等于下限，或留空');
    }
  }
  for (const level of ['S', 'A']) {
    const row = scoring.levels?.[level];
    if (typeof row?.enabled !== 'boolean' || typeof row?.requireCategory !== 'boolean') problems.push(`${level} 级开关必须是布尔值`);
    if (!nonnegative(row?.minFollowers) || !nonnegative(row?.minAverageLikes)) problems.push(`${level} 级粉丝下限和均赞必须是非负数`);
    if (row?.maxFollowers != null && (!nonnegative(row.maxFollowers) || numericValue(row.maxFollowers) < numericValue(row.minFollowers))) problems.push(`${level} 级粉丝上限必须大于等于下限，或留空`);
  }
  return problems;
}

export function scoreWithRules({ profile = {}, observation = {}, categories = [], risks = [], rules = {} } = {}) {
  if (risks.length) return { score: 0, level: 'C', filtered: true, reasons: ['存在内容风险'] };
  const config = mergeScoring(rules);
  const followers = numericValue(profile.followers);
  const profileLikes = numericValue(profile.averageLikes);
  const averageLikes = Number.isFinite(profileLikes) ? profileLikes : numericValue(observation.likes);
  const bestPoints = rows => Math.max(0, ...rows.map(row => Number(row.points)));
  const likesRows = config.likes.filter(row => averageLikes >= row.min);
  const followerRows = config.followers.filter(row => followers >= row.min && (row.max == null || followers <= row.max));
  const likesPoints = bestPoints(likesRows);
  const followerPoints = bestPoints(followerRows);
  const likesRule = likesRows.find(row => Number(row.points) === likesPoints);
  const followerRule = followerRows.find(row => Number(row.points) === followerPoints);
  const bestCategory = [...categories].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  const likesSource = Number.isFinite(profileLikes) ? '平均点赞' : '当前视频点赞（主页均赞未读到）';
  const reasons = [
    `${likesSource} ${Number.isFinite(averageLikes) ? averageLikes : '未知'}：${likesRule ? `命中 ≥ ${likesRule.min} 加分档，+${likesPoints}` : '未命中加分档，+0'}`,
    `粉丝 ${Number.isFinite(followers) ? followers : '未知'}：${followerRule ? `命中 ${followerRule.min}–${followerRule.max ?? '不限'} 加分档，+${followerPoints}` : '未命中加分档，+0'}`
  ];
  if (bestCategory) reasons.push(`${bestCategory.name}：+${bestCategory.score || 0}`);
  else reasons.push('内容类别未识别：需人工确认');
  const level = ['S', 'A'].find(name => {
    const row = config.levels[name];
    return row.enabled && followers >= row.minFollowers && (row.maxFollowers == null || followers <= row.maxFollowers)
      && averageLikes >= row.minAverageLikes && (!row.requireCategory || bestCategory);
  }) || 'B';
  if (level !== 'B') {
    const row = config.levels[level];
    reasons.push(`${level} 级条件：粉丝 ${row.minFollowers}–${row.maxFollowers ?? '不限'}，${likesSource} ≥ ${row.minAverageLikes}${row.requireCategory ? '，已命中内容类目' : ''}`);
  }
  return { score: likesPoints + followerPoints + Number(bestCategory?.score || 0), level, filtered: false, reasons, bestCategory: bestCategory || null };
}
