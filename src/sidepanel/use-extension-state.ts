import { errorMessage } from '../shared/error-message';
import { useCallback, useEffect, useRef, useState } from "react";
import { sendRuntime } from "../shared/chrome-runtime";
import type { CloudState, RuleSettings, SettingsDraft, Snapshot } from "./types";

interface SnapshotResponse extends Snapshot { ok: boolean; }
interface CloudResponse { ok: boolean; cloud?: CloudState; health?: { destination?: { name?: string } }; }
interface SaveResponse { ok: boolean; settings: Snapshot["settings"]; rules: unknown; settingsDraft?: Snapshot["settingsDraft"]; problems?: string[]; }

async function getPanelTab() {
  const currentWindow = await chrome.windows.getCurrent();
  if (!Number.isInteger(currentWindow.id)) throw new Error("无法识别侧边栏所在窗口");
  const [tab] = await chrome.tabs.query({ active: true, windowId: currentWindow.id });
  const tabId = tab?.id;
  if (!Number.isInteger(tabId)) throw new Error("无法识别当前标签页");
  return { id: tabId as number, windowId: currentWindow.id, url: tab.url || tab.pendingUrl || "" };
}

export function useExtensionState() {
  const [selectedPlatform, setSelectedPlatform] = useState("auto");
  const selectedRef = useRef(selectedPlatform);
  selectedRef.current = selectedPlatform;
  const refreshSequence = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [notice, setNotice] = useState<{ text: string; error: boolean }>({ text: "", error: false });
  const [busyAction, setBusyAction] = useState<string>("");
  const [bridgeChecking, setBridgeChecking] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const connectInFlight = useRef(false);
  const checkedConnection = useRef(false);
  const bridgeCheckInFlight = useRef(false);
  const settingsRequest = useRef(0);
  const [settingsNotice, setSettingsNotice] = useState("设置已保存");

  useEffect(() => {
    const consume=async()=>{
      const current=await chrome.windows.getCurrent();
      const response=await sendRuntime<{ok:boolean;platform?:string}>({type:'DRA_GET_PANEL_SELECTION',windowId:current.id});
      if(response.platform) setSelectedPlatform(response.platform);
    };
    const listener=(message:{type?:string})=>{if(message.type==='DRA_PANEL_SELECTION_CHANGED')void consume().catch(()=>undefined);};
    chrome.runtime.onMessage.addListener(listener);
    void consume().catch(()=>undefined);
    return ()=>{chrome.runtime.onMessage.removeListener(listener);};
  }, []);

  const show = useCallback((text: string, error = false) => setNotice({ text: error ? errorMessage(text) : text, error }), []);
  const refresh = useCallback(async () => {
    const sequence = selectedRef.current === selectedPlatform ? ++refreshSequence.current : -1;
    const tab = await getPanelTab();
    const response = await sendRuntime<SnapshotResponse>({ type: "DRA_GET_STATUS", tabId: tab.id, url: tab.url, platform: selectedPlatform });
    if (sequence === refreshSequence.current && selectedRef.current === selectedPlatform) {
      const changed = snapshotRef.current?.configPlatform !== response.configPlatform;
      snapshotRef.current = response;
      setSnapshot(response);
      if (changed) { ++settingsRequest.current; setSettingsNotice(response.settingsDraft ? "已恢复未完成的草稿，请修正后使用" : "设置已保存"); }
    }

    return response;
  }, [selectedPlatform]);

  const updateCloud = useCallback((cloud?: CloudState) => {
    if (!cloud) return;
    setSnapshot((current) => current ? { ...current, cloud } : current);
  }, []);

  const checkCloud = useCallback(async () => {
    if (bridgeCheckInFlight.current) return;
    bridgeCheckInFlight.current = true;
    setBridgeChecking(true);
    try {
      await sendRuntime<CloudResponse>({ type: "DRA_CHECK_CLOUD" });
      show("研究台连接正常");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), true);
    } finally {
      bridgeCheckInFlight.current = false;
      setBridgeChecking(false);
      await refresh().catch(() => undefined);
    }
  }, [show, refresh]);

  const saveSettings = useCallback(async (draft: SettingsDraft, autoSave = false) => {
    if (!snapshot) throw new Error("运行状态尚未加载");
    const platform = snapshot.configPlatform || snapshot.state?.route?.platform || "douyin";
    const requestId = ++settingsRequest.current;
    setSettingsNotice("正在保存…");
    const current = snapshot.settings || {};
    const settings = {
      ...current,
      engagement: { rate: draft.engagementRate, like: draft.engagementLike, collect: draft.engagementCollect, follow: draft.engagementFollow },
      dwell: {
        mode: draft.dwellMode,
        fixedSeconds: draft.fixedDwellSeconds,
        minSeconds: draft.dwellMinSeconds,
        typicalSeconds: draft.dwellTypicalSeconds,
        maxSeconds: draft.dwellMaxSeconds
      },
      target: {
        mode: draft.targetMode,
        durationMinutes: draft.targetDurationMinutes,
        maxItems: draft.targetMaxItems
      },
      keepSystemAwake: draft.keepSystemAwake,
      markRejectedNotInterested: draft.markRejectedNotInterested,
      dryRun: draft.dryRun,
      schedule: {
        ...(current.schedule || {}),
        enabled: draft.scheduleEnabled,
        weekdays: draft.scheduleWeekdays,
        times: draft.scheduleTimes,
        target: {
          mode: draft.scheduleTargetMode,
          durationMinutes: draft.scheduleDurationMinutes,
          maxItems: draft.scheduleMaxItems
        },
        reuseExistingTab: draft.scheduleReuseExistingTab,
        lateToleranceMinutes: draft.scheduleLateToleranceMinutes
      },
      cloud: { ...(current.cloud || {}), enabled: true }
    };
    try {
      const response = await sendRuntime<SaveResponse>({ type: "DRA_SAVE_CONFIG", platform, settings, saveDraft: autoSave });
      if (requestId === settingsRequest.current && (snapshotRef.current?.configPlatform || snapshotRef.current?.state?.route?.platform || "douyin") === platform) {
        setSnapshot((value) => value ? { ...value, settings: response.settings, settingsDraft: response.settingsDraft, rules: response.rules } : value);
        const problemText = response.problems?.join("；") || "";
        setSettingsNotice(problemText ? `草稿已保存，待修正：${problemText}` : "设置已自动保存");
        if (!autoSave) show(problemText || "设置已保存", Boolean(problemText));
      }
      return response;
    } catch (error) {
      if (requestId === settingsRequest.current && (snapshotRef.current?.configPlatform || snapshotRef.current?.state?.route?.platform || "douyin") === platform) {
        const text = error instanceof Error ? error.message : String(error);
        setSettingsNotice(`保存失败：${text}`);
        show(text, true);
      }
      throw error;
    }
  }, [show, snapshot]);

  const saveRules = useCallback(async (nextRules: RuleSettings) => {
    if (!snapshot) throw new Error("运行状态尚未加载");
    const platform = snapshot.configPlatform || snapshot.state?.route?.platform || "douyin";
    try {
      const response = await sendRuntime<SaveResponse>({
        type: "DRA_SAVE_CONFIG", platform,
        rules: nextRules
      });
      if ((snapshotRef.current?.configPlatform || snapshotRef.current?.state?.route?.platform || "douyin") !== platform) return response;
      setSnapshot((value) => value ? { ...value, settings: response.settings, rules: response.rules } : value);
      show("视频与账号规则已保存");
      return response;
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), true);
      throw error;
    }
  }, [show, snapshot]);

  const run = useCallback(async (action: "start" | "resume" | "pause" | "stop", draft: SettingsDraft) => {
    setBusyAction(action);
    show("");
    try {
      if (action === "start") {
        show("正在连接研究台并绑定当前标签页…");
        if (snapshot?.state?.route?.platform !== "feigua" && !["running", "starting"].includes(snapshot?.state?.status || "")) await saveSettings(draft);
        const tab = await getPanelTab();
        await sendRuntime({ type: "DRA_START", tabId: tab.id, platform: snapshot?.state?.route?.platform });
      } else if (action === "resume") {
        show("正在恢复本轮，保留已有计数与记录…");
        const tab = await getPanelTab();
        await sendRuntime({ type: "DRA_RESUME", windowId: tab.windowId, platform: snapshot?.state?.route?.platform, runId: snapshot?.state?.runId });
      } else if (action === "pause") {
        await sendRuntime({ type: "DRA_PAUSE", tabId: snapshot?.state?.feedTabId, platform: snapshot?.state?.route?.platform, runId: snapshot?.state?.runId });
      } else {
        await sendRuntime({ type: "DRA_STOP", tabId: snapshot?.state?.feedTabId, platform: snapshot?.state?.route?.platform, runId: snapshot?.state?.runId });
      }
      await refresh();
      show("");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), true);
      await refresh().catch(() => undefined);
    } finally {
      setBusyAction("");
    }
  }, [refresh, saveSettings, show, snapshot, selectedPlatform]);

  const connectCloud = useCallback(async () => {
    if (connectInFlight.current) return;
    connectInFlight.current = true;
    setConnecting(true);
    try {
      const response = await sendRuntime<CloudResponse>({ type: "DRA_START_PAIR" });
      updateCloud(response.cloud);
      show("已打开研究台配对页，请登录并确认授权");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), true);
    }
    finally { connectInFlight.current = false; setConnecting(false); }
  }, [show, updateCloud]);

  const disconnectCloud = useCallback(async () => {
    const pending = snapshot?.cloud?.pairing?.status === "pending";
    try {
      const response = await sendRuntime<CloudResponse>({ type: pending ? "DRA_CANCEL_PAIR" : "DRA_DISCONNECT_CLOUD" });
      updateCloud(response.cloud);
      show(pending ? "已取消配对" : "已断开研究台");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), true);
    }
  }, [show, snapshot?.cloud?.pairing?.status, updateCloud]);

  useEffect(() => {
    let mounted = true;
    refresh().then((response) => {
      if (!mounted || !response.cloud?.connected || checkedConnection.current) return;
      checkedConnection.current = true;
      void checkCloud();
    }).catch((error) => mounted && show(error instanceof Error ? error.message : String(error), true));
    return () => { mounted = false; };
  }, [checkCloud, refresh, show]);

  useEffect(() => {
    const listener = (event: unknown) => {
      const message = event as { type?: string; tabId?: number | null };
      if (message.type === "DRA_STATUS_CHANGED" || message.type === "DRA_HISTORY_CHANGED") void refresh().catch(() => undefined);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(onVisible, 60_000);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  useEffect(() => {
    if (snapshot?.cloud?.pairing?.status !== "pending") return undefined;
    const poll = async () => {
      try {
        const response = await sendRuntime<CloudResponse>({ type: "DRA_POLL_PAIR" });
        updateCloud(response.cloud);
        if (response.cloud?.connected) show("研究台已连接，可以开始本轮");
      } catch (error) {
        show(error instanceof Error ? error.message : String(error), true);
        await refresh().catch(() => undefined);
      }
    };
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => window.clearInterval(timer);
  }, [refresh, show, snapshot?.cloud?.pairing?.status, updateCloud]);

  useEffect(() => {
    const changed = () => { void refresh().catch(() => undefined); };
    const updated = (_id: number, info: {url?:string;status?:string}) => { if(info.url || info.status === 'complete') changed(); };
    chrome.tabs.onActivated.addListener(changed); chrome.tabs.onUpdated.addListener(updated);
    return () => { chrome.tabs.onActivated.removeListener(changed); chrome.tabs.onUpdated.removeListener(updated); };
  }, [refresh]);

  const openFeigua = async () => {
    setBusyAction('open');
    try { const tab=await getPanelTab(); await sendRuntime({type:'DRA_OPEN_FEIGUA',windowId:tab.windowId}); await refresh(); }
    catch(error){show(error instanceof Error?error.message:String(error),true);}
    finally {setBusyAction('');}
  };
  const openWorkbench = async () => {
    try { await sendRuntime({ type: "DRA_OPEN_WORKBENCH" }); }
    catch (error) { show(error instanceof Error ? error.message : String(error), true); }
  };

  return {
    snapshot,
    selectedPlatform, setSelectedPlatform,
    settingsNotice,
    openWorkbench,
    openFeigua,
    notice,
    busyAction,
    bridgeChecking,
    connecting,
    refresh,
    checkCloud,
    saveSettings,
    saveRules,
    run,
    connectCloud,
    disconnectCloud
  };
}
