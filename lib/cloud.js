import { normalizeSourcePlatform } from "./source-platform.js";
import { contentTypeOf } from "./content-type.js";
export { contentTypeOf } from "./content-type.js";

export const CLOUD_CONFIG = Object.freeze({
  url: "https://kigrzhmcphrkqtuqthwb.supabase.co",
  publishableKey: "sb_publishable_Jm6gViTHXW0c4hEmX26lqw_xfcLXP78",
  edgeFunction: "ingest",
  contractVersion: 2,
  workbenchUrl: "https://fai.zhuanspirit.com/creators",
  label: "研究台 · No Swipe"
});

export const CLOUD_DESTINATION = Object.freeze({
  name: CLOUD_CONFIG.label,
  ingest: `${CLOUD_CONFIG.url}/functions/v1/${CLOUD_CONFIG.edgeFunction}`,
  workbenchUrl: CLOUD_CONFIG.workbenchUrl
});

export const MAX_INGEST_RECORDS = 100;
export const MAX_INGEST_BYTES = 400_000;

export function functionUrl(name, config = CLOUD_CONFIG) {
  return `${String(config.url || "").replace(/\/$/, "")}/functions/v1/${name}`;
}

export function normalizeAuthorName(raw) {
  return String(raw || "").replace(/^@+/, "").replace(/\s+/g, " ").trim();
}

export function pairedAuthorHref(author, href) {
  const name = normalizeAuthorName(author);
  const url = String(href || "").trim();
  if (!name || !url) return { author: name, author_href: "" };
  return { author: name, author_href: url };
}

export function hashtagsFrom(observation = {}) {
  const listed = Array.isArray(observation.hashtags)
    ? observation.hashtags.map((item) => String(item || "").replace(/^#/, "").trim()).filter(Boolean)
    : [];
  const fromCaption = String(observation.caption || "").match(/#([^\s#]+)/g) || [];
  return [...new Set([...listed.map((item) => item.startsWith("#") ? item : `#${item}`), ...fromCaption])];
}

export function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function creatorWorkCovers(profile) {
  if (!profile?.ready || profile.stale) return [];
  const seen = new Set();
  return (Array.isArray(profile.recentVideos) ? profile.recentVideos : []).filter(item => {
    if (!item || !/^https?:\/\//i.test(item.coverUrl || "") || item.coverUrl.length > 4096) return false;
    const key = item.videoId || item.coverUrl;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 24).map(item => ({
    aweme_id: String(item.videoId || ""),
    video_url: String(item.videoUrl || ""),
    cover_url: item.coverUrl,
  }));
}

export function buildObservationRecord({
  observation = {},
  profile = null,
  feedIndex,
  runId = "",
  dwellSeconds = null,
  isRelevant = false,
  decision = "skip",
  action = "skip",
  score = null,
  extra = {},
} = {}) {
  const authorSource = observation.authorName || profile?.authorName || "";
  const hrefSource = observation.profileUrl || profile?.profileUrl || "";
  const { author, author_href } = pairedAuthorHref(authorSource, hrefSource);
  const interest = finiteOrNull(score?.score);
  return {
    contract_version: 2,
    record_id: crypto.randomUUID(),
    run_id: runId || "",
    observed_at: observation.observedAt || new Date().toISOString(),
    feed_index: Math.max(1, Number.parseInt(String(feedIndex), 10) || 1),
    is_relevant: Boolean(isRelevant),
    decision: String(decision || "skip").slice(0, 128),
    action: String(action || "skip").slice(0, 128),
    dwell_seconds: finiteOrNull(dwellSeconds) ?? finiteOrNull(observation.dwellSeconds),
    interest_score: interest,
    title: "",
    caption: String(observation.caption || ""),
    author,
    author_href,
    aweme_id: String(observation.videoId || ""),
    hashtags: hashtagsFrom(observation),
    content_type: contentTypeOf(observation),
    is_ad: Boolean(observation.isAd),
    duration_seconds: finiteOrNull(observation.durationSeconds),
    current_position_seconds: null,
    like_count: finiteOrNull(observation.likes),
    comment_count: null,
    share_count: null,
    favorite_count: null,
    before_url: String(observation.beforeUrl || ""),
    after_url: String(observation.afterUrl || ""),
    scroll_delta: finiteOrNull(observation.scrollDelta),
    transition_ok: typeof observation.transitionOk === "boolean" ? observation.transitionOk : null,
    user_liked: false,
    user_favorited: false,
    user_commented: false,
    user_comment_text: "",
    user_action_reason: "",
    user_action_result: {},
    rpa_feedback: {
      source: "douyin-feed-finder",
      source_platform: normalizeSourcePlatform(observation.sourcePlatform || "douyin"),
      no_profile_navigation: true,
      content_type: contentTypeOf(observation),
      is_ad: Boolean(observation.isAd),
      finder_decision: extra.finderDecision || "",
      finder_reasons: extra.reasons || [],
      recommendation_level: score?.level || "",
      followers: finiteOrNull(profile?.followers),
      average_likes: finiteOrNull(profile?.averageLikes),
      avatar_url: String(profile?.avatarUrl || observation.avatarUrl || ""),
      video_cover_url: String(observation.coverUrl || ""),
      video_cover_source: String(observation.coverSource || ""),
      creator_work_covers: creatorWorkCovers(profile),
      published_at: observation.publishedAt || null,
      published_time_text: String(observation.publishedTimeText || ""),
      published_time_precision: observation.publishedTimePrecision || null,
      published_time_estimated: typeof observation.publishedTimeEstimated === "boolean" ? observation.publishedTimeEstimated : null,
      published_time_source: String(observation.publishedTimeSource || ""),
    },
  };
}

export function buildIngestBody({
  sessionId,
  pluginVersion,
  hostFingerprint = "",
  startedAt,
  finishedAt = null,
  stats = {},
  heartbeat = {},
  records = [],
} = {}) {
  return {
    contract_version: 2,
    session_id: sessionId,
    client: {
      plugin_version: String(pluginVersion || "0.0.0"),
      ...(hostFingerprint ? { host_fingerprint: hostFingerprint } : {}),
    },
    task_config: { collector: "douyin-feed-finder" },
    started_at: startedAt,
    finished_at: finishedAt,
    stats,
    heartbeat,
    records,
  };
}

export function encodeIngestBody(body) {
  return JSON.stringify(body);
}

export function shrinkRecordsToByteLimit(records, encode) {
  let next = [...records];
  while (next.length > 1 && encode(next).length > MAX_INGEST_BYTES) {
    next = next.slice(0, Math.max(1, Math.floor(next.length / 2)));
  }
  return next;
}

export function ingestResultSets(payload = {}) {
  return {
    accepted: new Set((payload.accepted || []).map(String)),
    duplicated: new Set((payload.duplicated || []).map(String)),
    rejected: new Map(
      (payload.rejected || [])
        .filter((item) => item?.id)
        .map((item) => [String(item.id), item.reason || "rejected"]),
    ),
  };
}

export function classifyIngestStatus(status) {
  if (status === 401) return "auth_error";
  if (status === 408 || status === 429) return "retry";
  if (status >= 400 && status < 500) return "rejected";
  if (status >= 500) return "retry";
  return "ok";
}

export function pairUrlFor(code, config = CLOUD_CONFIG) {
  return `${String(config.workbenchUrl || "").replace(/\/$/, "")}/pair?code=${encodeURIComponent(code)}`;
}

export function createCloudClient(config = CLOUD_CONFIG, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number(options.timeoutMs || 30_000);

  async function request(name, { method = "POST", token = "", body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        apikey: config.publishableKey,
        "content-type": "application/json",
      };
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await fetchImpl(functionUrl(name, config), {
        method,
        headers,
        body: body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, payload };
    } catch (error) {
      if (error?.name === "AbortError") return { ok: false, status: 504, payload: { error: "ingest_timeout" } };
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    startPairing() {
      return request("pair-start", { body: {} });
    },
    pollPairing({ code, deviceSecret, hostFingerprint }) {
      return request("pair-poll", {
        body: {
          code,
          device_secret: deviceSecret,
          host_fingerprint: hostFingerprint,
        },
      });
    },
    ingest(token, body) {
      return request(config.edgeFunction, { token, body });
    },
    checkAuth(token, pluginVersion) {
      return request(config.edgeFunction, {
        token,
        body: buildIngestBody({
          sessionId: "auth-status",
          pluginVersion,
          startedAt: new Date().toISOString(),
          records: [],
        }),
      });
    },
  };
}
