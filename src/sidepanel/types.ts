import { DEFAULT_KEYWORDS as FEIGUA_KEYWORDS } from "../../lib/feigua-parser.js";
import { DEFAULT_KEYWORDS as XINGTU_KEYWORDS } from "../../lib/xingtu-parser.js";
export interface Stats {
  pagesCollected?: number;
  rejectedProfiles?: number;
  scanned?: number;
  matched?: number;
  reviewQueued?: number;
  newCreators?: number;
  duplicates?: number;
  notInterested?: number;
  liveSkipped?: number;
  photoSkipped?: number;
  adSkipped?: number;
  unknownSkipped?: number;
  panelSkipped?: number;
  uploaded?: number;
}

export interface Decision {
  sourcePlatform?: string;
  id?: string;
  runId?: string;
  runStartedAt?: string;
  code?: string;
  reasons?: string[];
  accountName?: string;
  avatarUrl?: string;
  profileUrl?: string;
  authorId?: string;
  videoId?: string;
  caption?: string;
  coverUrl?: string;
  beforeUrl?: string;
  durationSeconds?: number | null;
  plays?: number | null;
  likes?: number | null;
  favorites?: number | null;
  comments?: number | null;
  danmaku?: number | null;
  shares?: number | null;
  occurredAt?: string;
}

export interface RunState {
  engagement?: { policy: { rate: number; like: boolean; collect: boolean; follow: boolean }; videos: number; used: Record<string, number>; sent: Record<string, number>; lastResult: string };
  runId?: string;
  elapsedMs?: number | null;
  activeSince?: number | null;
  pausedAt?: number | null;
  status?: "idle" | "starting" | "running" | "paused" | "stopped";
  feedTabId?: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  lastTickAt?: string | null;
  startupStage?: string;
  pauseReason?: string;
  lastError?: string;
  backgroundMode?: string;
  runTrigger?: "manual" | "schedule";
  runTarget?: (Omit<RunTarget, "mode"> & { mode: TargetMode | "pages" }) | null;
  batchStartPages?: number;
  restUntil?: number | null;
  pageVisibility?: string;
  keepAliveAt?: string;
  runtime?: {
    phase?: string;
    deadlineAt?: number;
    lastTransitionAt?: number;
    plannedDwellSeconds?: number;
    actualDwellSeconds?: number;
    recoveryAttempts?: number;
  };
  route?: { platform?: string; surface?: string; label?: string } | null;
  lastDecision?: Decision | null;
  stats?: Stats;
}

export type DwellMode = "fixed" | "range";
export type TargetMode = "time" | "count" | "both";

export interface RunTarget {
  mode: TargetMode;
  maxPages?: number;
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
  feiguaTarget?: { maxPages?: number };
  feiguaDelay?: { minSeconds: number; maxSeconds: number };
  xingtuTarget?: { maxPages?: number };
  xingtuDelay?: { minSeconds: number; maxSeconds: number };
  bilibiliBatchDelay?: { minSeconds: number; maxSeconds: number };
  feiguaSchedule?: ScheduleSettings;
  feiguaUploadEnabled?: boolean;
  xingtuUploadEnabled?: boolean;
  engagement?: { rate: number; like: boolean; collect: boolean; follow: boolean };
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
  account?: { id: string; name: string; email: string } | null;
  connected?: boolean;
  expired?: boolean;
  userId?: string;
  pairing?: Pairing | null;
  destination?: { name?: string; ingest?: string };
}

export interface Snapshot {
  pageRoute?: {platform:string;surface:string;label:string}|null;
  browsing?: {enabled:boolean;count:number;lastCapturedAt?:string;lastPageUrl?:string;lastError?:string};
  feigua?: {pageCount:number;pageNumber:string;finalized:boolean;candidates:{name:string;followers:string;avatarUrl?:string;profileUrl?:string;videos?:{videoId?:string;title?:string;coverUrl?:string;videoUrl?:string;durationSeconds?:number|null;metrics?:Record<string,string>;hotWords?:string[];observedAt?:string}[]}[]};
  xingtu?: {pageCount:number;pageNumber:string;finalized:boolean;candidates:{name:string;followers:string;avatarUrl?:string;profileUrl?:string;xingtuId?:string;xingtuIndex?:string;tags?:string[];prices?:Record<string,string>;metrics?:Record<string,string>;city?:string;gender?:string}[]};
  tasks?: RunState[];
  decisionHistory?: Decision[];
  decisionHistoryTotal?: number;
  daily?: { date: string; scanned: number };
  state?: RunState;
  settings?: Settings;
  configPlatform?: string;
  settingsDraft?: EditableNumbers<Settings> | null;
  rules?: unknown;
  cloud?: CloudState;
  schedule?: ScheduleSettings & { nextRunAt?: string; lastRunAt?: string; lastResult?: string };
  outboxCount?: number;
  teamDestination?: { name?: string; ingest?: string };
}

export type EditableNumbers<T> = T extends number ? number | "" : T extends unknown[] ? T : T extends object ? { [K in keyof T]: EditableNumbers<T[K]> } : T;

export interface SettingsDraft {
  engagementRate: number | "";
  engagementLike: boolean;
  engagementCollect: boolean;
  engagementFollow: boolean;
  dwellMode: DwellMode;
  fixedDwellSeconds: number | "";
  dwellMinSeconds: number | "";
  dwellTypicalSeconds: number | "";
  dwellMaxSeconds: number | "";
  bilibiliBatchMinSeconds: number | "";
  bilibiliBatchMaxSeconds: number | "";
  targetMode: TargetMode;
  targetDurationMinutes: number | "";
  targetMaxItems: number | "";
  keepSystemAwake: boolean;
  markRejectedNotInterested: boolean;
  dryRun: boolean;
  scheduleEnabled: boolean;
  scheduleWeekdays: number[];
  scheduleTimes: string[];
  scheduleTargetMode: TargetMode;
  scheduleDurationMinutes: number | "";
  scheduleMaxItems: number | "";
  scheduleReuseExistingTab: boolean;
  scheduleLateToleranceMinutes: number | "";
}

export function settingsDraft(settings: EditableNumbers<Settings> = {}): SettingsDraft {
  return {
    engagementRate: settings.engagement?.rate ?? 10,
    engagementLike: settings.engagement?.like === true,
    engagementCollect: settings.engagement?.collect === true,
    engagementFollow: settings.engagement?.follow === true,
    dwellMode: settings.dwell?.mode ?? "range",
    fixedDwellSeconds: settings.dwell?.fixedSeconds ?? 30,
    dwellMinSeconds: settings.dwell?.minSeconds ?? 10,
    dwellTypicalSeconds: settings.dwell?.typicalSeconds ?? 20,
    dwellMaxSeconds: settings.dwell?.maxSeconds ?? 30,
    bilibiliBatchMinSeconds: settings.bilibiliBatchDelay?.minSeconds ?? 5,
    bilibiliBatchMaxSeconds: settings.bilibiliBatchDelay?.maxSeconds ?? 12,
    targetMode: settings.target?.mode ?? "time",
    targetDurationMinutes: settings.target?.durationMinutes ?? 60,
    targetMaxItems: settings.target?.maxItems ?? 100,
    keepSystemAwake: settings.keepSystemAwake !== false,
    markRejectedNotInterested: settings.markRejectedNotInterested !== false,
    dryRun: Boolean(settings.dryRun),
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
  score: number | "";
  audience: string;
  keywords: string[];
  enabled?: boolean;
}

export interface RuleSettings {
  version?: number;
  platform?: string;
  includeLive: boolean;
  includeDigital?: boolean;
  hard: {
    minVideoDurationSeconds: number | "";
    minVideoLikes: number | "";
    preferredVideoLikes: number | "";
    minFollowers: number | "";
    maxFollowers: number | "";
    minPlays?: number | "";
    rejectPlaysBelow?: number | "";
    earlyPlayWindowDays?: number | "";
  };
  lowFollowerNewAccount: {
    enabled: boolean;
    maxVideos: number | "";
    minAverageLikes: number | "";
    requireCompleteWorksList: boolean;
  };
  positiveCategories: CategoryRule[];
  gameBlacklist: string[];
  contentBlacklist?: string[];
  excludeTnames?: string[];
  feiguaKeywords: string[];
  xingtuKeywords: string[];
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
  feiguaKeywords: [...FEIGUA_KEYWORDS],
  xingtuKeywords: [...XINGTU_KEYWORDS],
  riskGroups: []
};

export function rulesDraft(value: unknown): RuleSettings {
  const source = value && typeof value === "object" ? value as Partial<RuleSettings> & Record<string, unknown> : {};
  const hard = source.hard && typeof source.hard === "object" ? source.hard as Record<string, unknown> : FALLBACK_RULES.hard;
  const lowFollower = source.lowFollowerNewAccount && typeof source.lowFollowerNewAccount === "object"
    ? source.lowFollowerNewAccount
    : FALLBACK_RULES.lowFollowerNewAccount;
  const categories = Array.isArray(source.positiveCategories) ? source.positiveCategories : [];
  const isBilibili = source.platform === "bilibili";
  return {
    ...source,
    version: Number(source.version || FALLBACK_RULES.version),
    includeLive: false,
    includeDigital: source.includeDigital === true,
    hard: {
      minVideoDurationSeconds: Number(hard.minVideoDurationSeconds ?? FALLBACK_RULES.hard.minVideoDurationSeconds),
      minVideoLikes: Number(hard.minVideoLikes ?? FALLBACK_RULES.hard.minVideoLikes),
      preferredVideoLikes: Number(hard.preferredVideoLikes ?? FALLBACK_RULES.hard.preferredVideoLikes),
      minFollowers: hard.minFollowers == null ? "" : Number(hard.minFollowers ?? FALLBACK_RULES.hard.minFollowers),
      maxFollowers: hard.maxFollowers == null ? "" : Number(hard.maxFollowers ?? FALLBACK_RULES.hard.maxFollowers),
      ...(isBilibili ? {
        minPlays: Number(hard.minPlays ?? 100000),
        rejectPlaysBelow: Number(hard.rejectPlaysBelow ?? 10000),
        earlyPlayWindowDays: Number(hard.earlyPlayWindowDays ?? 3)
      } : {})
    },
    lowFollowerNewAccount: {
      enabled: isBilibili ? lowFollower.enabled === true : lowFollower.enabled !== false,
      maxVideos: Number(lowFollower.maxVideos ?? FALLBACK_RULES.lowFollowerNewAccount.maxVideos),
      minAverageLikes: Number(lowFollower.minAverageLikes ?? FALLBACK_RULES.lowFollowerNewAccount.minAverageLikes),
      requireCompleteWorksList: isBilibili ? lowFollower.requireCompleteWorksList === true : lowFollower.requireCompleteWorksList !== false
    },
    positiveCategories: categories.length ? categories.map((category) => ({
      id: String(category.id || ""),
      name: String(category.name || ""),
      score: Number(category.score || 0),
      audience: String(category.audience || ""),
      keywords: Array.isArray(category.keywords) ? category.keywords.map(String) : [],
      enabled: category.enabled !== false
    })) : FALLBACK_RULES.positiveCategories,
    gameBlacklist: Array.isArray(source.gameBlacklist) ? source.gameBlacklist.map(String) : [],
    contentBlacklist: Array.isArray(source.contentBlacklist) ? source.contentBlacklist.map(String) : [],
    excludeTnames: Array.isArray(source.excludeTnames) ? source.excludeTnames.map(String) : [],
    feiguaKeywords: Array.isArray(source.feiguaKeywords) ? source.feiguaKeywords.map(String).filter(Boolean) : [...FEIGUA_KEYWORDS],
    xingtuKeywords: Array.isArray(source.xingtuKeywords) ? source.xingtuKeywords.map(String).filter(Boolean) : [...XINGTU_KEYWORDS],
    riskGroups: Array.isArray(source.riskGroups) ? source.riskGroups : []
  };
}
