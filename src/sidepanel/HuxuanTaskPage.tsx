import { useEffect, useState } from 'react';
import { sendRuntime } from '../shared/chrome-runtime';
import type { useExtensionState } from './use-extension-state';
import type { SettingsDraft } from './types';
import { errorMessage } from '../shared/error-message';
import { elapsedRunMs } from '../../lib/run-limits.js';
import { formatDuration } from './format';

const datasetLabels:Record<string,string>={list:'列表资料',detail:'基础资料与画像',persona:'创作者亮点',score:'账号评分',insight:'如翼洞察',recommendations:'达人推荐','near:0':'全部视频趋势','near:3':'个人视频趋势','near:1':'商单趋势','videos:0':'发表视频','videos:1':'商单案例',complete:'保存达人资料'};
const intervalText=({minSeconds,maxSeconds}:{minSeconds:number;maxSeconds:number})=>minSeconds===maxSeconds?`${minSeconds} 秒（固定等待）`:`${minSeconds}–${maxSeconds} 秒（随机等待）`;

export function HuxuanTaskPage({extension,draft,now}:{extension:ReturnType<typeof useExtensionState>;draft:SettingsDraft;now:number}) {
  const snapshot=extension.snapshot!;
  const state=snapshot.state || {}, details=snapshot.huxuan;
  const listPageCount=details?.listPageCount ?? details?.pageCount ?? 0;
  const active=state.status==='running'||state.status==='starting', busy=!!extension.busyAction;
  const saved=snapshot.settings;
  const maxPages=saved?.huxuanTarget?.maxPages ?? 50,minSeconds=saved?.huxuanDelay?.minSeconds ?? 2,maxSeconds=saved?.huxuanDelay?.maxSeconds ?? 4;
  const [pages,setPages]=useState(String(maxPages)),[min,setMin]=useState(String(minSeconds)),[max,setMax]=useState(String(maxSeconds)),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false);
  const pageMinSeconds=saved?.huxuanPageDelay?.minSeconds ?? minSeconds,pageMaxSeconds=saved?.huxuanPageDelay?.maxSeconds ?? maxSeconds;
  const [pageMin,setPageMin]=useState(String(pageMinSeconds)),[pageMax,setPageMax]=useState(String(pageMaxSeconds));
  const videoMaxPages=saved?.huxuanVideoMaxPages ?? 1;
  const [videoPages,setVideoPages]=useState(String(videoMaxPages));
  useEffect(()=>setVideoPages(String(videoMaxPages)),[videoMaxPages]);
  const continuing=Boolean(state.runId) && state.status!=='stopped' && details?.finalized!==true;
  const appliedDelay=continuing?(state.runSettings?.huxuanDelay || {minSeconds:2,maxSeconds:4}):{minSeconds,maxSeconds};
  const appliedPageDelay=continuing?(state.runSettings?.huxuanPageDelay || appliedDelay):{minSeconds:pageMinSeconds,maxSeconds:pageMaxSeconds};
  const pendingPageDelay=continuing && (appliedPageDelay.minSeconds!==pageMinSeconds || appliedPageDelay.maxSeconds!==pageMaxSeconds);
  const pendingDelay=continuing && (appliedDelay.minSeconds!==minSeconds || appliedDelay.maxSeconds!==maxSeconds);
  useEffect(()=>{setPages(String(maxPages));setMin(String(minSeconds));setMax(String(maxSeconds));},[maxPages,minSeconds,maxSeconds]);
  useEffect(()=>{setPageMin(String(pageMinSeconds));setPageMax(String(pageMaxSeconds));},[pageMinSeconds,pageMaxSeconds]);
  const save=async()=>{
    setSaving(true);setNotice('');
    try {await sendRuntime({type:'DRA_SAVE_HUXUAN_CONFIG',platform:snapshot.configPlatform,maxPages:Number(pages),videoMaxPages:Number(videoPages),minSeconds:Number(min),maxSeconds:Number(max),pageMinSeconds:Number(pageMin),pageMaxSeconds:Number(pageMax)});await extension.refresh();setNotice('已保存，下轮采集生效');}
    catch(error){setNotice(errorMessage(error));}finally{setSaving(false);}
  };
  const open=async()=>{try{const current=await chrome.windows.getCurrent();await sendRuntime({type:'DRA_OPEN_HUXUAN',platform:snapshot.configPlatform,windowId:current.id});}catch(error){setNotice(errorMessage(error));}};
  return <>
    <section className="feigua-task-card" aria-labelledby="huxuanTaskTitle">
      <div className="feigua-task-heading"><h2 id="huxuanTaskTitle">腾讯互选视频号采集</h2><span className="badge">{snapshot.cloud?.connected?'自动上传':'等待连接'}</span></div>
      <p className="field-note"><strong>{continuing?'本轮达人间隔':'达人间隔'}：{intervalText(appliedDelay)}</strong></p>
      {pendingDelay ? <p className="field-note" role="status">下轮达人间隔：{intervalText({minSeconds,maxSeconds})}</p> : null}
      <p className="field-note">{continuing?'本轮翻页间隔':'翻页间隔'}：{intervalText(appliedPageDelay)}</p>
      {pendingPageDelay ? <p className="field-note" role="status">下轮翻页间隔：{intervalText({minSeconds:pageMinSeconds,maxSeconds:pageMaxSeconds})}</p> : null}
      <p className="field-note">{continuing?'本轮':''}每位达人视频：每类最多 {continuing?(state.runSettings?.huxuanVideoMaxPages ?? 1):videoMaxPages} 页</p>
      <div className="feigua-progress" aria-live="polite"><strong>{listPageCount}<small> / {state.runTarget?.maxPages || maxPages} 页</small></strong><span>{({running:'采集中',starting:'启动中',paused:'已暂停',stopped:'本轮已结束'} as Record<string,string>)[state.status || ''] || '准备开始'}</span></div>
      <dl className="feigua-metrics"><div><dt>已获取列表页</dt><dd>{listPageCount}</dd></div><div><dt>候选账号</dt><dd>{state.stats?.matched || 0}</dd></div><div><dt>重复跳过</dt><dd>{state.stats?.duplicates || 0}</dd></div><div><dt>已上传记录</dt><dd>{state.stats?.uploaded || 0}</dd></div></dl>
      <p className="field-note">累计采集 {formatDuration(elapsedRunMs(state,now))} · 资料已完成 {details?.pageCount || 0} 页{details?.pageNumber?` · 最近完成第 ${details.pageNumber} 页`:''}</p>
      {active && details?.currentPage ? <p className="field-note" role="status">正在采集第 {details.currentPage.pageNumber} 页：达人资料已完成 {details.currentPage.completed}/{details.currentPage.total}{state.runtime?.authorName?` · ${state.runtime.authorName} · ${datasetLabels[state.runtime.dataset || ''] || '读取资料'}`:''}</p> : null}
      {active && state.runtime?.pageIndex!==undefined ? <p className="field-note" role="status">作品第 {state.runtime.pageIndex+1} 页 · 已获取 {state.runtime.received ?? 0}{state.runtime.total!==undefined?` / ${state.runtime.total}`:''} 条</p> : null}
      {state.pauseReason || state.lastError ? <p className="feigua-recovery" role="status">{errorMessage(state.pauseReason || state.lastError)}</p>:null}
      <div className="actions">{active?<button className="primary" disabled={busy} onClick={()=>void extension.run('pause',draft)}>暂停采集</button>:<button className="primary" disabled={busy || !snapshot.cloud?.connected} onClick={()=>void extension.run(state.runId && !details?.finalized?'resume':'start',draft)}>{state.runId && !details?.finalized?'继续采集':'开始新一轮采集'}</button>}<button disabled={busy || !state.runId || state.status==='stopped'} onClick={()=>void extension.run('stop',draft)}>结束并保存</button></div>
      <button className="feigua-open-page" disabled={busy} onClick={()=>void open()}>打开腾讯互选</button>
    </section>
    {extension.notice.text?<p className={`message ${extension.notice.error?'error':''}`} role="status">{extension.notice.text}</p>:null}
    <details className="disclosure feigua-config"><summary><strong>互选采集设置</strong><span className="summary-copy">页数、达人间隔与翻页间隔</span></summary><form onSubmit={event=>{event.preventDefault();void save();}}>
      <label className="field">本轮采集页数<input type="number" min="1" max="500" step="1" required value={pages} disabled={active||saving} onChange={event=>setPages(event.target.value)} /></label>
      <label className="field">每位达人视频页数（发表视频、商单各自上限）<input type="number" min="1" step="1" required value={videoPages} disabled={active||saving} onChange={event=>setVideoPages(event.target.value)} /></label>
      <label className="field">达人之间最短等待（秒）<input type="number" min="0" step="0.1" required value={min} disabled={active||saving} onChange={event=>setMin(event.target.value)} /></label>
      <label className="field">达人之间最长等待（秒）<input type="number" min={min||'0'} step="0.1" required value={max} disabled={active||saving} onChange={event=>setMax(event.target.value)} /></label>
      <label className="field">列表及作品翻页前最短等待（秒）<input type="number" min="0" step="0.1" required value={pageMin} disabled={active||saving} onChange={event=>setPageMin(event.target.value)} /></label>
      <label className="field">列表及作品翻页前最长等待（秒）<input type="number" min={pageMin||'0'} step="0.1" required value={pageMax} disabled={active||saving} onChange={event=>setPageMax(event.target.value)} /></label>
      <button type="submit" disabled={active||saving}>{saving?'保存中…':'保存互选设置'}</button><p className="field-note" role="status">{notice}</p>
    </form></details>
  </>;
}
