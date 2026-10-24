import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { DOUYIN_RECOMMEND_URL } from "../lib/platform-routes.js";
import { mergeRules } from '../lib/defaults.js';
import { decideKuaishou } from '../lib/kuaishou-task.js';
import { decideBilibili, mergeBilibiliRules } from '../lib/bilibili-rules.js';
import { evaluateFeiguaRules } from '../lib/feigua-rules.js';
import { captureRuleMatch } from '../lib/rule-match.js';

const root = resolve(import.meta.dirname, "../dist");
const extensionManifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const port = Number(process.env.EXTENSION_PREVIEW_PORT || 4174);
// The rule-matches preview uses real evaluators and stays entirely local.
const previewNow = Date.now();
const previewRules = mergeRules({hard:{minFollowers:10000,maxFollowers:100000,minVideoDurationSeconds:75,minVideoLikes:4200},positiveCategories:[{id:'digital',name:'数码测评',keywords:['手机测评'],score:15,enabled:true}]});
const previewVideo = {contentType:'video',caption:'新款手机测评',durationSeconds:90,likes:5000};
const previewProfile = {authorName:'手机测评员',followers:80000,averageLikes:5000,kuaishouId:'preview'};
const recordPreview = (sourcePlatform, taskName, decision, index, patch={}) => ({
  id:`rule-preview-${index}`,sourcePlatform,runId:`preview-${sourcePlatform}`,runStartedAt:new Date(previewNow-600000).toISOString(),
  accountName:`${taskName}示例达人`,authorId:`example-${sourcePlatform}`,caption:previewVideo.caption,...previewVideo,
  ...decision,occurredAt:new Date(previewNow-index*60000).toISOString(),
  ruleMatch:captureRuleMatch(decision,{route:{label:taskName}},sourcePlatform),...patch,
});
const ruleMatchPreview = [
  recordPreview('douyin','抖音推荐',decideKuaishou(previewVideo,previewProfile,previewRules),1),
  recordPreview('kuaishou','快手推荐',decideKuaishou(previewVideo,{...previewProfile,averageLikes:null},previewRules),2),
  recordPreview('bilibili','B站首页推荐',decideBilibili({...previewVideo,caption:'美食探店',tname:'美食',plays:150000,pubdateSeconds:previewNow/1000-86400},previewProfile,mergeBilibiliRules(),previewNow),3,{caption:'美食探店',tname:'美食',plays:150000}),
  recordPreview('feigua','飞瓜视频库',evaluateFeiguaRules([{title:'手机测评'}],{feiguaKeywords:[],feiguaPositiveKeywords:['手机测评']}),4),
  recordPreview('feigua','飞瓜视频库',evaluateFeiguaRules([{title:'日常记录'}],{feiguaKeywords:[],feiguaPositiveKeywords:['手机测评']}),5,{caption:'日常记录'}),
  recordPreview('xingtu','星图达人广场',{code:'XINGTU_PENDING_REVIEW',reasons:['按星图页面筛选采集，待人工复核']},6),
  recordPreview('huxuan','腾讯互选视频号',{code:'HUXUAN_CANDIDATE_REVIEW',reasons:['互选列表候选，待研究台人工复核']},7),
  recordPreview('douyin','抖音推荐',{code:'ACCEPTED',reasons:['旧记录保留原有判断依据']},8,{ruleMatch:null,accountName:'历史记录示例'}),
];
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
  const ruleSyncPreview = new URLSearchParams(location.search).get('ruleSync');
  if (ruleSyncPreview === 'error') snapshot.cloud.ruleSync = {pending:[],error:'invalid_session',syncedAt:''};
  if (ruleSyncPreview === 'service') snapshot.cloud.ruleSync = {pending:[],error:'rule_sync_service_unavailable',syncedAt:''};
  if (ruleSyncPreview === 'pending') snapshot.cloud.ruleSync = {pending:[{id:'preview-feedback',platform:'douyin',explanation:'删除误杀词，其他规则保持不变'}],error:'',syncedAt:new Date(now).toISOString()};
  const bilibiliRules = {
    ...snapshot.rules,
    platform: "bilibili",
    hard: { minVideoDurationSeconds: 60 },
    playRules: {
      reject: [{ plays: 10000, playsOp: "<", days: 3, daysOp: ">" }],
      prefer: [{ plays: 100000, playsOp: ">=", days: 3, daysOp: "<=" }]
    },
    contentBlacklist: ["动漫", "电影"],
    excludeTnames: []
  };
  snapshot.tasks = [snapshot.state, {...snapshot.state,route:{platform:"kuaishou",surface:"recommend",label:"快手推荐"},runId:"preview-ks",feedTabId:103}, {...snapshot.state,route:{platform:"bilibili",surface:"recommend",label:"B站首页推荐"},runId:"preview-bl",feedTabId:104,status:"idle"}, {...snapshot.state,route:{platform:'feigua',surface:'library',label:'飞瓜视频库'},runId:'preview-fg',feedTabId:102,runTarget:{mode:'pages',maxPages:50},batchStartPages:0,restUntil:now+10800000,stats:{...snapshot.state.stats,scanned:357,pagesCollected:50,matched:42,rejectedProfiles:16,duplicates:21},status:'paused',pauseReason:'本批已采集 50 页，建议休息至少 3 小时。提前继续可能增加访问限制风险。'}, {...snapshot.state,route:{platform:'xingtu',surface:'market',label:'星图达人广场'},runId:'preview-xt',feedTabId:105,runTarget:{mode:'pages',maxPages:50},batchStartPages:0,stats:{...snapshot.state.stats,pagesCollected:12,matched:190,rejectedProfiles:4,duplicates:8},status:'paused',pauseReason:'演示：已暂停自动翻页'}];
  snapshot.feigua={pageCount:50,pageNumber:'50',finalized:false,candidates:[{name:'示例美食账号',followers:'12w'},{name:'示例旅行账号',followers:'8.5w'}]};
  snapshot.xingtu={pageCount:12,pageNumber:'12',finalized:false,candidates:[]};
  snapshot.tasks.push({...snapshot.state,runId:'preview-hx',route:{platform:'huxuan',surface:'market',label:'腾讯互选视频号'},status:'paused',runTarget:{mode:'pages',maxPages:50},stats:{pagesCollected:2,matched:60,scanned:60,duplicates:0,uploaded:60},pauseReason:'演示：已保存两页，继续将从第 3 页开始'});
  snapshot.huxuan={pageCount:2,pageNumber:'2',finalized:false,candidates:[]};
  snapshot.settings.huxuanTarget={maxPages:50};snapshot.settings.huxuanDelay={minSeconds:4,maxSeconds:6};
  // Deterministic, local-only fixtures for layout/zoom acceptance. No collector runs.
  const responsivePreview = new URLSearchParams(location.search).has('responsive');
  snapshot.tasks.push({...snapshot.tasks[2],route:{platform:'bilibili',surface:'popular',label:'B站综合热门'}});
  if (responsivePreview) {
    for (const task of snapshot.tasks) task.status = 'paused';
    snapshot.rules.gameBlacklist.push('VeryLongKeywordWithoutSpacesForResponsiveLayoutVerification');
    snapshot.feigua.candidates[0].videos = [{videoId:'preview-video',title:'用于布局验收的长视频标题：一次完整记录拍摄制作与发布过程',durationSeconds:120,metrics:{'播放':'123456789','点赞':'9876543','评论':'123456'}}];
    snapshot.xingtu.candidates = [{name:'用于响应式布局验收的长名称达人账号',followers:'12345678',xingtuId:'1234567890123456789',tags:['美食','旅行'],prices:{'21-60秒视频':'123456'},metrics:{'预期CPM':'123.45'},city:'上海'}];
    snapshot.decisionHistory = snapshot.state.recentDecisions.slice(0,3).map((item,index)=>({...item,id:'preview-'+index,authorId:'preview-author-'+index,videoId:'preview-video-'+index,sourcePlatform:'douyin',ipLocation:index===0?'上海':null,ipLocationStatus:index===0?'available':'missing',ipLocationCapturedAt:new Date(now).toISOString(),accountName:index===0?'用于响应式布局验收的很长达人昵称':item.accountName,caption:'用于响应式验收的视频标题与连续英文 LongVideoTitleWithoutSpacesForLayoutVerification',plays:123456789,likes:1234567,durationSeconds:125}));
    snapshot.decisionHistoryTotal = snapshot.decisionHistory.length;
  }
  const ruleMatchMode = new URLSearchParams(location.search).has('rule-matches');
  if (ruleMatchMode) {
    for (const task of snapshot.tasks) task.status = 'paused';
    snapshot.decisionHistory = ${JSON.stringify(ruleMatchPreview)};
    snapshot.decisionHistoryTotal = snapshot.decisionHistory.length;
  }
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
      getURL: path => new URL("/" + path, location.origin).href,
      getManifest: () => (${JSON.stringify({ version: extensionManifest.version, version_name: extensionManifest.version_name })}),
      sendMessage: (message, callback) => new Promise(resolve => queueMicrotask(() => {
        const reply = value => { callback?.(value); resolve(value); };
        if (message.type === "DRA_DEBUG_STATUS") return reply({ok:true,enabled:false,samples:{count:0,bytes:0}});
        if (message.type === "DRA_QUERY_HISTORY") {
          const options = message.options || {};
          const items = (snapshot.decisionHistory || []).filter(item => (!options.authorId || item.authorId === options.authorId) && (!options.query || [item.accountName,item.caption,item.ruleMatch?.ruleName,...(item.reasons || [])].join(' ').includes(options.query)) && (!options.sourcePlatform || item.sourcePlatform === options.sourcePlatform) && (!options.runId || item.runId === options.runId));
          const counts={good:0,review:0,reject:0};
          for (const item of items) counts[item.code === 'ACCEPTED' || item.code === 'FEIGUA_MATCHED' ? 'good' : /REVIEW|OBSERVED|MISSING/.test(item.code || '') ? 'review' : 'reject']++;
          const filtered=options.tone ? items.filter(item => (item.code === 'ACCEPTED' || item.code === 'FEIGUA_MATCHED' ? 'good' : /REVIEW|OBSERVED|MISSING/.test(item.code || '') ? 'review' : 'reject') === options.tone) : items;
          const runs=[...new Map(items.map(item=>[item.runId,{id:item.runId,startedAt:item.runStartedAt || item.occurredAt}])).values()];
          return reply({ok:true,items:filtered,total:filtered.length,counts,runs,nextCursor:null,asOf:now});
        }
        if (message.type === "DRA_SYNC_RULES") return reply({ok:true,status:snapshot.cloud.ruleSync});
        const configKey = "previewConfig:" + (message.platform && message.platform !== "auto" ? message.platform : "douyin");
        if (message.type === "DRA_SAVE_CONFIG") {
          const stored = readStored();
          const config = {...stored[configKey], ...(message.settings ? {settings:message.settings} : {}), ...(message.rules ? {rules:message.rules} : {})};
          localStorage.setItem(previewStorageKey, JSON.stringify({...stored, [configKey]:config}));
          return reply({...snapshot, ...config, ok:true, configPlatform:message.platform || "douyin", settingsDraft:null, problems:[]});
        }
        if (message.type !== "DRA_GET_STATUS") return reply({ ...snapshot, ok: true });
        const state = snapshot.tasks.find(task => message.platform === "bilibili-popular" ? task.route?.platform === "bilibili" && task.route?.surface === "popular" : task.route?.platform === message.platform && task.route?.surface !== "popular") || snapshot.state;
        const rules = ["bilibili", "bilibili-popular"].includes(message.platform) ? bilibiliRules : snapshot.rules;
        const history = ruleMatchMode ? snapshot.decisionHistory.filter(item => item.sourcePlatform === state.route?.platform) : snapshot.decisionHistory;
        reply({ ...snapshot, state, rules, ...readStored()[configKey], ...(ruleMatchMode ? {decisionHistory:history,decisionHistoryTotal:history.length} : {}), configPlatform: message.platform === "bilibili-popular" ? message.platform : state.route?.platform || "douyin" });
      })),
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
