(function attachDouyinParser(global) {
  "use strict";

  function compactText(value) {
    return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function creatorDisplayText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function parseCompactNumber(value) {
    const match = compactText(value).replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*(亿|万|w|k)?/i);
    if (!match) return null;
    const base = Number(match[1]);
    const unit = String(match[2] || "").toLowerCase();
    const multiplier = unit === "亿" ? 100000000 : unit === "万" || unit === "w" ? 10000 : unit === "k" ? 1000 : 1;
    return Number.isFinite(base) ? Math.round(base * multiplier) : null;
  }

  function clockToSeconds(value) {
    const parts = compactText(value).split(":");
    if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
    const numbers = parts.map(Number);
    const seconds = numbers.at(-1);
    const minutes = numbers.at(-2);
    if (seconds >= 60 || minutes >= 60 && parts.length === 3) return null;
    const total = parts.length === 3
      ? numbers[0] * 3600 + minutes * 60 + seconds
      : minutes * 60 + seconds;
    return Number.isFinite(total) && total > 0 ? total : null;
  }

  function durationSecondsFromText(value) {
    const match = String(value || "").match(/\d{1,3}:\d{2}(?::\d{2})?\s*\/\s*(\d{1,3}:\d{2}(?::\d{2})?)/);
    return match ? clockToSeconds(match[1]) : null;
  }

  function publicationTimeFromText(value, observedAt) {
    const publishedTimeText = compactText(value).slice(0, 200);
    const result = { publishedAt: null, publishedTimeText, publishedTimePrecision: null, publishedTimeEstimated: null };
    const now = Date.parse(observedAt);
    if (!Number.isFinite(now)) return result;
    const text = publishedTimeText.replace(/^[·•]\s*/, "");
    const relative = text.match(/^(\d+)\s*(秒|分钟|小时|天)前$/);
    if (relative || text === "刚刚") {
      const [unit, seconds] = relative ? ({ 秒: ["second", 1], 分钟: ["minute", 60], 小时: ["hour", 3600], 天: ["day", 86400] })[relative[2]] : ["minute", 60];
      const time = now - (relative ? Number(relative[1]) * seconds * 1000 : 0);
      if (Number.isFinite(time) && time >= 0) return { ...result, publishedAt: new Date(time).toISOString(), publishedTimePrecision: unit, publishedTimeEstimated: true };
      return result;
    }
    // Explicit dates are interpreted in Douyin's China time zone. Never infer a missing year.
    const absolute = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!absolute) return result;
    const [, y, m, d, h = "0", min = "0", sec = "0"] = absolute;
    if (+y < 1970 || +m < 1 || +m > 12 || +d < 1 || +d > 31 || +h > 23 || +min > 59 || +sec > 59) return result;
    const local = new Date(Date.UTC(+y, +m - 1, +d, +h, +min, +sec));
    if (local.getUTCFullYear() !== +y || local.getUTCMonth() !== +m - 1 || local.getUTCDate() !== +d) return result;
    const time = local.getTime() - 8 * 3600_000;
    if (time > now) return result;
    const precision = absolute[6] ? "second" : absolute[4] ? "minute" : "day";
    return { ...result, publishedAt: new Date(time).toISOString(), publishedTimePrecision: precision, publishedTimeEstimated: precision !== "second" };
  }

  function normalizeProfileUrl(value) {
    try {
      const url = new URL(String(value || ""), "https://www.douyin.com/");
      if (url.hostname !== "www.douyin.com" || !url.pathname.startsWith("/user/")) return "";
      return `https://www.douyin.com${url.pathname}`;
    } catch (_) {
      return "";
    }
  }

  function secUidFromUrl(value) {
    const url = normalizeProfileUrl(value);
    return url ? url.split("/user/")[1] : "";
  }

  function videoIdFromValue(value) {
    const text = String(value || "");
    return text.match(/\/video\/(\d{8,})/)?.[1]
      || text.match(/[?&](?:aweme_id|gid|group_id)=(\d{8,})/)?.[1]
      || "";
  }

  function creatorKeyFromName(value) {
    const normalized = compactText(value).replace(/^@/, "").replace(/\s+/g, "").toLowerCase();
    return normalized ? `name:${normalized}` : "";
  }

  function coverUrl(value) {
    const text = String(value || "").trim();
    if (!text || text.length > 4096 || !/^(?:https?:)?\/\//i.test(text)) return "";
    try {
      const url = new URL(text, "https://www.douyin.com/");
      if (url.username || url.password || /(?:^|[\/_.-])(?:placeholder|transparent|blank|loading)(?:[\/_.-]|$)/i.test(url.pathname)) return "";
      return url.href;
    } catch (_) { return ""; }
  }

  function coverUrlFromImage(image) {
    if (!image) return "";
    const displayed = [image.currentSrc, image.getAttribute("src")];
    const tiny = image.naturalWidth > 0 && image.naturalWidth <= 2 && image.naturalHeight > 0 && image.naturalHeight <= 2;
    const candidates = [...(tiny ? [] : displayed), ...["data-src", "data-original", "data-lazy-src"].map(name => image.getAttribute(name))];
    return candidates.map(coverUrl).find(Boolean) || "";
  }

  function feedCover(element, drawer, video) {
    const poster = coverUrl(video?.getAttribute("poster"));
    if (poster) return { coverUrl: poster, coverSource: "video.poster" };
    // Only dedicated cover nodes qualify; never fall back to arbitrary card images/avatars.
    const nodes = element.querySelectorAll('[data-e2e="video-cover"], [data-e2e="feed-video-cover"], .xgplayer-poster');
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (drawer?.contains(node) || node.closest('[hidden], [aria-hidden="true"]') || !rect.width || !rect.height || global.getComputedStyle(node).visibility !== "visible") continue;
      const image = node.tagName === "IMG" ? node : node.querySelector("img");
      const imageUrl = coverUrlFromImage(image);
      if (imageUrl) return { coverUrl: imageUrl, coverSource: "cover-image" };
      const background = global.getComputedStyle(node).backgroundImage;
      const match = background.match(/^url\(["']?(.*?)["']?\)$/);
      const backgroundUrl = coverUrl(match?.[1]);
      if (backgroundUrl) return { coverUrl: backgroundUrl, coverSource: "cover-background" };
    }
    return { coverUrl: "", coverSource: "" };
  }

  function avatarUrlFromImage(image) {
    const value = String(image?.currentSrc || image?.getAttribute?.("src") || "").trim();
    return /^https:\/\//i.test(value) ? value : "";
  }

  function avatarUrlForProfile(root, profileUrl = "", authorName = "") {
    if (!root?.querySelectorAll) return "";
    const normalizedProfileUrl = normalizeProfileUrl(profileUrl);
    const normalizedAuthorName = cleanCreatorName(authorName).replace(/\s+/g, "").toLowerCase();
    const directAvatar = root.querySelector('[data-e2e="video-avatar"] img[src]');
    if (directAvatar) return avatarUrlFromImage(directAvatar);
    const linkedImages = [...root.querySelectorAll('a[href*="/user/"]')]
      .filter((link) => !normalizedProfileUrl || normalizeProfileUrl(link.href) === normalizedProfileUrl)
      .flatMap((link) => [...link.querySelectorAll("img[src]")]);
    const linkedAvatar = linkedImages.find((image) => /aweme-avatar|avatar/i.test(avatarUrlFromImage(image)))
      || linkedImages[0];
    if (linkedAvatar) return avatarUrlFromImage(linkedAvatar);

    if (!normalizedAuthorName) return "";
    const namedAvatar = [...root.querySelectorAll("img[src]")].find((image) => {
      const alt = compactText(image.alt || image.getAttribute("aria-label") || "").replace(/\s+/g, "").toLowerCase();
      return alt.includes(normalizedAuthorName) && /头像/.test(alt);
    });
    return avatarUrlFromImage(namedAvatar);
  }

  function isCreatorNameUiText(value) {
    const text = compactText(value).replace(/^@/, "");
    return /^(?:前往|打开|进入|查看|访问).{0,12}(?:作者|达人)主页$/.test(text)
      || /^(?:作者|达人)主页$/.test(text)
      || /^\d{4}年\d{1,2}月精选作者$/.test(text)
      || /^(?:抖音)?精选作者|优质创作者|认证作者|创作者等级/.test(text)
      || /^\d+(?:\.\d+)?(?:万|亿|w|k)?\s*(?:粉丝|获赞)$/i.test(text);
  }

  function cleanCreatorName(value) {
    let text = creatorDisplayText(value);
    const atIndex = text.indexOf("@");
    if (atIndex >= 0) text = text.slice(atIndex + 1);
    text = text
      .split(/[|｜›>]/)[0]
      .replace(/^@/, "")
      .replace(/[›>]+$/, "")
      .replace(/\s*\d{4}年\d{1,2}月精选作者$/, "")
      .trim();
    return !text || text === "@" || isCreatorNameUiText(text) ? "" : creatorDisplayText(text);
  }

  function creatorNameFromFeedSources(nicknameText = "", profileLinkText = "", lines = []) {
    const atLine = (lines || []).map(creatorDisplayText).find((line) => line.startsWith("@")) || "";
    return [nicknameText, atLine, profileLinkText].map(cleanCreatorName).find(Boolean) || "";
  }

  function creatorNameFromPanelLines(lines = [], profileLinkText = "") {
    const values = [profileLinkText, ...lines].map(creatorDisplayText).filter(Boolean);
    for (const value of values) {
      if (!value.includes("@")) continue;
      const matched = cleanCreatorName(value);
      if (matched) return matched;
    }
    return values.map(cleanCreatorName).find((value) => {
      if (!value || value === "@") return false;
      if (/^(详情|TA的作品|评论|AI抖音|相关推荐|关注)$/.test(value)) return false;
      return true;
    }) || "";
  }

  function visibleFeedItem(documentRef = document) {
    const viewportHeight = documentRef.defaultView?.innerHeight || global.innerHeight || 900;
    const items = [...documentRef.querySelectorAll('[data-e2e="feed-item"]')];
    return items
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        return { element, rect, visibleHeight, distance: Math.abs((rect.top + rect.bottom) / 2 - viewportHeight / 2) };
      })
      .filter((item) => item.rect.width > 200 && item.rect.height > 200 && item.visibleHeight > item.rect.height * 0.35)
      .sort((a, b) => b.visibleHeight - a.visibleHeight || a.distance - b.distance)[0]?.element || null;
  }

  function blockedReason(documentRef = document) {
    const text = String(documentRef.body?.innerText || "");
    if (/请输入验证码|完成验证|安全验证|访问过于频繁|操作频繁/.test(text)) return "抖音页面需要人工完成安全验证";
    if (/扫码登录|密码登录|登录后即可/.test(text) && !documentRef.querySelector('a[href*="/user/"]')) return "抖音页面登录失效";
    return "";
  }

  const WORKS_LIST_SELECTORS = [
    '[data-e2e="author-card-list"]',
    '[data-e2e="user-post-list"]',
    '[data-e2e*="author"][data-e2e*="list"]',
    '[data-e2e*="post"][data-e2e*="list"]'
  ];

  function isWorksLabel(value) {
    const text = compactText(value).replace(/\s+/g, "");
    return /^TA(?:的)?作品(?:\(?\d+\)?)?$/i.test(text);
  }

  function isWorksListComplete(value) {
    return /暂时没有更多作品|没有更多作品|已展示全部作品/.test(compactText(value));
  }

  function visibleArea(element, documentRef = document) {
    if (!element?.getBoundingClientRect) return 0;
    const rect = element.getBoundingClientRect();
    const view = documentRef.defaultView || global;
    const width = Math.max(0, Math.min(rect.right, view.innerWidth || 1920) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, view.innerHeight || 900) - Math.max(rect.top, 0));
    return width * height;
  }

  function worksTab(documentRef = document, scope = visibleFeedItem(documentRef)) {
    const selector = '[role="tab"], [data-e2e*="tab"], button, [tabindex], a, span';
    const labels = [...documentRef.querySelectorAll(selector)]
      .filter((element) => isWorksLabel(element.getAttribute("aria-label") || element.textContent));
    const candidates = labels
      .map((label) => label.closest('[role="tab"], [data-e2e*="tab"], button, [tabindex], a') || label)
      .filter((element, index, all) => all.indexOf(element) === index)
      .map((element) => ({
        element,
        area: visibleArea(element, documentRef),
        inCurrentFeed: Boolean(scope?.contains?.(element))
      }))
      .filter((item) => item.area > 0)
      .sort((a, b) => Number(b.inCurrentFeed) - Number(a.inCurrentFeed) || b.area - a.area);
    return candidates[0]?.element || null;
  }

  function directWorksList(scope) {
    for (const selector of WORKS_LIST_SELECTORS) {
      const list = scope?.querySelector?.(selector);
      if (list) return list;
    }
    return null;
  }

  function worksList(documentRef = document, tab = worksTab(documentRef), scope = visibleFeedItem(documentRef)) {
    const direct = directWorksList(scope);
    if (direct) return direct;
    let root = tab;
    while (root?.parentElement && root !== documentRef.body) {
      const candidates = [...root.querySelectorAll('[role="list"], ul, [class*="work"], [class*="post"]')]
        .filter((element) => element.querySelector('a[href*="/video/"], img[src], img[srcset], img[data-src], img[data-original], img[data-lazy-src]'))
        .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
      if (candidates[0]) return candidates[0];
      root = root.parentElement;
    }
    return null;
  }

  function tabSelected(tab) {
    if (!tab) return false;
    const className = typeof tab.className === "string" ? tab.className : "";
    return tab.getAttribute("aria-selected") === "true"
      || tab.getAttribute("data-state") === "active"
      || tab.classList.contains("semi-tabs-tab-active")
      || /(?:^|[-_\s])(active|selected|current)(?:$|[-_\s])/i.test(className)
      || tab.getAttribute("tabindex") === "0";
  }

  function creatorDrawerRoot(documentRef = document, scope = visibleFeedItem(documentRef)) {
    const tab = worksTab(documentRef, scope);
    if (!tab) return null;
    let element = tab;
    while (element?.parentElement) {
      const text = String(element.innerText || "");
      if (/\d+(?:\.\d+)?(?:万|亿|w|k)?\s*粉丝/i.test(text)
        && /\d+(?:\.\d+)?(?:万|亿|w|k)?\s*获赞/i.test(text)
        && (directWorksList(element) || element.querySelector('a[href*="/video/"], img[src], img[srcset], img[data-src], img[data-original], img[data-lazy-src]'))) return element;
      element = element.parentElement;
    }
    return null;
  }

  function creatorPanelState(documentRef = document) {
    const scope = visibleFeedItem(documentRef);
    const tab = worksTab(documentRef, scope);
    const list = worksList(documentRef, tab, scope);
    const selected = tabSelected(tab);
    const hasWorks = Boolean(list?.querySelector('a[href*="/video/"], img[src], img[srcset], img[data-src], img[data-original], img[data-lazy-src]'));
    return {
      present: Boolean(tab),
      selected,
      hasWorks,
      ready: Boolean(tab && list && hasWorks && (selected || tab.getAttribute("role") !== "tab"))
    };
  }

  function visibleTextWithoutDrawer(element, drawer) {
    let text = String(element?.innerText || element?.textContent || "");
    const drawerText = String(drawer?.innerText || "");
    if (drawerText && text.includes(drawerText)) text = text.replace(drawerText, "");
    return text;
  }

  function feedContentIdentity(element, drawer) {
    const visible = (node) => {
      if (drawer?.contains(node)) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !node.closest('[hidden], [aria-hidden="true"]');
    };
    const nodes = [element, ...element.querySelectorAll('[data-e2e], video, a[href], button, [role="button"]')].filter(visible);
    const markers = nodes.map((node) => node.getAttribute('data-e2e') || '');
    const has = (...names) => markers.some((marker) => names.includes(marker));
    // Only dedicated controls/markers qualify; words in captions are not type evidence.
    const live = has('feed-live') || nodes.some((node) =>
      !node.closest('[data-e2e="video-desc"]') &&
      (/^https:\/\/live\.douyin\.com\/\d+/.test(node.href || '') ||
       /^(进入直播间|观看直播)$/.test(compactText(node.textContent)) && ['BUTTON', 'A'].includes(node.tagName)));
    const photo = has('feed-photo', 'feed-image', 'image-player', 'note-container');
    const isAd = has('feed-ad', 'ad-label', 'feed-ad-label', 'video-ad-label') ||
      [...element.querySelectorAll('span')].some((node) => visible(node) &&
        !node.closest('[data-e2e="video-desc"], [data-e2e="feed-video-nickname"], a') &&
        node.children.length === 0 && compactText(node.textContent) === '广告');
    const video = has('feed-video') || nodes.some((node) => node.tagName === 'VIDEO' && Number.isFinite(node.duration) && node.duration > 0);
    const contentType = live ? 'live' : photo ? 'photo' : video ? 'video' : 'unknown';
    const typeEvidence = [];
    if (live) typeEvidence.push(has('feed-live') ? 'visible marker: feed-live' : 'dedicated live link or live entry control');
    if (photo) typeEvidence.push(`visible photo marker: ${markers.filter(m => ['feed-photo','feed-image','image-player','note-container'].includes(m)).join(', ')}`);
    if (video) typeEvidence.push(has('feed-video') ? 'visible marker: feed-video' : 'visible video element with positive duration');
    if (isAd) typeEvidence.push(has('feed-ad','ad-label','feed-ad-label','video-ad-label') ? 'visible ad marker' : 'dedicated ad label outside caption, author and links');
    if (!typeEvidence.length) typeEvidence.push('no confirmed type signal');
    return { contentType, isLive: live, isAd, typeEvidence, subtype: live ? 'feed-live' : photo ? 'feed-photo' : video ? 'feed-video' : has('feed-ad') ? 'feed-ad' : '' };
  }

  function parseFeedItem(element, documentRef = document) {
    if (!element) return null;
    const drawer = creatorDrawerRoot(documentRef, element);
    const rawText = visibleTextWithoutDrawer(element, drawer);
    const cardText = compactText(rawText);
    const observedAt = new Date().toISOString();
    const publicationNode = [...element.querySelectorAll('.video-create-time .time')].find((node) => {
      const rect = node.getBoundingClientRect();
      const style = global.getComputedStyle(node);
      return !drawer?.contains(node) && !node.closest('[hidden], [aria-hidden="true"], [data-e2e="video-desc"]') && rect.width > 0 && rect.height > 0 && style.visibility === "visible";
    });
    const publication = publicationTimeFromText(publicationNode?.innerText || publicationNode?.textContent || "", observedAt);
    const profileLink = [...element.querySelectorAll('a[href*="/user/"]')]
      .filter((link) => !drawer?.contains(link))
      .map((link) => ({ link, url: normalizeProfileUrl(link.href), text: compactText(link.innerText || link.textContent || "") }))
      .find((item) => item.url);
    const allHrefs = [...element.querySelectorAll("a[href]")]
      .filter((link) => !drawer?.contains(link))
      .map((link) => link.href);
    const videoIdNode = element.querySelector('[data-e2e-vid], [data-e2e-aweme-id]');
    const videoId = String(videoIdNode?.getAttribute("data-e2e-vid") || videoIdNode?.getAttribute("data-e2e-aweme-id") || "")
      || allHrefs.map(videoIdFromValue).find(Boolean)
      || "";
    const hashtagTexts = [...element.querySelectorAll('a[href*="/search/"]')]
      .filter((link) => !drawer?.contains(link))
      .map((link) => compactText(link.innerText || link.textContent || ""))
      .filter((text) => text.startsWith("#"));
    const identity = feedContentIdentity(element, drawer);
    const lines = rawText.split(/\r?\n/).map((line) => compactText(line)).filter(Boolean);
    const nicknameNode = element.querySelector('[data-e2e="feed-video-nickname"]');
    const authorName = creatorNameFromFeedSources(
      nicknameNode?.innerText || nicknameNode?.textContent || "",
      profileLink?.text || "",
      lines
    );
    const avatarUrl = avatarUrlForProfile(element, profileLink?.url || "", authorName);
    const captionNode = element.querySelector('[data-e2e="video-desc"]');
    const explicitCaption = compactText(captionNode?.innerText || captionNode?.textContent || "")
      .replace(/\s*(?:展开|收起)$/, "")
      .trim();
    const captionCandidates = lines.filter((line) => {
      if (line.length < 4 || line === authorName || line === `@${authorName}`) return false;
      if (/^\d+(?:\.\d+)?(?:万|亿|w|k)?$/i.test(line)) return false;
      if (/^\d{1,2}:\d{2}(?:\s*\/\s*\d{1,2}:\d{2})?$/.test(line)) return false;
      if (/^(发送|连播|倍速|智能|清屏|听抖音|直播中|播放中|正在播放|下一章|本场高光)$/.test(line)) return false;
      if (/^[·•]\s*\d+(?:分钟|小时|天)前/.test(line)) return false;
      return true;
    });
    const caption = explicitCaption
      || captionCandidates.find((line) => line.includes("#"))
      || captionCandidates.find((line) => line.length >= 8)
      || captionCandidates[0]
      || "";
    const video = [...element.querySelectorAll("video")].find((item) => {
      const rect = item.getBoundingClientRect();
      return !drawer?.contains(item) && !item.closest('[hidden], [aria-hidden="true"]') && rect.width > 200 && rect.height > 200 && global.getComputedStyle(item).visibility === "visible";
    });
    const cover = feedCover(element, drawer, video);
    const displayedDurationSeconds = durationSecondsFromText(rawText);
    const mediaDurationSeconds = Number(video?.duration);
    const durationSeconds = Number.isFinite(displayedDurationSeconds) && displayedDurationSeconds > 0
      ? displayedDurationSeconds
      : Number.isFinite(mediaDurationSeconds) && mediaDurationSeconds > 0
        ? Math.round(mediaDurationSeconds)
        : null;
    const likeNode = element.querySelector('[data-e2e="video-player-digg"], [data-e2e="like-count"], [data-e2e="video-like-count"], [aria-label*="点赞"]');
    const numericLines = lines.filter((line) => /^\d+(?:\.\d+)?(?:万|亿|w|k)?$/i.test(line));
    const likesText = compactText(likeNode?.innerText || likeNode?.textContent || numericLines[0] || "");
    return {
      videoId,
      sourcePlatform: "douyin",
      videoUrl: videoId ? `https://www.douyin.com/video/${videoId}` : "",
      profileUrl: profileLink?.url || "",
      secUid: secUidFromUrl(profileLink?.url || ""),
      authorName,
      avatarUrl,
      ...cover,
      caption,
      hashtags: [...new Set(hashtagTexts)],
      cardText,
      durationSeconds,
      likes: parseCompactNumber(likesText),
      likesText,
      ...identity,
      ...publication,
      publishedTimeSource: publication.publishedTimeText ? "dom:.video-create-time .time" : "",
      observedAt
    };
  }

  function parseCurrentFeed(documentRef = document) {
    const blocked = blockedReason(documentRef);
    if (blocked) return { blockedReason: blocked };
    const element = visibleFeedItem(documentRef);
    return element ? parseFeedItem(element, documentRef) : null;
  }

  function parseCreatorPanel(documentRef = document, observation = {}) {
    const state = creatorPanelState(documentRef);
    if (!state.ready) return { ready: false, panelState: state };
    const scope = visibleFeedItem(documentRef);
    const drawer = creatorDrawerRoot(documentRef, scope);
    const list = worksList(documentRef, worksTab(documentRef, scope), scope);
    if (!drawer || !list) return { ready: false, panelState: state };

    const drawerText = String(drawer.innerText || "");
    const lines = drawerText.split(/\r?\n/).map((line) => compactText(line)).filter(Boolean);
    const panelProfile = [...drawer.querySelectorAll('a[href*="/user/"]')]
      .map((link) => ({
        url: normalizeProfileUrl(link.href),
        text: compactText(link.innerText || link.textContent || "")
      }))
      .find((item) => item.url) || { url: "", text: "" };
    const panelProfileUrl = panelProfile.url;
    const panelSecUid = secUidFromUrl(panelProfileUrl);
    const followerIndex = lines.findIndex((line) => /^\d+(?:\.\d+)?(?:万|亿|w|k)?\s*粉丝$/i.test(line));
    const totalLikesIndex = lines.findIndex((line) => /^\d+(?:\.\d+)?(?:万|亿|w|k)?\s*获赞$/i.test(line));
    const followersText = followerIndex >= 0 ? lines[followerIndex].replace(/\s*粉丝$/i, "") : "";
    const totalLikesText = totalLikesIndex >= 0 ? lines[totalLikesIndex].replace(/\s*获赞$/i, "") : "";
    const panelAuthorName = creatorNameFromPanelLines(
      followerIndex > 0 ? lines.slice(0, followerIndex) : lines.slice(0, 8),
      panelProfile.text
    );
    const avatarUrl = avatarUrlForProfile(drawer, panelProfileUrl, panelAuthorName) || observation.avatarUrl || "";
    const followIndex = lines.indexOf("关注", Math.max(followerIndex, totalLikesIndex));
    const bio = followIndex >= 0
      ? lines.slice(followIndex + 1).filter((line) => !/^(置顶|共创|播放中|正在播放)$/.test(line) && !/^\d+(?:\.\d+)?(?:万|亿|w|k)?$/i.test(line)).slice(0, 5).join(" ").slice(0, 500)
      : "";

    const media = [
      ...list.querySelectorAll('a[href*="/video/"] img'),
      ...list.querySelectorAll('img[src], img[srcset], img[data-src], img[data-original], img[data-lazy-src]')
    ].filter((image, index, all) => all.indexOf(image) === index);
    const recentVideos = media.map((image, index) => {
      let card = image.closest('a[href*="/video/"]') || image;
      while (card?.parentElement && card !== list) {
        if (card.tagName === "A" || /^\s*(?:置顶\s*)?\d+(?:\.\d+)?(?:万|亿|w|k)?\s*(?:播放中)?\s*$/i.test(card.innerText || "")) break;
        card = card.parentElement;
      }
      const cardText = compactText(card?.innerText || "");
      const likesText = cardText.match(/\d+(?:\.\d+)?(?:万|亿|w|k)?/i)?.[0] || "";
      const alt = compactText(image.alt || image.getAttribute("aria-label") || "");
      const text = alt.includes("：") ? alt.slice(alt.indexOf("：") + 1) : alt;
      const link = image.closest('a[href*="/video/"]');
      const idNode = image.closest('[data-e2e-vid], [data-e2e-aweme-id]');
      const declaredId = idNode && list.contains(idNode) ? idNode.getAttribute("data-e2e-vid") || idNode.getAttribute("data-e2e-aweme-id") || "" : "";
      const videoId = (link && list.contains(link) ? videoIdFromValue(link.getAttribute("href")) : "") || (/^\d{8,}$/.test(declaredId) ? declaredId : "");
      return {
        index,
        text: text.slice(0, 500),
        coverAlt: alt.slice(0, 500),
        coverUrl: coverUrlFromImage(image),
        videoId,
        videoUrl: videoId ? `https://www.douyin.com/video/${videoId}` : "",
        likesText,
        likes: parseCompactNumber(likesText),
        pinned: /置顶/.test(cardText),
        playing: /播放中|正在播放/.test(cardText)
      };
    }).filter((item) => item.coverAlt || item.coverUrl || Number.isFinite(item.likes)).slice(0, 24);
    const sample = recentVideos.filter((video) => Number.isFinite(video.likes) && !video.pinned).slice(0, 12);
    const fallbackSample = recentVideos.filter((video) => Number.isFinite(video.likes)).slice(0, 12);
    const likeSample = sample.length >= 3 ? sample : fallbackSample;
    const averageLikes = likeSample.length
      ? Math.round(likeSample.reduce((sum, video) => sum + video.likes, 0) / likeSample.length)
      : null;
    const normalizedPanelName = compactText(panelAuthorName).replace(/^@/, "").replace(/\s+/g, "").toLowerCase();
    const normalizedFeedName = compactText(observation.authorName).replace(/^@/, "").replace(/\s+/g, "").toLowerCase();
    const observationSecUid = observation.secUid || secUidFromUrl(observation.profileUrl);
    const namesMatch = !normalizedFeedName || !normalizedPanelName
      || normalizedFeedName === normalizedPanelName
      || normalizedFeedName.includes(normalizedPanelName)
      || normalizedPanelName.includes(normalizedFeedName);
    const matchesObservation = observationSecUid && panelSecUid
      ? observationSecUid === panelSecUid
      : namesMatch;
    const feedAuthorName = cleanCreatorName(observation.authorName);
    const authorName = matchesObservation
      ? feedAuthorName || panelAuthorName
      : panelAuthorName || feedAuthorName || "";

    return {
      ready: Boolean(matchesObservation && authorName && Number.isFinite(parseCompactNumber(followersText))),
      stale: !matchesObservation,
      panelState: state,
      creatorKey: observationSecUid || panelSecUid || creatorKeyFromName(authorName),
      secUid: observationSecUid || panelSecUid,
      profileUrl: observation.profileUrl || panelProfileUrl,
      authorName,
      avatarUrl,
      followers: parseCompactNumber(followersText),
      followersText,
      totalLikes: parseCompactNumber(totalLikesText),
      totalLikesText,
      bio,
      recentVideos,
      videoCount: recentVideos.length,
      worksListComplete: isWorksListComplete(drawerText),
      latestVideoLikes: recentVideos.find((video) => !video.pinned)?.likes ?? recentVideos[0]?.likes ?? null,
      averageLikes,
      averageLikesSampleSize: likeSample.length,
      collectedAt: new Date().toISOString()
    };
  }

  global.DouyinAutoFinderParser = {
    blockedReason,
    creatorDrawerRoot,
    creatorNameFromFeedSources,
    creatorNameFromPanelLines,
    creatorKeyFromName,
    creatorPanelState,
    clockToSeconds,
    coverUrl,
    coverUrlFromImage,
    durationSecondsFromText,
    publicationTimeFromText,
    normalizeProfileUrl,
    isWorksLabel,
    isWorksListComplete,
    parseCompactNumber,
    parseCreatorPanel,
    parseCurrentFeed,
    parseFeedItem,
    feedContentIdentity,
    secUidFromUrl,
    videoIdFromValue,
    visibleFeedItem,
    worksList,
    worksTab
  };

})(globalThis);
