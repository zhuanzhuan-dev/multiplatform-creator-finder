import {
  assertBilibiliLoggedIn,
  fetchBilibiliFollowerCount,
  fetchBilibiliPopular,
  fetchBilibiliRecommend,
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

      // 一批接口结果连续处理，不在单条之间故意等待；间隔只发生在批与批之间。
      for (const observation of observations) {
        assert();
        if (seen.has(observation.videoId)) continue;
        const started = Date.now();
        await progress("submit", { freshIdx, popularPage });
        const matched = evaluateBilibiliVideoRules(observation, message.rules).matched;
        let followers = null;
        if (matched) {
          try {
            followers = await fetchBilibiliFollowerCount(observation.authorId);
          } catch {
            followers = null;
          }
        }
        const profile = mapBilibiliProfile(observation, followers);
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
