import { useEffect, useState } from "react";
import { decisionMeta, decisionsFor, formatDuration, formatLocalDateTime, formatRelativeTime } from "./format";
import { RadarDisplay } from "./RadarDisplay";
import type { CategoryRule, CloudState, RuleSettings, RunState, SettingsDraft, Snapshot, Stats } from "./types";

const STATUS_LABELS: Record<string, string> = {
  idle: "未启动",
  starting: "启动中",
  running: "运行中",
  paused: "已暂停",
  stopped: "已停止"
};

const COLLAPSED_DECISION_COUNT = 5;

function runningTime(state: RunState, now: number): string {
  const startedAt = Date.parse(state.startedAt || "");
  if (!Number.isFinite(startedAt)) return "00:00:00";
  const active = state.status === "starting" || state.status === "running";
  const recordedEnd = Date.parse(state.endedAt || state.lastTickAt || "");
  const endAt = active ? now : Number.isFinite(recordedEnd) ? recordedEnd : startedAt;
  return formatDuration(endAt - startedAt);
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
  now: number;
  busyAction: string;
  onStart(): void;
  onPause(): void;
  onStop(): void;
}

export function RunOverview({ state, cloud, outboxCount, now, busyAction, onStart, onPause, onStop }: RunOverviewProps) {
  const active = state.status === "starting" || state.status === "running";
  const uploadHealth = cloud?.connected ? outboxCount > 0 ? `待上传 ${outboxCount} 条` : "上传正常" : "研究台未连接";
  const phaseLabels: Record<string, string> = { read: "读取视频", profile: "读取达人", dwell: "等待切换", submit: "保存结果", transition: "切换视频", idle: "准备下一条" };
  const runtimeHealth = state.runtime?.deadlineAt && now > state.runtime.deadlineAt + 15_000
    ? "当前步骤超时，等待自动恢复"
    : phaseLabels[state.runtime?.phase || ""] || "准备运行";
  const health = state.status === "paused"
      ? `已暂停 · ${state.pauseReason || state.lastError || "等待继续"}`
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
          ? <button className="primary" disabled={busyAction === "pause" || state.status === "starting"} onClick={onPause}>暂停</button>
          : <button className="primary" disabled={Boolean(busyAction)} onClick={onStart}>{busyAction === "start" ? "启动中…" : "开始本轮"}</button>}
        <button className="danger-secondary" disabled={Boolean(busyAction) || state.status === "idle" || state.status === "stopped"} onClick={onStop}>停止本轮</button>
      </div>
      <details className="health-details">
        <summary><span>{health}</span><span className="detail-action">查看详情</span></summary>
        <dl className="mini-details">
          <div><dt>暂停原因</dt><dd>{state.pauseReason || "—"}</dd></div>
          <div><dt>具体错误</dt><dd>{state.lastError || "—"}</dd></div>
          <div><dt>运行页面</dt><dd>{backgroundHealth}</dd></div>
        </dl>
      </details>
    </section>
  );
}

export function RecentDecisions({ state, now }: { state: RunState; now: number }) {
  const decisions = decisionsFor(state);
  const visibleDecisions = decisions.slice(0, COLLAPSED_DECISION_COUNT);
  const openDecisionHistory = () => chrome.tabs.create({ url: chrome.runtime.getURL("decisions/index.html") });
  return (
    <section className="decision-section" aria-labelledby="decisionTitle">
      <div className="section-heading"><h2 id="decisionTitle">最近判断</h2><span className="section-meta">共 {decisions.length} 条</span></div>
      <div className="decision-list" id="recentDecisionList">
        {decisions.length === 0 ? <p className="empty-state">开始运行后，这里会显示最近处理的账号。</p> : visibleDecisions.map((decision, index) => {
          const meta = decisionMeta(decision.code);
          return (
            <article className="decision-row" key={`${decision.occurredAt || "decision"}-${index}`}>
              {decision.avatarUrl ? <DecisionAvatar url={decision.avatarUrl} name={decision.accountName} /> : null}
              <div className="decision-copy">
                <div className="decision-main"><span className="decision-name">{decision.accountName || "未识别账号"}</span><span className={`decision-label ${meta.tone}`}>{meta.label}</span></div>
                <div className="decision-reason">{decision.reasons?.length ? decision.reasons.join(" · ") : decision.code || "已完成判断"}</div>
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
          在完整页面查看（{decisions.length}）
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

export function StatsOverview({ state, now }: { state: RunState; now: number }) {
  const stats = state.stats || {};
  return (
    <section className="stats-section" aria-labelledby="statsTitle">
      <div className="section-heading"><h2 id="statsTitle">运行概览</h2><span className="section-meta">{state.lastTickAt ? `${formatRelativeTime(state.lastTickAt, now)}更新` : "等待更新"}</span></div>
      <div className="primary-stats">
        <div><span>规则命中</span><strong>{stat(stats, "matched")}</strong><small>本轮累计</small></div>
        <div><span>新增账号</span><strong>{stat(stats, "newCreators")}</strong><small>本轮累计</small></div>
        <div className="review"><span>需复核入表</span><strong>{stat(stats, "reviewQueued")}</strong><small>待处理</small></div>
      </div>
      <div className="compact-stats">
        <div><span>已刷视频</span><strong>{stat(stats, "scanned")}</strong></div>
        <div><span>去重拦截</span><strong>{stat(stats, "duplicates")}</strong></div>
        <div><span>已标记不感兴趣</span><strong>{stat(stats, "notInterested")}</strong></div>
        <div><span>跳过直播</span><strong>{stat(stats, "liveSkipped")}</strong></div>
        <div><span>侧栏失败跳过</span><strong>{stat(stats, "panelSkipped")}</strong></div>
        <div><span>已上传观察</span><strong>{stat(stats, "uploaded")}</strong></div>
      </div>
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
  const [open, setOpen] = useState(Boolean(pending));
  useEffect(() => { if (pending) setOpen(true); }, [pending]);
  const status = pending ? "等待确认" : cloud.connected ? "已连接" : checking ? "检测中" : "未连接";
  const tone = pending || checking ? "pending" : cloud.connected ? "ready" : "error";
  const summary = pending ? "配对等待确认" : cloud.connected ? `${snapshot.outboxCount || 0} 条待上传` : "连接后自动上传";
  const destination = cloud.destination || snapshot.teamDestination || {};

  return (
    <details className="disclosure" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><span><strong>研究台上传</strong><span className="summary-copy">{summary}</span></span><span className={`connection ${tone}`}>{status}</span></summary>
      <div className="disclosure-body">
        <p className="destination">{destination.name || destination.ingest || "研究台 · No Swipe ingest"}</p>
        <p className="destination-note">平台观察统一上传到研究台；命中账号会进入达人库，视频能力接入后沿用同一数据入口。</p>
        {pending ? <p className="pair-code">{cloud.pairing?.code}</p> : null}
        <div className="bridge-actions">
          <button disabled={checking || !cloud.connected} onClick={onCheck}>{checking ? "检测中…" : "检测连接"}</button>
          <button onClick={onConnect}>{pending || cloud.connected ? "重新连接" : "连接研究台"}</button>
          {pending || cloud.connected ? <button className="danger-text" onClick={onDisconnect}>{pending ? "取消配对" : "断开"}</button> : null}
        </div>
      </div>
    </details>
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
    onChange({ ...draft, [key]: Number(event.target.value) });
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
    <details className="disclosure settings-disclosure">
      <summary><strong>运行设置</strong><span className="summary-copy">停留、目标与定时</span></summary>
      <div className="disclosure-body">
        <section className="setting-group" aria-labelledby="dwellSettingTitle">
          <div className="setting-heading"><strong id="dwellSettingTitle">单条停留</strong><span>控制每条视频的观看节奏</span></div>
          <div className="segmented" aria-label="停留模式">
            <button className={draft.dwellMode === "fixed" ? "selected" : ""} disabled={disabled} onClick={() => onChange({ ...draft, dwellMode: "fixed" })}>固定时长</button>
            <button className={draft.dwellMode === "range" ? "selected" : ""} disabled={disabled} onClick={() => onChange({ ...draft, dwellMode: "range" })}>随机区间</button>
          </div>
          {draft.dwellMode === "fixed" ? (
            <div className="form-grid one-field"><label>每条停留（秒）<input type="number" min="5" max="300" value={draft.fixedDwellSeconds} disabled={disabled} onChange={number("fixedDwellSeconds")} /></label></div>
          ) : (
            <div className="form-grid three-fields">
              <label>最短（秒）<input type="number" min="5" max="300" value={draft.dwellMinSeconds} disabled={disabled} onChange={number("dwellMinSeconds")} /></label>
              <label>中心（秒）<input type="number" min="5" max="300" value={draft.dwellTypicalSeconds} disabled={disabled} onChange={number("dwellTypicalSeconds")} /></label>
              <label>最长（秒）<input type="number" min="5" max="300" value={draft.dwellMaxSeconds} disabled={disabled} onChange={number("dwellMaxSeconds")} /></label>
            </div>
          )}
          <button className="preset-button" disabled={disabled} onClick={() => onChange({ ...draft, dwellMode: "range", dwellMinSeconds: 10, dwellTypicalSeconds: 20, dwellMaxSeconds: 30 })}>应用随机预设</button>
          <p className="field-note">随机区间采用截断正态分布，在上下限之间连续取值，多数接近中心。默认 10–30 秒、中心 20 秒；随机节奏无法保证避免平台风控。</p>
        </section>

        <section className="setting-group" aria-labelledby="targetSettingTitle">
          <div className="setting-heading"><strong id="targetSettingTitle">本轮目标</strong><span>达到任一启用条件即停止</span></div>
          <div className="form-grid">
            <label>停止方式<select value={draft.targetMode} disabled={disabled} onChange={(event) => onChange({ ...draft, targetMode: event.target.value as SettingsDraft["targetMode"] })}><option value="time">按时间</option><option value="count">按视频数</option><option value="both">双重限制</option></select></label>
            {draft.targetMode !== "count" ? <label>运行时长（分钟）<input type="number" min="1" max="1440" value={draft.targetDurationMinutes} disabled={disabled} onChange={number("targetDurationMinutes")} /></label> : null}
            {draft.targetMode !== "time" ? <label>视频数量（条）<input type="number" min="1" max="5000" value={draft.targetMaxItems} disabled={disabled} onChange={number("targetMaxItems")} /></label> : null}
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
              {draft.scheduleTargetMode !== "count" ? <label>运行时长（分钟）<input type="number" min="1" max="1440" value={draft.scheduleDurationMinutes} disabled={disabled || !draft.scheduleEnabled} onChange={number("scheduleDurationMinutes")} /></label> : null}
              {draft.scheduleTargetMode !== "time" ? <label>视频数量（条）<input type="number" min="1" max="5000" value={draft.scheduleMaxItems} disabled={disabled || !draft.scheduleEnabled} onChange={number("scheduleMaxItems")} /></label> : null}
              <label>迟到容忍（分钟）<input type="number" min="0" max="60" value={draft.scheduleLateToleranceMinutes} disabled={disabled || !draft.scheduleEnabled} onChange={number("scheduleLateToleranceMinutes")} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={draft.scheduleReuseExistingTab} disabled={disabled || !draft.scheduleEnabled} onChange={checkbox("scheduleReuseExistingTab")} />优先复用插件创建的抖音任务页</label>
            <button className="preset-button" disabled={disabled} onClick={applyPreset}>应用默认预设</button>
          </div>
        </section>

        <div className="form-grid compact-options">
          <label className="check"><input type="checkbox" checked={draft.keepSystemAwake} disabled={disabled} onChange={checkbox("keepSystemAwake")} />运行期间保持系统唤醒</label>
          <label className="check"><input type="checkbox" checked={draft.markRejectedNotInterested} disabled={disabled} onChange={checkbox("markRejectedNotInterested")} />淘汰内容后标记为不感兴趣</label>
          <p className="field-note shortcut-note">通过抖音网页的 R 快捷键执行。</p>
          <label className="check"><input type="checkbox" checked={draft.dryRun} disabled={disabled} onChange={checkbox("dryRun")} />测试模式（不上传）</label>
          <label className="check"><input type="checkbox" checked={draft.bridgeEnabled} disabled={disabled} onChange={checkbox("bridgeEnabled")} />启用研究台上传</label>
        </div>
        <div className="settings-actions">
          <button className="primary compact" disabled={disabled} onClick={onSave}>保存设置</button>
          <p className="field-note" role="status">{saveStatus}</p>
        </div>
      </div>
    </details>
  );
}

interface AdvancedRulesPanelProps {
  draft: RuleSettings;
  disabled: boolean;
  onChange(next: RuleSettings): void;
  onSave(): void;
}

function terms(value: string): string[] {
  return [...new Set(value.split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean))];
}

export function AdvancedRulesPanel({ draft, disabled, onChange, onSave }: AdvancedRulesPanelProps) {
  const setHard = (key: keyof RuleSettings["hard"]) => (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...draft, hard: { ...draft.hard, [key]: Number(event.target.value) } });
  };
  const setLowFollower = (key: keyof RuleSettings["lowFollowerNewAccount"], value: number | boolean) => {
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
    <details className="disclosure rules-disclosure">
      <summary><span><strong>高级筛选规则</strong><span className="summary-copy">门槛、类目与黑名单</span></span></summary>
      <div className="disclosure-body rules-form">
        <section className="setting-group" aria-labelledby="hardRulesTitle">
          <div className="setting-heading"><strong id="hardRulesTitle">基础门槛</strong><span>先判断视频，再判断达人</span></div>
          <div className="form-grid">
            <label>最短视频（秒）<input type="number" min="1" value={draft.hard.minVideoDurationSeconds} disabled={disabled} onChange={setHard("minVideoDurationSeconds")} /></label>
            <label>最低点赞<input type="number" min="0" value={draft.hard.minVideoLikes} disabled={disabled} onChange={setHard("minVideoLikes")} /></label>
            <label>优选点赞<input type="number" min="0" value={draft.hard.preferredVideoLikes} disabled={disabled} onChange={setHard("preferredVideoLikes")} /></label>
            <label>最低粉丝<input type="number" min="0" value={draft.hard.minFollowers} disabled={disabled} onChange={setHard("minFollowers")} /></label>
            <label>最高粉丝<input type="number" min="0" value={draft.hard.maxFollowers} disabled={disabled} onChange={setHard("maxFollowers")} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={draft.includeLive} disabled={disabled} onChange={(event) => onChange({ ...draft, includeLive: event.target.checked })} />将直播卡片纳入判断</label>
        </section>

        <section className="setting-group" aria-labelledby="newAccountRulesTitle">
          <div className="setting-heading inline-heading">
            <span><strong id="newAccountRulesTitle">低粉新号例外</strong><small>低于粉丝下限时，满足以下条件仍可进入复核</small></span>
            <input aria-label="启用低粉新号例外" type="checkbox" checked={draft.lowFollowerNewAccount.enabled} disabled={disabled} onChange={(event) => setLowFollower("enabled", event.target.checked)} />
          </div>
          <div className={`form-grid ${draft.lowFollowerNewAccount.enabled ? "" : "disabled-fields"}`}>
            <label>最多作品数<input type="number" min="1" value={draft.lowFollowerNewAccount.maxVideos} disabled={disabled || !draft.lowFollowerNewAccount.enabled} onChange={(event) => setLowFollower("maxVideos", Number(event.target.value))} /></label>
            <label>最低平均点赞<input type="number" min="0" value={draft.lowFollowerNewAccount.minAverageLikes} disabled={disabled || !draft.lowFollowerNewAccount.enabled} onChange={(event) => setLowFollower("minAverageLikes", Number(event.target.value))} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={draft.lowFollowerNewAccount.requireCompleteWorksList} disabled={disabled || !draft.lowFollowerNewAccount.enabled} onChange={(event) => setLowFollower("requireCompleteWorksList", event.target.checked)} />要求作品列表完整加载</label>
        </section>

        <section className="setting-group" aria-labelledby="categoryRulesTitle">
          <div className="setting-heading"><strong id="categoryRulesTitle">账号类目</strong><span>启用 {draft.positiveCategories.filter((item) => item.enabled !== false).length} / {draft.positiveCategories.length}</span></div>
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
                    <label>命中加分<input type="number" min="0" max="100" value={category.score} disabled={disabled} onChange={(event) => updateCategory(index, { score: Number(event.target.value) })} /></label>
                  </div>
                  <label>受众描述<input type="text" value={category.audience} disabled={disabled} onChange={(event) => updateCategory(index, { audience: event.target.value })} /></label>
                  <label>关键词<textarea rows={3} value={category.keywords.join("、")} disabled={disabled} placeholder="美食、探店、烹饪" onChange={(event) => updateCategory(index, { keywords: terms(event.target.value) })} /></label>
                  <button className="danger-text compact category-remove" disabled={disabled || draft.positiveCategories.length <= 1} onClick={() => removeCategory(index)}>删除这个类目</button>
                </div>
              </details>
            ))}
          </div>
          <button className="add-category" disabled={disabled} onClick={addCategory}>＋ 添加账号类目</button>
        </section>

        <section className="setting-group" aria-labelledby="blacklistRulesTitle">
          <div className="setting-heading"><strong id="blacklistRulesTitle">游戏黑名单</strong><span>命中后直接淘汰</span></div>
          <label>游戏名称<textarea rows={3} value={draft.gameBlacklist.join("、")} disabled={disabled} placeholder="和平精英、我的世界" onChange={(event) => onChange({ ...draft, gameBlacklist: terms(event.target.value) })} /></label>
          <p className="field-note">使用逗号、顿号或换行分隔。</p>
        </section>

        <button className="primary compact save-rules" disabled={disabled} onClick={onSave}>保存高级规则</button>
      </div>
    </details>
  );
}

export function UtilityList({ snapshot }: { snapshot: Snapshot }) {
  const schedule = snapshot.schedule || {};
  return (
    <section className="utility-list" aria-label="运行辅助信息">
      <div><span>待上传队列</span><strong>{snapshot.outboxCount || 0} 条</strong></div>
      <div><span>下次定时</span><strong>{schedule.enabled ? formatLocalDateTime(schedule.nextRunAt) : "已停用"}</strong></div>
      <div><span>定时结果</span><strong>{schedule.lastResult ? `${formatLocalDateTime(schedule.lastRunAt)}｜${schedule.lastResult}` : "—"}</strong></div>
    </section>
  );
}

export function StatusBadge({ status }: { status?: string }) {
  return <span className={`badge ${status || ""}`}>{STATUS_LABELS[status || ""] || status || "未知"}</span>;
}
