export const STORAGE_KEYS = Object.freeze({
  settings: "draSettings",
  rules: "draRules",
  state: "draState",
  seenVideos: "draSeenVideos",
  creatorIndex: "draCreatorIndex",
  profileQueue: "draProfileQueue",
  outbox: "draOutbox",
  cloudAuth: "draCloudAuth",
  pairing: "draPairing"
});

export const TEAM_DESTINATION = Object.freeze({
  name: "研究台 · No Swipe",
  tableName: "ingest",
  viewName: "observations",
  platform: "抖音",
  status: "云端上传"
});

export const DEFAULT_SETTINGS = Object.freeze({
  liveDwellSeconds: 3,
  panelRecoveryAttempts: 3,
  dwell: {
    mode: "fixed",
    fixedSeconds: 30,
    minSeconds: 10,
    typicalSeconds: 15,
    maxSeconds: 30
  },
  target: {
    mode: "both",
    durationMinutes: 60,
    maxItems: 100
  },
  keepSystemAwake: true,
  markRejectedNotInterested: true,
  dryRun: false,
  schedule: {
    enabled: true,
    weekdays: [2, 3, 4, 5, 6],
    times: ["11:15", "13:30", "16:00", "18:00", "20:00", "23:00"],
    target: {
      mode: "time",
      durationMinutes: 60,
      maxItems: 100
    },
    reuseExistingTab: true,
    lateToleranceMinutes: 10
  },
  cloud: {
    enabled: true
  }
});

export const DEFAULT_RULES = Object.freeze({
  version: 4,
  includeLive: false,
  hard: {
    minVideoDurationSeconds: 60,
    minVideoLikes: 3000,
    preferredVideoLikes: 4000,
    minFollowers: 10000,
    maxFollowers: 5000000
  },
  lowFollowerNewAccount: {
    enabled: true,
    maxVideos: 10,
    minAverageLikes: 3000,
    requireCompleteWorksList: true
  },
  positiveCategories: [
    { id: "food", name: "美食", score: 20, audience: "广泛", keywords: ["美食", "探店", "吃播", "美食教程", "美食制作", "地方特色美食", "做饭", "烹饪", "餐厅"] },
    { id: "plot", name: "剧情", score: 20, audience: "18-30倾向", keywords: ["剧情", "搞笑剧情", "段子", "情景剧", "一人分饰多角", "反转剧情", "短剧"] },
    { id: "pc-game", name: "游戏PC", score: 20, audience: "男性偏高（类型推断）", keywords: ["三角洲行动", "无畏契约", "英雄联盟", "电脑游戏", "端游", "电竞"] },
    { id: "sports", name: "体育/才艺", score: 15, audience: "男性偏高（类型推断）", keywords: ["体育", "运动", "钓鱼", "技能展示", "才艺", "挑战", "户外", "足球", "篮球", "健身"] },
    { id: "vlog", name: "Vlog", score: 15, audience: "18-30倾向", keywords: ["vlog", "生活vlog", "日常记录", "职业生活", "旅行vlog", "校园vlog", "日常", "旅行", "校园"] },
    { id: "ai", name: "AI内容", score: 15, audience: "18-30倾向", keywords: ["ai漫剧", "ai剧情", "ai动画", "ai故事", "ai生成内容", "内容由 ai 生成", "aigc"] },
    { id: "mobile-honor", name: "王者荣耀", score: 10, audience: "男性偏高（类型推断）", keywords: ["王者荣耀"] }
  ],
  gameBlacklist: ["和平精英", "我的世界", "迷你世界", "光遇"],
  riskGroups: []
});

export const INITIAL_STATE = Object.freeze({
  status: "idle",
  startupStage: "",
  runId: "",
  feedTabId: null,
  feedWindowId: null,
  createdByExtension: false,
  backgroundMode: "",
  route: null,
  pageVisibility: "",
  pageHasFocus: null,
  runTrigger: "manual",
  runTarget: null,
  runDurationMinutes: null,
  scheduledFor: null,
  lastScheduleAt: null,
  lastScheduleResult: "",
  startedAt: null,
  endedAt: null,
  stopAt: null,
  lastTickAt: null,
  lastVideoId: "",
  lastError: "",
  pauseReason: "",
  recentDecisions: [],
  stats: {
    scanned: 0,
    matched: 0,
    reviewQueued: 0,
    newCreators: 0,
    duplicates: 0,
    rejectedProfiles: 0,
    notInterested: 0,
    liveSkipped: 0,
    panelRecoveries: 0,
    panelSkipped: 0,
    failed: 0,
    uploaded: 0,
    uploadRejected: 0
  }
});

export function mergeSettings(value = {}) {
  const { focusTab: _legacyScheduleFocusTab, ...scheduleValue } = value.schedule || {};
  const legacyDwellSeconds = Number(value.dwellSeconds);
  const legacyDurationMinutes = Number(value.runMinutes);
  const legacyMaxItems = Number(value.maxItemsPerRun);
  const dwell = {
    ...DEFAULT_SETTINGS.dwell,
    ...(value.dwell || {}),
    ...(!value.dwell && Number.isFinite(legacyDwellSeconds) ? { fixedSeconds: legacyDwellSeconds } : {})
  };
  const target = {
    ...DEFAULT_SETTINGS.target,
    ...(value.target || {}),
    ...(!value.target && Number.isFinite(legacyDurationMinutes) ? { durationMinutes: legacyDurationMinutes } : {}),
    ...(!value.target && Number.isFinite(legacyMaxItems) ? { maxItems: legacyMaxItems } : {})
  };
  const scheduleTarget = {
    ...DEFAULT_SETTINGS.schedule.target,
    ...(value.schedule?.target || {}),
    ...(!value.schedule?.target && Number.isFinite(Number(value.schedule?.durationMinutes))
      ? { durationMinutes: Number(value.schedule.durationMinutes) }
      : {})
  };
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    dwell,
    target,
    schedule: {
      ...DEFAULT_SETTINGS.schedule,
      ...scheduleValue,
      target: scheduleTarget,
      weekdays: Array.isArray(value.schedule?.weekdays) ? value.schedule.weekdays : DEFAULT_SETTINGS.schedule.weekdays,
      times: Array.isArray(value.schedule?.times) ? value.schedule.times : DEFAULT_SETTINGS.schedule.times
    },
    cloud: {
      ...DEFAULT_SETTINGS.cloud,
      ...(value.cloud || {}),
      enabled: value.cloud?.enabled ?? value.bridge?.enabled ?? DEFAULT_SETTINGS.cloud.enabled
    }
  };
}

export function validateSettings(settings = {}) {
  const problems = [];
  const dwell = settings.dwell || {};
  if (!new Set(["fixed", "range"]).has(dwell.mode)) problems.push("停留模式必须是固定或随机区间");
  if (dwell.mode === "fixed") {
    const fixed = Number(dwell.fixedSeconds);
    if (!Number.isFinite(fixed) || fixed < 5 || fixed > 300) problems.push("固定停留必须在 5–300 秒之间");
  }
  if (dwell.mode === "range") {
    const min = Number(dwell.minSeconds);
    const typical = Number(dwell.typicalSeconds);
    const max = Number(dwell.maxSeconds);
    if (![min, typical, max].every(Number.isFinite) || min < 5 || max > 300 || min > typical || typical > max) {
      problems.push("随机停留必须满足 5 ≤ 最短 ≤ 常见 ≤ 最长 ≤ 300 秒");
    }
  }
  const targets = [["单次任务", settings.target]];
  if (settings.schedule?.enabled !== false) targets.push(["定时任务", settings.schedule?.target]);
  for (const [label, target] of targets) {
    const mode = target?.mode;
    if (!new Set(["time", "count", "both"]).has(mode)) problems.push(`${label}目标模式无效`);
    const duration = Number(target?.durationMinutes);
    const count = Number(target?.maxItems);
    if (["time", "both"].includes(mode) && (!Number.isInteger(duration) || duration < 1 || duration > 1440)) {
      problems.push(`${label}时长必须是 1–1440 分钟的整数`);
    }
    if (["count", "both"].includes(mode) && (!Number.isInteger(count) || count < 1 || count > 5000)) {
      problems.push(`${label}视频数量必须是 1–5000 的整数`);
    }
  }
  return problems;
}

export function mergeRules(value = {}) {
  return {
    ...DEFAULT_RULES,
    ...value,
    hard: {
      ...DEFAULT_RULES.hard,
      ...(value.hard || {})
    },
    lowFollowerNewAccount: {
      ...DEFAULT_RULES.lowFollowerNewAccount,
      ...(value.lowFollowerNewAccount || {})
    },
    version: DEFAULT_RULES.version,
    positiveCategories: Array.isArray(value.positiveCategories) ? value.positiveCategories : DEFAULT_RULES.positiveCategories,
    gameBlacklist: Array.isArray(value.gameBlacklist) ? value.gameBlacklist : DEFAULT_RULES.gameBlacklist,
    // V2 取消“内容风险词直接淘汰”。旧版本保存过的风险组也不能在升级后重新生效。
    riskGroups: []
  };
}
