// 抖音网页播放器把平台提示画在当前卡片上，常见容器是 .safetyBar。
// 只认整段文字与官方提示一致；简介、昵称和话题里的相同字样不算。
export const OFFICIAL_AI_HINTS = Object.freeze([
  "疑似使用了AI生成技术，请谨慎甄别",
  "作品含AI生成内容",
  "内容由AI生成",
  "人工智能生成",
  "AI生成",
]);

const OFFICIAL = new Set(OFFICIAL_AI_HINTS);

export function normalizeAiHintText(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, "").replace(/^作者声明[:：]/, "");
}

export function officialAiHintText(value) {
  const text = normalizeAiHintText(value && typeof value === "object" ? value.text : value);
  return OFFICIAL.has(text) ? text : "";
}

function scopesOf(root) {
  const scopes = [];
  const visit = (scope) => {
    if (!scope?.querySelectorAll || scopes.includes(scope)) return;
    scopes.push(scope);
    for (const element of scope.querySelectorAll("*")) {
      if (element?.shadowRoot) visit(element.shadowRoot);
    }
  };
  visit(root);
  return scopes;
}

function elementText(node) {
  return normalizeAiHintText(node?.textContent || "");
}

function excludedCopy(node) {
  return Boolean(node?.closest?.('[data-e2e="video-desc"], [data-e2e="feed-video-nickname"], [data-e2e="feed-video-avatar"], a'));
}

function inLowerLeft(node, video) {
  const videoRect = video?.getBoundingClientRect?.();
  if (!videoRect || !(videoRect.width > 0) || !(videoRect.height > 0) || !node?.getBoundingClientRect) return true;
  const rect = node.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return false;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return centerX >= videoRect.left && centerX <= videoRect.left + videoRect.width * 0.5
    && centerY >= videoRect.top + videoRect.height * 0.55 && centerY <= videoRect.bottom + 8;
}

// 读到官方提示才返回文字。没有提示返回空，不能据此当成非 AI。
export function readDouyinAiHint(root, video = null) {
  if (!root?.querySelectorAll) return null;
  for (const scope of scopesOf(root)) {
    for (const bar of scope.querySelectorAll(".safetyBar")) {
      const text = elementText(bar);
      if (OFFICIAL.has(text)) return { text, source: "safetyBar" };
    }
  }
  for (const scope of scopesOf(root)) {
    let match = null;
    for (const node of scope.querySelectorAll("*")) {
      if (excludedCopy(node)) continue;
      const text = elementText(node);
      if (!OFFICIAL.has(text) || !inLowerLeft(node, video)) continue;
      match = { text, source: "corner" };
    }
    if (match) return match;
  }
  return null;
}

export function pickFeedVideo(root) {
  if (!root?.querySelectorAll) return null;
  const ranked = [];
  for (const scope of scopesOf(root)) {
    for (const video of scope.querySelectorAll("video")) {
      if (!(Number(video.videoWidth) > 0)) continue;
      const rect = video.getBoundingClientRect?.() || { width: Number(video.videoWidth), height: Number(video.videoHeight) };
      ranked.push({ video, area: Math.max(0, rect.width) * Math.max(0, rect.height) });
    }
  }
  ranked.sort((left, right) => right.area - left.area);
  return ranked[0]?.video || null;
}

function drawJpeg(video, options) {
  const doc = options.document || globalThis.document;
  if (!doc?.createElement || !(Number(video.videoWidth) > 0) || !(Number(video.videoHeight) > 0)) return "";
  const maxWidth = options.maxWidth ?? 640;
  const scale = Math.min(1, maxWidth / Number(video.videoWidth));
  const width = Math.max(1, Math.round(Number(video.videoWidth) * scale));
  const height = Math.max(1, Math.round(Number(video.videoHeight) * scale));
  const canvas = doc.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(video, 0, 0, width, height);
  try {
    const image = canvas.toDataURL("image/jpeg", options.quality ?? 0.6);
    return typeof image === "string" && image.startsWith("data:image/jpeg") ? image : "";
  } catch {
    return "";
  }
}

// 播放不到 1 秒时只等待，不拖动进度。计时由调用方在拿到画面之后开始。
export async function captureFeedFrame(video, options = {}) {
  const minSeconds = options.minSeconds ?? 1;
  const timeoutMs = options.timeoutMs ?? 2_500;
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  if (!video || !(Number(video.videoWidth) > 0)) return null;
  const deadline = now() + timeoutMs;
  while (Number(video.currentTime) < minSeconds && now() < deadline) await sleep(80);
  if (!(Number(video.videoWidth) > 0)) return null;
  const image = (options.draw || drawJpeg)(video, options);
  if (!image) return null;
  return { image, currentTime: Number(video.currentTime) || 0, capturedAt: now() };
}

export function footageStatusLine(judge) {
  if (!judge || typeof judge !== "object") return "";
  const verdict = judge.verdict || "不确定";
  const reason = judge.reason ? `，${judge.reason}` : "";
  const hint = judge.domAiHint ? `AI（${judge.domAiHint}）` : "无";
  const elapsed = Number.isFinite(Number(judge.elapsedMs)) ? `。看画面到返回 ${judge.elapsedMs} ms` : "";
  const model = Number.isFinite(Number(judge.modelMs)) ? `（模型 ${judge.modelMs} ms）` : "";
  return `画面：${verdict}${reason}。页面提示：${hint}${elapsed}${model}`;
}
