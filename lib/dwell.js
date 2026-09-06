export function normalizeDwellPolicy(value = {}) {
  const mode = value.mode === "fixed" ? "fixed" : "range";
  const fixedSeconds = Math.min(300, Math.max(5, Number(value.fixedSeconds) || 30));
  const minSeconds = Math.min(300, Math.max(5, Number(value.minSeconds) || 10));
  const maxSeconds = Math.min(300, Math.max(minSeconds, Number(value.maxSeconds) || 30));
  const typicalSeconds = Math.min(maxSeconds, Math.max(minSeconds, Number(value.typicalSeconds) || 20));
  return { mode, fixedSeconds, minSeconds, typicalSeconds, maxSeconds };
}

export function sampleDwellSeconds(value = {}, random = Math.random) {
  const policy = normalizeDwellPolicy(value);
  if (policy.mode === "fixed") return policy.fixedSeconds;
  const { minSeconds: min, typicalSeconds: mean, maxSeconds: max } = policy;
  if (min === max) return min;
  const sigma = (max - min) / 6;
  const unit = () => Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, Number(random()) || 0));
  // Box–Muller normal sampling, rejecting tails instead of clamping them to endpoints.
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const z = Math.sqrt(-2 * Math.log(unit())) * Math.cos(2 * Math.PI * unit());
    const seconds = mean + sigma * z;
    if (seconds >= min && seconds <= max) return Math.min(max, Math.max(min, Number(seconds.toFixed(1))));
  }
  return mean;
}
