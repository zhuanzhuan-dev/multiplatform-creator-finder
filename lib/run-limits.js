export function normalizeRunTarget(value = {}) {
  const mode = new Set(["time", "count", "both"]).has(value.mode) ? value.mode : "both";
  return {
    mode,
    durationMinutes: Math.min(1440, Math.max(1, Number.parseInt(String(value.durationMinutes), 10) || 60)),
    maxItems: Math.min(5000, Math.max(1, Number.parseInt(String(value.maxItems), 10) || 100))
  };
}

export function elapsedRunMs(state = {}, now = Date.now()) {
  if (state.elapsedMs != null && Number.isFinite(Number(state.elapsedMs))) {
    const active = state.status === "running" && Number.isFinite(state.activeSince);
    return Math.max(0, Number(state.elapsedMs)) + (active ? Math.max(0, now - state.activeSince) : 0);
  }
  // Existing persisted runs have timestamps but no accumulated active duration.
  const started = Date.parse(state.startedAt || "");
  if (!Number.isFinite(started)) return 0;
  const end = state.status === "running" ? now : Date.parse(state.endedAt || state.lastTickAt || state.startedAt);
  return Math.max(0, end - started);
}

export function canResumeRun(state = {}) {
  if (state.status !== "paused" || !state.runId || !state.startedAt) return false;
  if (state.route?.platform === 'feigua') return true;
  const target = normalizeRunTarget(state.runTarget || {});
  if (["count", "both"].includes(target.mode) && Number(state.stats?.scanned || 0) >= target.maxItems) return false;
  return !["time", "both"].includes(target.mode) || elapsedRunMs(state) < target.durationMinutes * 60_000;
}

export function getRunLimitReason(state = {}, settings = {}, now = Date.now()) {
  const scanned = Math.max(0, Number(state.stats?.scanned || 0));
  const target = normalizeRunTarget(state.runTarget || settings.target);
  if (["count", "both"].includes(target.mode) && scanned >= target.maxItems) {
    return `已达到本轮视频数量目标（${scanned}/${target.maxItems}条）`;
  }

  const stopAt = state.stopAt == null ? Number.NaN : Number(state.stopAt);
  if (["time", "both"].includes(target.mode) && Number.isFinite(stopAt) && now >= stopAt) {
    return `已达到本轮时长目标（${target.durationMinutes}分钟；已刷${scanned}条）`;
  }
  return "";
}
