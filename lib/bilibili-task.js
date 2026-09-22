import { INITIAL_STATE } from "./defaults.js";
import { canResumeRun, elapsedRunMs, normalizeRunTarget, getRunLimitReason } from "./run-limits.js";
import { createRunWaits, withTimeout, stepBudget, runtimeStalled } from "./runtime-health.js";
import { resolveRoute, launchUrl } from "../src/core/platform-router.ts";
import { decideBilibili } from "./bilibili-rules.js";
import { evaluateBilibiliVideoRules } from "./bilibili-rules.js";

export const BILIBILI_ALARM = "dra-bilibili-watchdog";
export const BILIBILI_STOP_ALARM = "dra-bilibili-stop";
export const BILIBILI_POPULAR_ALARM = "dra-bilibili-popular-watchdog";
export const BILIBILI_POPULAR_STOP_ALARM = "dra-bilibili-popular-stop";

function routeFor(surface = "recommend") {
  return surface === "popular"
    ? { platform: "bilibili", surface: "popular", label: "B站综合热门" }
    : { platform: "bilibili", surface: "recommend", label: "B站首页推荐" };
}

const initial = (surface = "recommend") => ({
  ...structuredClone(INITIAL_STATE),
  route: routeFor(surface),
  freshIdx: 1,
  popularPage: 1
});

const SURFACE_KEYS = {
  recommend: { storage: "draBilibili", alarm: BILIBILI_ALARM, stopAlarm: BILIBILI_STOP_ALARM },
  popular: { storage: "draBilibiliPopular", alarm: BILIBILI_POPULAR_ALARM, stopAlarm: BILIBILI_POPULAR_STOP_ALARM }
};

export function splitLegacyBilibiliStorage(saved = {}) {
  const next = { ...saved };
  if (next.draBilibili?.state?.route?.surface === "popular" && !next.draBilibiliPopular) {
    next.draBilibiliPopular = next.draBilibili;
    delete next.draBilibili;
  }
  if (next.draBilibiliConfig && !next.draBilibiliPopularConfig) {
    next.draBilibiliPopularConfig = structuredClone(next.draBilibiliConfig);
  }
  return next;
}

export { decideBilibili };

export function createBilibiliRuntime(deps, options = {}) {
  const pinned = options.surface === "popular" ? "popular" : "recommend";
  const keys = SURFACE_KEYS[pinned];
  const storageKey = options.storageKey || keys.storage;
  const alarm = options.alarm || keys.alarm;
  const stopAlarm = options.stopAlarm || keys.stopAlarm;
  const label = routeFor(pinned).label;
  let state = initial(pinned);
  let seen = [];
  let creators = [];
  let operations = Promise.resolve();
  let generation = 0;
  const waits = createRunWaits();
  const active = () => ["starting", "running"].includes(state.status);
  const serial = (work) => {
    const result = operations.then(work);
    operations = result.catch(() => {});
    return result;
  };
  const save = async () => {
    await deps.persist();
    await deps.indicators();
  };
  const send = (type, extra = {}) => withTimeout(chrome.tabs.sendMessage(state.feedTabId, { type, runId: state.runId, loopId: state.loopId, ...extra }), 5000);
  const surfaceOf = () => pinned;
  const valid = (tab) => {
    const route = resolveRoute(tab?.pendingUrl || tab?.url || "");
    return route?.platform === "bilibili" && route.runnable && route.surface === surfaceOf();
  };
  const increment = (key) => {
    state.stats[key] = Number(state.stats[key] || 0) + 1;
  };

  async function timers() {
    if (state.status === "running") {
      await chrome.alarms.create(alarm, { periodInMinutes: 0.5 });
      if (state.stopAt) await chrome.alarms.create(stopAlarm, { when: Math.max(Date.now() + 100, state.stopAt) });
    } else {
      await chrome.alarms.clear(alarm);
      await chrome.alarms.clear(stopAlarm);
    }
  }

  function cancel(reason, status = "paused") {
    generation++;
    state.elapsedMs = elapsedRunMs(state);
    state.activeSince = null;
    state.status = status;
    state.pausedAt = Date.now();
    state.endedAt = new Date().toISOString();
    state.pauseReason = reason;
    state.startupStage = "";
    waits.cancel();
    if (Number.isInteger(state.feedTabId)) void send("DRA_STOP_LOOP").catch(() => {});
  }

  async function pause(reason = "用户暂停") {
    cancel(reason);
    await timers();
    await save();
    return state;
  }

  async function stop() {
    cancel("用户结束本轮", "stopped");
    return serial(async () => {
      await timers();
      await save();
      return state;
    });
  }

  async function openPage({ tabId, windowId, focus = true, reuseExisting = true } = {}) {
    state.route = routeFor(pinned);
    let tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId).catch(() => null) : null;
    if (!valid(tab)) {
      const win = windowId ?? tab?.windowId ?? (await chrome.windows.getCurrent()).id;
      if (reuseExisting) {
        tab = (await chrome.tabs.query({ windowId: win, url: "https://www.bilibili.com/*" })).find((candidate) => candidate.windowId === win && valid(candidate));
      } else {
        tab = null;
      }
      if (!tab) tab = await chrome.tabs.create({ windowId: win, url: launchUrl("bilibili", pinned), active: focus });
    }
    if (focus && !tab.active) tab = await chrome.tabs.update(tab.id, { active: true });
    return deps.waitForTab(tab.id);
  }

  async function launch(tab, own) {
    tab = await deps.ensureContent(tab);
    if (own !== generation) return state;
    state.route = routeFor(pinned);
    state.feedTabId = tab.id;
    state.feedWindowId = tab.windowId;
    state.loopId = crypto.randomUUID();
    state.status = "running";
    state.startedAt ||= new Date().toISOString();
    state.activeSince = Date.now();
    state.endedAt = null;
    state.pauseReason = "";
    state.lastError = "";
    state.startupStage = "";
    state.stopAt = ["time", "both"].includes(state.runTarget.mode)
      ? Date.now() + Math.max(0, state.runTarget.durationMinutes * 60000 - state.elapsedMs)
      : null;
    state.runtime = { phase: "read", deadlineAt: Date.now() + 30000 };
    await timers();
    await save();
    if (own === generation) {
      await send("DRA_START_LOOP", {
        settings: state.runSettings,
        rules: state.runRules,
        surface: surfaceOf(),
        resume: {
          lastVideoId: state.lastVideoId,
          freshIdx: state.freshIdx || 1,
          popularPage: state.popularPage || 1
        }
      });
    }
    return state;
  }

  function start(options = {}) {
    if (active()) return Promise.reject(Error(`${label}正在运行`));
    const own = ++generation;
    return serial(async () => {
      if (active()) throw Error(`${label}正在运行`);
      if (!deps.settings().dryRun) await deps.authorize();
      if (own !== generation) return state;
      const scheduled = options.trigger === "schedule";
      state = {
        ...initial(pinned),
        status: "starting",
        runId: crypto.randomUUID(),
        elapsedMs: 0,
        backgroundMode: scheduled ? "scheduled-tab" : "current-tab",
        runTrigger: scheduled ? "schedule" : "manual",
        scheduledFor: options.scheduledFor || null,
        freshIdx: 1,
        popularPage: 1,
        runTarget: normalizeRunTarget(scheduled ? options.target : deps.settings().target),
        runSettings: structuredClone(deps.settings()),
        runRules: structuredClone(deps.rules()),
        startupStage: pinned === "popular" ? "正在打开 B 站综合热门" : "正在打开 B 站首页推荐"
      };
      seen = [];
      creators = [];
      await save();
      try {
        const launched = await launch(await openPage({
          ...options,
          focus: scheduled ? false : options.focus !== false,
          reuseExisting: options.reuseExisting !== false
        }), own);
        if (scheduled && own === generation) {
          const target = state.runTarget;
          const targetText = target.mode === "time"
            ? `${target.durationMinutes} 分钟`
            : target.mode === "count"
              ? `${target.maxItems} 条视频`
              : `${target.durationMinutes} 分钟或 ${target.maxItems} 条视频`;
          state.lastScheduleAt = new Date().toISOString();
          state.lastScheduleResult = `已按计划启动：${targetText}`;
          await save();
        }
        return launched;
      } catch (error) {
        if (own === generation) await pause(error.message);
        throw error;
      }
    });
  }

  function resume(options = {}) {
    const own = ++generation;
    return serial(async () => {
      if (!canResumeRun(state)) throw Error("本轮已结束或达到目标，请开始新一轮");
      if (!state.runSettings.dryRun) await deps.authorize();
      if (own !== generation) return state;
      state.status = "starting";
      await save();
      try {
        return await launch(await openPage({ ...options, tabId: state.feedTabId, focus: false, surface: surfaceOf() }), own);
      } catch (error) {
        if (own === generation) await pause(error.message);
        throw error;
      }
    });
  }

  function bound(message, sender) {
    if (
      (sender.frameId ?? 0) !== 0 ||
      sender.tab?.id !== state.feedTabId ||
      !valid(sender.tab) ||
      state.status !== "running" ||
      message.runId !== state.runId ||
      message.loopId !== state.loopId
    ) {
      throw Error(`消息不属于当前${label}`);
    }
  }

  async function message(message, sender) {
    bound(message, sender);
    if (message.type === "DRA_WAIT") return waits.wait(message.until);
    if (message.type === "DRA_PROGRESS") {
      state.runtime = { phase: message.phase, deadlineAt: Date.now() + stepBudget(message.phase, state.runSettings, message.waitUntil) };
      if (message.phase === "submit") state.runtime.deadlineAt = Date.now() + 90000;
      if (Number.isFinite(message.freshIdx)) state.freshIdx = message.freshIdx;
      if (Number.isFinite(message.popularPage)) state.popularPage = message.popularPage;
      await save();
      return { ok: true };
    }
    if (message.type === "DRA_TICK_ERROR") {
      await pause(message.error || `${label}页面异常`);
      return { ok: true };
    }
    if (message.type !== "DRA_BILIBILI_VIDEO") throw Error("B站消息类型无效");
    return serial(async () => {
      bound(message, sender);
      const own = generation;
      const observation = message.observation;
      const profile = message.profile || null;
      if (
        !observation ||
        observation.sourcePlatform !== "bilibili" ||
        !/^BV[\w]+$/i.test(observation.videoId || "") ||
        !/^\d+$/.test(observation.authorId || "") ||
        JSON.stringify(observation).length > 100000
      ) {
        throw Error("B站观察数据不完整");
      }
      if (seen.includes(observation.videoId)) return { ok: true, continue: true, duplicate: true };
      const limit = getRunLimitReason(state, state.runSettings);
      if (limit) {
        await pause(limit);
        return { ok: true, continue: false };
      }
      const decision = decideBilibili(observation, profile, state.runRules);
      await deps.collect(observation, profile, decision, state);
      seen.push(observation.videoId);
      state.lastVideoId = observation.videoId;
      if (Number.isFinite(message.freshIdx)) state.freshIdx = message.freshIdx;
      if (Number.isFinite(message.popularPage)) state.popularPage = message.popularPage;
      increment("scanned");
      if (decision.matched) {
        increment("matched");
        if (!creators.includes(observation.authorId)) {
          creators.push(observation.authorId);
          increment("newCreators");
          if (decision.needsReview) increment("reviewQueued");
        }
      } else {
        const video = evaluateBilibiliVideoRules(observation, state.runRules);
        increment(decision.needsReview ? "failed" : video.matched ? "rejectedProfiles" : "rejectedVideos");
      }
      deps.recordDecision(decision, observation, profile, state);
      deps.recordScan(`bilibili:${observation.videoId}`);
      state.lastTickAt = new Date().toISOString();
      await save();
      await deps.scheduleUpload(true);
      if (own !== generation) return { ok: true, continue: false };
      const reached = getRunLimitReason(state, state.runSettings);
      if (reached) {
        await pause(reached);
        return { ok: true, continue: false };
      }
      return { ok: true, continue: true };
    });
  }

  async function inspect() {
    if (state.status !== "running") return;
    const reason = getRunLimitReason(state, state.runSettings);
    if (reason) return pause(reason);
    const tab = await chrome.tabs.get(state.feedTabId).catch(() => null);
    if (!valid(tab)) return pause(pinned === "popular" ? "B站综合热门页已关闭或离开" : "B站首页已关闭或离开");
    const status = await send("DRA_LOOP_STATUS").catch(() => null);
    if (!status?.running || status.runId !== state.runId || status.loopId !== state.loopId || runtimeStalled(state.runtime)) {
      return pause(`${label}运行中断，请继续本轮`);
    }
  }

  async function noteSchedule(result) {
    state.lastScheduleAt = new Date().toISOString();
    state.lastScheduleResult = result;
    await save();
    return state;
  }

  function restore(saved) {
    const payload = saved[storageKey];
    if (payload) {
      state = { ...initial(pinned), ...payload.state, route: routeFor(pinned) };
      seen = payload.seen || [];
      creators = payload.creators || [];
    } else {
      state = initial(pinned);
    }
    if (state.status === "starting") cancel("启动被中断，请继续本轮");
  }

  return {
    state: () => state,
    active,
    start,
    noteSchedule,
    resume,
    pause,
    stop,
    message,
    inspect,
    timers,
    restore,
    storage: () => ({ [storageKey]: { state, seen, creators } }),
    clear: () => {
      state = initial(pinned);
      seen = [];
      creators = [];
    }
  };
}
