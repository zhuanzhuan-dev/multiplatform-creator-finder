import { useEffect, useRef, useState } from "react";
import { AdvancedRulesPanel, CloudPanel, RecentDecisions, RunOverview, SettingsPanel, StatsOverview, StatusBadge } from "./components";
import { rulesDraft, settingsDraft } from "./types";
import { PreferencesMenu } from "./PreferencesMenu";
import { useButtonGlow } from "../shared/useButtonGlow";
import { useExtensionState } from "./use-extension-state";

const manifest = chrome.runtime.getManifest();
const visibleVersion = manifest.version_name || manifest.version;

export default function App() {
  useButtonGlow();
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

  return (
    <main>
      <header className="app-header">
        <h1 className="visually-hidden">多平台自动找号助手</h1>
        <span className="version-label" aria-label={`版本 ${visibleVersion}`}>V{visibleVersion}</span>
        <div className="header-actions"><button onClick={() => void extension.openWorkbench()}>打开工作台</button><StatusBadge status={state.status} /><PreferencesMenu /></div>
      </header>
      <RunOverview
        state={state}
        cloud={snapshot.cloud}
        outboxCount={snapshot.outboxCount || 0}
        schedule={snapshot.schedule}
        now={now}
        busyAction={extension.busyAction}
        onStart={() => void extension.run("start", draft)}
        onPause={() => void extension.run("pause", draft)}
        onStop={() => void extension.run("stop", draft)}
      />
      <RecentDecisions state={state} now={now} />
      <StatsOverview state={state} now={now} />
      <CloudPanel snapshot={snapshot} checking={extension.bridgeChecking} onCheck={() => void extension.checkCloud()} onConnect={() => void extension.connectCloud()} onDisconnect={() => void extension.disconnectCloud()} />
      <SettingsPanel draft={draft} disabled={active || Boolean(extension.busyAction)} saveStatus={extension.settingsNotice} onChange={(next) => { setDraft(next); void extension.saveSettings(next, true).catch(() => undefined); }} onSave={() => void extension.saveSettings(draft).catch(() => undefined)} />
      <AdvancedRulesPanel draft={ruleDraft} disabled={active || Boolean(extension.busyAction)} onChange={setRuleDraft} onSave={() => void extension.saveRules(ruleDraft).catch(() => undefined)} />
      <details className="notice-disclosure">
        <summary>运行说明</summary>
        <p>点击“开始本轮”会使用当前抖音推荐页，或打开同窗口中的推荐页。切换标签页或窗口后任务继续运行，侧栏可随时暂停或停止。页面停滞时尝试恢复，持续异常或关闭任务页时暂停。每轮只有绑定页面能采集和上传。</p>
      </details>
      <p className={`message ${extension.notice.error ? "error" : ""}`} aria-live="polite">{extension.notice.text}</p>
    </main>
  );
}
