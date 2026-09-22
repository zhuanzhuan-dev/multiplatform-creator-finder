import {
  applyBilibiliView,
  assertBilibiliLoggedIn,
  clipBilibiliObservation,
  fetchBilibiliPopular,
  fetchBilibiliRecommend,
  fetchBilibiliRelationStat,
  fetchBilibiliView,
  mapBilibiliPopularItem,
  mapBilibiliProfile,
  mapBilibiliRecommendItem,
  sampleBilibiliBatchSeconds
} from "../lib/bilibili-api.js";
import { evaluateBilibiliVideoRules } from "../lib/bilibili-rules.js";

let generation = 0;
let running = false;
let runId = "";
let loopId = "";

const stop = () => {
  generation++;
  running = false;
};

function currentSurface() {
  if (location.pathname === "/v/popular/all" || location.pathname.startsWith("/v/popular/all")) return "popular";
  if (location.pathname === "/" || location.pathname === "") return "recommend";
  return "";
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.type === "DRA_LOOP_STATUS") {
    reply({ ok: true, running, runId, loopId });
    return false;
  }
  if (message.type === "DRA_STOP_LOOP") {
    stop();
    reply({ ok: true });
    return false;
  }
  if (message.type !== "DRA_START_LOOP") return false;
  stop();
  running = true;
  runId = message.runId;
  loopId = message.loopId;
  const own = generation;
  const expected = message.surface === "popular" ? "popular" : "recommend";
  const assert = () => {
    if (!running || own !== generation) throw Error("任务已取消");
    if (currentSurface() !== expected) {
      throw Error(expected === "popular" ? "已离开 B 站综合热门" : "已离开 B 站首页");
    }
  };
  const send = async (type, extra = {}) => {
    assert();
    const result = await chrome.runtime.sendMessage({ type, runId: message.runId, loopId: message.loopId, ...extra });
    if (!result?.ok) throw Error(result?.error || "任务已暂停");
    assert();
    return result;
  };
  const sleep = async (ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) await send("DRA_WAIT", { until: Math.min(until, Date.now() + 1000) });
  };
  const progress = (phase, extra = {}) => send("DRA_PROGRESS", { phase, ...extra });

  void (async () => {
    await assertBilibiliLoggedIn();
    let freshIdx = Math.max(1, Number(message.resume?.freshIdx) || 1);
    let popularPage = Math.max(1, Number(message.resume?.popularPage) || 1);
    const seen = new Set(message.resume?.lastVideoId ? [message.resume.lastVideoId] : []);
    while (running && own === generation) {
      await progress("read", { freshIdx, popularPage });
      let observations = [];
      let popularExhausted = false;
      if (expected === "popular") {
        const batch = await fetchBilibiliPopular(popularPage);
        popularExhausted = batch.exhausted === true;
        observations = batch.items.map((item) => mapBilibiliPopularItem(item)).filter(Boolean);
        if (!observations.length) throw Error(popularExhausted ? "综合热门已全部采完" : "本页综合热门未返回可用视频，已暂停");
      } else {
        const batch = await fetchBilibiliRecommend(freshIdx);
        if (batch.exhausted) throw Error("B 站暂时没有更多推荐内容");
        observations = batch.items.map((item) => mapBilibiliRecommendItem(item)).filter(Boolean);
        if (!observations.length) throw Error("本批推荐未返回可用视频，已暂停");
      }

      // 推荐卡片没有分区名，先打视频详情再判断。热门卡片自带分区，时长或播放已淘汰的不再打详情。
      for (const item of observations) {
        assert();
        if (seen.has(item.videoId)) continue;
        const started = Date.now();
        await progress("submit", { freshIdx, popularPage });
        let observation = item;
        let followers = null;
        let extra = {};
        let gate = null;
        const loadView = async () => {
          const view = await fetchBilibiliView(observation.videoId);
          observation = clipBilibiliObservation(applyBilibiliView(observation, view));
          extra = { ...extra, view, archives: extra.archives || [], archiveCount: extra.archiveCount ?? null, archivesComplete: extra.archivesComplete === true };
        };
        if (!String(observation.tname || "").trim()) {
          try {
            await loadView();
          } catch {
            extra = {};
          }
          gate = evaluateBilibiliVideoRules(observation, message.rules);
        } else {
          gate = evaluateBilibiliVideoRules(observation, message.rules);
          const rejectedOnCard = gate.matched === false && gate.needsReview !== true;
          if (!rejectedOnCard) {
            try {
              await loadView();
              gate = evaluateBilibiliVideoRules(observation, message.rules);
            } catch {
              extra = {};
            }
          }
        }
        if (gate.matched || gate.needsReview) {
          try {
            const relationStat = await fetchBilibiliRelationStat(observation.authorId);
            const count = Number(relationStat?.follower);
            followers = Number.isFinite(count) ? count : null;
            observation = { ...observation, relationStat };
            extra = { ...extra, relationStat, followers };
          } catch {
            followers = null;
          }
        }
        await progress("submit", { freshIdx, popularPage });
        const profile = mapBilibiliProfile(observation, followers, extra);
        const result = await send("DRA_BILIBILI_VIDEO", {
          observation: { ...observation, dwellSeconds: (Date.now() - started) / 1000 },
          profile,
          freshIdx,
          popularPage
        });
        seen.add(observation.videoId);
        if (!result.continue) {
          stop();
          return;
        }
      }

      if (expected === "popular") {
        if (popularExhausted) throw Error("综合热门已全部采完");
        popularPage += 1;
      } else {
        freshIdx += 1;
      }
      const batchSeconds = sampleBilibiliBatchSeconds(message.settings);
      await progress("transition", { freshIdx, popularPage, waitUntil: Date.now() + batchSeconds * 1000 });
      await sleep(batchSeconds * 1000);
    }
  })().catch(async (error) => {
    if (own !== generation) return;
    running = false;
    await chrome.runtime.sendMessage({
      type: "DRA_TICK_ERROR",
      runId: message.runId,
      loopId: message.loopId,
      error: error.message
    }).catch(() => {});
  });
  reply({ ok: true });
  return false;
});
