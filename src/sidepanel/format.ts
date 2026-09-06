import type { Decision } from "./types";

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

export function decisionMeta(code = ""): { label: string; tone: string } {
  const value = code.toUpperCase();
  if (value === "ACCEPTED") return { label: "符合条件", tone: "good" };
  if (value.includes("REVIEW")) return { label: "需人工确认", tone: "review" };
  if (value === "AD_SKIPPED") return { label: "跳过广告", tone: "reject" };
  if (value === "PHOTO_SKIPPED") return { label: "跳过图文", tone: "reject" };
  if (value === "UNKNOWN_TYPE_SKIPPED") return { label: "类型未确认", tone: "reject" };
  if (value.includes("LIVE")) return { label: "跳过直播", tone: "reject" };
  if (value.includes("DUPLICATE")) return { label: "重复发现", tone: "reject" };
  if (value.includes("PANEL") || value.includes("MISSING") || value.includes("INVALID")) return { label: "资料未读全", tone: "review" };
  if (["REJECT", "BLACKLIST", "RISK", "TOO_SHORT", "DURATION", "LIKES"].some((keyword) => value.includes(keyword))) {
    return { label: "未符合条件", tone: "reject" };
  }
  return { label: "已处理", tone: "reject" };
}

export function decisionsFor(state: { recentDecisions?: Decision[]; lastDecision?: Decision | null }): Decision[] {
  if (state.recentDecisions?.length) return state.recentDecisions;
  return state.lastDecision ? [state.lastDecision] : [];
}
