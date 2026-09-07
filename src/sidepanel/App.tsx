import { ConfigurationPanel } from "./ConfigurationPanel";
import { EngagementSettings } from "./EngagementSettings";
import { RawCaptureSettings } from "./RawCaptureSettings";
import { usePanelPresence } from "./use-panel-presence";
import { useEffect, useRef, useState } from "react";
import { AdvancedRulesPanel, CloudPanel, RunOverview, SettingsPanel, StatsOverview } from "./components";
import { rulesDraft, settingsDraft } from "./types";
import { PreferencesMenu } from "./PreferencesMenu";
import { useButtonGlow } from "../shared/useButtonGlow";
import { useExtensionState } from "./use-extension-state";

const manifest = chrome.runtime.getManifest();
const visibleVersion = manifest.version_name || manifest.version;

export default function App() {
  useButtonGlow();
  usePanelPresence();
  const extension = useExtensionState();
  const [now, setNow] = useState(Date.now());
  const [draft, setDraft] = useState(settingsDraft());
  const draftHydrated = useRef(false);
  const [draftReady, setDraftReady] = useState(false);
  const [ruleDraft, setRuleDraft] = useState(rulesDraft(null));
  const snapshot = extension.snapshot;
  const state = snapshot?.state || {};
  const active = state.status === "starting" || state.status === "running";

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (snapshot?.settings && !draftHydrated.current) {
      draftHydrated.current = true;
      setDraft(settingsDraft(snapshot.settingsDraft || snapshot.settings));
      setDraftReady(true);
    }
  }, [snapshot?.settings, snapshot?.settingsDraft]);

  const savedRules = JSON.stringify(snapshot?.rules);
  useEffect(() => {
    if (savedRules) setRuleDraft(rulesDraft(JSON.parse(savedRules)));
  }, [savedRules]);

  if (!snapshot || !draftReady) {
    return <main><div className="loading-state" role="status">正在读取运行状态…</div><p className={`message ${extension.notice.error ? "error" : ""}`}>{extension.notice.text}</p></main>;
  }

  const cloudPanel = <CloudPanel snapshot={snapshot} checking={extension.bridgeChecking || extension.connecting} onCheck={() => void extension.checkCloud()} onConnect={() => void extension.connectCloud()} onDisconnect={() => void extension.disconnectCloud()} />;
  const connected = snapshot.cloud?.connected && snapshot.cloud?.pairing?.status !== "pending";
  return (
    <main>
      <header className="app-header">
        <h1 className="visually-hidden">多平台自动找号助手</h1>
        <span className="version-label" aria-label={`版本 ${visibleVersion}`}>V{visibleVersion}</span>
        <div className="header-actions"><button onClick={() => void extension.openWorkbench()}>打开工作台</button><PreferencesMenu>
          {cloudPanel}
          <details className="debug-settings"><summary>开发调试</summary><label className="check"><input type="checkbox" checked={draft.dryRun} disabled={active || Boolean(extension.busyAction)} onChange={(event) => { const next = { ...draft, dryRun: event.target.checked }; setDraft(next); void extension.saveSettings(next, true).catch(() => undefined); }} />本地测试（不连接、不上传）</label><RawCaptureSettings /></details>
        </PreferencesMenu></div>
      </header>
      {!connected ? cloudPanel : <div className="connection-summary">研究台已连接 · 结果自动同步</div>}
      {draft.dryRun ? <p className="test-mode-note">本地测试模式 · 结果保存在本机，正式使用请在设置中关闭</p> : null}
      <RunOverview
        state={state}
        cloud={snapshot.cloud}
        outboxCount={snapshot.outboxCount || 0}
        schedule={snapshot.schedule}
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
        <SettingsPanel draft={draft} disabled={active || Boolean(extension.busyAction)} saveStatus={extension.settingsNotice} onChange={(next) => { setDraft(next); void extension.saveSettings(next, true).catch(() => undefined); }} onSave={() => void extension.saveSettings(draft).catch(() => undefined)} />
      } rules={
        <AdvancedRulesPanel draft={ruleDraft} disabled={active || Boolean(extension.busyAction)} onChange={setRuleDraft} onSave={() => void extension.saveRules(ruleDraft).catch(() => undefined)} engagement={<EngagementSettings draft={draft} disabled={active || Boolean(extension.busyAction)} saveStatus={extension.settingsNotice} onChange={next => { setDraft(next); void extension.saveSettings(next, true).catch(() => undefined); }} />} />
      } />
      <details className="notice-disclosure">
        <summary>运行说明</summary>
        <p>点击“开始本轮”会使用当前抖音推荐页，或打开同窗口中的推荐页。切换标签页、窗口或关闭侧栏后任务继续运行。抖音页面的悬浮入口或工具栏插件图标可重新打开面板，侧栏可随时暂停或停止。页面停滞时尝试恢复，持续异常或关闭任务页时暂停。点击“继续本轮”会恢复原推荐页；原页面已离开推荐页或关闭时，会在当前窗口找到或打开推荐页，保留本轮进度。每轮只有绑定页面能采集和上传。</p>
      </details>
    </main>
  );
}
