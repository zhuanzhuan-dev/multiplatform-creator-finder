import { useEffect, useState } from 'react';
import { sendRuntime } from '../shared/chrome-runtime';
import type { useExtensionState } from './use-extension-state';
import type { SettingsDraft } from './types';
import { errorMessage } from '../shared/error-message';
import { elapsedRunMs } from '../../lib/run-limits.js';
import { formatDuration } from './format';

export function HuxuanTaskPage({extension,draft,now}:{extension:ReturnType<typeof useExtensionState>;draft:SettingsDraft;now:number}) {
  const snapshot=extension.snapshot!;
  const state=snapshot.state || {}, details=snapshot.huxuan;
  const active=state.status==='running'||state.status==='starting', busy=!!extension.busyAction;
  const saved=snapshot.settings;
  const [pages,setPages]=useState('50'),[min,setMin]=useState('4'),[max,setMax]=useState('6'),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false);
  const maxPages=saved?.huxuanTarget?.maxPages ?? 50,minSeconds=saved?.huxuanDelay?.minSeconds ?? 4,maxSeconds=saved?.huxuanDelay?.maxSeconds ?? 6;
  useEffect(()=>{setPages(String(maxPages));setMin(String(minSeconds));setMax(String(maxSeconds));},[maxPages,minSeconds,maxSeconds]);
  const save=async()=>{
    setSaving(true);setNotice('');
    try {await sendRuntime({type:'DRA_SAVE_HUXUAN_CONFIG',platform:snapshot.configPlatform,maxPages:Number(pages),minSeconds:Number(min),maxSeconds:Number(max)});await extension.refresh();setNotice('已保存，下轮采集生效');}
    catch(error){setNotice(errorMessage(error));}finally{setSaving(false);}
  };
  const open=async()=>{try{const current=await chrome.windows.getCurrent();await sendRuntime({type:'DRA_OPEN_HUXUAN',platform:snapshot.configPlatform,windowId:current.id});}catch(error){setNotice(errorMessage(error));}};
  return <>
    <section className="feigua-task-card" aria-labelledby="huxuanTaskTitle">
      <div className="feigua-task-heading"><h2 id="huxuanTaskTitle">腾讯互选视频号采集</h2><span className="badge">{snapshot.cloud?.connected?'自动上传':'等待连接'}</span></div>
      <p className="field-note">使用当前登录账号的创作者广场筛选结果，按接口逐页采集。浏览器自动维持登录，无需复制 Cookie。</p>
      <div className="feigua-progress" aria-live="polite"><strong>{details?.pageCount || 0}<small> / {state.runTarget?.maxPages || maxPages} 页</small></strong><span>{({running:'采集中',starting:'启动中',paused:'已暂停',stopped:'本轮已结束'} as Record<string,string>)[state.status || ''] || '准备开始'}</span></div>
      <dl className="feigua-metrics"><div><dt>已采集页</dt><dd>{details?.pageCount || 0}</dd></div><div><dt>候选账号</dt><dd>{state.stats?.matched || 0}</dd></div><div><dt>重复跳过</dt><dd>{state.stats?.duplicates || 0}</dd></div><div><dt>已上传</dt><dd>{state.stats?.uploaded || 0}</dd></div></dl>
      <p className="field-note">累计采集 {formatDuration(elapsedRunMs(state,now))}{details?.pageNumber?` · 最近保存第 ${details.pageNumber} 页`:''}</p>
      {state.pauseReason || state.lastError ? <p className="feigua-recovery" role="status">{errorMessage(state.pauseReason || state.lastError)}</p>:null}
      <div className="actions">{active?<button className="primary" disabled={busy} onClick={()=>void extension.run('pause',draft)}>暂停采集</button>:<button className="primary" disabled={busy || !snapshot.cloud?.connected} onClick={()=>void extension.run(state.runId && !details?.finalized?'resume':'start',draft)}>{state.runId && !details?.finalized?'继续采集':'开始新一轮采集'}</button>}<button disabled={busy || !state.runId || state.status==='stopped'} onClick={()=>void extension.run('stop',draft)}>结束并保存</button></div>
      <button className="feigua-open-page" disabled={busy} onClick={()=>void open()}>打开腾讯互选</button>
      <p className="field-note">打开视频号创作者广场并设置筛选后开始。每页保存后自动上传；暂停后从下一页继续。修改筛选或切换广告账号后，请开始新一轮。粉丝量和播放量保留网站区间。</p>
    </section>
    {extension.notice.text?<p className={`message ${extension.notice.error?'error':''}`} role="status">{extension.notice.text}</p>:null}
    <details className="disclosure feigua-config"><summary><strong>互选采集设置</strong><span className="summary-copy">本轮页数与请求间隔</span></summary><form onSubmit={event=>{event.preventDefault();void save();}}>
      <label className="field">本轮采集页数<input type="number" min="1" max="500" step="1" required value={pages} disabled={active||saving} onChange={event=>setPages(event.target.value)} /></label>
      <label className="field">最短等待（秒）<input type="number" min="1" max="30" step="0.1" required value={min} disabled={active||saving} onChange={event=>setMin(event.target.value)} /></label>
      <label className="field">最长等待（秒）<input type="number" min={min||'1'} max="30" step="0.1" required value={max} disabled={active||saving} onChange={event=>setMax(event.target.value)} /></label>
      <p className="field-note">从当前网页所在页开始；达到本轮页数或当前筛选末页时结束。登录失效或接口访问受限时暂停，已有记录保留。</p>
      <button type="submit" disabled={active||saving}>{saving?'保存中…':'保存互选设置'}</button><p className="field-note" role="status">{notice}</p>
    </form></details>
  </>;
}
