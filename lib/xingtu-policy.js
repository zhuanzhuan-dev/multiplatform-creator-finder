export const XINGTU_REST_MS = 3 * 60 * 60 * 1000;
export function xingtuPolicy(settings = {}) {
  const pages = Number(settings.xingtuTarget?.maxPages);
  const min = Number(settings.xingtuDelay?.minSeconds);
  const max = Number(settings.xingtuDelay?.maxSeconds);
  return {
    maxPages: Number.isInteger(pages) && pages >= 1 && pages <= 500 ? pages : 50,
    minSeconds: Number.isFinite(min) && min >= 1 && min <= 30 ? min : 4,
    maxSeconds: Number.isFinite(max) && max >= 1 && max <= 30 && max >= (Number.isFinite(min) ? min : 4) ? max : 6
  };
}
export function xingtuDelayMs(settings, random = Math.random) {
  const policy = xingtuPolicy(settings);
  return Math.round((policy.minSeconds + random() * (Math.max(policy.minSeconds, policy.maxSeconds) - policy.minSeconds)) * 1000);
}
export function xingtuBatchReached(state) {
  return Number(state.stats?.pagesCollected || 0) - Number(state.batchStartPages || 0) >= (state.runTarget?.maxPages || 50);
}
