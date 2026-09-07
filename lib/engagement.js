export const ENGAGEMENT_ACTIONS = ['like', 'collect', 'follow'];
export const DEFAULT_ENGAGEMENT = { rate: 10, like: false, collect: false, follow: false };
export function newEngagement(policy = DEFAULT_ENGAGEMENT) {
  return { policy: { ...DEFAULT_ENGAGEMENT, ...policy }, videos: 0, used: { like: 0, collect: 0, follow: 0 }, sent: { like: 0, collect: 0, follow: 0 }, attempts: {}, candidate: null, lastResult: '' };
}
export const ENGAGEMENT_KEYS = {
  like: { key: 'z', code: 'KeyZ', keyCode: 90 },
  collect: { key: 'c', code: 'KeyC', keyCode: 67 },
  follow: { key: 'g', code: 'KeyG', keyCode: 71 }
};
// Preserve quota and deduplication when upgrading the earlier local mouse-click build.
export function restoreEngagement(saved) {
  const { confirmed, ...rest } = saved || {};
  return { ...newEngagement(), ...rest, sent: { like: 0, collect: 0, follow: 0, ...(rest.sent || confirmed || {}) } };
}
export function engagementLimit(ledger) {
  const rate = Number(ledger?.policy?.rate);
  return Number.isInteger(rate) && rate >= 0 && rate <= 100 ? Math.floor((ledger?.videos || 0) * rate / 100) : 0;
}
export function engagementKey(action, candidate) {
  return `${action}:${action === 'follow' ? candidate?.creatorKey : candidate?.videoId}`;
}
export function canEngage(ledger, action, videoId, loopId) {
  const candidate = ledger?.candidate;
  return ENGAGEMENT_ACTIONS.includes(action) && ledger?.policy?.[action] === true &&
    Boolean(videoId) && candidate?.videoId === videoId && candidate?.loopId === loopId && Boolean(candidate?.creatorKey) &&
    !ledger.attempts[engagementKey(action, candidate)] &&
    (ledger.used[action] || 0) < engagementLimit(ledger);
}
// Persist this reservation before sending input. Unknown outcomes retain their quota.
export function reserveEngagement(ledger, action, videoId, loopId) {
  if (!canEngage(ledger, action, videoId, loopId)) return null;
  const key = engagementKey(action, ledger.candidate);
  ledger.attempts[key] = 'reserved';
  ledger.used[action] += 1;
  return key;
}
