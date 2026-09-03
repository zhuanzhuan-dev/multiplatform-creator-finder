export function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseCompactNumber(value) {
  const normalized = normalizeText(value).replace(/,/g, "");
  const match = normalized.match(/(-?\d+(?:\.\d+)?)\s*(亿|万|w|k)?/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const unit = String(match[2] || "").toLowerCase();
  const multiplier = unit === "亿" ? 100_000_000 : unit === "万" || unit === "w" ? 10_000 : unit === "k" ? 1_000 : 1;
  return Math.round(base * multiplier);
}

export function normalizeProfileUrl(value) {
  try {
    const url = new URL(String(value || ""), "https://www.douyin.com/");
    if (url.hostname !== "www.douyin.com" || !url.pathname.startsWith("/user/")) return "";
    return `https://www.douyin.com${url.pathname}`;
  } catch (_) {
    return "";
  }
}

export function profileKeyFromUrl(value) {
  const normalized = normalizeProfileUrl(value);
  return normalized ? normalized.split("/user/")[1] : "";
}

export function videoIdFromValue(value) {
  const text = String(value || "");
  const pathMatch = text.match(/\/video\/(\d{8,})/);
  if (pathMatch) return pathMatch[1];
  const queryMatch = text.match(/[?&](?:aweme_id|gid|group_id)=(\d{8,})/);
  return queryMatch?.[1] || "";
}

export function canonicalVideoUrl(videoId) {
  return videoId ? `https://www.douyin.com/video/${videoId}` : "";
}

export function makeCreatorKey(candidate = {}) {
  return String(candidate.secUid || candidate.creatorKey || candidate.douyinId || normalizeProfileUrl(candidate.profileUrl) || "").trim();
}

