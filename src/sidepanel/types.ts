export interface Stats {
  scanned?: number;
  matched?: number;
  reviewQueued?: number;
  newCreators?: number;
  duplicates?: number;
  notInterested?: number;
  liveSkipped?: number;
  panelSkipped?: number;
  uploaded?: number;
}

export interface Decision {
  code?: string;
  reasons?: string[];
  accountName?: string;
  avatarUrl?: string;
  profileUrl?: string;
  occurredAt?: string;
}

export interface RunState {
  status?: "idle" | "starting" | "running" | "paused" | "stopped";
  startedAt?: string | null;
  endedAt?: string | null;
  lastTickAt?: string | null;
  startupStage?: string;
  pauseReason?: string;
  lastError?: string;
  backgroundMode?: string;
  runTrigger?: "manual" | "schedule";
  runTarget?: RunTarget | null;
  pageVisibility?: string;
  route?: { platform?: string; surface?: string; label?: string } | null;
  recentDecisions?: Decision[];
  lastDecision?: Decision | null;
  stats?: Stats;
}

export type DwellMode = "fixed" | "range";
export type TargetMode = "time" | "count" | "both";

export interface RunTarget {
  mode: TargetMode;
  durationMinutes: number;
  maxItems: number;
}

export interface DwellPolicy {
  mode: DwellMode;
  fixedSeconds: number;
  minSeconds: number;
  typicalSeconds: number;
  maxSeconds: number;
}

export interface ScheduleSettings {
  enabled?: boolean;
  weekdays?: number[];
  times?: string[];
  target?: RunTarget;
  reuseExistingTab?: boolean;
  lateToleranceMinutes?: number;
}

export interface Settings {
  dwell?: DwellPolicy;
  target?: RunTarget;
  keepSystemAwake?: boolean;
  markRejectedNotInterested?: boolean;
  dryRun?: boolean;
  cloud?: { enabled?: boolean };
  schedule?: ScheduleSettings;
  [key: string]: unknown;
}

export interface Pairing {
  status?: string;
  code?: string;
}

export interface CloudState {
  connected?: boolean;
  userId?: string;
  pairing?: Pairing | null;
  destination?: { name?: string; ingest?: string };
}

export interface Snapshot {
  state?: RunState;
  settings?: Settings;
  rules?: unknown;
  cloud?: CloudState;
  schedule?: ScheduleSettings & { nextRunAt?: string; lastRunAt?: string; lastResult?: string };
  outboxCount?: number;
  teamDestination?: { name?: string; ingest?: string };
}

export interface SettingsDraft {
  dwellMode: DwellMode;
  fixedDwellSeconds: number;
  dwellMinSeconds: number;
  dwellTypicalSeconds: number;
  dwellMaxSeconds: number;
  targetMode: TargetMode;
  targetDurationMinutes: number;
  targetMaxItems: number;
  keepSystemAwake: boolean;
  markRejectedNotInterested: boolean;
  dryRun: boolean;
  bridgeEnabled: boolean;
  scheduleEnabled: boolean;
  scheduleWeekdays: number[];
  scheduleTimes: string[];
  scheduleTargetMode: TargetMode;
  scheduleDurationMinutes: number;
  scheduleMaxItems: number;
  scheduleReuseExistingTab: boolean;
  scheduleLateToleranceMinutes: number;
}

export function settingsDraft(settings: Settings = {}): SettingsDraft {
  return {
    dwellMode: settings.dwell?.mode ?? "fixed",
    fixedDwellSeconds: settings.dwell?.fixedSeconds ?? 30,
    dwellMinSeconds: settings.dwell?.minSeconds ?? 10,
    dwellTypicalSeconds: settings.dwell?.typicalSeconds ?? 15,
    dwellMaxSeconds: settings.dwell?.maxSeconds ?? 30,
    targetMode: settings.target?.mode ?? "both",
    targetDurationMinutes: settings.target?.durationMinutes ?? 60,
    targetMaxItems: settings.target?.maxItems ?? 100,
    keepSystemAwake: settings.keepSystemAwake !== false,
    markRejectedNotInterested: settings.markRejectedNotInterested !== false,
    dryRun: Boolean(settings.dryRun),
    bridgeEnabled: settings.cloud?.enabled !== false,
    scheduleEnabled: settings.schedule?.enabled !== false,
    scheduleWeekdays: settings.schedule?.weekdays ?? [2, 3, 4, 5, 6],
    scheduleTimes: settings.schedule?.times ?? ["11:15", "13:30", "16:00", "18:00", "20:00", "23:00"],
    scheduleTargetMode: settings.schedule?.target?.mode ?? "time",
    scheduleDurationMinutes: settings.schedule?.target?.durationMinutes ?? 60,
    scheduleMaxItems: settings.schedule?.target?.maxItems ?? 100,
    scheduleReuseExistingTab: settings.schedule?.reuseExistingTab !== false,
    scheduleLateToleranceMinutes: settings.schedule?.lateToleranceMinutes ?? 10
  };
}

export interface CategoryRule {
  id: string;
  name: string;
  score: number;
  audience: string;
  keywords: string[];
  enabled?: boolean;
}

export interface RuleSettings {
  version?: number;
  includeLive: boolean;
  hard: {
    minVideoDurationSeconds: number;
    minVideoLikes: number;
    preferredVideoLikes: number;
    minFollowers: number;
    maxFollowers: number;
  };
  lowFollowerNewAccount: {
    enabled: boolean;
    maxVideos: number;
    minAverageLikes: number;
    requireCompleteWorksList: boolean;
  };
  positiveCategories: CategoryRule[];
  gameBlacklist: string[];
  riskGroups?: unknown[];
  [key: string]: unknown;
}

const FALLBACK_RULES: RuleSettings = {
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
  positiveCategories: [],
  gameBlacklist: [],
  riskGroups: []
};

export function rulesDraft(value: unknown): RuleSettings {
  const source = value && typeof value === "object" ? value as Partial<RuleSettings> : {};
  const hard = source.hard && typeof source.hard === "object" ? source.hard : FALLBACK_RULES.hard;
  const lowFollower = source.lowFollowerNewAccount && typeof source.lowFollowerNewAccount === "object"
    ? source.lowFollowerNewAccount
    : FALLBACK_RULES.lowFollowerNewAccount;
  const categories = Array.isArray(source.positiveCategories) ? source.positiveCategories : [];
  return {
    ...source,
    version: Number(source.version || FALLBACK_RULES.version),
    includeLive: Boolean(source.includeLive),
    hard: {
      minVideoDurationSeconds: Number(hard.minVideoDurationSeconds ?? FALLBACK_RULES.hard.minVideoDurationSeconds),
      minVideoLikes: Number(hard.minVideoLikes ?? FALLBACK_RULES.hard.minVideoLikes),
      preferredVideoLikes: Number(hard.preferredVideoLikes ?? FALLBACK_RULES.hard.preferredVideoLikes),
      minFollowers: Number(hard.minFollowers ?? FALLBACK_RULES.hard.minFollowers),
      maxFollowers: Number(hard.maxFollowers ?? FALLBACK_RULES.hard.maxFollowers)
    },
    lowFollowerNewAccount: {
      enabled: lowFollower.enabled !== false,
      maxVideos: Number(lowFollower.maxVideos ?? FALLBACK_RULES.lowFollowerNewAccount.maxVideos),
      minAverageLikes: Number(lowFollower.minAverageLikes ?? FALLBACK_RULES.lowFollowerNewAccount.minAverageLikes),
      requireCompleteWorksList: lowFollower.requireCompleteWorksList !== false
    },
    positiveCategories: categories.map((category, index) => ({
      id: String(category?.id || `category-${index + 1}`),
      name: String(category?.name || "未命名类目"),
      score: Number(category?.score || 0),
      audience: String(category?.audience || "未知"),
      keywords: Array.isArray(category?.keywords) ? category.keywords.map(String).filter(Boolean) : [],
      enabled: category?.enabled !== false
    })),
    gameBlacklist: Array.isArray(source.gameBlacklist) ? source.gameBlacklist.map(String).filter(Boolean) : [],
    riskGroups: []
  };
}
