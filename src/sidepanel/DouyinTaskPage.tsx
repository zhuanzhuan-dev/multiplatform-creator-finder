import { ConfigurationPanel } from './ConfigurationPanel';
import { EngagementSettings } from './EngagementSettings';
import { AdvancedRulesPanel, RunOverview, SettingsPanel, StatsOverview } from './components';
import type { Dispatch, SetStateAction } from 'react';
import type { SettingsDraft, RuleSettings } from './types';
import type { useExtensionState } from './use-extension-state';

type Props = {
  extension:ReturnType<typeof useExtensionState>; now:number;
  draft:SettingsDraft;setDraft:Dispatch<SetStateAction<SettingsDraft>>;
  ruleDraft:RuleSettings;setRuleDraft:Dispatch<SetStateAction<RuleSettings>>;
  configurationLocked:boolean;connected:boolean | undefined;
};
export function DouyinTaskPage({extension,now,draft,setDraft,ruleDraft,setRuleDraft,configurationLocked,connected}:Props) {
  const snapshot=extension.snapshot!;
  const state=snapshot.state || {};
  const kuaishou=state.route?.platform==='kuaishou';
  return <>
      <RunOverview
        state={state}
        cloud={snapshot.cloud}
        outboxCount={snapshot.outboxCount || 0}
        schedule={kuaishou?undefined:snapshot.schedule}
        now={now}
        busyAction={extension.busyAction}
        startDisabled={!draft.dryRun && (!connected || extension.bridgeChecking)}
        onStart={() => void extension.run("start", draft)}
        onResume={() => void extension.run("resume", draft)}
        onPause={() => void extension.run("pause", draft)}
        onStop={() => void extension.run("stop", draft)}
      />
      {extension.notice.text ? <p className={`message ${extension.notice.error ? "error" : ""}`} aria-live="polite">{extension.notice.text}</p> : null}
      <StatsOverview state={state} now={now} daily={snapshot.daily} history={snapshot.decisionHistory} historyTotal={snapshot.decisionHistoryTotal} />
      <ConfigurationPanel runtime={
        <SettingsPanel recommendationPlatform={kuaishou?"kuaishou":"douyin"} draft={draft} disabled={configurationLocked || Boolean(extension.busyAction)} saveStatus={extension.settingsNotice} onChange={(next) => { setDraft(next); void extension.saveSettings(next, true).catch(() => undefined); }} onSave={() => void extension.saveSettings(draft).catch(() => undefined)} />
      } rules={
        <AdvancedRulesPanel draft={ruleDraft} disabled={configurationLocked || Boolean(extension.busyAction)} onChange={setRuleDraft} onSave={() => void extension.saveRules(ruleDraft).catch(() => undefined)} engagement={kuaishou?<p className="field-note">快手当前执行采集与切换视频，互动设置仅用于抖音。</p>:<EngagementSettings draft={draft} disabled={configurationLocked || Boolean(extension.busyAction)} saveStatus={extension.settingsNotice} onChange={next => { setDraft(next); void extension.saveSettings(next, true).catch(() => undefined); }} />} />
      } />
      <details className="notice-disclosure">
        <summary>运行说明</summary>
        <p>{kuaishou?'点击开始使用或打开快手推荐页；继续在后台恢复，保留计数和去重记录。停留时间、视频与账号规则独立保存，可与抖音并行采集，上传共用队列；修改后在新任务生效。作者主页在后台读取后关闭；主页未读全的记录交由人工确认。定时启动和自动互动目前仅用于抖音。':<>点击“开始本轮”使用当前抖音推荐页，或打开同窗口中的抖音推荐页。切换标签页、窗口或关闭侧栏后任务继续运行。普通网页上的悬浮入口或工具栏插件图标可重新打开面板；悬浮按钮支持拖动和方向键移动，位置自动保存，侧栏可随时暂停或停止。页面停滞时尝试恢复，持续异常或关闭任务页时暂停。抖音点击“继续本轮”会恢复原推荐页；原页面已离开推荐页或关闭时，会在当前窗口找到或打开推荐页，保留本轮进度。每个平台任务独立绑定页面并采集，上传由共享队列统一处理。</>}</p>
      </details>
  </>;
}
