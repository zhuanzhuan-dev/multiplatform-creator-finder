import { sourcePlatformLabel } from "../../lib/source-platform.js";
import { canResumeRun, elapsedRunMs } from "../../lib/run-limits.js";
import { useState } from "react";
import { NumberInput, inputNumber } from "../shared/NumberInput";
import { decisionMeta, formatDuration, formatLocalDateTime, formatRelativeTime } from "./format";
import { RadarDisplay } from "./RadarDisplay";
import type { CategoryRule, Decision, CloudState, RuleSettings, RunState, SettingsDraft, Snapshot, Stats } from "./types";

const STATUS_LABELS: Record<string, string> = {
  idle: "未启动",
  starting: "启动中",
  running: "运行中",
  paused: "已暂停",
  stopped: "已停止"
};

const COLLAPSED_DECISION_COUNT = 5;

function runningTime(state: RunState, now: number): string {
  return formatDuration(elapsedRunMs(state, now));
}

function targetProgress(state: RunState): string {
  const target = state.runTarget;
  const scanned = Number(state.stats?.scanned || 0);
  if (!target) return `第 ${scanned} 条`;
  if (target.mode === "time") return `${target.durationMinutes} 分钟`;
  if (target.mode === "count") return `${scanned}/${target.maxItems} 条`;
  return `${scanned}/${target.maxItems} 条 · ${target.durationMinutes} 分`;
}

interface RunOverviewProps {
  state: RunState;
  cloud?: CloudState;
  outboxCount: number;
  schedule?: Snapshot["schedule"];
  now: number;
  busyAction: string;
  startDisabled?: boolean;
  onStart(): void;
  onResume(): void;
  onPause(): void;
  onStop(): void;
}

export function RunOverview({ state, cloud, outboxCount, schedule, now, busyAction, startDisabled, onStart, onResume, onPause, onStop }: RunOverviewProps) {
  const active = state.status === "starting" || state.status === "running";
  const resumable = canResumeRun(state);
  const uploadHealth = cloud?.connected ? outboxCount > 0 ? `待同步 ${outboxCount} 条` : "同步正常" : "研究台未连接";
  const phaseLabels: Record<string, string> = { read: "读取视频", profile: "读取达人", dwell: "等待切换", submit: "保存结果", transition: "切换视频", idle: "准备下一条" };
  const runtimeHealth = state.runtime?.deadlineAt && now > state.runtime.deadlineAt + 15_000
    ? "当前步骤超时，等待自动恢复"
    : phaseLabels[state.runtime?.phase || ""] || "准备运行";
  const health = state.status === "paused"
      ? state.pauseReason || state.lastError || "等待继续"
    : state.status === "starting"
      ? state.startupStage || "正在绑定当前标签页"
      : state.status === "running"
        ? `${runtimeHealth} · ${uploadHealth}`
        : `等待开始 · ${uploadHealth}`;
  const visibilityLabels: Record<string, string> = { visible: "前台运行", hidden: "后台运行", loading: "加载中", unknown: "状态未知" };
  const tabModeLabels: Record<string, string> = { "current-tab": "当前标签页", "scheduled-tab": "定时任务页" };
  const backgroundHealth = tabModeLabels[state.backgroundMode || ""]
    ? `${state.route?.label || "抖音推荐"}｜${tabModeLabels[state.backgroundMode || ""]}｜${visibilityLabels[state.pageVisibility || ""] || state.pageVisibility || "等待检测"}`
    : state.startupStage || "—";

  return (
    <section className="run-card" aria-labelledby="runCardTitle">
      <h2 id="runCardTitle" className="visually-hidden">本轮运行状态</h2>
      <div className="run-summary">
        <RadarDisplay state={state} />
        <div className={`run-fact run-time ${state.status || "idle"}`}><strong>{runningTime(state, now)}</strong><span>{active ? "本轮运行时长" : "本轮已运行"}</span></div>
        <div className="run-fact"><strong>{state.route?.label || (tabModeLabels[state.backgroundMode || ""] ? "抖音推荐" : "—")}</strong><span>当前来源</span></div>
        <div className="run-fact"><strong>{targetProgress(state)}</strong><span>任务目标</span></div>
      </div>
      <div className="actions">
        {active
          ? <button className="primary" disabled={Boolean(busyAction) || state.status === "starting"} onClick={onPause}>暂停</button>
          : <button className="primary" disabled={Boolean(busyAction) || startDisabled} onClick={resumable ? onResume : onStart}>{busyAction === "resume" ? "恢复中…" : busyAction === "start" ? "启动中…" : resumable ? "继续本轮" : state.runId ? "开始新一轮" : "开始本轮"}</button>}
        <button className="danger-secondary" disabled={Boolean(busyAction) || state.status === "idle" || state.status === "stopped"} onClick={onStop}>停止本轮</button>
      </div>
      <details className="health-details">
        <summary><span className="run-health"><StatusBadge status={state.status} /><span>{health}{state.lastError && !health.includes(state.lastError) ? <span className="health-alert">最近异常：{state.lastError}</span> : null}</span></span><span className="detail-action">查看详情</span></summary>
        <dl className="mini-details">
          {state.engagement && (state.engagement.policy.like || state.engagement.policy.collect || state.engagement.policy.follow) ? <>
            <div><dt>本轮互动上限</dt><dd>{state.engagement.policy.rate}% · 已处理 {state.engagement.videos} 条普通视频</dd></div>
            {([['like', '点赞'], ['collect', '收藏'], ['follow', '关注']] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{state.engagement?.policy[key] ? `${state.engagement.sent[key] || 0} 次按键已发送 · 配额已用 ${state.engagement.used[key] || 0} / ${Math.floor(state.engagement.videos * state.engagement.policy.rate / 100)}` : "未启用"}</dd></div>)}
            {state.engagement.lastResult ? <div><dt>最近互动</dt><dd>{state.engagement.lastResult}</dd></div> : null}
          </> : null}
          <div><dt>同步方式</dt><dd>后台独立同步，暂停找号后继续处理队列</dd></div>
          <div><dt>待同步记录</dt><dd>{outboxCount} 条</dd></div>
          <div><dt>本轮已同步</dt><dd>{state.stats?.uploaded || 0} 条</dd></div>
          <div><dt>下次定时</dt><dd>{schedule?.enabled ? formatLocalDateTime(schedule.nextRunAt) : "已停用"}</dd></div>
          <div><dt>定时结果</dt><dd>{schedule?.lastResult ? `${formatLocalDateTime(schedule.lastRunAt)}｜${schedule.lastResult}` : "—"}</dd></div>
          <div><dt>暂停原因</dt><dd>{state.pauseReason || "—"}</dd></div>
          <div><dt>具体错误</dt><dd>{state.lastError || "—"}</dd></div>
          <div><dt>运行页面</dt><dd>{backgroundHealth}</dd></div>
        </dl>
      </details>
    </section>
  );
}

export function RecentDecisions({ now, history = [], total = 0 }: { now: number; history?: Decision[]; total?: number }) {
  const decisions = history;
  const visibleDecisions = decisions.slice(0, COLLAPSED_DECISION_COUNT);
  const openDecisionHistory = () => chrome.tabs.create({ url: chrome.runtime.getURL("decisions/index.html") });
  return (
    <section className="decision-section" aria-labelledby="decisionTitle">
      <div className="section-heading"><h2 id="decisionTitle">最近记录</h2><span className="section-meta">近 24 小时 · 最近 {visibleDecisions.length} 条</span></div>
      <div className="decision-list" id="recentDecisionList">
        {decisions.length === 0 ? <p className="empty-state">开始运行后，这里会显示最近处理的账号。</p> : visibleDecisions.map((decision, index) => {
          const meta = decisionMeta(decision.code);
          return (
            <article className="decision-row" key={`${decision.occurredAt || "decision"}-${index}`}>
              {decision.avatarUrl ? <DecisionAvatar url={decision.avatarUrl} name={decision.accountName} /> : null}
              <div className="decision-copy">
                <div className="decision-main"><span className="decision-name">{decision.accountName || "未识别账号"}</span><span className={`decision-label ${meta.tone}`}>{meta.label}</span></div>
                <div className="decision-reason"><span className="decision-source">{sourcePlatformLabel(decision.sourcePlatform)} · </span>{decision.reasons?.length ? decision.reasons.join(" · ") : decision.code || "已完成判断"}</div>
              </div>
              <time className="decision-time" dateTime={decision.occurredAt || ""}>{formatRelativeTime(decision.occurredAt, now)}</time>
            </article>
          );
        })}
      </div>
      {decisions.length > 0 ? (
        <button
          className="decision-toggle"
          type="button"
          onClick={() => void openDecisionHistory()}
        >
          查看近 24 小时记录（{total}）
        </button>
      ) : null}
    </section>
  );
}

function DecisionAvatar({ url, name }: { url: string; name?: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? null : <img className="decision-avatar" src={url} alt={`${name || "账号"}头像`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function stat(stats: Stats, key: keyof Stats): number {
  return Number(stats[key] || 0);
}

export function StatsOverview({ state, now, daily, history, historyTotal }: { state: RunState; now: number; daily?: Snapshot["daily"]; history?: Decision[]; historyTotal?: number }) {
  const stats = state.stats || {};
  return (
    <section className="stats-section" aria-labelledby="statsTitle">
      <div className="section-heading"><h2 id="statsTitle">{state.status === "stopped" ? "本轮已结束" : "本轮结果"}</h2><span className="section-meta" title="按北京时间统计，当天同一内容只计一次；保存在当前浏览器">今日已刷 <strong>{daily?.date === new Date(now + 8 * 3600000).toISOString().slice(0, 10) ? daily.scanned : 0}</strong></span></div>
      <dl className="primary-stats">
        <div><dt title="通过初筛的内容次数，包含需人工确认和重复发现">符合条件</dt><dd><strong>{stat(stats, "matched")}</strong></dd></div>
        <div><dt>新发现账号</dt><dd><strong>{stat(stats, "newCreators")}</strong></dd></div>
        <div className={stat(stats, "reviewQueued") > 0 ? "review" : "neutral"}><dt title="本轮新发现中需要人工确认的账号数，非实时待办数">需人工确认</dt><dd><strong>{stat(stats, "reviewQueued")}</strong></dd></div>
      </dl>
      <details className="stats-details">
        <summary>
          <span className="stats-throughput"><span>本轮已刷 <strong>{stat(stats, "scanned")}</strong></span></span>
          <span className="stats-detail-action"><span className="when-closed">过程明细</span><span className="when-open">收起明细</span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></span>
        </summary>
        <dl className="stats-breakdown">
          <div><dt>重复发现</dt><dd>{stat(stats, "duplicates")}</dd></div>
          <div><dt>已标记不感兴趣</dt><dd>{stat(stats, "notInterested")}</dd></div>
          <div><dt>跳过直播</dt><dd>{stat(stats, "liveSkipped")}</dd></div>
          <div><dt>跳过图文</dt><dd>{stat(stats, "photoSkipped")}</dd></div>
          <div><dt>跳过广告</dt><dd>{stat(stats, "adSkipped")}</dd></div>
          <div><dt>类型未确认</dt><dd>{stat(stats, "unknownSkipped")}</dd></div>
          <div><dt>账号资料读取失败</dt><dd>{stat(stats, "panelSkipped")}</dd></div>
        </dl>
      </details>
      <RecentDecisions now={now} history={history} total={historyTotal} />
    </section>
  );
}

interface CloudPanelProps {
  snapshot: Snapshot;
  checking: boolean;
  onCheck(): void;
  onConnect(): void;
  onDisconnect(): void;
}

export function CloudPanel({ snapshot, checking, onCheck, onConnect, onDisconnect }: CloudPanelProps) {
  const cloud = snapshot.cloud || {};
  const pending = cloud.pairing?.status === "pending" && Boolean(cloud.pairing.code);
  return (
    <section className="cloud-panel" aria-label="研究台连接">
      <strong>{pending ? "等待研究台授权" : cloud.expired ? "请重新登录并连接" : cloud.connected ? "研究台已连接" : "登录并连接研究台"}</strong>
      <p className="field-note">{pending ? "请在已打开的研究台页面登录并确认授权，完成后这里会自动更新。" : cloud.connected ? `发现结果会自动同步到研究台，当前待同步 ${snapshot.outboxCount || 0} 条。` : "首次使用请完成登录授权，连接成功后即可开始找号。"}</p>
      {cloud.connected && !pending ? <div className="account-identity">
        <strong>{cloud.account?.name || cloud.account?.email || "已连接账号"}</strong>
        {cloud.account?.name && cloud.account.email ? <span>{cloud.account.email}</span> : null}
        {!cloud.account?.name && !cloud.account?.email ? <span>账号 ID：{cloud.userId || "暂未返回"}</span> : null}
      </div> : null}
      <div className="bridge-actions">
        <button className={cloud.connected ? "" : "primary"} disabled={checking} onClick={onConnect}>{pending ? "重新打开授权页" : cloud.connected ? "切换账号" : cloud.expired ? "重新登录并连接" : "登录并连接研究台"}</button>
        {cloud.connected ? <button disabled={checking} onClick={onCheck}>{checking ? "检测中…" : "检测连接"}</button> : null}
        {pending || cloud.connected ? <button className="danger-text" onClick={onDisconnect}>{pending ? "取消连接" : "断开连接"}</button> : null}
      </div>
    </section>
  );
}

interface SettingsPanelProps {
  draft: SettingsDraft;
  disabled: boolean;
  onChange(next: SettingsDraft): void;
  onSave(): void;
  saveStatus: string;
}

export function SettingsPanel({ draft, disabled, onChange, onSave, saveStatus }: SettingsPanelProps) {
  const number = (key: keyof SettingsDraft) => (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...draft, [key]: inputNumber(event.target.value) });
  };
  const checkbox = (key: keyof SettingsDraft) => (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...draft, [key]: event.target.checked });
  };
  const toggleWeekday = (day: number) => {
    const next = draft.scheduleWeekdays.includes(day)
      ? draft.scheduleWeekdays.filter((value) => value !== day)
      : [...draft.scheduleWeekdays, day].sort();
    onChange({ ...draft, scheduleWeekdays: next });
  };
  const changeTime = (index: number, value: string) => {
    const times = draft.scheduleTimes.map((time, position) => position === index ? value : time);
    onChange({ ...draft, scheduleTimes: [...new Set(times)].sort() });
  };
  const removeTime = (index: number) => onChange({ ...draft, scheduleTimes: draft.scheduleTimes.filter((_, position) => position !== index) });
  const applyPreset = () => onChange({
    ...draft,
    scheduleEnabled: true,
    scheduleWeekdays: [2, 3, 4, 5, 6],
    scheduleTimes: ["11:15", "13:30", "16:00", "18:00", "20:00", "23:00"],
    scheduleTargetMode: "time",
    scheduleDurationMinutes: 60,
    scheduleMaxItems: 100,
    scheduleReuseExistingTab: true,
    scheduleLateToleranceMinutes: 10
  });
  return (
    <div className="settings-disclosure">
      <div className="disclosure-body">
        <section className="setting-group" aria-labelledby="dwellSettingTitle">
          <div className="setting-heading"><strong id="dwellSettingTitle">单条停留</strong><span>通过筛选的视频按此停留，淘汰内容、图文和直播快速跳过</span></div>
          <div className="segmented" aria-label="停留模式">
            <button className={draft.dwellMode === "fixed" ? "selected" : ""} disabled={disabled} onClick={() => onChange({ ...draft, dwellMode: "fixed" })}>固定时长</button>
            <button className={draft.dwellMode === "range" ? "selected" : ""} disabled={disabled} onClick={() => onChange({ ...draft, dwellMode: "range" })}>随机区间</button>
          </div>
          {draft.dwellMode === "fixed" ? (
            <div className="form-grid one-field"><label>每条停留（秒）<NumberInput min="5" max="300" value={draft.fixedDwellSeconds} disabled={disabled} onChange={number("fixedDwellSeconds")} /></label></div>
          ) : (
            <div className="form-grid three-fields">
              <label>最短（秒）<NumberInput min="5" max="300" value={draft.dwellMinSeconds} disabled={disabled} onChange={number("dwellMinSeconds")} /></label>
              <label>中心（秒）<NumberInput min="5" max="300" value={draft.dwellTypicalSeconds} disabled={disabled} onChange={number("dwellTypicalSeconds")} /></label>
              <label>最长（秒）<NumberInput min="5" max="300" value={draft.dwellMaxSeconds} disabled={disabled} onChange={number("dwellMaxSeconds")} /></label>
            </div>
          )}
          <button className="preset-button" disabled={disabled} onClick={() => onChange({ ...draft, dwellMode: "range", dwellMinSeconds: 10, dwellTypicalSeconds: 20, dwellMaxSeconds: 30 })}>应用随机预设</button>
          <p className="field-note">随机区间采用截断正态分布，在上下限之间连续取值，多数接近中心。默认 10–30 秒、中心 20 秒；随机节奏无法保证避免平台风控。</p>
        </section>

        <section className="setting-group" aria-labelledby="targetSettingTitle">
          <div className="setting-heading"><strong id="targetSettingTitle">任务目标</strong><span>达到任一启用条件即停止</span></div>
          <p className="field-note">继续本轮会沿用原目标，暂停时间不计入时长。修改后的目标在新一轮生效。</p>
          <div className="form-grid">
            <label>停止方式<select value={draft.targetMode} disabled={disabled} onChange={(event) => onChange({ ...draft, targetMode: event.target.value as SettingsDraft["targetMode"] })}><option value="time">按时间</option><option value="count">按视频数</option><option value="both">双重限制</option></select></label>
            {draft.targetMode !== "count" ? <label>运行时长（分钟）<NumberInput min="1" max="1440" step="1" value={draft.targetDurationMinutes} disabled={disabled} onChange={number("targetDurationMinutes")} /></label> : null}
            {draft.targetMode !== "time" ? <label>视频数量（条）<NumberInput min="1" max="5000" step="1" value={draft.targetMaxItems} disabled={disabled} onChange={number("targetMaxItems")} /></label> : null}
          </div>
        </section>

        <section className="setting-group" aria-labelledby="scheduleSettingTitle">
          <div className="setting-heading inline-heading"><span><strong id="scheduleSettingTitle">定时任务</strong><small>到点自动创建或复用抖音任务页</small></span><input aria-label="启用定时任务" type="checkbox" checked={draft.scheduleEnabled} disabled={disabled} onChange={checkbox("scheduleEnabled")} /></div>
          <div className={`schedule-editor ${draft.scheduleEnabled ? "" : "disabled"}`}>
            <div className="weekday-picker" aria-label="执行星期">
              {["日", "一", "二", "三", "四", "五", "六"].map((label, day) => <button key={label} className={draft.scheduleWeekdays.includes(day) ? "selected" : ""} disabled={disabled || !draft.scheduleEnabled} onClick={() => toggleWeekday(day)}>周{label}</button>)}
            </div>
            <div className="time-list">
              {draft.scheduleTimes.map((time, index) => <div className="time-row" key={`${time}-${index}`}><input aria-label={`执行时间 ${index + 1}`} type="time" value={time} disabled={disabled || !draft.scheduleEnabled} onChange={(event) => changeTime(index, event.target.value)} /><button aria-label={`删除 ${time}`} disabled={disabled || !draft.scheduleEnabled || draft.scheduleTimes.length <= 1} onClick={() => removeTime(index)}>×</button></div>)}
              <button className="add-time" disabled={disabled || !draft.scheduleEnabled} onClick={() => onChange({ ...draft, scheduleTimes: [...draft.scheduleTimes, "09:00"] })}>＋ 添加时间</button>
            </div>
            <div className="form-grid">
              <label>任务目标<select value={draft.scheduleTargetMode} disabled={disabled || !draft.scheduleEnabled} onChange={(event) => onChange({ ...draft, scheduleTargetMode: event.target.value as SettingsDraft["scheduleTargetMode"] })}><option value="time">按时间</option><option value="count">按视频数</option><option value="both">双重限制</option></select></label>
              {draft.scheduleTargetMode !== "count" ? <label>运行时长（分钟）<NumberInput min="1" max="1440" step="1" value={draft.scheduleDurationMinutes} disabled={disabled || !draft.scheduleEnabled} onChange={number("scheduleDurationMinutes")} /></label> : null}
              {draft.scheduleTargetMode !== "time" ? <label>视频数量（条）<NumberInput min="1" max="5000" step="1" value={draft.scheduleMaxItems} disabled={disabled || !draft.scheduleEnabled} onChange={number("scheduleMaxItems")} /></label> : null}
              <label>允许延迟启动（分钟）<NumberInput aria-describedby="scheduleDelayHelp" min="0" max="60" value={draft.scheduleLateToleranceMinutes} disabled={disabled || !draft.scheduleEnabled} onChange={number("scheduleLateToleranceMinutes")} /></label>
            </div>
            <p className="field-note" id="scheduleDelayHelp">定时触发晚于计划时，在此时间内仍可启动；超过则跳过本次任务。</p>
            <label className="check"><input type="checkbox" checked={draft.scheduleReuseExistingTab} disabled={disabled || !draft.scheduleEnabled} onChange={checkbox("scheduleReuseExistingTab")} />优先复用插件创建的抖音任务页</label>
            <button className="preset-button" disabled={disabled} onClick={applyPreset}>应用默认预设</button>
          </div>
        </section>

        <div className="form-grid compact-options">
          <label className="check"><input type="checkbox" checked={draft.keepSystemAwake} disabled={disabled} onChange={checkbox("keepSystemAwake")} />运行期间保持系统唤醒</label>
          <label className="check"><input type="checkbox" checked={draft.markRejectedNotInterested} disabled={disabled} onChange={checkbox("markRejectedNotInterested")} />淘汰内容后标记为不感兴趣</label>
          <p className="field-note shortcut-note">通过抖音网页的 R 快捷键执行。</p>

        </div>
        <div className="settings-actions">
          <button className="primary compact" disabled={disabled} onClick={onSave}>保存设置</button>
          <p className="field-note" role="status">{saveStatus}</p>
        </div>
      </div>
    </div>
  );
}

interface AdvancedRulesPanelProps {
  draft: RuleSettings;
  disabled: boolean;
  onChange(next: RuleSettings): void;
  onSave(): void;
  engagement: React.ReactNode;
}

function terms(value: string): string[] {
  return [...new Set(value.split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean))];
}

export function AdvancedRulesPanel({ draft, disabled, onChange, onSave, engagement }: AdvancedRulesPanelProps) {
  const setHard = (key: keyof RuleSettings["hard"]) => (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...draft, hard: { ...draft.hard, [key]: inputNumber(event.target.value) } });
  };
  const setLowFollower = (key: keyof RuleSettings["lowFollowerNewAccount"], value: number | "" | boolean) => {
    onChange({ ...draft, lowFollowerNewAccount: { ...draft.lowFollowerNewAccount, [key]: value } });
  };
  const updateCategory = (index: number, patch: Partial<CategoryRule>) => {
    onChange({
      ...draft,
      positiveCategories: draft.positiveCategories.map((category, position) => position === index ? { ...category, ...patch } : category)
    });
  };
  const removeCategory = (index: number) => {
    onChange({ ...draft, positiveCategories: draft.positiveCategories.filter((_, position) => position !== index) });
  };
  const addCategory = () => {
    const used = new Set(draft.positiveCategories.map((category) => category.id));
    let index = draft.positiveCategories.length + 1;
    while (used.has(`custom-${index}`)) index += 1;
    onChange({
      ...draft,
      positiveCategories: [...draft.positiveCategories, {
        id: `custom-${index}`,
        name: "新类目",
        score: 10,
        audience: "待填写",
        keywords: [],
        enabled: true
      }]
    });
  };

  return (
    <div className="rules-disclosure">
      <div className="disclosure-body rules-form">
        <section className="setting-group" aria-labelledby="feiguaRulesTitle">
          <div className="setting-heading"><strong id="feiguaRulesTitle">飞瓜视频库</strong><span>按账号去重与排除</span></div>
          <label>飞瓜规避词<textarea rows={3} aria-describedby="feiguaRulesHelp" value={draft.feiguaKeywords.join("、")} disabled={disabled} onChange={(event) => onChange({ ...draft, feiguaKeywords: terms(event.target.value) })} /></label>
          <p id="feiguaRulesHelp" className="field-note">先在飞瓜设置筛选条件，再开始自动采集与翻页。标题、话题、热词或昵称命中任一规避词时，移除本轮整个账号。暂停保留候选；到达末页、目标或点击结束后汇总上传。规避词在开始本轮时生效；以下视频、账号及互动规则用于抖音推荐流。</p>
        </section>
        <section className="setting-group" aria-labelledby="hardRulesTitle">
          <div className="setting-heading"><strong id="hardRulesTitle">视频与账号条件</strong><span>先判断视频，再判断达人</span></div>
          <div className="form-grid">
            <label>最短视频（秒）<NumberInput min="1" value={draft.hard.minVideoDurationSeconds} disabled={disabled} onChange={setHard("minVideoDurationSeconds")} /></label>
            <label>最低点赞<NumberInput min="0" value={draft.hard.minVideoLikes} disabled={disabled} onChange={setHard("minVideoLikes")} /></label>
            <label>优选点赞<NumberInput min="0" value={draft.hard.preferredVideoLikes} disabled={disabled} onChange={setHard("preferredVideoLikes")} /></label>
            <label>最低粉丝<NumberInput min="0" value={draft.hard.minFollowers} disabled={disabled} onChange={setHard("minFollowers")} /></label>
            <label>最高粉丝<NumberInput min="0" value={draft.hard.maxFollowers} disabled={disabled} onChange={setHard("maxFollowers")} /></label>
          </div>
          <p className="field-note">仅筛选普通视频。直播（含图文直播）、图文、广告及类型未确认的内容会自动跳过。</p>
        </section>

        <section className="setting-group" aria-labelledby="newAccountRulesTitle">
          <div className="setting-heading inline-heading">
            <span><strong id="newAccountRulesTitle">低粉新号例外</strong><small>低于粉丝下限时，满足以下条件仍可交给人工确认</small></span>
            <input aria-label="启用低粉新号例外" type="checkbox" checked={draft.lowFollowerNewAccount.enabled} disabled={disabled} onChange={(event) => setLowFollower("enabled", event.target.checked)} />
          </div>
          <div className={`form-grid ${draft.lowFollowerNewAccount.enabled ? "" : "disabled-fields"}`}>
            <label>最多作品数<NumberInput min="1" step="1" value={draft.lowFollowerNewAccount.maxVideos} disabled={disabled || !draft.lowFollowerNewAccount.enabled} onChange={(event) => setLowFollower("maxVideos", inputNumber(event.target.value))} /></label>
            <label>最低平均点赞<NumberInput min="0" value={draft.lowFollowerNewAccount.minAverageLikes} disabled={disabled || !draft.lowFollowerNewAccount.enabled} onChange={(event) => setLowFollower("minAverageLikes", inputNumber(event.target.value))} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={draft.lowFollowerNewAccount.requireCompleteWorksList} disabled={disabled || !draft.lowFollowerNewAccount.enabled} onChange={(event) => setLowFollower("requireCompleteWorksList", event.target.checked)} />要求作品列表完整加载</label>
        </section>

        <section className="setting-group" aria-labelledby="categoryRulesTitle">
          <div className="setting-heading"><strong id="categoryRulesTitle">想找的内容</strong><span>启用 {draft.positiveCategories.filter((item) => item.enabled !== false).length} / {draft.positiveCategories.length}</span></div>
          <p className="field-note">按视频描述、话题及账号资料中的关键词初筛。未匹配类别但满足其他条件的账号，仍保存为候选，交给人工确认。</p>
          {engagement}
          <div className="category-list">
            {draft.positiveCategories.map((category, index) => (
              <details className="category-editor" key={category.id}>
                <summary>
                  <span className={`category-dot ${category.enabled === false ? "off" : ""}`} aria-hidden="true" />
                  <span><strong>{category.name}</strong><small>{category.keywords.length} 个关键词 · +{category.score} 分</small></span>
                </summary>
                <div className="category-fields">
                  <label className="check"><input type="checkbox" checked={category.enabled !== false} disabled={disabled} onChange={(event) => updateCategory(index, { enabled: event.target.checked })} />启用这个类目</label>
                  <div className="form-grid">
                    <label>类目名称<input type="text" value={category.name} disabled={disabled} onChange={(event) => updateCategory(index, { name: event.target.value })} /></label>
                    <label>命中加分<NumberInput min="0" max="100" value={category.score} disabled={disabled} onChange={(event) => updateCategory(index, { score: inputNumber(event.target.value) })} /></label>
                  </div>
                  <label>受众描述<input type="text" value={category.audience} disabled={disabled} onChange={(event) => updateCategory(index, { audience: event.target.value })} /></label>
                  <label>关键词<textarea rows={3} value={category.keywords.join("、")} disabled={disabled} placeholder="美食、探店、烹饪" onChange={(event) => updateCategory(index, { keywords: terms(event.target.value) })} /></label>
                  <button className="danger-text compact category-remove" disabled={disabled || draft.positiveCategories.length <= 1} onClick={() => removeCategory(index)}>删除这个类目</button>
                </div>
              </details>
            ))}
          </div>
          <button className="add-category" disabled={disabled} onClick={addCategory}>＋ 添加内容类别</button>
        </section>

        <section className="setting-group" aria-labelledby="blacklistRulesTitle">
          <div className="setting-heading"><strong id="blacklistRulesTitle">不需要的内容</strong><span>包含排除词时跳过</span></div>
          <label>排除关键词<textarea rows={3} value={draft.gameBlacklist.join("、")} disabled={disabled} placeholder="和平精英、我的世界" onChange={(event) => onChange({ ...draft, gameBlacklist: terms(event.target.value) })} /></label>
          <p className="field-note">适用于任何不需要的内容，使用逗号、顿号或换行分隔。匹配视频描述、话题及账号简介、作品文字等可读取信息中的关键词，不仅限于话题标签。排除条件优先。</p>
        </section>

        <button className="primary compact save-rules" disabled={disabled} onClick={onSave}>保存规则</button>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status?: string }) {
  return <span className={`badge ${status || ""}`}>{STATUS_LABELS[status || ""] || status || "未知"}</span>;
}
