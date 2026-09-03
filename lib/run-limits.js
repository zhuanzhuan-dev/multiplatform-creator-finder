export function normalizeRunTarget(value = {}) {
  const mode = new Set(["time", "count", "both"]).has(value.mode) ? value.mode : "both";
  return {
    mode,
    durationMinutes: Math.min(1440, Math.max(1, Number.parseInt(String(value.durationMinutes), 10) || 60)),
    maxItems: Math.min(5000, Math.max(1, Number.parseInt(String(value.maxItems), 10) || 100))
  };
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
