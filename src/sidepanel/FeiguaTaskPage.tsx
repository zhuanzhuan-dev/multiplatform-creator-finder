import { useEffect, useState } from 'react';
import { canResumeRun, elapsedRunMs } from '../../lib/run-limits.js';
import { formatDuration } from './format';
import { sendRuntime } from '../shared/chrome-runtime';
import type { useExtensionState } from './use-extension-state';
import type { SettingsDraft } from './types';

type Props = { extension: ReturnType<typeof useExtensionState>; draft: SettingsDraft; now: number };
export function FeiguaTaskPage({extension, draft, now}: Props) {
  const snapshot=extension.snapshot!;
  const state=snapshot.state || {};
  const details=snapshot.feigua;
  const active=state.status==='running' || state.status==='starting';
  const resumable=canResumeRun(state);
  const localOnly=snapshot.settings?.feiguaUploadEnabled !== true;
  const [limit,setLimit]=useState('50');
  const [minDelay,setMinDelay]=useState('4');
  const [maxDelay,setMaxDelay]=useState('6');
  const [keywords,setKeywords]=useState('');
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState('');
  const savedLimit=snapshot.settings?.feiguaTarget?.maxPages || 50;
  const savedMin=snapshot.settings?.feiguaDelay?.minSeconds ?? 4;
  const savedMax=snapshot.settings?.feiguaDelay?.maxSeconds ?? 6;
  useEffect(()=>{setMinDelay(String(savedMin));setMaxDelay(String(savedMax));},[savedMin,savedMax]);
  const savedKeywords=JSON.stringify((snapshot.rules as {feiguaKeywords?:string[]})?.feiguaKeywords || []);
  useEffect(()=>{setLimit(String(savedLimit));},[savedLimit]);
  useEffect(()=>{setKeywords((JSON.parse(savedKeywords) as string[]).join('\n'));},[savedKeywords]);
  const save=async()=>{
    setSaving(true);setNotice('');
    try {
      await sendRuntime({type:'DRA_SAVE_FEIGUA_CONFIG',maxPages:Number(limit),minSeconds:Number(minDelay),maxSeconds:Number(maxDelay),keywords:keywords.split(/[\n,，;；]+/).map(word=>word.trim()).filter(Boolean)});
      await extension.refresh();setNotice('已保存，下轮飞瓜采集生效');
    }catch(error){setNotice(error instanceof Error?error.message:String(error));}finally{setSaving(false);}
  };
  const phase:Record<string,string>={read:'读取当前页',submit:'保存本页候选',transition:'翻到下一页',idle:'准备采集下一页'};
  const statusLabel:Record<string,string>={running:'采集中',starting:'正在打开视频库',paused:'已暂停',stopped:'本轮已结束'};
  const busy=Boolean(extension.busyAction);
  return <>
    <section className="feigua-task-card"><h2>浏览自动采集</h2>
      <label className="check"><input type="checkbox" checked={snapshot.browsing?.enabled!==false} onChange={event=>{void sendRuntime({type:'DRA_SET_FEIGUA_BROWSING',enabled:event.target.checked}).then(()=>extension.refresh()).catch(error=>setNotice(String(error)));}} />随浏览保存飞瓜数据</label>
      <p className="field-note">适配视频库、视频详情和达人详情。用户负责点击，插件只读保存；暂停或结束自动翻页后继续生效。进入详情会暂停自动翻页。</p>
      <p className="field-note">{snapshot.pageRoute?.platform==='feigua' ? ['library','video','creator'].includes(snapshot.pageRoute.surface) ? `当前页面：${snapshot.pageRoute.label}` : '当前飞瓜页面尚未适配浏览采集' : '切换至飞瓜页面后进行浏览采集'}</p>
      <p className="field-note">已保存 {snapshot.browsing?.count || 0} 条观察{snapshot.browsing?.lastCapturedAt ? ` · 最近浏览采集 ${new Date(snapshot.browsing.lastCapturedAt).toLocaleTimeString('zh-CN')}` : ''}</p>
      {snapshot.browsing?.lastError ? <p role="alert">{snapshot.browsing.lastError}</p> : null}
    </section>
    <section className="feigua-task-card" aria-labelledby="feiguaTaskTitle">
      <div className="feigua-task-heading"><h2 id="feiguaTaskTitle">飞瓜视频库采集</h2><span className="badge">{localOnly?'仅本地保存':'汇总后上传'}</span></div>
      <p className="field-note">使用飞瓜页面上的筛选结果，逐页提取达人账号；命中规避词时排除整个账号。</p>
      <div className="feigua-progress" aria-live="polite"><strong>{Math.max(0,(details?.pageCount || 0)-(state.batchStartPages || 0))}<small> / {state.runTarget?.maxPages || savedLimit} 页（本批）</small></strong><span>{statusLabel[state.status || ''] || '准备开始'}</span></div>
      <dl className="feigua-metrics">
        <div><dt>已采集页</dt><dd>{details?.pageCount || 0}</dd></div>
        <div><dt>候选账号</dt><dd>{state.stats?.matched || 0}</dd></div>
        <div><dt>排除账号</dt><dd>{state.stats?.rejectedProfiles || 0}</dd></div>
        <div><dt>重复跳过</dt><dd>{state.stats?.duplicates || 0}</dd></div>
      </dl>
      <p className="field-note">累计采集 {formatDuration(elapsedRunMs(state,now))}{details?.pageNumber ? ` · 最近采集第 ${details.pageNumber} 页` : ''}{active ? ` · ${state.startupStage || phase[state.runtime?.phase || ''] || '准备采集'}` : ''}</p>
      {state.pauseReason || state.lastError ? <p className="feigua-recovery" role="status">{state.pauseReason || state.lastError}</p> : null}
      {state.restUntil ? <p className="feigua-recovery" role="status">建议休息至 {new Date(state.restUntil).toLocaleString('zh-CN')}。{now < state.restUntil ? '提前继续可能触发访问限制。' : '建议休息时间已到，可手动继续。'}继续后开始下一批，累计记录保留。</p> : null}
      <div className="actions">
        {active ? <button className="primary" disabled={busy} onClick={()=>void extension.run('pause',draft)}>{state.status==='starting'?'取消恢复':'暂停自动翻页'}</button> : <button className="primary" disabled={busy || (!localOnly && !snapshot.cloud?.connected)} onClick={()=>void extension.run(resumable?'resume':'start',draft)}>{resumable?(state.restUntil && now<state.restUntil?'知晓风险，提前继续':'继续采集'):'开始新一轮采集'}</button>}
        <button disabled={busy || !state.runId || state.status==='stopped'} onClick={()=>void extension.run('stop',draft)}>结束并保存</button>
      </div>
      <button className="feigua-open-page" disabled={busy} onClick={()=>void extension.openFeigua()}>打开飞瓜视频库</button>
      <p className="field-note">继续时自动恢复采集页，保留计数和账号去重记录；已采集的页面会跳过重复内容。重新打开网页后，请核对飞瓜筛选条件。{localOnly?'本轮结果只保存在本机，飞瓜历史待上传记录也暂停发送。':'结束后汇总到共用上传队列。'}</p>
    </section>
    {extension.notice.text ? <p className={`message ${extension.notice.error?'error':''}`} role="status">{extension.notice.text}</p> : null}
    <section className="feigua-task-card" aria-labelledby="feiguaCandidatesTitle">
      <h2 id="feiguaCandidatesTitle">{details?.finalized?'本轮已保存账号':'本轮候选账号'}</h2>
      <p className="field-note">显示前 10 个候选；后续页面命中规避词时会移除整个账号。</p>
      {details?.candidates?.length ? <ul className="feigua-candidates">{details.candidates.map((row,index)=><li key={row.profileUrl || `${row.name}-${index}`}>
        <div className="feigua-account-heading">{row.avatarUrl ? <img className="feigua-avatar" src={row.avatarUrl} alt={`${row.name}头像`} loading="lazy" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.style.display='none';}} /> : <span className="feigua-avatar" aria-hidden="true">{row.name.slice(0,1)}</span>}<div><strong>{row.name}</strong><p className="field-note">{row.followers ? `${row.followers} 粉丝` : '粉丝量未读取'}</p></div></div>
        <details><summary>已采集视频 · {row.videos?.length || 0} 条</summary>{row.videos?.map((video,i)=><article className="feigua-video" key={video.videoId || `${video.title}-${i}`}>
          {video.coverUrl ? <img className="feigua-cover" src={video.coverUrl} alt="视频封面" loading="lazy" referrerPolicy="no-referrer" /> : null}
          <p>{video.title || '标题未读取'}</p>
          <p className="field-note">{video.durationSeconds != null ? `时长 ${video.durationSeconds} 秒` : '时长未读取'}</p>
          <dl className="feigua-video-metrics">{['传播指数','播放','点赞','评论','分享','收藏','发布时间'].map(label=><div key={label}><dt>{label}</dt><dd>{video.metrics?.[label] || '未读取'}</dd></div>)}</dl>
          {video.hotWords?.length ? <p className="field-note">热词：{video.hotWords.join('、')}</p> : null}
        </article>)}</details>
      </li>)}</ul> : <p className="field-note">采集到符合条件的账号后会显示在这里。</p>}
    </section>
    <details className="disclosure feigua-config">
      <summary><strong>飞瓜采集设置</strong><span className="summary-copy">每批页数、翻页间隔与规避词</span></summary>
      <form onSubmit={event=>{event.preventDefault();void save();}}>
        <label className="field">每批采集页数<input type="number" min="1" max="500" step="1" value={limit} disabled={active || saving} onChange={event=>setLimit(event.target.value)} required /></label>
        <label className="field">翻页最短等待（秒）<input type="number" min="1" max="30" step="0.1" value={minDelay} disabled={active || saving} onChange={event=>setMinDelay(event.target.value)} required /></label>
        <label className="field">翻页最长等待（秒）<input type="number" min={minDelay || '1'} max="30" step="0.1" value={maxDelay} disabled={active || saving} onChange={event=>setMaxDelay(event.target.value)} required /></label>
        <p className="field-note">每页保存后在区间内随机等待，再翻下一页；另需等待列表加载。达到每批页数后自动暂停，建议休息至少 3 小时，可手动提前继续。到达当前筛选末页时结束本轮。随机等待仍有触发访问限制的风险。</p>
        <label className="field">整账号排除词<textarea rows={6} value={keywords} disabled={active || saving} onChange={event=>setKeywords(event.target.value)} /></label>
        <p className="field-note">每行一个词。视频标题、热词、话题或达人昵称命中时排除整个账号。修改只作用于新一轮飞瓜任务，暂停中的任务继续使用原规则。</p>
        <button type="submit" disabled={active || saving}>{saving?'保存中…':'保存飞瓜设置'}</button><p className="field-note" role="status">{notice}</p>
      </form>
    </details>
  </>;
}
