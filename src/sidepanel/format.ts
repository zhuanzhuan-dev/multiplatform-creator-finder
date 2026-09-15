export function formatLocalDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    weekday: "short",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function formatRelativeTime(value?: string, now = Date.now()): string {
  const elapsed = now - Date.parse(value || "");
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return `${Math.floor(elapsed / 86_400_000)} 天前`;
}

export function formatCompactCount(value?: number | null): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(n % 100_000_000 === 0 ? 0 : 1)}亿`;
  if (Math.abs(n) >= 10_000) return `${(n / 10_000).toFixed(n % 10_000 === 0 ? 0 : 1)}万`;
  return String(Math.round(n));
}

export function formatVideoDuration(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(Number(seconds))) return "—";
  const total = Math.max(0, Math.floor(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function decisionMetricLine(decision: {
  plays?: number | null;
  durationSeconds?: number | null;
  likes?: number | null;
  favorites?: number | null;
  comments?: number | null;
  danmaku?: number | null;
}): string {
  const parts = [
    decision.plays != null ? `播放 ${formatCompactCount(decision.plays)}` : null,
    decision.durationSeconds != null ? `时长 ${formatVideoDuration(decision.durationSeconds)}` : null,
    decision.likes != null ? `点赞 ${formatCompactCount(decision.likes)}` : null,
    decision.favorites != null ? `收藏 ${formatCompactCount(decision.favorites)}` : null,
    decision.comments != null ? `评论 ${formatCompactCount(decision.comments)}` : null,
    decision.danmaku != null ? `弹幕 ${formatCompactCount(decision.danmaku)}` : null
  ].filter(Boolean);
  return parts.join(" · ") || "指标未写入（旧记录）";
}

export function decisionMeta(code = ""): { label: string; tone: string } {
  const value = code.toUpperCase();
  if (value === "FEIGUA_OBSERVED" || value === "XINGTU_OBSERVED") return {label:"浏览已采集",tone:"review"};
  if (value === "ACCEPTED") return { label: "符合条件", tone: "good" };
  if (value.includes("REVIEW")) return { label: "需人工确认", tone: "review" };
  if (value === "AD_SKIPPED") return { label: "跳过广告", tone: "reject" };
  if (value === "PHOTO_SKIPPED") return { label: "跳过图文", tone: "reject" };
  if (value === "UNKNOWN_TYPE_SKIPPED") return { label: "类型未确认", tone: "reject" };
  if (value.includes("LIVE")) return { label: "跳过直播", tone: "reject" };
  if (value.includes("DUPLICATE")) return { label: "重复发现", tone: "reject" };
  if (value.includes("PANEL") || value.includes("MISSING") || value.includes("INVALID")) return { label: "资料未读全", tone: "review" };
  if (["REJECT", "BLACKLIST", "RISK", "TOO_SHORT", "DURATION", "LIKES", "PLAYS", "CONTENT_EXCLUDED", "DIGITAL"].some((keyword) => value.includes(keyword))) {
    return { label: "未符合条件", tone: "reject" };
  }
  return { label: "已处理", tone: "reject" };
}
