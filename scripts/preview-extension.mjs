import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { DOUYIN_RECOMMEND_URL } from "../lib/platform-routes.js";

const root = resolve(import.meta.dirname, "../dist");
const extensionManifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const port = Number(process.env.EXTENSION_PREVIEW_PORT || 4174);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png"
};

const browserMock = `<script>
(() => {
  const now = Date.now();
  const snapshot = {
    ok: true,
    state: {
      status: "running",
      startedAt: new Date(now - 754000).toISOString(),
      lastTickAt: new Date(now - 45000).toISOString(),
      backgroundMode: "current-tab",
      runTrigger: "manual",
      runTarget: { mode: "both", durationMinutes: 60, maxItems: 100 },
      pageVisibility: "visible",
      route: { platform: "douyin", surface: "recommend", label: "抖音推荐" },
      recentDecisions: [
        { accountName: "山野厨房", code: "ACCEPTED", reasons: ["A级", "美食"], occurredAt: new Date(now - 60000).toISOString() },
        { accountName: "小林的数字生活", code: "ACCEPTED_REVIEW", reasons: ["B级", "需人工复核"], occurredAt: new Date(now - 180000).toISOString() },
        { accountName: "游戏研究社", code: "CATEGORY_BLACKLIST", reasons: ["命中游戏黑名单", "和平精英"], occurredAt: new Date(now - 360000).toISOString() },
        { accountName: "阿远去旅行", code: "ACCEPTED", reasons: ["A级", "旅行 Vlog"], occurredAt: new Date(now - 480000).toISOString() },
        { accountName: "今日直播间", code: "LIVE_SKIPPED", reasons: ["直播卡片已跳过"], occurredAt: new Date(now - 620000).toISOString() },
        { accountName: "数码修理铺", code: "LIKES_MISSING", reasons: ["当前视频点赞数未读取"], occurredAt: new Date(now - 740000).toISOString() },
        { accountName: "一人食日记", code: "ACCEPTED", reasons: ["S级", "美食", "互动稳定"], occurredAt: new Date(now - 900000).toISOString() }
      ],
      stats: { scanned: 38, matched: 7, reviewQueued: 2, newCreators: 5, duplicates: 3, notInterested: 20, liveSkipped: 1, panelSkipped: 2, uploaded: 36 }
    },
    settings: {
      dwell: { mode: "range", fixedSeconds: 30, minSeconds: 10, typicalSeconds: 15, maxSeconds: 30 },
      target: { mode: "both", durationMinutes: 60, maxItems: 100 },
      keepSystemAwake: true,
      markRejectedNotInterested: true,
      dryRun: false,
      cloud: { enabled: true },
      schedule: {
        enabled: true,
        weekdays: [2, 3, 4, 5, 6],
        times: ["11:15", "13:30", "16:00", "18:00", "20:00", "23:00"],
        target: { mode: "time", durationMinutes: 60, maxItems: 100 },
        reuseExistingTab: true,
        lateToleranceMinutes: 10
      }
    },
    rules: {
      version: 4,
      includeLive: false,
      hard: { minVideoDurationSeconds: 60, minVideoLikes: 3000, preferredVideoLikes: 4000, minFollowers: 10000, maxFollowers: 5000000 },
      lowFollowerNewAccount: { enabled: true, maxVideos: 10, minAverageLikes: 3000, requireCompleteWorksList: true },
      positiveCategories: [
        { id: "food", name: "美食", score: 20, audience: "广泛", keywords: ["美食", "探店", "烹饪"], enabled: true },
        { id: "plot", name: "剧情", score: 20, audience: "18-30倾向", keywords: ["剧情", "情景剧", "反转剧情"], enabled: true },
        { id: "pc-game", name: "游戏PC", score: 20, audience: "男性偏高", keywords: ["三角洲行动", "无畏契约", "英雄联盟"], enabled: true }
      ],
      gameBlacklist: ["和平精英", "我的世界", "迷你世界", "光遇"],
      riskGroups: []
    },
    cloud: { connected: true, destination: { name: "研究台 · No Swipe" } },
    schedule: { enabled: true, nextRunAt: new Date(now + 3600000).toISOString(), lastRunAt: new Date(now - 7200000).toISOString(), lastResult: "运行完成" },
    outboxCount: 0,
    teamDestination: { name: "研究台 · No Swipe" }
  };
  snapshot.tasks = [snapshot.state, {...snapshot.state,route:{platform:"kuaishou",surface:"recommend",label:"快手推荐"},runId:"preview-ks",feedTabId:103}, {...snapshot.state,route:{platform:'feigua',surface:'library',label:'飞瓜视频库'},runId:'preview-fg',feedTabId:102,runTarget:{mode:'pages',maxPages:50},batchStartPages:0,restUntil:now+10800000,stats:{...snapshot.state.stats,scanned:357,pagesCollected:50,matched:42,rejectedProfiles:16,duplicates:21},status:'paused',pauseReason:'本批已采集 50 页，建议休息至少 3 小时。提前继续可能增加访问限制风险。'}];
  snapshot.feigua={pageCount:50,pageNumber:'50',finalized:false,candidates:[{name:'示例美食账号',followers:'12w'},{name:'示例旅行账号',followers:'8.5w'}]};
  const storageListeners = new Set();
  const previewStorageKey = "draPreviewStorage";
  const readStored = () => JSON.parse(localStorage.getItem(previewStorageKey) || "{}");
  const emitChanges = (before, after) => {
    const changes = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { oldValue: before[key], newValue: after[key] };
    }
    for (const listener of storageListeners) listener(changes, "local");
  };
  window.addEventListener("storage", event => {
    if (event.key === previewStorageKey) emitChanges(JSON.parse(event.oldValue || "{}"), JSON.parse(event.newValue || "{}"));
  });
  let visitHidden = false;
  window.chrome = {
    windows: { getCurrent: async () => ({ id: 1 }) },
    tabs: {
      onActivated: { addListener() {}, removeListener() {} },
      onUpdated: { addListener() {}, removeListener() {} },
      sendMessage: async (_id, message) => {
        if (message.type === "DRA_LAUNCHER_VISIT") visitHidden = message.hidden === true;
        return {ok: true, visitHidden};
      },
      query: async () => [{ id: 101, windowId: 1, active: true, url: ${JSON.stringify(DOUYIN_RECOMMEND_URL)} }] },
    runtime: {
      lastError: null,
      getManifest: () => (${JSON.stringify({ version: extensionManifest.version, version_name: extensionManifest.version_name })}),
      sendMessage: (message, callback) => queueMicrotask(() => callback(message.type === "DRA_GET_STATUS" ? {...snapshot,state:snapshot.tasks.find(task=>task.route?.platform===message.platform) || snapshot.state} : { ...snapshot, ok: true })),
      onMessage: { addListener() {}, removeListener() {} }
    },
    storage: {
      local: {
        remove: async key => {
          const before = readStored(), after = {...before};
          delete after[key];
          localStorage.setItem(previewStorageKey, JSON.stringify(after));
          emitChanges(before, after);
        },
        get: async () => ({ draState: snapshot.state, ...readStored() }),
        set: async values => {
          const before = readStored();
          const after = { ...before, ...values };
          localStorage.setItem(previewStorageKey, JSON.stringify(after));
          emitChanges(before, after);
        }
      },
      onChanged: { addListener(listener) { storageListeners.add(listener); }, removeListener(listener) { storageListeners.delete(listener); } }
    }
  };
})();
</script>`;

function safePath(pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "") || "sidepanel/index.html";
  const candidate = resolve(root, relative);
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    const file = safePath(url.pathname);
    if (!file || !(await stat(file)).isFile()) throw new Error("not-found");
    let body = await readFile(file);
    if (extname(file) === ".html") {
      body = Buffer.from(body.toString("utf8").replace("<body>", `<body>${browserMock}`));
    }
    response.writeHead(200, { "Content-Type": mimeTypes[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`extension preview: http://127.0.0.1:${port}/sidepanel/index.html`);
});
