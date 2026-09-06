import { contentSkipDecision } from "../lib/content-type.js";
import { sampleDwellSeconds } from "../lib/dwell.js";

(function installDouyinAutomation() {
  "use strict";

  const parser = globalThis.DouyinAutoFinderParser;
  if (!parser) return;

  function createLoop(settings, runId, loopId, resume = null) {
    const abort = new AbortController();
    const PAGE_CHANNEL = "DOUYIN_AUTO_FINDER_PAGE";
    let running = false;
    let activeRunId = "";
    let dwellPolicy = { mode: "fixed", fixedSeconds: 30, minSeconds: 10, typicalSeconds: 15, maxSeconds: 30 };
    let liveDwellMs = 3_000;
    let panelRecoveryAttempts = 3;
    let failureStreak = 0;

    function assertRunning() {
      if (abort.signal.aborted || !running) throw new Error("循环已取消");
    }

    async function sleep(ms) {
      const until = Date.now() + ms;
      do {
        const response = await sendRuntime({ type: "DRA_WAIT", until });
        assertRunning();
        if (!response?.ok) throw new Error(response?.error || "后台等待已取消");
      } while (Date.now() < until);
    }

    async function progress(phase, details = {}) {
      const response = await sendRuntime({ type: "DRA_PROGRESS", phase, ...details });
      if (!response?.ok) throw new Error(response?.error || "运行状态保存失败");
    }

    function scheduleTick(ms) {
      void sleep(ms).then(tick).catch(() => { running = false; });
    }

    function sendRuntime(message) {
      assertRunning();
      return new Promise((resolve, reject) => {
        const cancel = () => reject(new Error("循环已取消"));
        abort.signal.addEventListener("abort", cancel, { once: true });
        chrome.runtime.sendMessage({ ...message, runId: activeRunId, loopId }, (response) => {
          abort.signal.removeEventListener("abort", cancel);
          if (abort.signal.aborted) return reject(new Error("循环已取消"));
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(response);
        });
      });
    }

    function pageCommand(command, payload = {}, timeoutMs = 7_000) {
      assertRunning();
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (result, error) => {
          if (settled) return;
          settled = true;
          window.removeEventListener("message", onMessage);
          abort.signal.removeEventListener("abort", cancel);
          if (error) reject(error); else resolve(result);
        };
        const cancel = () => finish(null, new Error("循环已取消"));
        function onMessage(event) {
          if (event.source !== window || event.data?.channel !== PAGE_CHANNEL || event.data?.direction !== "response" || event.data?.id !== id) return;
          finish(event.data.result || { ok: false, reason: "页面未返回结果" });
        }
        abort.signal.addEventListener("abort", cancel, { once: true });
        window.addEventListener("message", onMessage);
        sleep(timeoutMs).then(() => finish({ ok: false, reason: "页面指令超时" }), (error) => finish(null, error));
        window.postMessage({ channel: PAGE_CHANNEL, direction: "request", id, command, payload }, "*");
      });
    }

    function observationFingerprint(observation) {
      if (!observation) return "";
      return observation.videoId || [observation.secUid, observation.caption, observation.subtype].filter(Boolean).join("|");
    }

    function hasPositiveNumber(value) {
      if (value == null || value === "") return false;
      const number = Number(value);
      return Number.isFinite(number) && number > 0;
    }

    function hasFiniteNumber(value) {
      if (value == null || value === "") return false;
      return Number.isFinite(Number(value));
    }

    async function waitForObservationHydration(initialObservation, timeoutMs = 6_000) {
      const deadline = Date.now() + timeoutMs;
      let observation = initialObservation;
      while (Date.now() < deadline && running) {
        const skip = observation && contentSkipDecision(observation);
        if (observation?.blockedReason || skip && skip.code !== "UNKNOWN_TYPE_SKIPPED") return observation;
        const hasIdentity = Boolean(observationFingerprint(observation));
        const hasCreator = Boolean(observation?.authorName || observation?.secUid || observation?.profileUrl);
        if (!skip && hasIdentity && hasCreator && hasPositiveNumber(observation?.durationSeconds) && hasFiniteNumber(observation?.likes)) {
          return observation;
        }
        await sleep(300);
        observation = parser.parseCurrentFeed(document);
      }
      return observation;
    }

    async function waitForNext(previousFingerprint, timeoutMs = 12_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && running) {
        await sleep(400);
        const current = parser.parseCurrentFeed(document);
        if (current?.blockedReason) return { changed: false, blockedReason: current.blockedReason };
        const fingerprint = observationFingerprint(current);
        if (fingerprint && fingerprint !== previousFingerprint) return { changed: true, observation: current };
      }
      return { changed: false };
    }

    async function getCreatorPanelUi() {
      const result = await pageCommand("GET_CREATOR_PANEL_STATE", {}, 3_000);
      return result?.ok ? result : { ok: false, reason: result?.reason || "无法读取达人侧栏状态", panelState: {}, targets: {} };
    }

    async function waitForCreatorPanelUi(predicate, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      let last = await getCreatorPanelUi();
      while (Date.now() < deadline && running) {
        if (last?.ok && predicate(last.panelState || {}, last)) return { matched: true, ui: last };
        await sleep(250);
        last = await getCreatorPanelUi();
      }
      return { matched: false, ui: last };
    }

    async function trustedClick(target) {
      if (!target || !["comment", "works"].includes(target.target)) {
        return { ok: false, error: "页面未返回允许的真实点击目标" };
      }
      return sendRuntime({ type: "DRA_TRUSTED_CLICK", ...target }).catch((error) => ({ ok: false, error: error?.message || String(error) }));
    }

    async function openCurrentCreatorPanel() {
      let ui = await getCreatorPanelUi();
      if (ui.panelState?.present) return { ok: true, ui, method: "existing" };

      const keyResult = await sendRuntime({ type: "DRA_TRUSTED_KEY", key: "x" }).catch((error) => ({ ok: false, error: error?.message || String(error) }));
      if (keyResult?.ok) {
        const openedByKey = await waitForCreatorPanelUi((state) => state.present, 4_000);
        if (openedByKey.matched) return { ok: true, ui: openedByKey.ui, method: "trusted-x" };
        ui = openedByKey.ui;
      }

      const commentTarget = ui?.targets?.comment || (await getCreatorPanelUi())?.targets?.comment;
      const clickResult = await trustedClick(commentTarget);
      if (!clickResult?.ok) return { ok: false, reason: clickResult?.error || "真实点击评论入口失败", ui };
      const openedByClick = await waitForCreatorPanelUi((state) => state.present, 6_000);
      return openedByClick.matched
        ? { ok: true, ui: openedByClick.ui, method: "trusted-comment" }
        : { ok: false, reason: "真实点击评论入口后未出现 TA 的作品", ui: openedByClick.ui };
    }

    async function recoverCreatorPanel(observation) {
      let lastProfile = null;
      let lastReason = "";
      let lastUi = null;
      for (let attempt = 1; attempt <= panelRecoveryAttempts && running; attempt += 1) {
        const existing = parser.parseCreatorPanel(document, observation);
        if (existing?.ready) return { ok: true, profile: existing, recovered: false };
        lastProfile = existing;

        if (existing?.stale) {
          lastReason = "检测到上一位达人侧栏残留";
          const closed = await sendRuntime({ type: "DRA_TRUSTED_KEY", key: "x" }).catch(() => null);
          if (!closed?.ok) lastReason = closed?.reason || closed?.error || "无法关闭上一位达人侧栏";
          const closedState = await waitForCreatorPanelUi((state) => !state.present, 4_000);
          lastUi = closedState.ui;
          if (!closedState.matched) lastReason = "真实 X 后旧达人侧栏仍未关闭";
        }

        const opened = await openCurrentCreatorPanel();
        lastUi = opened.ui;
        if (!opened.ok) {
          lastReason = opened.reason || "未能打开当前达人的评论侧栏";
          continue;
        }

        let ui = opened.ui || await getCreatorPanelUi();
        if (!ui.panelState?.ready) {
          const worksTarget = ui.targets?.works;
          const clicked = await trustedClick(worksTarget);
          if (!clicked?.ok) {
            lastReason = clicked?.error || "真实点击 TA 的作品失败";
            continue;
          }
          const ready = await waitForCreatorPanelUi((state) => state.selected && state.hasWorks, 8_000);
          ui = ready.ui;
          lastUi = ui;
          if (!ready.matched) {
            lastReason = !ui?.panelState?.present
              ? "点击过程中 TA 的作品入口消失"
              : !ui?.panelState?.selected
                ? "真实点击后 TA 的作品标签未激活"
                : "真实点击后达人作品列表未加载";
            continue;
          }
        }

        const deadline = Date.now() + 8_000;
        while (Date.now() < deadline && running) {
          await sleep(250);
          const profile = parser.parseCreatorPanel(document, observation);
          lastProfile = profile;
          if (profile?.ready) return { ok: true, profile, recovered: opened.method !== "existing" || attempt > 1 };
          if (profile?.stale) {
            lastReason = "当前卡片内仍是上一位达人侧栏";
            break;
          }
        }
      }
      const state = lastUi?.panelState || lastProfile?.panelState || {};
      const detail = lastReason
        || (!state.present ? "未找到 TA 的作品入口" : "")
        || (!state.selected ? "TA 的作品标签未激活" : "")
        || (!state.hasWorks ? "作品列表尚未加载" : "")
        || "达人身份或粉丝量尚未加载";
      return { ok: false, reason: `连续重试后仍无法读取当前达人的 TA 的作品侧栏（${detail}）` };
    }

    function transitionResult(result, beforeUrl, scrollDelta = null) {
      return {
        ...result,
        beforeUrl,
        afterUrl: location.href,
        transitionOk: result?.changed === true,
        scrollDelta: scrollDelta != null && Number.isFinite(Number(scrollDelta)) ? Number(scrollDelta) : null
      };
    }

    async function reportTransition(recordId, transition) {
      if (!recordId) return;
      const response = await sendRuntime({
        type: "DRA_TRANSITION_RESULT",
        recordId,
        transition: {
          beforeUrl: transition.beforeUrl,
          afterUrl: transition.afterUrl,
          transitionOk: transition.transitionOk,
          scrollDelta: transition.scrollDelta
        }
      });
      if (!response?.ok) throw new Error(response?.error || "无法保存翻页结果");
    }

    async function performDecisionAction(action, previousFingerprint, beforeUrl) {
      if (action === "not-interested") {
        const marked = await sendRuntime({ type: "DRA_TRUSTED_KEY", key: "r" }).catch((error) => ({ ok: false, error: error?.message || String(error) }));
        if (!marked?.ok) throw new Error(marked?.error || "标记不感兴趣失败（抖音 R 快捷键）");
        const changedByR = await waitForNext(previousFingerprint, 5_000);
        if (changedByR.blockedReason) return transitionResult(changedByR, beforeUrl);
        if (changedByR.changed) return transitionResult(changedByR, beforeUrl);
      }

      let lastError = "";
      let lastScrollDelta = null;
      for (const deltaY of [null, 1_400]) {
        const feedTarget = await pageCommand("GET_FEED_TARGET", {}, 3_000);
        if (feedTarget?.ok && feedTarget.target) {
          const target = deltaY == null ? feedTarget.target : { ...feedTarget.target, deltaY };
          const advanced = await sendRuntime({ type: "DRA_TRUSTED_WHEEL", ...target }).catch((error) => ({ ok: false, error: error?.message || String(error) }));
          if (advanced?.ok) {
            lastScrollDelta = Number.isFinite(Number(advanced.deltaY)) ? Number(advanced.deltaY) : lastScrollDelta;
            const changedByWheel = await waitForNext(previousFingerprint, 5_000);
            if (changedByWheel.blockedReason || changedByWheel.changed) return transitionResult(changedByWheel, beforeUrl, lastScrollDelta);
          } else {
            lastError = advanced?.error || lastError;
          }
        }

        const pressed = await sendRuntime({ type: "DRA_TRUSTED_KEY", key: "ArrowDown" }).catch((error) => ({ ok: false, error: error?.message || String(error) }));
        if (!pressed?.ok) {
          lastError = pressed?.error || lastError;
          continue;
        }
        const changedByKey = await waitForNext(previousFingerprint, 5_000);
        if (changedByKey.blockedReason || changedByKey.changed) return transitionResult(changedByKey, beforeUrl, lastScrollDelta);
      }
      return transitionResult({ changed: false, reason: lastError || "真实滚轮和方向键均未切换推荐视频" }, beforeUrl, lastScrollDelta);
    }

    async function performAndReportTransition(recordId, action, previousFingerprint, beforeUrl) {
      await progress("transition");
      try {
        const result = await performDecisionAction(action, previousFingerprint, beforeUrl);
        await reportTransition(recordId, result);
        await progress("idle", { transitionOk: result.changed === true });
        return result;
      } catch (error) {
        await reportTransition(recordId, {
          beforeUrl,
          afterUrl: location.href,
          transitionOk: false,
          scrollDelta: null
        }).catch(() => undefined);
        throw error;
      }
    }

    async function skipUnreadableCard(observation, reason, previousFingerprint) {
      await progress("submit");
      const beforeUrl = location.href;
      const result = await sendRuntime({ type: "DRA_PANEL_SKIPPED", observation: { ...observation, beforeUrl }, reason });
      if (!result?.continue) {
        await reportTransition(result?.observationRecordId, { beforeUrl, afterUrl: location.href, transitionOk: false, scrollDelta: null });
        running = false;
        return { stopped: true };
      }
      const changed = await performAndReportTransition(result.observationRecordId, result.action || "advance", previousFingerprint, beforeUrl);
      if (changed.blockedReason) {
        await sendRuntime({ type: "DRA_PAGE_BLOCKED", reason: changed.blockedReason });
        running = false;
        return { stopped: true };
      }
      if (!changed.changed) {
        failureStreak += 1;
        if (failureStreak >= 3) {
          await sendRuntime({ type: "DRA_FEED_STALLED", reason: `连续三条异常卡片后仍无法切换推荐视频（${changed.reason || "翻页无响应"}）` });
          running = false;
          return { stopped: true };
        }
      } else {
        failureStreak = 0;
      }
      return { stopped: false };
    }

    async function tick() {
      if (!running) return;
      try {
        let tickStartedAt = Date.now();
        await progress("read");
        if (!/[?&]recommend=1(?:&|$)/.test(location.search)) {
          await sendRuntime({ type: "DRA_PAGE_BLOCKED", reason: "后台推荐流标签页离开了推荐页" });
          running = false;
          return;
        }

        let observation = await waitForObservationHydration(parser.parseCurrentFeed(document));
        if (observation?.blockedReason) {
          await sendRuntime({ type: "DRA_PAGE_BLOCKED", reason: observation.blockedReason });
          running = false;
          return;
        }
        if (!observation) throw new Error("当前推荐卡片尚未加载");
        const previousFingerprint = observationFingerprint(observation);
        const resumedDwell = resume?.phase === "dwell" && resume.videoId === previousFingerprint ? resume : null;
        if (resumedDwell && Number.isFinite(resumedDwell.cycleStartedAt)) tickStartedAt = resumedDwell.cycleStartedAt;
        resume = null;
        await progress("profile", { videoId: previousFingerprint });

        let profile = null;
        let panelRecovered = false;
        if (!contentSkipDecision(observation)) {
          if (!observation.authorName && !observation.secUid && !observation.profileUrl) {
            throw new Error("当前推荐卡片仍未加载达人身份");
          }
          const recovered = await recoverCreatorPanel(observation);
          if (!recovered.ok) {
            const skipped = await skipUnreadableCard(observation, recovered.reason, previousFingerprint);
            if (!skipped.stopped && running) scheduleTick(600);
            return;
          }
          profile = recovered.profile;
          panelRecovered = recovered.recovered;
          if (!observation.authorName && profile?.authorName) {
            observation = { ...observation, authorName: profile.authorName };
          }
        }

        const targetDwellMs = resumedDwell ? resumedDwell.plannedDwellSeconds * 1_000 : contentSkipDecision(observation) ? liveDwellMs : sampleDwellSeconds(dwellPolicy) * 1_000;
        const waitUntil = resumedDwell ? resumedDwell.waitUntil : tickStartedAt + targetDwellMs;
        await progress("dwell", { waitUntil, cycleStartedAt: tickStartedAt, plannedDwellSeconds: targetDwellMs / 1_000 });
        const remainingDwellMs = Math.max(0, waitUntil - Date.now());
        if (remainingDwellMs > 0) await sleep(remainingDwellMs);
        if (!running) return;

        await progress("submit");
        const refreshed = await waitForObservationHydration(parser.parseCurrentFeed(document), 2_000);
        if (refreshed?.blockedReason) {
          await sendRuntime({ type: "DRA_PAGE_BLOCKED", reason: refreshed.blockedReason });
          running = false;
          return;
        }
        if (refreshed && observationFingerprint(refreshed) === previousFingerprint) {
          observation = {
            ...observation,
            ...refreshed,
            authorName: refreshed.authorName || profile?.authorName || observation.authorName,
            durationSeconds: refreshed.durationSeconds ?? observation.durationSeconds,
            likes: refreshed.likes ?? observation.likes,
            likesText: refreshed.likesText || observation.likesText
          };
        }

        const dwellSeconds = Number(((Date.now() - tickStartedAt) / 1000).toFixed(1));
        await progress("submit", { actualDwellSeconds: dwellSeconds });
        const beforeUrl = location.href;
        const result = await sendRuntime({
          type: "DRA_OBSERVATION",
          observation: { ...observation, dwellSeconds, beforeUrl },
          profile,
          panelRecovered
        });
        if (!result?.continue) {
          await reportTransition(result?.observationRecordId, { beforeUrl, afterUrl: location.href, transitionOk: false, scrollDelta: null });
          running = false;
          return;
        }
        const changed = await performAndReportTransition(result.observationRecordId, result.action || "advance", previousFingerprint, beforeUrl);
        if (changed.blockedReason) {
          await sendRuntime({ type: "DRA_PAGE_BLOCKED", reason: changed.blockedReason });
          running = false;
          return;
        }
        if (!changed.changed) {
          failureStreak += 1;
          if (failureStreak >= 3) {
            await sendRuntime({ type: "DRA_FEED_STALLED", reason: "连续三次未能切换到下一条推荐视频" });
            running = false;
            return;
          }
        } else {
          failureStreak = 0;
        }
      } catch (error) {
        if (abort.signal.aborted || !running) return;
        failureStreak += 1;
        await sendRuntime({ type: "DRA_TICK_ERROR", error: error?.message || String(error), failureStreak }).catch(() => undefined);
        if (failureStreak >= 3) {
          running = false;
          return;
        }
      }
      if (running) scheduleTick(600);
    }

    function startLoop() {
      activeRunId = runId;
      dwellPolicy = settings.dwell || dwellPolicy;
      liveDwellMs = Math.max(1_000, Number(settings.liveDwellSeconds || 3) * 1_000);
      panelRecoveryAttempts = Math.max(1, Math.min(5, Number(settings.panelRecoveryAttempts || 3)));
      running = true;
      scheduleTick(800);
    }

    function stopLoop() {
      running = false;
      abort.abort();
    }

    return {
      start: startLoop, stop: stopLoop,
      status: () => ({ running, runId, loopId, failureStreak })
    };
  }

  let loop = null;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "DRA_START_LOOP") {
      if (!message.runId || !message.loopId) { sendResponse({ ok: false }); return false; }
      if (!loop?.status().running || loop.status().loopId !== message.loopId) {
        loop?.stop();
        loop = createLoop(message.settings || {}, message.runId, message.loopId, message.resume);
        loop.start();
      }
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "DRA_STOP_LOOP") {
      if (!message.loopId || loop?.status().loopId === message.loopId) loop?.stop();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "DRA_LOOP_STATUS") {
      sendResponse({
        ok: true, ...(loop?.status() || { running: false }),
        url: location.href, visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(), panelState: parser.creatorPanelState(document)
      });
      return false;
    }
    if (message?.type === "DRA_PARSE_FEED") {
      try {
        const observation = parser.parseCurrentFeed(document);
        sendResponse({ ok: true, observation, profile: observation && contentSkipDecision(observation) ? null : parser.parseCreatorPanel(document, observation) });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return false;
    }
    return false;
  });
})();
