export function contentTypeOf(observation = {}) {
  if (observation.isLive || observation.subtype === "feed-live") return "live";
  if (["video", "photo", "live", "unknown"].includes(observation.contentType)) return observation.contentType;
  if (["feed-photo", "feed-image"].includes(observation.subtype)) return "photo";
  if (observation.subtype === "feed-video") return "video";
  return "unknown";
}

export function contentSkipDecision(observation = {}) {
  if (observation.isAd) return { code: "AD_SKIPPED", counter: "adSkipped", reasons: ["已识别广告，跳过"] };
  const type = contentTypeOf(observation);
  if (type === "video") return null;
  const [code, counter, reason] = {
    live: ["LIVE_SKIPPED", "liveSkipped", "直播内容（含图文直播），跳过"],
    photo: ["PHOTO_SKIPPED", "photoSkipped", "图文内容，跳过"],
    unknown: ["UNKNOWN_TYPE_SKIPPED", "unknownSkipped", "内容类型暂未确认，跳过"]
  }[type];
  return { code, counter, reasons: [reason] };
}
