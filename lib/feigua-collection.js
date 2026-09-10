import { DEFAULT_KEYWORDS, decideRows, rowAccountKey, parseRowText } from './feigua-parser.js';
import { parseCompactNumber } from './normalizers.js';
import { buildObservationRecord } from './cloud.js';

export function newFeiguaCollection(runId, dryRun) {
  return { runId, dryRun, accounts: {}, excluded: {}, seen: [], pages: [], finalized: false };
}
export function feiguaFingerprint(row) {
  return JSON.stringify([rowAccountKey(row), row.videoId || row.title]);
}
export function mergeFeiguaPage(collection, page, keywords = DEFAULT_KEYWORDS) {
  const rows = page.rows.map(row => ({ ...row, ...parseRowText(row.rawText || '', row) }));
  const decisions = decideRows(rows, keywords);
  const seen = new Set(collection.seen);
  const fresh = rows.filter(row => {
    const key = feiguaFingerprint(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  collection.seen = [...seen];
  const events = [];
  for (const entry of decisions.excluded) {
    const key = `feigua:${entry.key}`;
    if (!collection.excluded[key]) events.push({ code: 'FEIGUA_EXCLUDED', row: entry, reasons: [`命中规避词：${entry.matchedKeywords.join('、')}`] });
    collection.excluded[key] = entry;
    delete collection.accounts[key];
  }
  for (const entry of decisions.accounts) {
    const key = `feigua:${entry.key}`;
    if (collection.excluded[key]) continue;
    const row = rows.find(row => rowAccountKey(row) === entry.key);
    if (!collection.accounts[key]) {
      collection.accounts[key] = { ...row, followerCount: entry.followerCount, pageUrl: page.pageUrl, observedAt: page.capturedAt, feedIndex: collection.seen.indexOf(feiguaFingerprint(row)) + 1 };
      events.push({ code: 'FEIGUA_PENDING_REVIEW', row, reasons: ['已存本地候选，本轮结束后汇总上传'] });
    } else if (entry.followerCount) collection.accounts[key].followerCount = entry.followerCount;
    const account = collection.accounts[key];
    if (row.avatarUrl) account.avatarUrl = row.avatarUrl;
    // Preserve every observed video under its account, including refreshed metrics on replay.
    const videos = new Map((account.videos || [account]).map(video => [feiguaFingerprint(video), { ...video, videos: undefined }]));
    for (const video of rows.filter(item => rowAccountKey(item) === entry.key)) {
      videos.set(feiguaFingerprint(video), { ...video, pageUrl: page.pageUrl, observedAt: page.capturedAt });
    }
    account.videos = [...videos.values()];
  }
  if (!collection.pages.includes(page.fingerprint)) collection.pages.push(page.fingerprint);
  return { fresh, events, duplicates: rows.length - fresh.length + Math.max(0, fresh.length - events.length) };
}
export function feiguaRecord(row, runId) {
  const record = buildObservationRecord({
    observation: {
      sourcePlatform: 'feigua', contentType: 'video', authorName: row.authorName,
      // Feigua blogger IDs are not Douyin sec_uids. Preserve provenance separately.
      profileUrl: row.douyinProfileUrl || '', videoId: row.videoId || '',
      caption: row.title, hashtags: row.topics, observedAt: row.observedAt,
      beforeUrl: row.pageUrl, dwellSeconds: 0, durationSeconds: row.durationSeconds,
      avatarUrl: row.avatarUrl || '', coverUrl: row.coverUrl || '', coverSource: 'feigua-list',
    },
    profile: { followers: parseCompactNumber(row.followerCount) },
    feedIndex: row.feedIndex, runId, isRelevant: true, decision: 'keep', action: 'collect',
    extra: { finderDecision: 'FEIGUA_CANDIDATE_REVIEW', reasons: ['飞瓜视频库候选；按页面筛选及规避词入选，待研究台复核'] }
  });
  Object.assign(record.rpa_feedback, {
    source: 'feigua-video-library', feigua_profile_url: row.profileUrl || '',
    followers_text: row.followerCount || '', review_required: true,
    feigua_videos: row.videos || [{...row, videos: undefined}]
  });
  return record;
}
