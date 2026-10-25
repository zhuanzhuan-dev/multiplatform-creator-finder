import { captureRuleMatch } from "./rule-match.js";
import { saveObservations, normalizeDouyinObservation } from './observations.js';
import { canEngage, reserveEngagement, newEngagement, ENGAGEMENT_KEYS } from "./engagement.js";
import { contentSkipDecision } from "./content-type.js";
import { buildObservationRecord } from "./cloud.js";
import { INITIAL_STATE, mergeRules, mergeSettings, validateSettings } from "./defaults.js";
import { makeCreatorKey } from "./normalizers.js";
import { evaluateCreatorRules, evaluateVideoRules, scoreCreator, validateRules } from "./rule-engine.js";
import { createRunWaits, runtimeStalled, stepBudget } from "./runtime-health.js";
import { canResumeRun, elapsedRunMs, getRunLimitReason, normalizeRunTarget } from "./run-limits.js";
import { validateSchedule } from "./scheduler.js";
import { firstRunnableTabInWindow, launchUrl, resolveRoute } from "../src/core/platform-router.ts";

export const DOUYIN_CONTENT_MESSAGES=["DRA_WAIT","DRA_PROGRESS","DRA_RAW_SAMPLE","DRA_DOUYIN_PROFILE_IP","DRA_READ_CAPTURED_PROFILE_IP","DRA_OBSERVATION","DRA_PANEL_SKIPPED","DRA_TRANSITION_RESULT","DRA_ENGAGE","DRA_TRUSTED_KEY","DRA_TRUSTED_CLICK","DRA_TRUSTED_WHEEL","DRA_PAGE_BLOCKED","DRA_FEED_STALLED","DRA_TICK_ERROR"];
export function createDouyinRuntime(deps, options={}) {
  let state=structuredClone(INITIAL_STATE),seenVideos=[],creatorIndex={};
  let settings=deps.config().settings,rules=deps.config().rules;
  let watchdogInFlight=null,engagementQueue=Promise.resolve();
  const runWaits=createRunWaits(), attachedDebuggerTabs=new Set();
  const WATCHDOG_ALARM=options.alarm || 'dra-watchdog', RUN_STOP_ALARM=options.stopAlarm || 'dra-run-stop';
  const MAX_SEEN_VIDEOS=5000, DEBUGGER_PROTOCOL_VERSION='1.3';
  const notify=()=>{Object.assign(state,deps.identity?.() || {});deps.changed?.({state,seenVideos,creatorIndex});};
  const persistState=async()=>{notify();await deps.persistState();};
  const persistWorkData=async()=>{notify();await deps.persist();};
  const recordDecision=(decision,observation,profile)=>deps.recordDecision(decision,observation,profile,state);
  const addOutbox=(status,payload,error='',extra={})=>deps.addOutbox(status,payload,error,{...extra,owner:state});
  const touchOutbox=(...items)=>deps.touchOutbox(...items);
  const syncPower=()=>deps.indicators();
  const checkCloudConnection=()=>deps.authorize();
  const requestUpload=()=>deps.scheduleUpload();
  const {waitForTabComplete,ensureContentRuntime,sendTabMessage,saveRawSample,readDouyinIpLocation}=deps;
function isInvalidStoredCreatorName(value) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().replace(/^@/, "");
  return /^\d{4}年\d{1,2}月精选作者$/.test(text)
    || /^(?:前往|打开|进入|查看|访问).{0,12}(?:作者|达人)主页$/.test(text)
    || /^(?:作者|达人)主页$/.test(text);
}

function cloneInitialState() {
  return JSON.parse(JSON.stringify(INITIAL_STATE));
}

function isActiveRunStatus(value = state.status) {
  return value === "starting" || value === "running";
}

function isRecommendationFeedUrl(value) {
  const route = resolveRoute(String(value || ""));
  return route?.platform === "douyin" && route.runnable;
}

function increment(name, amount = 1) {
  state.stats[name] = Number(state.stats[name] || 0) + amount;
}

function dwellSecondsFor(observation) {
  const actual = Number(observation?.dwellSeconds);
  if (Number.isFinite(actual) && actual >= 0) return actual;
  return observation?.isLive ? Number(settings.liveDwellSeconds || 3) : Number(settings.dwell?.fixedSeconds || 30);
}

function observationRecord(observation, profile, { isRelevant, decision, action, score = null, extra = {} }) {
  return buildObservationRecord({
    observation,
    profile,
    feedIndex: Math.max(1, Number(state.stats.scanned) || 1),
    runId: state.runId,
    dwellSeconds: dwellSecondsFor(observation),
    isRelevant,
    decision,
    action,
    score,
    extra
  });
}

async function enqueueObservation(record) {
  let item;
  if (settings.dryRun || !settings.cloud?.enabled) {
    item = addOutbox(settings.dryRun ? "dry-run" : "cloud-disabled", record, "", { transitionPending: true, captureRules: true });
  } else if (!deps.cloudAuth()?.device_token) {
    item = addOutbox("write-error", record, "尚未连接研究台", { transitionPending: true, captureRules: true });
  } else {
    item = addOutbox("pending", record, "", { transitionPending: true, captureRules: true });
  }
  return { queued: true, recordId: item.id };
}

async function finalizeObservationTransition(recordId, transition = {}) {
  const item = deps.outbox().find((candidate) => candidate?.payload?.record_id === recordId);
  if (!item || item.sessionId!==state.runId) throw new Error("找不到本轮等待确认翻页结果的观察记录");
  item.payload = {
    ...item.payload,
    before_url: String(transition.beforeUrl || item.payload.before_url || ""),
    after_url: String(transition.afterUrl || ""),
    scroll_delta: transition.scrollDelta != null && Number.isFinite(Number(transition.scrollDelta))
      ? Number(transition.scrollDelta)
      : null,
    transition_ok: typeof transition.transitionOk === "boolean" ? transition.transitionOk : null
  };
  item.transitionPending = false;
  touchOutbox(item);
  await persistWorkData();
  if (["pending", "write-error"].includes(item.status)) void requestUpload();
  return { ok: true, recordId };
}

async function settleInterruptedTransitions() {
  let changed = false;
  for (const item of deps.outbox()) {
    if (item.sessionId !== state.runId || !item.transitionPending) continue;
    item.transitionPending = false;
    item.payload.transition_ok = null;
    touchOutbox(item);
    changed = true;
  }
  if (changed) await persistWorkData();
}

async function setPaused(reason, error = "") {
  const now = Date.now();
  state.elapsedMs = elapsedRunMs(state, now);
  state.activeSince = null;
  if (state.status !== "paused") state.pausedAt = now;
  state.status = "paused";
  runWaits.cancel();
  state.endedAt = new Date().toISOString();
  state.startupStage = "";
  state.pauseReason = reason;
  state.lastError = error || state.lastError;
  syncPower();
  await chrome.alarms.clear(WATCHDOG_ALARM);
  await chrome.alarms.clear(RUN_STOP_ALARM);
  if (state.feedTabId) {
    chrome.tabs.sendMessage(state.feedTabId, { type: "DRA_STOP_LOOP", loopId: state.loopId, preserveRunId: true }).catch(() => undefined);
  }
  await detachDebugger(state.feedTabId);
  await settleInterruptedTransitions();
  await persistState();
}

async function pauseForRunLimit(reason) {
  if (state.runTrigger === "schedule") {
    state.lastScheduleAt = new Date().toISOString();
    state.lastScheduleResult = reason;
  }
  await setPaused(reason);
  void requestUpload();
}

async function ensureDebugger(tabId) {
  if (!Number.isInteger(tabId)) throw new Error("缺少当前推荐流标签页");
  if (attachedDebuggerTabs.has(tabId)) return;
  // A worker restart loses the Set while Chrome can retain our attachment.
  if (state.feedTabId === tabId && state.status === "running") {
    const owned = await chrome.debugger.sendCommand({ tabId }, "Page.getFrameTree").then(() => true, () => false);
    if (owned) { attachedDebuggerTabs.add(tabId); await deps.captureProfileIp?.(tabId); return; }
  }
  try {
    await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
  } catch (error) {
    const message = error?.message || String(error);
    if (/debugger|attach|target is already/i.test(message)) {
      throw new Error("当前抖音标签页正被 F12 或其他调试工具占用，请关闭调试工具后重试");
    }
    throw error;
  }
  attachedDebuggerTabs.add(tabId);
  await deps.captureProfileIp?.(tabId);
}

async function keepFeedPageActive(tabId) {
  if (state.route?.platform === "feigua") {
    await chrome.tabs.update(tabId, { autoDiscardable: false });
    state.keepAliveAt = new Date().toISOString();
    return;
  }
  const runId = state.runId;
  const apply = async () => {
    await ensureDebugger(tabId);
    await chrome.tabs.update(tabId, { autoDiscardable: false });
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setFocusEmulationEnabled", { enabled: true });
    await chrome.debugger.sendCommand({ tabId }, "Page.setWebLifecycleState", { state: "active" });
  };
  try { await apply(); } catch (error) {
    if (!isActiveRunStatus() || state.runId !== runId) throw error;
    attachedDebuggerTabs.delete(tabId);
    await apply();
  }
  state.keepAliveAt = new Date().toISOString();
}

async function detachDebugger(tabId) {
  if (!Number.isInteger(tabId) || !attachedDebuggerTabs.has(tabId)) return;
  await chrome.debugger.sendCommand({ tabId }, "Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => undefined);
  await chrome.debugger.detach({ tabId }).catch(() => undefined);
  attachedDebuggerTabs.delete(tabId);
  deps.releaseProfileIp?.(tabId);
}

function assertInputGeneration(tabId, loopId) {
  if (state.status !== "running" || tabId !== state.feedTabId || loopId !== state.loopId) throw new Error("操作所属循环已结束");
}

async function dispatchTrustedKey(tabId, requestedKey, loopId) {
  const keys = {
    Escape: { key: "Escape", code: "Escape", keyCode: 27 },
    ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
    r: { key: "r", code: "KeyR", keyCode: 82 },
    x: { key: "x", code: "KeyX", keyCode: 88 }
  };
  const selected = keys[requestedKey];
  if (!selected) throw new Error("不允许的后台按键");
  return sendTrustedKey(tabId, selected, loopId);
}

async function sendTrustedKey(tabId, selected, loopId, beforeSend = () => {}) {
  if (tabId !== state.feedTabId) throw new Error("按键请求不是来自本轮当前标签页");
  await ensureDebugger(tabId);
  const target = { tabId };
  const common = {
    key: selected.key,
    code: selected.code,
    windowsVirtualKeyCode: selected.keyCode,
    nativeVirtualKeyCode: selected.keyCode,
    modifiers: 0
  };
  assertInputGeneration(tabId, loopId);
  beforeSend();
  await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyDown", ...common });
  await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", ...common });
  return { ok: true, key: selected.key };
}

async function validateTrustedPointer(tabId, payload, allowedTargets) {
  if (state.status !== "running") throw new Error("任务未运行，拒绝后台鼠标操作");
  if (tabId !== state.feedTabId) throw new Error("鼠标请求不是来自本轮当前标签页");
  if (!allowedTargets.has(payload?.target)) throw new Error("不允许的后台鼠标目标");
  const x = Number(payload?.x);
  const y = Number(payload?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("后台鼠标坐标无效");
  await ensureDebugger(tabId);
  const metrics = await chrome.debugger.sendCommand({ tabId }, "Page.getLayoutMetrics");
  const viewport = metrics?.cssLayoutViewport || metrics?.layoutViewport || {};
  const width = Number(viewport.clientWidth);
  const height = Number(viewport.clientHeight);
  if (x < 0 || y < 0 || !Number.isFinite(width) || !Number.isFinite(height) || x > width || y > height) {
    throw new Error("后台鼠标坐标超出当前推荐页视口");
  }
  assertInputGeneration(tabId, payload.loopId);
  return { x: Math.round(x), y: Math.round(y) };
}

async function performEngagement(tabId, message) {
  const { action, videoId, loopId } = message;
  const ledger = state.engagement;
  if (state.status !== "running" || state.feedTabId !== tabId || state.loopId !== loopId || !canEngage(ledger, action, videoId, loopId)) {
    return { ok: true, skipped: true, reason: "未启用、非正向结果或配额不足" };
  }
  const key = reserveEngagement(ledger, action, videoId, loopId);
  if (!key) return { ok: true, skipped: true };
  await persistState();
  const selected = ENGAGEMENT_KEYS[action];
  try {
    await sendTrustedKey(tabId, selected, loopId, () => {
      if (state.engagement !== ledger || ledger.candidate?.videoId !== videoId || ledger.candidate?.loopId !== loopId) throw new Error("互动所属视频或轮次已变化");
    });
    ledger.attempts[key] = "sent";
    ledger.sent[action] += 1;
    ledger.lastResult = `已发送 ${selected.key.toUpperCase()} 快捷键，未检查平台结果`;
    await persistState();
    return { ok: true, sent: true, key: selected.key };
  } catch (error) {
    ledger.attempts[key] = "unknown";
    ledger.lastResult = "快捷键发送未完成，保留配额且不重试";
    await persistState();
    throw error;
  }
}

async function dispatchTrustedClick(tabId, payload = {}) {
  const point = await validateTrustedPointer(tabId, payload, new Set(["comment", "works"]));
  const target = { tabId };
  await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", ...point, button: "none" });
  assertInputGeneration(tabId, payload.loopId);
  await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
  await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 });
  return { ok: true, target: payload.target };
}

async function dispatchTrustedWheel(tabId, payload = {}) {
  const point = await validateTrustedPointer(tabId, payload, new Set(["feed"]));
  const deltaY = Math.max(200, Math.min(2_000, Number(payload.deltaY) || 800));
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    ...point,
    deltaX: 0,
    deltaY
  });
  return { ok: true, target: payload.target, deltaY };
}

async function requireFeedTab(tabId, { requireActive = true, requireFocused = true } = {}) {
  if (!Number.isInteger(tabId)) throw new Error("无法识别当前标签页，请重新打开侧边栏");
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !Number.isInteger(tab.id)) throw new Error("当前标签页已关闭");
  if (!isRecommendationFeedUrl(tab.pendingUrl || tab.url || "")) {
    throw new Error("请在抖音推荐页打开侧边栏后启动");
  }
  if (requireActive && !tab.active) throw new Error("只能在当前活动标签页启动");
  if (requireFocused) {
    const windowInfo = await chrome.windows.get(tab.windowId).catch(() => null);
    if (!windowInfo?.focused) throw new Error("只能在当前浏览器窗口的活动标签页启动");
  }
  return tab;
}

async function prepareFeedTab(tabId, runTrigger) {
  const scheduled = runTrigger === "schedule";
  let tab = await requireFeedTab(tabId, { requireActive: !scheduled, requireFocused: !scheduled });
  tab = await waitForTabComplete(tab.id);
  tab = await ensureContentRuntime(tab);
  await keepFeedPageActive(tab.id);
  state.feedTabId = tab.id;
  state.feedWindowId = tab.windowId;
  state.backgroundMode = scheduled ? "scheduled-tab" : "current-tab";
  state.pageVisibility = tab.active ? "visible" : "hidden";
  state.pageHasFocus = tab.active;
  return tab;
}

async function findOrCreateFeedTab({ windowId, reuseExisting = true, focusTab = true } = {}) {
  if (!Number.isInteger(windowId)) throw new Error("无法识别当前浏览器窗口");
  let tab = null;
  let createdByExtension = false;
  if (reuseExisting) {
    const candidates = await chrome.tabs.query({ windowId, url: "https://www.douyin.com/*" });
    tab = firstRunnableTabInWindow(candidates.filter(tab=>!deps.ownedElsewhere(tab.id) && resolveRoute(tab.pendingUrl || tab.url || "")?.platform==='douyin'), windowId);
  }
  if (!tab) {
    tab = await chrome.tabs.create({ windowId, url: launchUrl("douyin", "recommend"), active: focusTab });
    createdByExtension = true;
  } else if (focusTab) {
    tab = await chrome.tabs.update(tab.id, { active: true });
  }
  if (!Number.isInteger(tab?.id)) throw new Error("无法创建抖音推荐页");
  return { tab, createdByExtension };
}

async function scheduledFeedTab() {
  const reuseExisting = settings.schedule?.reuseExistingTab !== false;
  const previousManagedTabId = state.createdByExtension ? state.feedTabId : null;
  let tab = null;
  if (reuseExisting && state.createdByExtension && Number.isInteger(state.feedTabId)) {
    tab = await requireFeedTab(state.feedTabId, { requireActive: false, requireFocused: false }).catch(() => null);
  }
  if (!tab) {
    if (Number.isInteger(previousManagedTabId)) {
      await chrome.tabs.remove(previousManagedTabId).catch(() => undefined);
    }
    tab = await chrome.tabs.create({ url: launchUrl("douyin", "recommend"), active: false });
  }
  if (!Number.isInteger(tab?.id)) throw new Error("无法创建定时任务推荐页");
  await chrome.tabs.update(tab.id, { autoDiscardable: false });
  return { tab, createdByExtension: true };
}

async function applyPageRuntimeState(status = {}) {
  const tab = await chrome.tabs.get(state.feedTabId).catch(() => null);
  const windowInfo = tab ? await chrome.windows.get(tab.windowId).catch(() => null) : null;
  // Focus emulation changes document.visibilityState; report the actual browser UI.
  state.pageVisibility = tab ? tab.active && windowInfo?.focused && windowInfo.state !== "minimized" ? "visible" : "hidden" : "unknown";
  state.emulatedVisibility = status.visibilityState || "unknown";
  state.pageHasFocus = typeof status.hasFocus === "boolean" ? status.hasFocus : state.pageHasFocus;
  const route = resolveRoute(status.url || "");
  state.route = route ? { platform: route.platform, surface: route.surface, label: route.label } : null;
}

async function syncRunStopAlarm() {
  await chrome.alarms.clear(RUN_STOP_ALARM);
  if (state.stopAt == null) return null;
  const stopAt = Number(state.stopAt);
  if (state.status !== "running" || !Number.isFinite(stopAt)) return null;
  const when = Math.max(Date.now() + 500, stopAt);
  await chrome.alarms.create(RUN_STOP_ALARM, { when });
  return when;
}

function rejectedAction(decision, profileDecision = null) {
  const uncertainCodes = new Set(["DURATION_MISSING", "LIKES_MISSING"]);
  const uncertain = decision?.needsReview || uncertainCodes.has(decision?.code) || profileDecision?.needsReview;
  if (uncertain) return "advance";
  return settings.markRejectedNotInterested ? "not-interested" : "advance";
}

function candidatePayload(observation, profile, videoDecision, creatorDecision, score) {
  const categories = [...(creatorDecision.categories || []), ...(videoDecision.categories || [])]
    .filter((item, index, items) => items.findIndex((other) => other.id === item.id) === index)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  // 当前视频或主页任一侧识别出账号类型即可；两侧都无法识别，或最终仅为 B 级时才需复核。
  const reviewRequired = score.level === "B" || !score.bestCategory;
  const recommendationReason = [...videoDecision.reasons, ...creatorDecision.reasons, ...score.reasons].join("；");
  const reviewReason = !score.bestCategory ? "账号类型未自动识别" : `自动评级为${score.level}级`;
  return {
    creatorKey: makeCreatorKey(profile) || makeCreatorKey(observation),
    platform: "抖音",
    accountName: profile.authorName || observation.authorName || "",
    followers: profile.followers,
    followersText: profile.followersText || String(profile.followers || ""),
    videoUrl: observation.videoUrl || "",
    videoId: observation.videoId || "",
    profileUrl: profile.profileUrl || observation.profileUrl || "",
    status: "待绑定",
    priority: reviewRequired ? "B级" : `${score.level}级`,
    note: reviewRequired ? `需复核：${reviewReason}；自动判断：${recommendationReason}` : "",
    reviewRequired,
    source: "抖音推荐流自动找号",
    caption: observation.caption || "",
    currentVideoLikes: observation.likes,
    averageLikes: profile.averageLikes,
    averageLikesSampleSize: profile.averageLikesSampleSize,
    category: score.bestCategory?.name || categories[0]?.name || "",
    audienceInference: score.bestCategory?.audience || categories[0]?.audience || "未知",
    recommendationLevel: score.level,
    recommendationScore: score.score,
    recommendationReason,
    discoveredAt: observation.observedAt || new Date().toISOString()
  };
}

async function handleObservation(observation, profile, panelRecovered = false) {
  await deps.ready();
  if (state.status !== "running") return { continue: false, reason: "任务未运行" };
  const limitReason = getRunLimitReason(state, settings);
  if (limitReason) {
    await pauseForRunLimit(limitReason);
    return { continue: false, reason: state.pauseReason };
  }
  if (observation.blockedReason) {
    await setPaused(observation.blockedReason);
    return { continue: false, reason: observation.blockedReason };
  }

  const fingerprint = observation.videoId || [observation.secUid, observation.caption, observation.subtype].filter(Boolean).join("|");
  if (!fingerprint) {
    increment("failed");
    state.lastError = "当前推荐卡片缺少可去重标识";
    recordDecision({ code: "NO_FINGERPRINT", reasons: [state.lastError] }, observation, profile);
    await persistState();
    return { continue: true, action: "advance", decision: state.lastDecision };
  }
  state.engagement.candidate = null;
  deps.recordScan(fingerprint);
  if (seenVideos.includes(fingerprint)) {
    await persistState();
    return { continue: true, action: "advance", duplicateVideo: true };
  }

  seenVideos.push(fingerprint);
  seenVideos = seenVideos.slice(-MAX_SEEN_VIDEOS);
  increment("scanned");
  if (observation.contentType === "video" && !contentSkipDecision(observation)) state.engagement.videos += 1;
  if (panelRecovered) increment("panelRecoveries");
  state.lastTickAt = new Date().toISOString();
  state.lastVideoId = observation.videoId || fingerprint;

  const videoDecision = evaluateVideoRules(observation, rules);
  if (videoDecision.blocked) {
    recordDecision(videoDecision, observation, profile);
    await setPaused(videoDecision.reasons.join("；"));
    return { continue: false, decision: videoDecision };
  }
  const contentSkip = contentSkipDecision(observation);
  if (contentSkip) {
    increment(contentSkip.counter);
    recordDecision(videoDecision, observation, profile);
    const queued = await enqueueObservation(observationRecord(observation, profile, {
      isRelevant: false,
      decision: "skip",
      action: "skip",
      extra: { finderDecision: videoDecision.code, reasons: videoDecision.reasons || [] }
    }));
    await persistWorkData();
    await persistState();
    return { continue: true, action: "advance", decision: videoDecision, observationRecordId: queued.recordId };
  }
  if (!videoDecision.matched) {
    const action = rejectedAction(videoDecision);
    if (action === "not-interested") increment("notInterested");
    else if (videoDecision.needsReview) increment("failed");
    recordDecision(videoDecision, observation, profile);
    const queued = await enqueueObservation(observationRecord(observation, profile, {
      isRelevant: false,
      decision: "skip",
      action: action === "not-interested" ? "not_interested" : "skip",
      extra: { finderDecision: videoDecision.code, reasons: videoDecision.reasons || [] }
    }));
    await persistWorkData();
    await persistState();
    return { continue: true, action, decision: videoDecision, observationRecordId: queued.recordId };
  }

  if (!profile?.ready || !makeCreatorKey(profile)) {
    await setPaused("当前达人侧栏数据不完整，已停止以避免误判");
    return { continue: false, reason: state.pauseReason };
  }
  if (isInvalidStoredCreatorName(profile.authorName || observation.authorName)) {
    increment("failed");
    recordDecision({
      code: "INVALID_CREATOR_NAME_SKIPPED",
      reasons: ["检测到页面导航文案而非达人昵称，已跳过且未上传"],
      accountName: profile.authorName || observation.authorName || ""
    }, observation, profile);
    await persistWorkData();
    await persistState();
    return { continue: true, action: "advance", decision: state.lastDecision };
  }
  const creatorDecision = evaluateCreatorRules(profile, rules);
  if (!creatorDecision.matched) {
    increment("rejectedProfiles");
    const action = rejectedAction(videoDecision, creatorDecision);
    if (action === "not-interested") increment("notInterested");
    recordDecision(creatorDecision, observation, profile);
    const queued = await enqueueObservation(observationRecord(observation, profile, {
      isRelevant: false,
      decision: "skip",
      action: action === "not-interested" ? "not_interested" : "skip",
      extra: { finderDecision: creatorDecision.code, reasons: creatorDecision.reasons || [] }
    }));
    await persistWorkData();
    await persistState();
    return { continue: true, action, decision: creatorDecision, observationRecordId: queued.recordId };
  }

  const categories = [...(creatorDecision.categories || []), ...(videoDecision.categories || [])]
    .filter((item, index, items) => items.findIndex((other) => other.id === item.id) === index);
  const score = scoreCreator({ profile, observation, categories, risks: creatorDecision.risks || videoDecision.risks || [], rules });
  const matchedReasons = [...videoDecision.reasons, ...creatorDecision.reasons, ...score.reasons];
  if (!new Set(["S", "A", "B"]).has(score.level)) {
    increment("rejectedProfiles");
    if (settings.markRejectedNotInterested) increment("notInterested");
    recordDecision({ code: "LEVEL_B_REVIEW", reasons: score.reasons }, observation, profile);
    const queued = await enqueueObservation(observationRecord(observation, profile, {
      isRelevant: false,
      decision: "skip",
      action: settings.markRejectedNotInterested ? "not_interested" : "skip",
      score,
      extra: { finderDecision: "LEVEL_B_REVIEW", reasons: score.reasons || [] }
    }));
    await persistWorkData();
    await persistState();
    return { continue: true, action: settings.markRejectedNotInterested ? "not-interested" : "advance", decision: state.lastDecision, observationRecordId: queued.recordId };
  }

  increment("matched");
  const payload = candidatePayload(observation, profile, videoDecision, creatorDecision, score);
  const creatorKey = payload.creatorKey;
  const existing = creatorIndex[creatorKey];
  const engagementEligible = categories.length > 0 && !payload.reviewRequired;
  if (engagementEligible) state.engagement.candidate = { videoId: observation.videoId, creatorKey, loopId: state.loopId };
  const queued = await enqueueObservation(observationRecord(observation, profile, {
    isRelevant: true,
    decision: "keep",
    action: "watch_then_next",
    score,
    extra: { finderDecision: payload.reviewRequired ? "ACCEPTED_REVIEW" : "ACCEPTED", reasons: matchedReasons,
      ruleMatch:captureRuleMatch({categories},state,'douyin') }
  }));
  if (existing) {
    increment("duplicates");
    existing.lastSeenAt = new Date().toISOString();
    existing.sourceVideoId = observation.videoId || existing.sourceVideoId;
  } else {
    creatorIndex[creatorKey] = {
      status: "indexed",
      lastSeenAt: new Date().toISOString(),
      sourceVideoId: payload.videoId
    };
    increment("newCreators");
    if (payload.reviewRequired) increment("reviewQueued");
  }
  recordDecision({
    code: payload.reviewRequired ? "ACCEPTED_REVIEW" : "ACCEPTED",
    reasons: [score.level, ...(payload.reviewRequired ? ["已保存为候选，需人工确认"] : []), ...matchedReasons],
    categories,
    accountName: payload.accountName
  }, observation, profile);
  await persistWorkData();
  await persistState();
  return { continue: state.status === "running", action: "advance", engagementActions: engagementEligible ? ["like", "collect", "follow"].filter(action => canEngage(state.engagement, action, observation.videoId, state.loopId)) : [], decision: state.lastDecision, observationRecordId: queued.recordId };
}

async function handlePanelSkipped(observation, reason) {
  await deps.ready();
  if (state.status !== "running") return { continue: false, reason: "任务未运行" };
  const limitReason = getRunLimitReason(state, settings);
  if (limitReason) {
    await pauseForRunLimit(limitReason);
    return { continue: false, reason: state.pauseReason };
  }

  const fingerprint = observation.videoId || [observation.secUid, observation.caption, observation.subtype].filter(Boolean).join("|");
  deps.recordScan(fingerprint);
  if (fingerprint && seenVideos.includes(fingerprint)) {
    await persistState();
    return { continue: true, action: "advance", duplicateVideo: true };
  }
  if (fingerprint) {
    seenVideos.push(fingerprint);
    seenVideos = seenVideos.slice(-MAX_SEEN_VIDEOS);
    increment("scanned");
  }
  increment("panelSkipped");
  increment("failed");
  state.lastTickAt = new Date().toISOString();
  state.lastVideoId = observation.videoId || fingerprint || state.lastVideoId;
  state.lastError = reason || "当前达人侧栏无法读取，已跳过本条";
  recordDecision({
    code: "PANEL_UNREADABLE_SKIPPED",
    reasons: [state.lastError],
    accountName: observation.authorName || ""
  }, observation);
  let observationRecordId = null;
  if (fingerprint) {
    const queued = await enqueueObservation(observationRecord(observation, null, {
      isRelevant: false,
      decision: "skip",
      action: "skip",
      extra: { finderDecision: "PANEL_UNREADABLE_SKIPPED", reasons: [state.lastError] }
    }));
    observationRecordId = queued.recordId;
  }
  await persistWorkData();
  await persistState();
  return { continue: true, action: "advance", decision: state.lastDecision, observationRecordId };
}

async function startRun({ trigger = "manual", scheduledFor = null, tabId = null } = {}) {
  await deps.ready();
  settings=structuredClone(deps.config().settings); rules=structuredClone(deps.config().rules);
  const problems = [...validateSettings(settings), ...validateRules(rules), ...validateSchedule(settings.schedule)];
  if (problems.length) throw new Error(problems.join("；"));
  if (!settings.dryRun) {
    await checkCloudConnection();
    if (!settings.cloud?.enabled) {
      settings.cloud = { ...settings.cloud, enabled: true };
      await deps.saveSettings(settings);
    }
  }
  let requested;
  if (trigger === "schedule") {
    requested = await scheduledFeedTab();
  } else {
    const current = await deps.selectPage(tabId);
    if (isRecommendationFeedUrl(current.pendingUrl || current.url || "")) {
      const tab = await requireFeedTab(current.id);
      requested = { tab, createdByExtension: current.createdByExtension === true || state.createdByExtension === true && state.feedTabId === tab.id };
    } else {
      const route = resolveRoute(current.pendingUrl || current.url || "");

      requested = await findOrCreateFeedTab({ windowId: current.windowId, reuseExisting: true, focusTab: true });
      requested.createdByExtension ||= state.createdByExtension === true && state.feedTabId === requested.tab.id;
    }
  }
  const requestedTab = requested.tab;
  if (isActiveRunStatus() && state.feedTabId === requestedTab.id) return state;
  if (isActiveRunStatus() && state.feedTabId !== requestedTab.id) {
    const previousTabId = state.feedTabId;
    const closePreviousTab = state.createdByExtension === true;
    await setPaused("已切换到新的当前标签页");
    if (closePreviousTab && Number.isInteger(previousTabId)) {
      await chrome.tabs.remove(previousTabId).catch(() => undefined);
    }
  }
  if (!isActiveRunStatus() && state.createdByExtension && state.feedTabId !== requestedTab.id) {
    await chrome.tabs.remove(state.feedTabId).catch(() => undefined);
  }
  await deps.beforeStart();
  const lastScheduleAt = state.lastScheduleAt;
  const lastScheduleResult = state.lastScheduleResult;
  state = {
    ...cloneInitialState(),
    engagement: newEngagement(settings.engagement),
    feedTabId: requestedTab.id,
    feedWindowId: requestedTab.windowId,
    createdByExtension: requested.createdByExtension,
    backgroundMode: trigger === "schedule" ? "scheduled-tab" : "current-tab",
    route: (() => {
      const route = resolveRoute(requestedTab.pendingUrl || requestedTab.url || "");
      return route ? { platform: route.platform, surface: route.surface, label: route.label } : null;
    })(),
    lastScheduleAt,
    lastScheduleResult
  };
  const effectiveTarget = normalizeRunTarget(trigger === "schedule" ? settings.schedule?.target : settings.target);
  const runId = crypto.randomUUID();
  state.runSettings=structuredClone(settings); state.runRules=structuredClone(rules);
  state.status = "starting";
  state.startupStage = "正在连接研究台并绑定当前标签页";
  state.runId = runId;
  state.loopId = crypto.randomUUID();
  state.runtime = { phase: "idle", deadlineAt: Date.now() + 30_000, recoveryAttempts: 0 };
  state.runTrigger = trigger === "schedule" ? "schedule" : "manual";
  state.runTarget = effectiveTarget;
  state.runDurationMinutes = effectiveTarget.durationMinutes;
  state.scheduledFor = scheduledFor || null;
  if (state.runTrigger === "schedule") {
    state.lastScheduleAt = new Date().toISOString();
    const targetText = effectiveTarget.mode === "time"
      ? `${effectiveTarget.durationMinutes} 分钟`
      : effectiveTarget.mode === "count"
        ? `${effectiveTarget.maxItems} 条视频`
        : `${effectiveTarget.durationMinutes} 分钟或 ${effectiveTarget.maxItems} 条视频`;
    state.lastScheduleResult = `已按计划启动：${targetText}`;
  }
  await persistState();
  try {
    const tab = await prepareFeedTab(requestedTab.id, state.runTrigger);
    if (state.status !== "starting" || state.runId !== runId) {
      await detachDebugger(tab?.id);
      return state;
    }
    state.status = "running";
    state.startupStage = "";
    state.pauseReason = "";
    state.startedAt = new Date().toISOString();
    state.elapsedMs = 0;
    state.activeSince = Date.now();
    state.pausedAt = null;
    state.stopAt = ["time", "both"].includes(effectiveTarget.mode)
      ? Date.now() + effectiveTarget.durationMinutes * 60_000
      : null;
    if (settings.keepSystemAwake) chrome.power.requestKeepAwake("system");
    await syncRunStopAlarm();
    await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
    await sendTabMessage(tab.id, { type: "DRA_START_LOOP", settings, rules, runId, loopId: state.loopId });
    const runtimeStatus = await sendTabMessage(tab.id, { type: "DRA_LOOP_STATUS" }, 2).catch(() => null);
    if (runtimeStatus) await applyPageRuntimeState(runtimeStatus);
    await persistState();
    void requestUpload();
    return state;
  } catch (error) {
    if (state.runId === runId && isActiveRunStatus()) {
      await setPaused("启动刷号任务失败", error?.message || String(error));
    }
    throw error;
  }
}

async function resumeRun({ windowId, target } = {}) {
  await deps.ready();
  const runTarget = normalizeRunTarget(target || state.runTarget || {});
  if (!canResumeRun(state, runTarget)) throw new Error("本轮已结束或达到目标，请开始新一轮");
  const runId = state.runId;
  settings=structuredClone(mergeSettings(deps.config().settings)); rules=structuredClone(mergeRules(state.runRules || deps.config().rules));
  const problems = [...validateSettings(settings), ...validateRules(rules)];
  if (problems.length) throw new Error(problems.join("；"));
  if (!settings.dryRun) {
    await checkCloudConnection();
    settings.cloud = { ...settings.cloud, enabled: true };
    await deps.saveSettings(settings);
  }
  if (state.runId !== runId || state.status !== "paused") throw new Error("任务状态已变化，请重试");
  state.runTarget = runTarget;
  state.runSettings=structuredClone(settings);
  const previousFeedTabId = state.feedTabId;
  const elapsedMs = elapsedRunMs(state);
  const pausedAt = state.pausedAt || Date.parse(state.endedAt || "") || Date.now();
  const previousRuntime = state.runtime;
  state.status = "starting";
  state.startupStage = "正在恢复本轮任务";
  state.loopId = crypto.randomUUID();
  state.elapsedMs = elapsedMs;
  state.activeSince = null;
  await persistState();
  try {
    const stillResuming = () => state.runId === runId && state.status === "starting";
    let tab = await requireFeedTab(previousFeedTabId, { requireActive: false, requireFocused: false }).catch(() => null);
    if (!stillResuming()) return state;
    if (tab && resolveRoute(tab.pendingUrl || tab.url || "")?.platform !== state.route?.platform && state.route?.platform) tab = null;
    const samePage = Boolean(tab);
    if (!tab) {
      // Release a page the user navigated to, including ownership used by Stop.
      state.feedTabId = null;
      state.createdByExtension = false;
      await detachDebugger(previousFeedTabId);
      if (!stillResuming()) return state;
      const preferredWindowId = Number.isInteger(windowId) ? windowId : state.feedWindowId;
      const destinationWindow = Number.isInteger(preferredWindowId)
        ? await chrome.windows.get(preferredWindowId).catch(() => null) : null;
      const targetWindowId = destinationWindow?.id ?? (await chrome.windows.getCurrent()).id;
      if (!stillResuming()) return state;
      const selected = await findOrCreateFeedTab({ windowId: targetWindowId });
      if (!stillResuming()) {
        if (selected.createdByExtension) await chrome.tabs.remove(selected.tab.id).catch(() => undefined);
        return state;
      }
      tab = selected.tab;
      state.feedTabId = tab.id;
      state.feedWindowId = tab.windowId;
      state.createdByExtension = selected.createdByExtension;
    }
    if (!stillResuming()) return state;
    state.startupStage = samePage ? "正在恢复本轮任务" : "正在连接推荐页，保留本轮进度";
    state.backgroundMode = state.runTrigger === "schedule" ? "scheduled-tab" : "current-tab";
    await persistState();
    tab = await waitForTabComplete(tab.id);
    if (!stillResuming()) return state;
    tab = await requireFeedTab(tab.id, { requireActive: false, requireFocused: false });
    tab = await ensureContentRuntime(tab);
    if (!stillResuming()) return state;
    tab = await requireFeedTab(tab.id, { requireActive: false, requireFocused: false });
    await keepFeedPageActive(tab.id);
    if (!stillResuming()) return state;
    await applyPageRuntimeState({ url: tab.url, hasFocus: tab.active });
    if (!stillResuming()) return state;
    const now = Date.now();
    const shift = Math.max(0, now - pausedAt);
    const resume = samePage && previousRuntime?.phase === "dwell" ? {
      ...previousRuntime,
      waitUntil: previousRuntime.waitUntil + shift,
      deadlineAt: previousRuntime.deadlineAt + shift,
      cycleStartedAt: previousRuntime.cycleStartedAt + shift
    } : null;
    state.status = "running";
    state.activeSince = now;
    state.pausedAt = null;
    state.endedAt = null;
    state.pauseReason = "";
    state.lastError = "";
    state.startupStage = "";
    state.runtime = { phase: "idle", deadlineAt: now + 30_000, recoveryAttempts: 0 };
    const target = normalizeRunTarget(state.runTarget || {});
    state.stopAt = ["time", "both"].includes(target.mode) ? now + Math.max(0, target.durationMinutes * 60_000 - elapsedMs) : null;
    if (settings.keepSystemAwake) chrome.power.requestKeepAwake("system");
    await syncRunStopAlarm();
    await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
    await persistState();
    await sendTabMessage(tab.id, { type: "DRA_START_LOOP", settings, rules, runId, loopId: state.loopId, resume });
    void requestUpload();
    return state;
  } catch (error) {
    if (state.runId === runId && isActiveRunStatus()) await setPaused("恢复本轮失败", error?.message || String(error));
    throw error;
  }
}

async function stopRun() {
  await deps.ready();
  const feedTabId = state.feedTabId;
  const closeFeedTab = state.createdByExtension === true;
  state.elapsedMs = elapsedRunMs(state);
  state.activeSince = null;
  state.status = "stopped";
  runWaits.cancel();
  if (feedTabId) await sendTabMessage(feedTabId, { type: "DRA_STOP_LOOP" }, 1).catch(() => undefined);
  await chrome.alarms.clear(WATCHDOG_ALARM);
  await chrome.alarms.clear(RUN_STOP_ALARM);
  syncPower();
  await detachDebugger(feedTabId);
  await settleInterruptedTransitions();
  state.status = "stopped";
  state.endedAt = new Date().toISOString();
  state.startupStage = "";
  state.pageVisibility = "";
  state.pageHasFocus = null;
  state.pauseReason = "";
  if (closeFeedTab) {
    state.feedTabId = null;
    state.feedWindowId = null;
    state.createdByExtension = false;
    state.backgroundMode = "";
  }
  if (closeFeedTab && Number.isInteger(feedTabId)) {
    await chrome.tabs.remove(feedTabId).catch(() => undefined);
  }
  void requestUpload();
  await persistState();
  return state;
}

async function restartContentLoop(tab, reason) {
  const runId = state.runId;
  const oldLoopId = state.loopId;
  const resume = state.runtime?.phase === "dwell" ? { ...state.runtime } : null;
  const attempts = Number(state.runtime?.recoveryAttempts || 0) + 1;
  if (attempts > 2) return setPaused(`后台任务恢复失败：${reason}`);
  // Invalidate the previous generation before asking the page to stop it.
  state.loopId = crypto.randomUUID();
  runWaits.cancel();
  await settleInterruptedTransitions();
  state.runtime = { ...state.runtime, phase: "idle", deadlineAt: Date.now() + 30_000, recoveryAttempts: attempts, recoveryReason: reason };
  await persistState();
  await sendTabMessage(tab.id, { type: "DRA_STOP_LOOP", loopId: oldLoopId }, 1).catch(() => undefined);
  await keepFeedPageActive(tab.id);
  if (state.status !== "running" || state.runId !== runId) return;
  await sendTabMessage(tab.id, { type: "DRA_START_LOOP", settings, rules, runId, loopId: state.loopId, resume }, 2);
}

function watchdog() {
  if (watchdogInFlight) return watchdogInFlight;
  watchdogInFlight = inspectRuntime().finally(() => { watchdogInFlight = null; });
  return watchdogInFlight;
}

async function inspectRuntime() {
  await deps.ready();
  if (state.status !== "running") return;
  const runId = state.runId;
  const limitReason = getRunLimitReason(state, settings);
  if (limitReason) return pauseForRunLimit(limitReason);
  const tab = await requireFeedTab(state.feedTabId, { requireActive: false, requireFocused: false }).catch(() => null);
  if (!tab || state.route?.platform && resolveRoute(tab.pendingUrl || tab.url || "")?.platform !== state.route.platform) return setPaused("当前运行标签页已关闭或离开原平台采集页");
  await keepFeedPageActive(tab.id);
  if (settings.keepSystemAwake) chrome.power.requestKeepAwake("system");
  const status = await sendTabMessage(tab.id, { type: "DRA_LOOP_STATUS" }, 1).catch(() => null);
  if (state.status !== "running" || state.runId !== runId) return;
  if (status) await applyPageRuntimeState(status);
  if (!status?.running || status.runId !== runId || status.loopId !== state.loopId || runtimeStalled(state.runtime)) {
    await restartContentLoop(tab, runtimeStalled(state.runtime) ? "当前步骤超时且没有完成进展" : "页面循环中断");
  }
  await persistState();
  void requestUpload();
}

async function handleRunStopAlarm() {
  await deps.ready();
  if (state.status !== "running") return;
  const limitReason = getRunLimitReason(state, settings);
  if (limitReason) {
    await pauseForRunLimit(limitReason);
    return;
  }
  // 极端情况下系统时钟发生调整，重新按当前 stopAt 校准一次。
  await syncRunStopAlarm();
}

function requireBoundContentTab(sender, message) {
  if ((sender.frameId ?? 0)!==0 || !Number.isInteger(sender.tab?.id) || sender.tab.id !== state.feedTabId) {
    throw new Error("消息不是来自当前运行标签页");
  }
  if (state.status !== "running" && message.type !== "DRA_TRANSITION_RESULT") throw new Error("任务已停止");
  if (!message?.runId || message.runId !== state.runId || !message.loopId || message.loopId !== state.loopId) {
    throw new Error("消息不属于当前运行任务");
  }
}

async function stopAtReachedTarget(result) {
  if (!result?.continue) return result;
  const reason = getRunLimitReason(state, settings);
  if (!reason) return result;
  await pauseForRunLimit(reason);
  return { ...result, continue: false, reason };
}
async function message(message,sender) { if(!state.runSettings){settings=deps.config().settings;rules=deps.config().rules;} switch(message.type) {
      case "DRA_WAIT": {
        requireBoundContentTab(sender, message);
        if (state.status !== "running") return { ok: false, canceled: true };
        const until = Number(message.until);
        if (!Number.isFinite(until) || until > Date.now() + 300_000) throw new Error("无效的等待截止时间");
        const result = await runWaits.wait(Math.min(until, Date.now() + 30_000));
        requireBoundContentTab(sender, message);
        const reason = getRunLimitReason(state, settings);
        if (state.status === "running" && reason) await pauseForRunLimit(reason);
        return { ...result, ok: result.ok && state.status === "running" };
      }

      case "DRA_PROGRESS": {
        requireBoundContentTab(sender, message);
        if (state.status !== "running") return { ok: false, canceled: true };
        const now = Date.now();
        const budget = stepBudget(message.phase, settings, message.waitUntil, now);
        state.runtime = {
          ...state.runtime, phase: message.phase, deadlineAt: now + budget, progressAt: now,
          videoId: String(message.videoId || state.runtime?.videoId || ""),
          cycleStartedAt: message.phase === "read" ? now
            : message.phase === "dwell" && Number.isFinite(message.cycleStartedAt) && message.cycleStartedAt <= now
              ? message.cycleStartedAt : state.runtime?.cycleStartedAt,
          waitUntil: message.phase === "dwell" ? message.waitUntil : null,
          plannedDwellSeconds: message.plannedDwellSeconds ?? state.runtime?.plannedDwellSeconds
        };
        if (message.phase === "submit") {
          state.runtime.lastReadAt = now;
          state.runtime.actualDwellSeconds = message.actualDwellSeconds;
        }
        if (message.phase === "idle" && message.transitionOk === true) {
          state.runtime.lastTransitionAt = now;
          state.runtime.recoveryAttempts = 0;
        }
        await persistState();
        return { ok: true };
      }

      case "DRA_RAW_SAMPLE":
        requireBoundContentTab(sender, message);
        return {ok:true, samples:await saveRawSample(message.sample)};

      case "DRA_READ_CAPTURED_PROFILE_IP": {
        requireBoundContentTab(sender,message);
        return {ok:true,ipLocation:deps.readCapturedProfileIp(state.feedTabId,message.secUid)};
      }
      case "DRA_DOUYIN_PROFILE_IP": {
        requireBoundContentTab(sender, message);
        if (settings.allowProfileIpFallback !== true) return { ok: true, ipLocation: null };
        const { runId, loopId } = message;
        const ipLocation = await readDouyinIpLocation({ profileUrl: message.profileUrl,
          secUid: message.secUid, windowId: state.feedWindowId, runKey: `${runId}:${loopId}`,
          isCurrent: () => state.status === 'running' && state.runId === runId && state.loopId === loopId });
        return { ok: true, ipLocation };
      }

      case "DRA_OBSERVATION": {
        requireBoundContentTab(sender, message);
        try {await saveObservations([normalizeDouyinObservation(message.observation || {},message.profile,state.runId)]);}
        catch(error){await setPaused(error.message);return {ok:false,continue:false,error:error.message};}
        const result = await handleObservation(message.observation || {}, message.profile || null, Boolean(message.panelRecovered));
        return stopAtReachedTarget(result);
      }

      case "DRA_PANEL_SKIPPED": {
        requireBoundContentTab(sender, message);
        try {await saveObservations([normalizeDouyinObservation(message.observation || {},null,state.runId)]);}
        catch(error){await setPaused(error.message);return {ok:false,continue:false,error:error.message};}
        const result = await handlePanelSkipped(message.observation || {}, message.reason || "");
        return stopAtReachedTarget(result);
      }

      case "DRA_TRANSITION_RESULT":
        requireBoundContentTab(sender, message);
        return finalizeObservationTransition(message.recordId, message.transition || {});

      case "DRA_ENGAGE": {
        requireBoundContentTab(sender, message);
        const pending = engagementQueue.then(() => performEngagement(sender.tab.id, message));
        engagementQueue = pending.catch(() => undefined);
        return pending;
      }

      case "DRA_TRUSTED_KEY":
        requireBoundContentTab(sender, message);
        return dispatchTrustedKey(sender.tab?.id, message.key, message.loopId);

      case "DRA_TRUSTED_CLICK":
        requireBoundContentTab(sender, message);
        return dispatchTrustedClick(sender.tab?.id, message);

      case "DRA_TRUSTED_WHEEL":
        requireBoundContentTab(sender, message);
        return dispatchTrustedWheel(sender.tab?.id, message);

      case "DRA_PAGE_BLOCKED":

      case "DRA_FEED_STALLED":
        requireBoundContentTab(sender, message);
        await setPaused(message.reason || "抖音页面需要人工处理");
        return { ok: true };

      case "DRA_TICK_ERROR":
        requireBoundContentTab(sender, message);
        state.lastError = message.error || "推荐流处理异常";
        if (Number(message.failureStreak) >= 3) await setPaused(`推荐流连续处理失败：${state.lastError}`, state.lastError);
        else await persistState();
        return { ok: true };

 default: throw Error("抖音消息类型无效"); }}

  function restore(saved={}) {state={...cloneInitialState(),...saved.state,stats:{...INITIAL_STATE.stats,...saved.state?.stats}};seenVideos=saved.seenVideos || [];creatorIndex=saved.creatorIndex || {};settings=mergeSettings(state.runSettings || deps.config().settings);rules=mergeRules(state.runRules || deps.config().rules);notify();}
  function snapshot(){notify();return state.route?state:{...state,route:{platform:'douyin',surface:'recommend',label:'抖音推荐'}};}
  return {observationRecord,setPaused,syncRunStopAlarm,startRun,resumeRun,stopRun,watchdog,handleRunStopAlarm,message,state:snapshot,active:isActiveRunStatus,restore,storage:()=>({state,seenVideos,creatorIndex}),
    start:startRun,resume:resumeRun,pause:async(reason='用户暂停')=>{await setPaused(reason);return snapshot();},stop:stopRun,inspect:watchdog,
    timers:async()=>{await syncRunStopAlarm();if(state.status==='running')await chrome.alarms.create(WATCHDOG_ALARM,{periodInMinutes:.5});},
    detached:(tabId)=>attachedDebuggerTabs.delete(tabId),clear:()=>{seenVideos=[];creatorIndex={};notify();}};
}
