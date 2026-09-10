import { saveObservations, normalizeDouyinObservation, exportObservations, normalizeFeiguaObservation, observationRecord as feiguaObservationRecord, observationStatus, pendingObservations, markObservationsQueued, markObservationsUploaded, cleanupObservations } from './lib/observations.js';
import { createFeiguaRuntime, FEIGUA_ALARM, FEIGUA_STOP_ALARM } from "./lib/feigua-task.js";
import { canEngage, reserveEngagement, newEngagement, restoreEngagement, ENGAGEMENT_KEYS } from "./lib/engagement.js";
import { rawSamples } from "./lib/raw-sample-store.js";
import { sanitizeRaw } from "./lib/raw-sample.js";
import { accountProfile } from "./lib/account-profile.js";
import { launcherState, toolbarState, aggregateTaskState } from "./lib/launcher-state.js";
import { contentSkipDecision } from "./lib/content-type.js";
import { dailySnapshot, recordDailyScan } from "./lib/daily-stats.js";
import {
  CLOUD_DESTINATION,
  MAX_INGEST_BYTES,
  MAX_INGEST_RECORDS,
  buildIngestBody,
  buildObservationRecord,
  classifyIngestStatus,
  createCloudClient,
  encodeIngestBody,
  ingestResultSets,
  pairUrlFor,
  shrinkRecordsToByteLimit,
} from "./lib/cloud.js";
import { DEFAULT_RULES, DEFAULT_SETTINGS, INITIAL_STATE, STORAGE_KEYS, TEAM_DESTINATION, mergeRules, mergeSettings, validateSettings } from "./lib/defaults.js";
import { migrateDecisionHistory, writeDecisions, cleanupDecisions, decisionPreview, queryDecisions } from "./lib/decision-store.js";
import { normalizeSourcePlatform } from "./lib/source-platform.js";
import { makeCreatorKey } from "./lib/normalizers.js";
import { evaluateCreatorRules, evaluateVideoRules, scoreCreator, validateRules } from "./lib/rule-engine.js";
import { createRunWaits, runtimeStalled, stepBudget, withTimeout } from "./lib/runtime-health.js";
import { canResumeRun, elapsedRunMs, getRunLimitReason, normalizeRunTarget } from "./lib/run-limits.js";
import { nextScheduledOccurrence, validateSchedule } from "./lib/scheduler.js";
import { firstRunnableTabInWindow, launchUrl, resolveRoute } from "./src/core/platform-router.ts";

const WATCHDOG_ALARM = "dra-watchdog";
const SCHEDULE_ALARM = "dra-schedule-next";
const RUN_STOP_ALARM = "dra-run-stop";
const UPLOAD_ALARM = "dra-upload";
const MAX_SEEN_VIDEOS = 5_000;
const MAX_OUTBOX = 1_000;
const DEBUGGER_PROTOCOL_VERSION = "1.3";
const SIDE_PANEL_PATH = "sidepanel/index.html";
const attachedDebuggerTabs = new Set();
const panelPorts = new Map();
const cloudClient = createCloudClient();
const MAX_UPLOAD_ATTEMPTS = 8;

let initialized = null;
let state = structuredClone(INITIAL_STATE);
let settings = mergeSettings();
let rules = mergeRules();
let settingsDraft = null;
let configQueue = Promise.resolve();
let seenVideos = [];
let creatorIndex = {};
let outbox = [];
let workDataWrites = Promise.resolve();
let browseState = {enabled:true, count:0, lastError:""};
let browseWrites=Promise.resolve();
let dailyStats = null;
let pendingDecisions = [];
let historyWrites = Promise.resolve();
let flushInFlight = null;
let cloudAuth = null;
let pairing = null;
const runWaits = createRunWaits();
let watchdogInFlight = null;


const feigua = createFeiguaRuntime({
  settings:()=>settings, rules:()=>rules, authorize:checkCloudConnection,
  ensureContent:ensureContentRuntime, waitForTab:waitForTabComplete,
  creatorIndex:()=>creatorIndex, reserveQueue, addOutbox, recordDecision,
  recordScan:key=>{dailyStats=recordDailyScan(dailyStats,key);},
  persist:persistWorkData, indicators:updateTaskIndicators, scheduleUpload,
  savePage:async(page,runId,legacy=false)=>{
    const items=await saveObservations(page.rows.map(row=>({...normalizeFeiguaObservation(row,page,runId,"automatic"),uploadEligible:!legacy && settings.feiguaUploadEnabled===true && !feigua.state().runSettings?.dryRun})));
    await stageFeiguaObservations();
    return items;
  }
});
function taskForSession(sessionId) { return [state,feigua.state()].find(task=>task.runId===sessionId); }
function incrementForSession(sessionId,key,amount=1) {
  const owner=taskForSession(sessionId); if(owner) owner.stats[key]=Number(owner.stats[key]||0)+amount;
}
function reserveQueue(count) {
  const settled=new Set(['written','duplicate','dry-run']);
  const retained=outbox.filter(item=>!settled.has(item.status));
  if(retained.length+count>MAX_OUTBOX) throw Error('共享上传队列已满，请完成上传后继续；待上传数据已保留');
  let excess=Math.max(0,outbox.length+count-MAX_OUTBOX);
  outbox=outbox.filter(item=>{if(excess && settled.has(item.status)){excess--;return false;}return true;});
}
function aggregateState() { return aggregateTaskState([state,feigua.state()]); }
function syncPower() {
  if (isActiveRunStatus() && settings.keepSystemAwake || feigua.active() && feigua.state().runSettings?.keepSystemAwake) chrome.power.requestKeepAwake('system');
  else chrome.power.releaseKeepAwake();
}
async function selectedTask(tabId,platform) {
  if(platform==='feigua') return feigua.state();
  if(platform==='douyin' || !Number.isInteger(tabId)) return state;
  const tab=Number.isInteger(tabId)?await chrome.tabs.get(tabId).catch(()=>null):null;
  const route=resolveRoute(tab?.pendingUrl || tab?.url || '');
  if(route?.platform==='feigua') return feigua.state();
  if(route?.platform==='kuaishou') return stateSnapshotForTab(tabId);
  if(route?.platform==='douyin')return state;
  return stateSnapshotForTab(tabId);
}

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

async function initialize() {
  if (initialized) return initialized;
  initialized = (async () => {
    const saved = await chrome.storage.local.get([...Object.values(STORAGE_KEYS),"draFeiguaBrowsing"]);
    browseState={...browseState,...saved.draFeiguaBrowsing};
    const savedRules = saved[STORAGE_KEYS.rules] || {};
    const savedRulesVersion = Number(savedRules.version || 0);
    settings = mergeSettings(saved[STORAGE_KEYS.settings] || DEFAULT_SETTINGS);
    settingsDraft = saved[STORAGE_KEYS.settingsDraft] || null;
    rules = mergeRules(savedRules);
    dailyStats = saved[STORAGE_KEYS.dailyStats] || null;
    const savedState = saved[STORAGE_KEYS.state] || {};
    state = {
      ...cloneInitialState(),
      ...savedState,
      engagement: restoreEngagement(savedState.engagement),
      stats: { ...INITIAL_STATE.stats, ...(savedState.stats || {}) }
    };
    await migrateDecisionHistory(saved);
    delete state.recentDecisions;
    await chrome.storage.local.remove(STORAGE_KEYS.decisionHistory);
    await chrome.alarms.create("dra-history-cleanup", {periodInMinutes:5});
    if (state.status === "starting") {
      state.status = "paused";
      runWaits.cancel();
      state.startupStage = "";
      state.pauseReason = "上次启动过程被 Chrome 中断，请重新开始本轮";
    }
    if (["paused", "stopped"].includes(state.status) && !state.endedAt) {
      state.endedAt = state.lastTickAt || new Date().toISOString();
    }
    delete state.workerTabId;
    seenVideos = Array.isArray(saved[STORAGE_KEYS.seenVideos]) ? saved[STORAGE_KEYS.seenVideos] : [];
    // 规则升级后允许旧版本已过滤的视频重新进入判断。
    if (savedRulesVersion < DEFAULT_RULES.version) seenVideos = [];
    creatorIndex = saved[STORAGE_KEYS.creatorIndex] && typeof saved[STORAGE_KEYS.creatorIndex] === "object"
      ? saved[STORAGE_KEYS.creatorIndex]
      : {};
    feigua.restore(saved);
    if (savedState.route?.platform === "feigua") state = cloneInitialState();
    outbox = Array.isArray(saved[STORAGE_KEYS.outbox]) ? saved[STORAGE_KEYS.outbox] : [];
    await chrome.alarms.create("dra-observations-cleanup", {periodInMinutes:60});
    await cleanupStoredObservations();
    cloudAuth = saved[STORAGE_KEYS.cloudAuth] && typeof saved[STORAGE_KEYS.cloudAuth] === "object"
      ? saved[STORAGE_KEYS.cloudAuth]
      : null;
    pairing = saved[STORAGE_KEYS.pairing] && typeof saved[STORAGE_KEYS.pairing] === "object"
      ? saved[STORAGE_KEYS.pairing]
      : null;
    const invalidQueuedKeys = new Set(outbox
      .filter((item) => ["dry-run", "bridge-disabled", "cloud-disabled", "write-error"].includes(item?.status) && isInvalidStoredCreatorName(item?.payload?.accountName || item?.payload?.author))
      .map((item) => item?.payload?.creatorKey)
      .filter(Boolean));
    outbox = outbox.filter((item) => !(["dry-run", "bridge-disabled", "cloud-disabled", "write-error"].includes(item?.status) && isInvalidStoredCreatorName(item?.payload?.accountName || item?.payload?.author)));
    for (const key of invalidQueuedKeys) {
      if (creatorIndex[key]?.status === "outbox") delete creatorIndex[key];
    }
    await chrome.storage.local.set({
      [STORAGE_KEYS.settings]: settings,
      [STORAGE_KEYS.rules]: rules,
      [STORAGE_KEYS.state]: state,
      [STORAGE_KEYS.seenVideos]: seenVideos,
      [STORAGE_KEYS.creatorIndex]: creatorIndex,
      [STORAGE_KEYS.profileQueue]: [],
      [STORAGE_KEYS.outbox]: outbox,
      ...feigua.storage()
    });
    await feigua.timers();
    await updateTaskIndicators();
    await syncScheduleAlarm();
    await syncRunStopAlarm();
    await scheduleUpload();
    if (state.status === "running") await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
  })();
  return initialized;
}

let rawQueue = Promise.resolve();
function requireExtensionPage(sender) {
  if (!sender.url?.startsWith(chrome.runtime.getURL(""))) throw Error("此操作仅可从插件设置发起");
}
async function saveRawSample(sample, label = "unconfirmed", manual = false) {
  const saved = await chrome.storage.local.get(STORAGE_KEYS.debugSettings);
  if (!saved[STORAGE_KEYS.debugSettings]?.rawCapture) throw Error("请先开启原始数据采样");
  if (!sample || typeof sample.dom !== "string") throw Error("无效的卡片采样");
  const value = {...sanitizeRaw(sample), dom:sample.dom.slice(0,250000), label,
    runId:manual ? "" : state.runId || "", captureMode:manual ? "manual" : "automatic", version:pluginVersion()};
  const result = rawQueue.then(() => rawSamples("add", value));
  rawQueue = result.catch(() => undefined);
  try { const summary = await result; await chrome.storage.local.set({draRawSampleError:""}); return summary; }
  catch (error) { await chrome.storage.local.set({draRawSampleError:error.message || "本地采样保存失败"}); throw error; }
}

async function updateTaskIndicators() {
  syncPower();
  const badge = toolbarState(aggregateState());
  await Promise.all([
    chrome.action.setBadgeText({ text: badge.text }),
    chrome.action.setBadgeBackgroundColor({ color: badge.color }),
    chrome.action.setTitle({ title: badge.title })
  ]);
}

async function notifyLauncherWindow(windowId) {
  const tabs = await chrome.tabs.query({ windowId, url: ["http://*/*", "https://*/*"] });
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, {
    type: "DRA_LAUNCHER_CHANGED", launcher: launcherState(aggregateState())
  }).catch(() => undefined);
}

chrome.runtime.onConnect.addListener(port => {
  if (!port.name.startsWith("dra-panel:") || port.sender?.url !== chrome.runtime.getURL(SIDE_PANEL_PATH)) return;
  const windowId = Number(port.name.slice("dra-panel:".length));
  if (!Number.isInteger(windowId)) return;
  const ports = panelPorts.get(windowId) || new Set();
  ports.add(port); panelPorts.set(windowId, ports);
  initialize().then(() => notifyLauncherWindow(windowId)).catch(() => undefined);
  port.onDisconnect.addListener(() => {
    ports.delete(port); if (!ports.size) panelPorts.delete(windowId);
    notifyLauncherWindow(windowId).catch(() => undefined);
  });
});

async function flushDecisionHistory() {
  const task = historyWrites.then(async () => {
    if (!pendingDecisions.length) return;
    const batch = pendingDecisions.slice();
    await writeDecisions(batch);
    pendingDecisions.splice(0,batch.length);
    chrome.runtime.sendMessage({type:"DRA_HISTORY_CHANGED"}).catch(() => undefined);
  });
  historyWrites=task.catch(() => undefined);
  return task;
}

async function persistState(notificationTabId = state.feedTabId) {
  const task = workDataWrites.then(async () => {
  await flushDecisionHistory();
  await chrome.storage.local.set({
    [STORAGE_KEYS.state]: state,
    [STORAGE_KEYS.dailyStats]: dailyStats
  });
  void updateTaskIndicators().catch(() => undefined);
  chrome.runtime.sendMessage({ type: "DRA_STATUS_CHANGED", tabId: notificationTabId, state }).catch(() => undefined);
  });
  workDataWrites = task.catch(()=>undefined);
  return task;
}

async function persistWorkData() {
  const task = workDataWrites.then(async () => {
  await flushDecisionHistory();
  await chrome.storage.local.set({
    [STORAGE_KEYS.state]: state,
    [STORAGE_KEYS.dailyStats]: dailyStats,
    [STORAGE_KEYS.seenVideos]: seenVideos,
    [STORAGE_KEYS.creatorIndex]: creatorIndex,
    [STORAGE_KEYS.profileQueue]: [],
    [STORAGE_KEYS.outbox]: outbox,
    ...feigua.storage(),
    [STORAGE_KEYS.cloudAuth]: cloudAuth,
    [STORAGE_KEYS.pairing]: pairing
  });
  chrome.runtime.sendMessage({type:"DRA_STATUS_CHANGED"}).catch(()=>undefined);
  });
  workDataWrites = task.catch(()=>undefined);
  return task;
}

async function persistCloudAuth() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.cloudAuth]: cloudAuth,
    [STORAGE_KEYS.pairing]: pairing
  });
}

function increment(name, amount = 1) {
  state.stats[name] = Number(state.stats[name] || 0) + amount;
}

function recordDecision(decision = {}, observation = {}, profile = null, owner = state) {
  const entry = {
    id: crypto.randomUUID(),
    runId: owner.runId || "",
    runStartedAt: owner.startedAt || "",
    sourcePlatform: normalizeSourcePlatform(owner.route?.platform || observation.sourcePlatform || observation.platform || "douyin"),
    code: String(decision.code || "UNKNOWN"),
    reasons: Array.isArray(decision.reasons) ? decision.reasons.filter(Boolean).slice(0, 4) : [],
    accountName: profile?.authorName || observation.authorName || decision.accountName || "",
    avatarUrl: profile?.avatarUrl || observation.avatarUrl || decision.avatarUrl || "",
    profileUrl: profile?.profileUrl || observation.profileUrl || decision.profileUrl || "",
    occurredAt: new Date().toISOString()
  };
  owner.lastDecision = entry;
  pendingDecisions.push(entry);
  return entry;
}

function addOutbox(status, payload, error = "", { transitionPending = false, owner = state } = {}) {
  reserveQueue(1);
  const item = {
    id: payload?.record_id || crypto.randomUUID(),
    status,
    payload,
    error,
    transitionPending,
    sessionId: owner.runId || payload?.run_id || "",
    startedAt: owner.startedAt || payload?.observed_at || new Date().toISOString(),
    queuedAt: new Date().toISOString(),
    attempts: 0
  };
  outbox.push(item);
  return item;
}

function pluginVersion() {
  return chrome.runtime.getManifest().version;
}

function cloudStatusSnapshot() {
  return {
    connected: Boolean(cloudAuth?.device_token) && !cloudAuth?.expired,
    expired: Boolean(cloudAuth?.expired),
    userId: cloudAuth?.user_id || "",
    account: accountProfile(cloudAuth?.account, cloudAuth?.user_id),
    pairedAt: cloudAuth?.pairedAt || "",
    destination: CLOUD_DESTINATION,
    pairing: pairing
      ? {
          status: pairing.status || "pending",
          code: pairing.code || "",
          pairUrl: pairing.pairUrl || "",
          expiresAt: pairing.expiresAt || ""
        }
      : null
  };
}

async function ensureHostFingerprint() {
  if (cloudAuth?.host_fingerprint) return cloudAuth.host_fingerprint;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const fingerprint = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
  cloudAuth = { ...(cloudAuth || {}), host_fingerprint: fingerprint };
  await persistCloudAuth();
  return fingerprint;
}

function cloudReady() {
  // Upload eligibility belongs to each queued item, independent of the next task's test-mode setting.
  return Boolean(cloudAuth?.device_token && !cloudAuth?.expired);
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
    item = addOutbox(settings.dryRun ? "dry-run" : "cloud-disabled", record, "", { transitionPending: true });
  } else if (!cloudAuth?.device_token) {
    item = addOutbox("write-error", record, "尚未连接研究台", { transitionPending: true });
  } else {
    item = addOutbox("pending", record, "", { transitionPending: true });
  }
  return { queued: true, recordId: item.id };
}

async function finalizeObservationTransition(recordId, transition = {}) {
  const item = outbox.find((candidate) => candidate?.payload?.record_id === recordId);
  if (!item) throw new Error("找不到等待确认翻页结果的观察记录");
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
  await persistWorkData();
  if (["pending", "write-error"].includes(item.status)) await scheduleUpload();
  return { ok: true, recordId };
}

async function settleInterruptedTransitions() {
  let changed = false;
  for (const item of outbox) {
    if (item.sessionId !== state.runId || !item.transitionPending) continue;
    item.transitionPending = false;
    item.payload.transition_ok = null;
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
  await scheduleUpload(true);
}

async function ensureDebugger(tabId) {
  if (!Number.isInteger(tabId)) throw new Error("缺少当前推荐流标签页");
  if (attachedDebuggerTabs.has(tabId)) return;
  // A worker restart loses the Set while Chrome can retain our attachment.
  if (state.feedTabId === tabId && state.status === "running") {
    const owned = await chrome.debugger.sendCommand({ tabId }, "Page.getFrameTree").then(() => true, () => false);
    if (owned) { attachedDebuggerTabs.add(tabId); return; }
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
}

function assertInputGeneration(tabId, loopId) {
  if (state.status !== "running" || tabId !== state.feedTabId || loopId !== state.loopId) throw new Error("操作所属循环已结束");
}

async function dispatchTrustedKey(tabId, requestedKey, loopId) {
  const keys = {
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

let engagementQueue = Promise.resolve();
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

function waitForTabComplete(tabId, timeoutMs = 45_000) {
  return new Promise(async (resolve, reject) => {
    const current = await chrome.tabs.get(tabId).catch(() => null);
    if (!current) return reject(new Error("当前推荐流标签页已关闭"));
    if (current.status === "complete") return resolve(current);
    const timeout = setTimeout(() => finish(new Error("当前推荐流页面加载超时")), timeoutMs);
    function finish(error, tab) {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (error) reject(error);
      else resolve(tab);
    }
    function onUpdated(updatedId, changeInfo, tab) {
      if (updatedId === tabId && changeInfo.status === "complete") finish(null, tab);
    }
    function onRemoved(removedId) {
      if (removedId === tabId) finish(new Error("当前推荐流标签页已关闭"));
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

async function sendTabMessage(tabId, message, attempts = 8) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await withTimeout(chrome.tabs.sendMessage(tabId, message), 5_000);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError || new Error("无法连接当前平台页面脚本");
}

async function ensureContentRuntime(tab) {
  const existing = await sendTabMessage(tab.id, { type: "DRA_LOOP_STATUS" }, 1).catch(() => null);
  if (existing?.ok) return tab;
  await chrome.tabs.reload(tab.id);
  const reloaded = await waitForTabComplete(tab.id);
  const status = await sendTabMessage(tab.id, { type: "DRA_LOOP_STATUS" }, 12).catch(() => null);
  if (!status?.ok) throw new Error("当前平台页面脚本未加载，请刷新页面后重试");
  return reloaded;
}

const launcherInjections = new Map();
function ensureTabLauncher(tabId) {
  if (!Number.isInteger(tabId)) return Promise.resolve();
  if (launcherInjections.has(tabId)) return launcherInjections.get(tabId);
  const pending = (async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!/^https?:\/\//.test(tab?.pendingUrl || tab?.url || "")) return;
    const reply = await withTimeout(chrome.tabs.sendMessage(tabId, { type: "DRA_LAUNCHER_PING" }), 1500).catch(() => null);
    if (reply?.launcherVersion === pluginVersion()) return;
    // Only install the small launcher; never start a collector or reload the page.
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content/floating-launcher.js"] });
  })().catch(() => undefined).finally(() => launcherInjections.delete(tabId));
  // Chrome protected pages and withheld site permissions reject injection.
  launcherInjections.set(tabId, pending);
  return pending;
}
async function restoreOpenTabLaunchers() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(tabs.map(tab => ensureTabLauncher(tab.id)));
}

async function configureOpenTabSidePanels() {
  await chrome.sidePanel.setOptions({ path: SIDE_PANEL_PATH, enabled: true });
  // Upgrade tabs carrying the previous per-tab disabled override.
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async tab => {
    const previous = await chrome.sidePanel.getOptions({ tabId: tab.id });
    if (Number.isInteger(previous.tabId)) {
      await chrome.sidePanel.setOptions({ tabId: tab.id, path: SIDE_PANEL_PATH, enabled: true });
    }
  }));
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
    tab = firstRunnableTabInWindow(candidates, windowId);
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

async function syncScheduleAlarm(fromMs = Date.now()) {
  await chrome.alarms.clear(SCHEDULE_ALARM);
  if (settings.schedule?.enabled === false || validateSchedule(settings.schedule).length) return null;
  const occurrence = nextScheduledOccurrence(settings.schedule, fromMs);
  if (!occurrence) return null;
  await chrome.alarms.create(SCHEDULE_ALARM, { when: occurrence.scheduledTime });
  return occurrence;
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

async function getScheduleStatus() {
  const alarm = await chrome.alarms.get(SCHEDULE_ALARM).catch(() => null);
  const fallback = alarm ? null : nextScheduledOccurrence(settings.schedule, Date.now());
  return {
    enabled: settings.schedule?.enabled !== false,
    weekdays: settings.schedule?.weekdays || [],
    times: settings.schedule?.times || [],
    target: normalizeRunTarget(settings.schedule?.target),
    reuseExistingTab: settings.schedule?.reuseExistingTab !== false,
    nextRunAt: alarm?.scheduledTime
      ? new Date(alarm.scheduledTime).toISOString()
      : fallback?.scheduledTime
        ? new Date(fallback.scheduledTime).toISOString()
        : null,
    lastRunAt: state.lastScheduleAt,
    lastResult: state.lastScheduleResult || ""
  };
}

function uploadableOutbox() {
  return outbox.filter((item) => {
    if (item.transitionPending || Number(item.retryAt || 0)>Date.now()) return false;
    if (!["pending", "write-error", "failed"].includes(item.status)) return false;
    const record = item.payload;
    const isFeigua = record?.rpa_feedback?.source_platform === 'feigua' || record?.rpa_feedback?.source === 'feigua-video-library' || item.sessionId && item.sessionId === feigua.state().runId;
    if (isFeigua && settings.feiguaUploadEnabled !== true) return false;
    return record && typeof record === "object" && typeof record.record_id === "string" && Number.isInteger(record.feed_index);
  });
}

async function scheduleUpload(force = false, retry = false) {
  await stageFeiguaObservations();
  const pending = uploadableOutbox();
  if (!pending.length || !cloudReady()) {
    const retries=outbox.filter(item=>['pending','write-error','failed'].includes(item.status) && item.retryAt>Date.now() && (settings.feiguaUploadEnabled===true || item.payload?.rpa_feedback?.source_platform!=='feigua'));
    if(cloudReady() && retries.length)await chrome.alarms.create(UPLOAD_ALARM,{when:Math.min(...retries.map(item=>item.retryAt))});
    else await chrome.alarms.clear(UPLOAD_ALARM);
    return;
  }
  const oldest = Math.min(...pending.map(item => Date.parse(item.queuedAt) || Date.now()));
  const when = retry || flushInFlight ? Date.now() + 30_000
    : force || pending.length >= 10 ? Date.now() + 100 : Math.max(Date.now() + 100, oldest + 60_000);
  const existing = await chrome.alarms.get(UPLOAD_ALARM);
  if (!existing || existing.scheduledTime > when) await chrome.alarms.create(UPLOAD_ALARM, { when });
}

async function handleUploadAlarm() {
  await initialize();
  try { await flushOutbox({ force: true }); }
  catch (error) { state.lastError = `研究台同步失败：${error?.message || String(error)}`; await persistState(); }
  finally { await scheduleUpload(false, true); }
}

function flushOutbox(options = {}) {
  if (flushInFlight) return flushInFlight;
  flushInFlight = flushOutboxBatch(options).finally(() => { flushInFlight = null; });
  return flushInFlight;
}

async function flushOutboxBatch({ force = false, limit = MAX_INGEST_RECORDS } = {}) {
  await stageFeiguaObservations();
  if (!cloudReady()) return { status: "idle" };
  const pending = uploadableOutbox();
  if (!pending.length) return { status: "idle" };
  const oldest = Math.min(...pending.map((item) => Date.parse(item.queuedAt) || Date.now()));
  if (!force && pending.length < 10 && Date.now() - oldest < 60_000) return { status: "deferred" };

  pending.sort((a,b)=>(Date.parse(a.payload.observed_at) || Date.parse(a.queuedAt) || 0)-(Date.parse(b.payload.observed_at) || Date.parse(b.queuedAt) || 0));
  const first = pending[0];
  const sessionId = first.sessionId || state.runId;

  const owner = taskForSession(sessionId);
  const startedAt = first.startedAt || owner?.startedAt || new Date().toISOString();
  let end=pending.findIndex(item=>(item.sessionId || state.runId)!==sessionId);
  let rows = pending.slice(0,end<0?limit:Math.min(end,limit));
  const encode = (list) => encodeIngestBody(buildIngestBody({
    sessionId,
    pluginVersion: pluginVersion(),
    hostFingerprint: cloudAuth.host_fingerprint || "",
    startedAt,
    stats: owner?.stats || {},
    heartbeat: { pending: uploadableOutbox().length },
    records: list.map((item) => item.payload)
  }));
  rows = shrinkRecordsToByteLimit(rows, encode);
  const body = encode(rows);
  if (body.length > MAX_INGEST_BYTES) {
    for (const item of rows) {
      item.status = "dead";
      item.error = "单条观察超过上传体积上限";
    }
    incrementForSession(sessionId,"uploadRejected",rows.length);
    await persistWorkData();
    return { status: "rejected" };
  }

  let result;
  const uploadingAuth = cloudAuth;
  try {
    result = await cloudClient.ingest(uploadingAuth.device_token, body);
  } catch (error) {
    const message = error?.message || String(error);
    for (const item of rows) {
      item.status = "write-error";
      item.retryAt=Date.now()+30_000;
      item.error = message;
      item.lastTriedAt = new Date().toISOString();
    }
    if (owner) owner.lastError = `研究台上传失败：${message}`;
    await persistWorkData();
    await persistState();
    return { status: "network_error" };
  }

  const kind = classifyIngestStatus(result.status);
  if (kind === "auth_error") {
    if (cloudAuth !== uploadingAuth) return { status: "auth_error", reason: "connection_changed" };
    if (cloudAuth) cloudAuth.expired = true;
    await persistCloudAuth();
    if (feigua.active() && !feigua.state().runSettings?.dryRun) await feigua.pause("研究台授权已失效，请重新登录并连接");
    if (isActiveRunStatus() && !settings.dryRun) await setPaused("研究台授权已失效，请重新登录并连接");
    state.lastError = "研究台授权已失效，请重新连接";
    await persistState();
    return { status: "auth_error", reason: result.payload?.error || "unauthorized" };
  }
  if (!result.ok) {
    const permanent = kind === "rejected";
    for (const item of rows) {
      item.attempts = Number(item.attempts || 0) + 1;
      item.lastTriedAt = new Date().toISOString();
      item.error = result.payload?.error || `HTTP ${result.status}`;
      item.status = permanent || item.attempts >= MAX_UPLOAD_ATTEMPTS ? "dead" : "write-error";
      item.retryAt=Date.now()+Math.min(1800000,30000*2**Math.min(item.attempts,6));
    }
    if (permanent) incrementForSession(sessionId,"uploadRejected",rows.length);
    await persistWorkData();
    return { status: permanent ? "rejected" : "retry" };
  }

  const sets = ingestResultSets(result.payload);
  await markObservationsUploaded([...sets.accepted,...sets.duplicated]);
  for (const item of rows) {
    const id = String(item.payload.record_id);
    item.attempts = Number(item.attempts || 0) + 1;
    item.lastTriedAt = new Date().toISOString();
    if (sets.accepted.has(id) || sets.duplicated.has(id)) {
      item.status = sets.duplicated.has(id) ? "duplicate" : "written";
      item.flushedAt = new Date().toISOString();
      item.error = "";
      incrementForSession(item.sessionId,"uploaded");
    } else if (sets.rejected.has(id) || item.attempts >= MAX_UPLOAD_ATTEMPTS) {
      item.status = "dead";
      item.error = sets.rejected.get(id) || "retry_exhausted";
      incrementForSession(item.sessionId,"uploadRejected");
    } else {
      item.status = "write-error";
      item.error = "missing acknowledgement";
      item.retryAt=Date.now()+30_000;
    }
  }
  await persistWorkData();
  await persistState();
  return { status: "ok", accepted: sets.accepted.size, duplicated: sets.duplicated.size, rejected: sets.rejected.size };
}

async function checkCloudConnection() {
  if (!cloudAuth?.device_token) throw new Error("尚未连接研究台。请先点击「登录并连接研究台」完成授权。");
  const auth = cloudAuth;
  const result = await cloudClient.checkAuth(auth.device_token, pluginVersion());
  if (cloudAuth !== auth) throw new Error("研究台连接已变更，请重试");
  if (result.status === 401) {
    cloudAuth.expired = true;
    await persistCloudAuth();
    if (feigua.active() && !feigua.state().runSettings?.dryRun) await feigua.pause("研究台授权已失效，请重新登录并连接");
    if (isActiveRunStatus() && !settings.dryRun) await setPaused("研究台授权已失效，请重新登录并连接");
    else await persistState();
    throw new Error("研究台授权已失效，请重新登录并连接。");
  }
  if (!result.ok) throw new Error(result.payload?.error || `研究台检测失败：${result.status}`);
  cloudAuth.expired = false;
  if (result.payload?.account) cloudAuth.account = accountProfile(result.payload.account, cloudAuth.user_id);
  await persistCloudAuth();
  await scheduleUpload(true);
  return { ok: true, userId: cloudAuth.user_id || "", destination: CLOUD_DESTINATION };
}

async function startPairing() {
  if (pairing?.status === "pending" && Date.parse(pairing.expiresAt) > Date.now()) {
    pairing = { ...pairing, pairUrl: pairUrlFor(pairing.code) };
    await persistCloudAuth();
    await chrome.tabs.create({ url: pairing.pairUrl, active: true });
    return cloudStatusSnapshot();
  }
  const result = await cloudClient.startPairing();
  if (!result.ok) throw new Error(result.payload?.error || "发起研究台配对失败");
  const code = String(result.payload.code || "");
  const deviceSecret = String(result.payload.device_secret || "");
  if (!code || !deviceSecret) throw new Error("研究台未返回配对码");
  pairing = {
    status: "pending",
    code,
    deviceSecret,
    pairUrl: pairUrlFor(code),
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + Number(result.payload.expires_in_seconds || 600) * 1000).toISOString()
  };
  await persistCloudAuth();
  await chrome.tabs.create({ url: pairing.pairUrl, active: true });
  return cloudStatusSnapshot();
}

async function pollPairing() {
  if (!pairing?.code || !pairing?.deviceSecret) return cloudStatusSnapshot();
  if (pairing.expiresAt && Date.parse(pairing.expiresAt) <= Date.now()) {
    pairing = { ...pairing, status: "expired" };
    await persistCloudAuth();
    throw new Error("配对码已过期，请重新连接研究台");
  }
  const fingerprint = await ensureHostFingerprint();
  const result = await cloudClient.pollPairing({
    code: pairing.code,
    deviceSecret: pairing.deviceSecret,
    hostFingerprint: fingerprint
  });
  if (result.status === 202 || result.payload?.status === "pending") {
    pairing = { ...pairing, status: "pending" };
    await persistCloudAuth();
    return cloudStatusSnapshot();
  }
  if (!result.ok) throw new Error(result.payload?.error || "配对确认失败");
  cloudAuth = {
    device_token: result.payload.device_token,
    user_id: result.payload.user_id || "",
    account: accountProfile(result.payload.account, result.payload.user_id),
    host_fingerprint: fingerprint,
    workbench_url: CLOUD_DESTINATION.workbenchUrl,
    pairedAt: new Date().toISOString()
  };
  pairing = null;
  await persistCloudAuth();
  await scheduleUpload(true);
  return cloudStatusSnapshot();
}

async function disconnectCloud() {
  if (feigua.active() && !feigua.state().runSettings?.dryRun) await feigua.pause("研究台已断开，请重新连接后继续");
  if (isActiveRunStatus() && !settings.dryRun) await setPaused("研究台已断开，请登录并连接后继续");
  cloudAuth = cloudAuth?.host_fingerprint ? { host_fingerprint: cloudAuth.host_fingerprint } : null;
  pairing = null;
  await persistCloudAuth();
  return cloudStatusSnapshot();
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
  await initialize();
  if (state.status !== "running") return { continue: false, reason: "任务未运行" };
  try { reserveQueue(1); } catch(error) { await setPaused(error.message); return {continue:false,reason:error.message}; }
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
  dailyStats = recordDailyScan(dailyStats, fingerprint);
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
    extra: { finderDecision: payload.reviewRequired ? "ACCEPTED_REVIEW" : "ACCEPTED", reasons: score.reasons || [] }
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
    reasons: [score.level, ...(payload.reviewRequired ? ["已保存为候选，需人工确认"] : []), ...score.reasons],
    accountName: payload.accountName
  }, observation, profile);
  await persistWorkData();
  await persistState();
  return { continue: state.status === "running", action: "advance", engagementActions: engagementEligible ? ["like", "collect", "follow"].filter(action => canEngage(state.engagement, action, observation.videoId, state.loopId)) : [], decision: state.lastDecision, observationRecordId: queued.recordId };
}

async function handlePanelSkipped(observation, reason) {
  await initialize();
  if (state.status !== "running") return { continue: false, reason: "任务未运行" };
  try { reserveQueue(1); } catch(error) { await setPaused(error.message); return {continue:false,reason:error.message}; }
  const limitReason = getRunLimitReason(state, settings);
  if (limitReason) {
    await pauseForRunLimit(limitReason);
    return { continue: false, reason: state.pauseReason };
  }

  const fingerprint = observation.videoId || [observation.secUid, observation.caption, observation.subtype].filter(Boolean).join("|");
  dailyStats = recordDailyScan(dailyStats, fingerprint);
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

async function saveConfiguration(message) {
  if (isActiveRunStatus() && (message.settings && JSON.stringify(mergeSettings(message.settings)) !== JSON.stringify(settings) || message.rules && JSON.stringify(mergeRules(message.rules)) !== JSON.stringify(rules))) throw new Error("请先暂停抖音任务再修改共享配置");
  const nextSettings = mergeSettings(message.settings || settings);
  const nextRules = mergeRules(message.rules || rules);
  const problems = [...validateSettings(nextSettings), ...validateRules(nextRules), ...validateSchedule(nextSettings.schedule)];
  if (problems.length) {
    if (!message.saveDraft) throw new Error(problems.join("；"));
    await chrome.storage.local.set({ [STORAGE_KEYS.settingsDraft]: nextSettings });
    settingsDraft = nextSettings;
    return { ok: true, settings, settingsDraft, rules, problems };
  }
  const scheduleChanged = JSON.stringify(settings.schedule) !== JSON.stringify(nextSettings.schedule);
  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: nextSettings,
    [STORAGE_KEYS.rules]: nextRules,
    [STORAGE_KEYS.settingsDraft]: message.settings ? null : settingsDraft
  });
  settings = nextSettings;
  rules = nextRules;
  if (message.settings) settingsDraft = null;
  if (scheduleChanged) await syncScheduleAlarm();
  return { ok: true, settings, settingsDraft, rules, problems: [] };
}

async function startRun({ trigger = "manual", scheduledFor = null, tabId = null } = {}) {
  await initialize();
  const problems = [...validateSettings(settings), ...validateRules(rules), ...validateSchedule(settings.schedule)];
  if (problems.length) throw new Error(problems.join("；"));
  if (!settings.dryRun) {
    await checkCloudConnection();
    if (!settings.cloud?.enabled) {
      settings.cloud = { ...settings.cloud, enabled: true };
      await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
    }
  }
  let requested;
  if (trigger === "schedule") {
    requested = await scheduledFeedTab();
  } else {
    const current = await chrome.tabs.get(tabId);
    if (isRecommendationFeedUrl(current.pendingUrl || current.url || "")) {
      const tab = await requireFeedTab(tabId);
      requested = { tab, createdByExtension: state.createdByExtension === true && state.feedTabId === tab.id };
    } else {
      const route = resolveRoute(current.pendingUrl || current.url || "");
      if (route && route.platform !== "douyin") throw new Error(`${route.label}暂不支持运行，请打开飞瓜视频库`);
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
    await scheduleUpload(true);
    return state;
  } catch (error) {
    if (state.runId === runId && isActiveRunStatus()) {
      await setPaused("启动刷号任务失败", error?.message || String(error));
    }
    throw error;
  }
}

async function resumeRun({ windowId } = {}) {
  await initialize();
  if (!canResumeRun(state)) throw new Error("本轮已结束或达到目标，请开始新一轮");
  const runId = state.runId;
  const problems = [...validateSettings(settings), ...validateRules(rules)];
  if (problems.length) throw new Error(problems.join("；"));
  if (!settings.dryRun) {
    await checkCloudConnection();
    settings.cloud = { ...settings.cloud, enabled: true };
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
  }
  if (state.runId !== runId || state.status !== "paused") throw new Error("任务状态已变化，请重试");
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
    await scheduleUpload(true);
    return state;
  } catch (error) {
    if (state.runId === runId && isActiveRunStatus()) await setPaused("恢复本轮失败", error?.message || String(error));
    throw error;
  }
}

async function stopRun() {
  await initialize();
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
  await scheduleUpload(true);
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
  await initialize();
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
  await scheduleUpload();
}

async function handleRunStopAlarm() {
  await initialize();
  if (state.status !== "running") return;
  const limitReason = getRunLimitReason(state, settings);
  if (limitReason) {
    await pauseForRunLimit(limitReason);
    return;
  }
  // 极端情况下系统时钟发生调整，重新按当前 stopAt 校准一次。
  await syncRunStopAlarm();
}

async function handleScheduledAlarm(alarm) {
  await initialize();
  const scheduledTime = Number(alarm?.scheduledTime || Date.now());
  await syncScheduleAlarm(Math.max(Date.now(), scheduledTime + 1_000));
  if (settings.schedule?.enabled === false) return;

  const lateMinutes = Math.max(0, Date.now() - scheduledTime) / 60_000;
  const toleranceMinutes = Math.max(0, Number(settings.schedule?.lateToleranceMinutes || 0));
  if (lateMinutes > toleranceMinutes) {
    state.lastScheduleAt = new Date().toISOString();
    state.lastScheduleResult = `错过计划时间 ${Math.round(lateMinutes)} 分钟，已跳过本次`;
    await persistState();
    return;
  }
  if (isActiveRunStatus()) {
    state.lastScheduleAt = new Date().toISOString();
    state.lastScheduleResult = "到点时已有刷号任务运行，未重复启动";
    await persistState();
    return;
  }

  try {
    await startRun({
      trigger: "schedule",
      scheduledFor: new Date(scheduledTime).toISOString()
    });
  } catch (error) {
    state.lastScheduleAt = new Date().toISOString();
    state.lastScheduleResult = `定时启动失败：${error?.message || String(error)}`;
    state.lastError = state.lastScheduleResult;
    await persistState();
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await initialize();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await configureOpenTabSidePanels();
  await restoreOpenTabLaunchers();
  const currentVersion = chrome.runtime.getManifest().version;
  if (details.reason === "update" && details.previousVersion && details.previousVersion !== currentVersion) {
    const url = new URL(chrome.runtime.getURL("updates/index.html"));
    url.searchParams.set("from", details.previousVersion);
    await chrome.tabs.create({ url: url.href, active: true });
  }
});

chrome.runtime.onStartup.addListener(() => {
  initialize().then(() => Promise.all([syncScheduleAlarm(), syncRunStopAlarm(), configureOpenTabSidePanels(), restoreOpenTabLaunchers()])).catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "dra-observations-cleanup") {
    initialize().then(()=>cleanupStoredObservations()).then(()=>chrome.runtime.sendMessage({type:"DRA_STATUS_CHANGED"})).catch(()=>undefined);
  }
  if (alarm.name === "dra-history-cleanup") {
    initialize().then(()=>cleanupDecisions()).then(()=>chrome.runtime.sendMessage({type:"DRA_HISTORY_CHANGED"})).catch(()=>undefined);
  }
  if ([FEIGUA_ALARM, FEIGUA_STOP_ALARM].includes(alarm.name)) initialize().then(()=>feigua.inspect()).catch(error=>feigua.pause(error.message));
  if (alarm.name === UPLOAD_ALARM) handleUploadAlarm().catch(() => undefined);
  if (alarm.name === WATCHDOG_ALARM) watchdog().catch((error) => setPaused("后台巡检失败", error.message));
  if (alarm.name === RUN_STOP_ALARM) handleRunStopAlarm().catch((error) => setPaused("到点停止任务失败", error.message));
  if (alarm.name === SCHEDULE_ALARM) handleScheduledAlarm(alarm).catch((error) => {
    state.lastScheduleAt = new Date().toISOString();
    state.lastScheduleResult = `定时任务异常：${error?.message || String(error)}`;
    persistState().catch(() => undefined);
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  const launcher=ensureTabLauncher(tabId);
  const navigation=chrome.tabs.get(tabId).then(async tab=>{
    await initialize();
    if(resolveRoute(tab.url || '')?.platform==='feigua' && /#\/(video-detail|blogger-detail)\//.test(tab.url || '') && feigua.active())await feigua.pause('你已进入飞瓜详情，自动翻页已暂停');
  }).catch(()=>{});
  return Promise.all([launcher,navigation]);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedDebuggerTabs.delete(tabId);
  if (tabId === feigua.state().feedTabId && feigua.active()) void feigua.pause("飞瓜标签页已关闭");
  if (tabId === state.feedTabId && isActiveRunStatus()) setPaused("当前运行标签页已关闭").catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") void ensureTabLauncher(tabId);
  const url = changeInfo.url || tab.url || tab.pendingUrl || "";
  if (resolveRoute(url)?.platform==='feigua' && /#\/(video-detail|blogger-detail)\//.test(url) && feigua.active()) void feigua.pause('你已进入飞瓜详情，自动翻页已暂停');
  if (tabId === feigua.state().feedTabId && feigua.active() && (changeInfo.url || changeInfo.status === "complete")) void feigua.inspect();
  if (tabId === state.feedTabId && state.status === "running" && changeInfo.status === "complete") {
    watchdog().catch((error) => setPaused("刷新后恢复失败", error.message));
  }
  if (tabId === state.feedTabId && isActiveRunStatus() && (!isRecommendationFeedUrl(url) || state.route?.platform && resolveRoute(url)?.platform !== state.route.platform)) {
    setPaused("当前标签页已离开原平台采集页").catch(() => undefined);
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (Number.isInteger(source.tabId)) attachedDebuggerTabs.delete(source.tabId);
  if (source.tabId === state.feedTabId && state.status === "running" && reason === "canceled_by_user") {
    setPaused("页面调试连接已由用户或其他调试工具断开，请重新开始任务").catch(() => undefined);
  }
});

async function stateSnapshotForTab(tabId) {
  if (Number.isInteger(tabId) && tabId === state.feedTabId) return state;
  const tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId).catch(() => null) : null;
  const route = resolveRoute(tab?.url || tab?.pendingUrl || "");
  return {
    ...cloneInitialState(),
    backgroundMode: "current-tab",
    feedTabId: Number.isInteger(tab?.id) ? tab.id : null,
    feedWindowId: Number.isInteger(tab?.windowId) ? tab.windowId : null,
    route: route ? { platform: route.platform, surface: route.surface, label: route.label } : null
  };
}

function requireBoundContentTab(sender, message) {
  if (!Number.isInteger(sender.tab?.id) || sender.tab.id !== state.feedTabId) {
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Call immediately in the user gesture, before storage/auth initialization.
  if (message?.type === "DRA_OPEN_PANEL") {
    if (!sender.tab || (sender.frameId ?? 0) !== 0 || !/^https?:\/\//.test(sender.url || "")) { sendResponse({ ok:false }); return false; }
    chrome.sidePanel.open({ windowId: sender.tab.windowId }).then(() => sendResponse({ok:true})).catch(error => sendResponse({ok:false,error:error.message}));
    return true;
  }
  (async () => {
    await initialize();
    if (sender.tab?.id === feigua.state().feedTabId && ['DRA_WAIT','DRA_PROGRESS','DRA_FEIGUA_PAGE','DRA_FEIGUA_COMPLETE','DRA_PAGE_BLOCKED','DRA_FEED_STALLED','DRA_TICK_ERROR'].includes(message?.type)) return feigua.message(message,sender);
    if (['DRA_PAUSE','DRA_STOP','DRA_RESUME'].includes(message?.type) && message.runId) {
      const target = message.platform === 'feigua' ? feigua.state() : state;
      if (message.runId !== target.runId) throw Error('任务已变化，请刷新状态后重试');
    }
    switch (message?.type) {
      case 'DRA_FEIGUA_TAKEOVER': {
        requireFeiguaSender(sender);
        if(sender.tab.id===feigua.state().feedTabId && feigua.active())await feigua.pause('你已接管飞瓜页面，自动翻页已暂停');
        return {ok:true};
      }
      case 'DRA_FEIGUA_BROWSE_ERROR':
        requireFeiguaSender(sender);browseState.lastError=String(message.error || '浏览采集失败').slice(0,500);return {ok:true};
      case 'DRA_FEIGUA_BROWSE_STATUS': {
        requireFeiguaSender(sender);
        if(/#\/(video-detail|blogger-detail)\//.test(sender.url || '') && feigua.active())await feigua.pause('你已进入飞瓜详情，自动翻页已暂停');
        browseState.lastCheckedAt=new Date().toISOString();
        return {ok:true,enabled:browseState.enabled,automaticTab:feigua.active() && sender.tab.id===feigua.state().feedTabId};
      }
      case 'DRA_SET_FEIGUA_BROWSING':
        requireExtensionPage(sender);
        browseState.enabled=message.enabled===true; browseState.lastError='';
        await chrome.storage.local.set({draFeiguaBrowsing:browseState});
        return {ok:true};
      case 'DRA_FEIGUA_BROWSE_PAGE': {
        requireFeiguaSender(sender);
        const work=browseWrites.then(()=>captureBrowsePage(message.page,sender));
        browseWrites=work.catch(()=>{});return work;
      }

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
      case "DRA_DEBUG_STATUS": {
        requireExtensionPage(sender);
        const saved = await chrome.storage.local.get([STORAGE_KEYS.debugSettings,"draRawSampleError"]);
        return {ok:true, enabled:saved[STORAGE_KEYS.debugSettings]?.rawCapture===true, error:saved.draRawSampleError || "", samples:await rawSamples("status")};
      }
      case "DRA_SET_RAW_CAPTURE":
        requireExtensionPage(sender);
        await chrome.storage.local.set({[STORAGE_KEYS.debugSettings]:{rawCapture:message.enabled===true},draRawSampleError:""});
        return {ok:true};
      case "DRA_CAPTURE_RAW": {
        requireExtensionPage(sender);
        const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
        if (!tab?.url?.startsWith("https://www.douyin.com/")) throw Error("请切换到抖音推荐页后采样");
        const result = await chrome.tabs.sendMessage(tab.id,{type:"DRA_CAPTURE_SAMPLE"});
        if (!result?.ok) throw Error(result?.error || "采样失败，请刷新抖音页面后重试");
        const label = ["video","live","photo","ad"].includes(message.label) ? message.label : "unconfirmed";
        return {ok:true,samples:await saveRawSample(result.sample,label,true)};
      }
      case "DRA_EXPORT_RAW":
        requireExtensionPage(sender);
        return {ok:true,samples:await rawQueue.then(()=>rawSamples("list"))};
      case "DRA_CLEAR_RAW": {
        requireExtensionPage(sender);
        const task=rawQueue.then(()=>rawSamples("clear")); rawQueue=task.catch(()=>undefined);
        return {ok:true,samples:await task};
      }
      case "DRA_GET_LAUNCHER":
        return { ok:true, launcher: launcherState(aggregateState()) };
      case 'DRA_EXPORT_OBSERVATIONS':
        requireExtensionPage(sender);
        return {ok:true,records:await exportObservations()};
      case "DRA_QUERY_HISTORY":
        requireExtensionPage(sender);
        await flushDecisionHistory();
        return {ok:true,...await queryDecisions(message.options || {})};
      case "DRA_GET_STATUS": {
        await flushDecisionHistory();
        const selectedState = await selectedTask(message.tabId, message.platform);
        const history = await decisionPreview(selectedState.route?.platform || (selectedState === state ? 'douyin' : ''));
        return {
          ok: true,
          state: selectedState,
          tasks: [state, feigua.state()],
          feigua: {
            pageCount:feigua.collection()?.pages?.length || 0,
            pageNumber:feigua.state().lastPageNumber || '',
            finalized:feigua.collection()?.finalized === true,
            candidates:Object.values(feigua.collection()?.accounts || {}).slice(0,10).map(row=>({name:row.authorName,followers:row.followerCount || '',avatarUrl:row.avatarUrl || '',profileUrl:row.profileUrl || '',videos:(row.videos || [row]).map(video=>({videoId:video.videoId,title:video.title,coverUrl:video.coverUrl,videoUrl:video.videoUrl,durationSeconds:video.durationSeconds,metrics:video.metrics,hotWords:video.hotWords,observedAt:video.observedAt}))}))
          },
          pageRoute:Number.isInteger(message.tabId)?resolveRoute((await chrome.tabs.get(message.tabId).catch(()=>null))?.url || ''):null,
          browsing:{...browseState,...await observationStatus()},
          decisionHistory: history.items,
          decisionHistoryTotal: history.total,
          settings,
          settingsDraft,
          rules,
          teamDestination: TEAM_DESTINATION,
          cloud: cloudStatusSnapshot(),
          daily: dailySnapshot(dailyStats),
          schedule: await getScheduleStatus(),
          queueLength: uploadableOutbox().length,
          outboxCount: uploadableOutbox().length,
          outbox: outbox.slice(-20).reverse()
        };
      }
      case "DRA_CHECK_BRIDGE":
      case "DRA_CHECK_CLOUD": {
        const health = await checkCloudConnection();
        return { ok: true, health };
      }
      case "DRA_START_PAIR":
        return { ok: true, cloud: await startPairing() };
      case "DRA_POLL_PAIR":
        return { ok: true, cloud: await pollPairing() };
      case "DRA_CANCEL_PAIR":
        pairing = null;
        await persistCloudAuth();
        return { ok: true, cloud: cloudStatusSnapshot() };
      case "DRA_DISCONNECT_CLOUD":
        return { ok: true, cloud: await disconnectCloud() };
      case "DRA_OPEN_WORKBENCH":
        await chrome.tabs.create({ url: CLOUD_DESTINATION.workbenchUrl, active: true });
        return { ok: true };
      case "DRA_OPEN_FEIGUA": {
        requireExtensionPage(sender);
        const tab=await feigua.openPage({windowId:message.windowId});
        return {ok:true,tabId:tab.id};
      }
      case "DRA_SAVE_FEIGUA_CONFIG": {
        requireExtensionPage(sender);
        const save=configQueue.then(async()=>{
          if(feigua.active()) throw Error('请先暂停飞瓜再修改下轮采集设置');
          const maxPages=Number(message.maxPages);
          const minSeconds=Number(message.minSeconds), maxSeconds=Number(message.maxSeconds);
          if(!Number.isInteger(maxPages) || maxPages<1 || maxPages>500) throw Error('页数需为 1 至 500 的整数');
          if(!Number.isFinite(minSeconds) || !Number.isFinite(maxSeconds) || minSeconds<1 || maxSeconds>30 || maxSeconds<minSeconds) throw Error('翻页间隔需为 1 至 30 秒，最大值应大于或等于最小值');
          if(!Array.isArray(message.keywords) || message.keywords.length>200 || message.keywords.some(word=>typeof word!=='string'||word.length>100)) throw Error('规避词格式不正确，最多 200 个词，每个词最多 100 字');
          settings={...settings,feiguaTarget:{maxPages},feiguaDelay:{minSeconds,maxSeconds}};
          rules={...rules,feiguaKeywords:[...new Set(message.keywords.map(word=>word.trim()).filter(Boolean))]};
          await chrome.storage.local.set({[STORAGE_KEYS.settings]:settings,[STORAGE_KEYS.rules]:rules});
          return {ok:true};
        });
        configQueue=save.catch(()=>undefined);return save;
      }
      case "DRA_START": {
        const tab = await chrome.tabs.get(message.tabId);
        if (message.platform === 'feigua') {
          const destination=await feigua.openPage({windowId:tab.windowId});
          return {ok:true,state:await feigua.start(destination.id)};
        }
        const platform = resolveRoute(tab.pendingUrl || tab.url || '')?.platform;
        if (message.platform && message.platform !== 'auto' && platform !== message.platform) throw Error('请先切换到所选平台的采集页面，再开始该平台任务');
        return {ok:true,state:platform === 'feigua' ? await feigua.start(tab.id) : await startRun({tabId:message.tabId})};
      }
      case "DRA_RESUME":
        return { ok: true, state: message.platform === "feigua" ? await feigua.resume({windowId:message.windowId}) : await resumeRun({ windowId: message.windowId }) };
      case "DRA_PAUSE":
        if (message.platform === "feigua") return {ok:true,state:await feigua.pause()};
        if (message.tabId !== state.feedTabId) throw new Error("当前标签页没有正在运行的任务");
        await setPaused("用户暂停");
        await scheduleUpload(true);
        return { ok: true, state };
      case "DRA_STOP":
        if (message.platform === "feigua") return {ok:true,state:await feigua.stop()};
        if (message.tabId !== state.feedTabId) throw new Error("当前标签页没有可以停止的任务");
        return { ok: true, state: await stopRun() };
      case "DRA_SAVE_CONFIG": {
        const save = configQueue.then(() => saveConfiguration(message));
        configQueue = save.catch(() => undefined);
        return save;
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
      case "DRA_CLEAR_LOCAL_DATA":
        if (isActiveRunStatus() || feigua.active() || feigua.collection() && !feigua.collection().finalized) throw new Error("请先结束所有平台任务并保存候选，再清空本地数据");
        feigua.clear();
        seenVideos = [];
        creatorIndex = {};
        outbox = [];
        await persistWorkData();
        return { ok: true };
      default:
        return null;
    }
  })().then((result) => sendResponse(result)).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

initialize().then(() => Promise.all([
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }),
  configureOpenTabSidePanels()
])).catch(() => undefined);

function requireFeiguaSender(sender) {
  if(!Number.isInteger(sender.tab?.id) || (sender.frameId ?? 0)!==0 || !/^https:\/\/dy\.feigua\.cn\/app\//.test(sender.url || ''))throw Error('消息不是来自飞瓜页面');
}
async function captureBrowsePage(page,sender) {
  if(!browseState.enabled || feigua.active() && sender.tab.id===feigua.state().feedTabId)return {ok:true,skipped:true};
  const tab=await chrome.tabs.get(sender.tab.id);
  if(!tab.active)return {ok:true,skipped:true};
  if(!page || page.pageUrl!==tab.url || !['library','video','creator'].includes(page.surface) || !Array.isArray(page.rows) || page.rows.length>60 || !page.rows.length || JSON.stringify(page).length>500000)throw Error('飞瓜浏览数据不完整或页面已变化');
  const day=new Date().toISOString().slice(0,10);
  const runId=`feigua-browse:${day}`;
  try {
    const items=await saveObservations(page.rows.map(row=>({...normalizeFeiguaObservation(row,page,runId,'browse'),uploadEligible:settings.feiguaUploadEnabled===true && !settings.dryRun})));
    await stageFeiguaObservations();
    const owner={runId,startedAt:page.capturedAt,route:{platform:'feigua'}};
    for(const item of items)recordDecision({code:'FEIGUA_OBSERVED',reasons:['浏览采集已保存；自动翻页保持暂停']},item,null,owner);
    browseState.lastCapturedAt=page.capturedAt; browseState.lastPageUrl=page.pageUrl; browseState.lastError='';
    await chrome.storage.local.set({draFeiguaBrowsing:browseState});
    await flushDecisionHistory();
    await chrome.runtime.sendMessage({type:"DRA_STATUS_CHANGED"}).catch(()=>{});
    return {ok:true,count:items.length};
  } catch(error) {
    browseState.lastError=error.message; browseState.enabled=false;
    await chrome.storage.local.set({draFeiguaBrowsing:browseState});
    if(feigua.active())await feigua.pause(error.message);
    throw error;
  }
}

let stagingObservations=null;
function stageFeiguaObservations() {
  if(settings.feiguaUploadEnabled!==true)return Promise.resolve();
  if(stagingObservations)return stagingObservations;
  stagingObservations=(async()=>{
    const items=await pendingObservations();
    for(const item of items) {
      // Leave durable observations waiting while a full outbox drains.
      if(!outbox.some(queued=>queued.id===item.id) && outbox.filter(queued=>!['written','duplicate','dry-run'].includes(queued.status)).length>=MAX_OUTBOX)break;
      if(!outbox.some(queued=>queued.id===item.id))addOutbox('pending',feiguaObservationRecord(item),'',{owner:{runId:item.sessionId,startedAt:item.firstObservedAt}});
      await persistWorkData();
      await markObservationsQueued([item.id]);
    }
  })().finally(()=>{stagingObservations=null;});
  return stagingObservations;
}

async function cleanupStoredObservations() {
  const settled=new Set(['written','duplicate','dry-run']);
  await markObservationsUploaded(outbox.filter(item=>['written','duplicate'].includes(item.status)).map(item=>item.id));
  const pending=outbox.filter(item=>!settled.has(item.status));
  const protectedSessions=pending.filter(item=>!item.payload?.aweme_id).map(item=>item.sessionId);
  // Protect the in-progress read before its upload record has been enqueued.
  if(['running','starting'].includes(state.status))protectedSessions.push(state.runId);
  return cleanupObservations({protectedIds:pending.map(item=>item.id),
    protectedEntities:pending.filter(item=>item.payload?.aweme_id).map(item=>JSON.stringify([item.sessionId,item.payload.aweme_id])),protectedSessions});
}
