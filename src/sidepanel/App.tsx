import { useEffect, useState } from "react";
import { AdvancedRulesPanel, CloudPanel, RecentDecisions, RunOverview, SettingsPanel, StatsOverview, StatusBadge, UtilityList } from "./components";
import { rulesDraft, settingsDraft } from "./types";
import { useExtensionState } from "./use-extension-state";

const manifest = chrome.runtime.getManifest();
const visibleVersion = manifest.version_name || manifest.version;

export default function App() {
  const extension = useExtensionState();
  const [now, setNow] = useState(Date.now());
  const [draft, setDraft] = useState(settingsDraft());
  const [ruleDraft, setRuleDraft] = useState(rulesDraft(null));
  const snapshot = extension.snapshot;
  const state = snapshot?.state || {};
  const active = state.status === "starting" || state.status === "running";

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (snapshot?.settings) setDraft(settingsDraft(snapshot.settings));
  }, [snapshot?.settings]);

  useEffect(() => {
    if (snapshot?.rules) setRuleDraft(rulesDraft(snapshot.rules));
  }, [snapshot?.rules]);

  if (!snapshot) {
    return <main><div className="loading-state" role="status">正在读取运行状态…</div><p className={`message ${extension.notice.error ? "error" : ""}`}>{extension.notice.text}</p></main>;
  }

  return (
    <main>
      <header className="app-header">
        <div><h1 className="visually-hidden">多平台自动找号助手</h1><p className="eyebrow">达人与视频发现 · V{visibleVersion}</p></div>
        <StatusBadge status={state.status} />
      </header>
      <RunOverview
        state={state}
        cloud={snapshot.cloud}
        outboxCount={snapshot.outboxCount || 0}
        now={now}
        busyAction={extension.busyAction}
        onStart={() => void extension.run("start", draft)}
        onPause={() => void extension.run("pause", draft)}
        onStop={() => void extension.run("stop", draft)}
      />
      <RecentDecisions state={state} now={now} />
      <StatsOverview state={state} now={now} />
      <CloudPanel snapshot={snapshot} checking={extension.bridgeChecking} onCheck={() => void extension.checkCloud()} onConnect={() => void extension.connectCloud()} onDisconnect={() => void extension.disconnectCloud()} />
      <UtilityList snapshot={snapshot} />
      <SettingsPanel draft={draft} disabled={active || Boolean(extension.busyAction)} onChange={setDraft} onSave={() => void extension.saveSettings(draft)} />
      <AdvancedRulesPanel draft={ruleDraft} disabled={active || Boolean(extension.busyAction)} onChange={setRuleDraft} onSave={() => void extension.saveRules(ruleDraft).catch(() => undefined)} />
      <details className="notice-disclosure">
        <summary>运行说明</summary>
        <p>任务只绑定启动时的抖音推荐标签页；切换标签页或浏览器窗口后通常会继续运行。页面被 Chrome 冻结、丢弃，或关闭、离开推荐页时，任务会暂停；无论打开多少标签页，只有本轮绑定页面能采集和上传。</p>
      </details>
      <p className={`message ${extension.notice.error ? "error" : ""}`} aria-live="polite">{extension.notice.text}</p>
    </main>
  );
}
