import { PlatformTasks } from "./PlatformTasks";
import { sendRuntime } from '../shared/chrome-runtime';
import { DouyinTaskPage } from "./DouyinTaskPage";
import { FeiguaTaskPage } from "./FeiguaTaskPage";
import { LauncherSettings } from "./LauncherSettings";
import { RawCaptureSettings } from "./RawCaptureSettings";
import { usePanelPresence } from "./use-panel-presence";
import { useEffect, useRef, useState } from "react";
import { CloudPanel, RecentDecisions } from "./components";
import { rulesDraft, settingsDraft } from "./types";
import { ThemePicker } from "../shared/ThemePicker";
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
  const configurationLocked = active || Boolean(snapshot?.tasks?.some(task => task.route?.platform !== "feigua" && ["starting","running"].includes(task.status || "")));

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
        <div className="header-actions"><PlatformTasks tasks={snapshot.tasks || []} selected={extension.selectedPlatform} resolved={state.route?.platform} busy={Boolean(extension.busyAction)} onSelect={extension.setSelectedPlatform} /><button onClick={() => void extension.openWorkbench()}>打开工作台</button><PreferencesMenu>
          {cloudPanel}
          <ThemePicker />
          <LauncherSettings />
          <details className="debug-settings"><summary>开发调试</summary><label className="check"><input type="checkbox" checked={draft.dryRun} disabled={configurationLocked || Boolean(extension.busyAction)} onChange={(event) => { const next = { ...draft, dryRun: event.target.checked }; setDraft(next); void extension.saveSettings(next, true).catch(() => undefined); }} />本地测试（不连接、不上传）</label><RawCaptureSettings /></details>
        </PreferencesMenu></div>
      </header>
      {!connected ? cloudPanel : <div className="connection-summary">研究台已连接 · 结果自动同步</div>}
      {draft.dryRun ? <p className="test-mode-note">新任务使用本地测试模式 · 新采集结果只存本机，已有正式上传队列继续同步</p> : null}
      {extension.selectedPlatform!=='auto' ? <p className="field-note">正在手动查看{extension.selectedPlatform==='feigua'?'飞瓜':'抖音'}任务，当前网页不会改变。</p> : null}
      {state.route?.platform === 'feigua' ? <FeiguaTaskPage extension={extension} draft={draft} now={now} />
        : state.route?.platform === 'kuaishou' ? <section className="feigua-task-card"><h2>快手采集</h2><p>当前页面已识别为快手，采集界面尚未接入。抖音与飞瓜任务继续独立运行。</p></section>
        : state.route?.platform === 'douyin' ? <DouyinTaskPage extension={extension} now={now} draft={draft} setDraft={setDraft} ruleDraft={ruleDraft} setRuleDraft={setRuleDraft} configurationLocked={configurationLocked} connected={connected} /> : <section className="feigua-task-card"><h2>选择采集平台</h2><p>当前页面尚未适配。通过上方任务选择查看抖音或飞瓜，再打开对应采集页。</p></section>}
      {state.route?.platform !== 'douyin' ? <section className="feigua-task-card"><RecentDecisions now={now} history={snapshot.decisionHistory} total={snapshot.decisionHistoryTotal} />
        <button onClick={()=>{void sendRuntime<{ok:boolean;records:unknown[]}>({type:'DRA_EXPORT_OBSERVATIONS'}).then(result=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result.records,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`采集观察-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}).catch(error=>window.alert(String(error)));}}>导出本地完整观察</button>
      </section> : null}

    </main>
  );
}
