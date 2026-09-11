import { errorMessage } from '../shared/error-message';
import { useEffect, useRef, useState } from 'react';
import { LAUNCHER_ENABLED_KEY, LAUNCHER_COMPACT_KEY, launcherSiteKey, launcherPreferences } from '../../lib/launcher-preferences.js';

export function LauncherSettings() {
  const [preferences, setPreferences] = useState(launcherPreferences());
  const [target, setTarget] = useState<{id: number; hostname: string} | null>(null);
  const [visitHidden, setVisitHidden] = useState(false);
  const [scope, setScope] = useState('visit');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let disposed = false, revision = 0;
    const refresh = async () => {
      const ticket = ++revision;
      try {
        const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
        const url = tab?.url && /^https?:\/\//.test(tab.url) ? new URL(tab.url) : null;
        const nextTarget = url && tab.id !== undefined ? {id: tab.id, hostname: url.hostname} : null;
        const saved = await chrome.storage.local.get([LAUNCHER_ENABLED_KEY, LAUNCHER_COMPACT_KEY, launcherSiteKey(url?.hostname || '')]);
        const reply = nextTarget ? await chrome.tabs.sendMessage(nextTarget.id, {type: 'DRA_LAUNCHER_PING'}, {frameId: 0}).catch(() => null) : null;
        if (disposed || ticket !== revision) return;
        setTarget(nextTarget); setPreferences(launcherPreferences(saved, url?.hostname || ''));
        setVisitHidden(reply?.visitHidden === true); setReady(true);
      } catch (error) {
        if (!disposed && ticket === revision) setNotice(error instanceof Error ? error.message : '无法读取悬浮球设置');
      }
    };
    refreshRef.current = refresh;
    const changed = () => { void refresh(); };
    const updated = (_id: number, change: {url?: string; status?: string}) => { if (change.url || change.status === 'complete') changed(); };
    const storageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && Object.keys(changes).some(key => key === LAUNCHER_ENABLED_KEY || key === LAUNCHER_COMPACT_KEY || key.startsWith('draLauncherBlocked:'))) changed();
    };
    changed();
    chrome.tabs.onActivated.addListener(changed); chrome.tabs.onUpdated.addListener(updated);
    chrome.storage.onChanged.addListener(storageChanged);
    return () => {
      disposed = true; chrome.tabs.onActivated.removeListener(changed); chrome.tabs.onUpdated.removeListener(updated);
      chrome.storage.onChanged.removeListener(storageChanged);
    };
  }, []);
  const action = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true); setNotice('');
    try { await work(); await refreshRef.current(); setNotice(success); }
    catch (error) { setNotice(error instanceof Error ? error.message : '保存失败，请重试'); }
    finally { setBusy(false); }
  };
  const currentTarget = async () => {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!target || tab?.id !== target.id || !tab.url || !/^https?:\/\//.test(tab.url) || new URL(tab.url).hostname !== target.hostname) {
      throw Error('当前页面已变化，请等待网站名称更新后重试');
    }
    return target;
  };
  const setVisit = async (hidden: boolean) => {
    const target = await currentTarget();
    const result = await chrome.tabs.sendMessage(target.id, {type: 'DRA_LAUNCHER_VISIT', hidden}, {frameId: 0}).catch(() => null);
    if (!result?.ok) throw Error('当前网页尚未加载悬浮入口，请检查站点访问权限并刷新网页');
  };
  const hide = () => action(async () => {
    if (scope === 'global') await chrome.storage.local.set({[LAUNCHER_ENABLED_KEY]: false});
    else if (scope === 'site') {
      const site = await currentTarget();
      await chrome.storage.local.set({[launcherSiteKey(site.hostname)]: true});
    }
    else await setVisit(true);
  }, '悬浮球已隐藏，可在此恢复显示');
  return <section className="launcher-settings" aria-labelledby="launcherSettingsTitle">
    <h3 id="launcherSettingsTitle">悬浮球设置</h3>
    <label className="check"><input type="checkbox" checked={preferences.compact} disabled={busy || !ready} onChange={e => void action(() => chrome.storage.local.set({[LAUNCHER_COMPACT_KEY]: e.target.checked}), '大小已保存')} />缩小悬浮球（28px）</label>
    <p className="field-note">默认 36px，可拖动或用方向键移动。大小与位置在网页间同步。</p>
    <label className="check"><input type="checkbox" checked={preferences.enabled} disabled={busy || !ready} onChange={e => void action(() => chrome.storage.local.set({[LAUNCHER_ENABLED_KEY]: e.target.checked}), '全局显示设置已保存')} />启用悬浮球</label>
    <p className="field-note">当前网站：{target?.hostname || '请切换到普通 HTTP / HTTPS 网页'}</p>
    <fieldset disabled={busy || !ready}>
      <legend>隐藏范围</legend>
      <label className="check"><input type="radio" name="launcherHideScope" value="visit" checked={scope === 'visit'} onChange={() => setScope('visit')} />本次访问（刷新或重新访问后恢复）</label>
      <label className="check"><input type="radio" name="launcherHideScope" value="site" checked={scope === 'site'} onChange={() => setScope('site')} />当前网站禁用</label>
      <label className="check"><input type="radio" name="launcherHideScope" value="global" checked={scope === 'global'} onChange={() => setScope('global')} />永久禁用（在此重新启用）</label>
    </fieldset>
    <div className="bridge-actions">
      <button disabled={busy || !ready || (scope !== 'global' && !target)} onClick={() => void hide()}>隐藏悬浮球</button>
      {preferences.siteBlocked && target ? <button disabled={busy} onClick={() => void action(async () => { const site = await currentTarget(); await chrome.storage.local.remove(launcherSiteKey(site.hostname)); }, '当前网站已恢复；全局开关开启时显示')}>恢复当前网站</button> : null}
      {visitHidden ? <button disabled={busy} onClick={() => void action(() => setVisit(false), '本次隐藏已取消；全局与网站设置仍生效')}>取消本次隐藏</button> : null}
    </div>
    <p className="field-note">隐藏后可点击浏览器工具栏的插件图标，在“设置”中恢复。隐藏仅改变入口显示，采集任务继续运行。</p>
    <p className="field-note" role="status">{errorMessage(notice)}</p>
  </section>;
}
