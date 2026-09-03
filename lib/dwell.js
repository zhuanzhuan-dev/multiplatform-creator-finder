export function normalizeDwellPolicy(value = {}) {
  const mode = value.mode === "range" ? "range" : "fixed";
  const fixedSeconds = Math.min(300, Math.max(5, Number(value.fixedSeconds) || 30));
  const minSeconds = Math.min(300, Math.max(5, Number(value.minSeconds) || 10));
  const maxSeconds = Math.min(300, Math.max(minSeconds, Number(value.maxSeconds) || 30));
  const typicalSeconds = Math.min(maxSeconds, Math.max(minSeconds, Number(value.typicalSeconds) || 15));
  return { mode, fixedSeconds, minSeconds, typicalSeconds, maxSeconds };
}

export function sampleDwellSeconds(value = {}, random = Math.random) {
  const policy = normalizeDwellPolicy(value);
  if (policy.mode === "fixed" || policy.minSeconds === policy.maxSeconds) return policy.fixedSeconds;
  const { minSeconds: min, typicalSeconds: mode, maxSeconds: max } = policy;
  const unit = Math.min(1 - Number.EPSILON, Math.max(0, Number(random()) || 0));
  const split = (mode - min) / (max - min);
  const seconds = unit < split
    ? min + Math.sqrt(unit * (max - min) * (mode - min))
    : max - Math.sqrt((1 - unit) * (max - min) * (max - mode));
  return Number(seconds.toFixed(1));
}
