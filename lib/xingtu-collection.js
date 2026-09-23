import { DEFAULT_KEYWORDS, decideRows, rowAccountKey, parseCardText } from './xingtu-parser.js';
import { parseCompactNumber } from './normalizers.js';
import { buildObservationRecord } from './cloud.js';

export function newXingtuCollection(runId, dryRun) {
  return { runId, dryRun, accounts: {}, excluded: {}, seen: [], pages: [], finalized: false };
}
export function xingtuFingerprint(row) {
  return JSON.stringify([rowAccountKey(row), row.xingtuId || row.authorName]);
}
export function mergeXingtuPage(collection, page, keywords = DEFAULT_KEYWORDS) {
  const rows = page.rows.map(row => ({ ...row, ...parseCardText(row.rawText || '', row) }));
  const decisions = decideRows(rows, keywords);
  const seen = new Set(collection.seen);
  const fresh = rows.filter(row => {
    const key = xingtuFingerprint(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  collection.seen = [...seen];
  const events = [];
  for (const entry of decisions.excluded) {
    const key = `xingtu:${entry.key}`;
    if (!collection.excluded[key]) events.push({ code: 'XINGTU_EXCLUDED', row: entry, reasons: [`命中规避词：${entry.matchedKeywords.join('、')}`] });
    collection.excluded[key] = entry;
    delete collection.accounts[key];
  }
  for (const entry of decisions.accounts) {
    const key = `xingtu:${entry.key}`;
    if (collection.excluded[key]) continue;
    const row = rows.find(item => rowAccountKey(item) === entry.key);
    if (!collection.accounts[key]) {
      collection.accounts[key] = { ...row, followerCount: entry.followerCount, pageUrl: page.pageUrl, observedAt: page.capturedAt, feedIndex: collection.seen.indexOf(xingtuFingerprint(row)) + 1 };
      events.push({ code: 'XINGTU_PENDING_REVIEW', row, reasons: ['已存本地候选，本轮结束后汇总上传'] });
    } else {
      const account = collection.accounts[key];
      if (entry.followerCount) account.followerCount = entry.followerCount;
      if (row.avatarUrl) account.avatarUrl = row.avatarUrl;
      if (row.xingtuIndex) account.xingtuIndex = row.xingtuIndex;
      if (row.prices) account.prices = { ...account.prices, ...row.prices };
      if (row.metrics) account.metrics = { ...account.metrics, ...row.metrics };
      if (row.city) account.city = row.city;
      if (row.gender) account.gender = row.gender;
      if (row.tags?.length) account.tags = [...new Set([...(account.tags || []), ...row.tags])];
    }
  }
  if (!collection.pages.includes(page.fingerprint)) collection.pages.push(page.fingerprint);
  return { fresh, events, duplicates: rows.length - fresh.length + Math.max(0, fresh.length - events.length) };
}
export function xingtuRecord(row, runId) {
  const record = buildObservationRecord({
    observation: {
      sourcePlatform: 'xingtu', contentType: 'unknown', authorName: row.authorName,
      profileUrl: '', videoId: '', caption: '', hashtags: row.tags, observedAt: row.observedAt,
      beforeUrl: row.pageUrl, dwellSeconds: 0, durationSeconds: null,
      avatarUrl: row.avatarUrl || '', coverUrl: '', coverSource: 'xingtu-market',
    },
    profile: { followers: parseCompactNumber(row.followerCount) },
    feedIndex: row.feedIndex, runId, isRelevant: true, decision: 'keep', action: 'collect',
    extra: { finderDecision: 'XINGTU_CANDIDATE_REVIEW', reasons: ['星图达人广场候选；按页面筛选及规避词入选，待研究台复核'] }
  });
  Object.assign(record.rpa_feedback, {
    source: 'xingtu-author-market', xingtu_profile_url: row.profileUrl || '',
    xingtu_id: row.xingtuId || '', unique_id: row.uniqueId || '',
    followers_text: row.followerCount || '', review_required: true,
    xingtu_index: row.xingtuIndex || '', prices: row.prices || {}, metrics: row.metrics || {},
    city: row.city || '', gender: row.gender || '', tags: row.tags || []
  });
  if (/^\d{1,30}$/.test(String(row.xingtuId || ''))) record.xingtu_id = row.xingtuId;
  return record;
}
