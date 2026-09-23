import { errorMessage } from '../shared/error-message';
import { useEffect, useState } from 'react';
import { canResumeRun, elapsedRunMs } from '../../lib/run-limits.js';
import { formatDuration } from './format';
import { sendRuntime } from '../shared/chrome-runtime';
import { ConfigurationPanel } from './ConfigurationPanel';
import { ScheduleEditor, TermChips } from './components';
import type { useExtensionState } from './use-extension-state';
import { settingsDraft, type Settings, type SettingsDraft } from './types';

type Props = { extension: ReturnType<typeof useExtensionState>; draft: SettingsDraft; now: number };
export function FeiguaTaskPage({extension, draft, now}: Props) {
  const snapshot=extension.snapshot!;
  const state=snapshot.state || {};
  const details=snapshot.feigua;
  const active=state.status==='running' || state.status==='starting';
  const resumable=canResumeRun(state);
  const localOnly=Boolean(snapshot.settings?.dryRun || state.runSettings?.dryRun);
  const [limit,setLimit]=useState('50');
  const [minDelay,setMinDelay]=useState('4');
  const [maxDelay,setMaxDelay]=useState('6');
  const [keywords,setKeywords]=useState<string[]>([]);
  const [positiveKeywords,setPositiveKeywords]=useState<string[]>([]);
  const savedFeiguaSchedule=snapshot.settings?.feiguaSchedule as Settings["schedule"];
  const [scheduleDraft,setScheduleDraft]=useState<SettingsDraft>(() => settingsDraft({ schedule: savedFeiguaSchedule }));
  const savedSchedule=JSON.stringify(savedFeiguaSchedule || null);
  useEffect(()=>{setScheduleDraft(settingsDraft({ schedule: savedFeiguaSchedule }));},[savedSchedule]);
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState('');
  const savedLimit=snapshot.settings?.feiguaTarget?.maxPages || 50;
  const savedMin=snapshot.settings?.feiguaDelay?.minSeconds ?? 4;
  const savedMax=snapshot.settings?.feiguaDelay?.maxSeconds ?? 6;
  useEffect(()=>{setMinDelay(String(savedMin));setMaxDelay(String(savedMax));},[savedMin,savedMax]);
  const savedKeywords=JSON.stringify((snapshot.rules as {feiguaKeywords?:string[]})?.feiguaKeywords || []);
  const savedPositive=JSON.stringify((snapshot.rules as {feiguaPositiveKeywords?:string[]})?.feiguaPositiveKeywords || []);
  useEffect(()=>{setPositiveKeywords(JSON.parse(savedPositive) as string[]);},[savedPositive]);
  useEffect(()=>{setLimit(String(savedLimit));},[savedLimit]);
  useEffect(()=>{setKeywords(JSON.parse(savedKeywords) as string[]);},[savedKeywords]);
  const save=async()=>{
    setSaving(true);setNotice('');
    try {
      await sendRuntime({type:'DRA_SAVE_FEIGUA_CONFIG',maxPages:Number(limit),minSeconds:Number(minDelay),maxSeconds:Number(maxDelay),positiveKeywords,keywords,schedule:{enabled:scheduleDraft.scheduleEnabled,weekdays:scheduleDraft.scheduleWeekdays,times:scheduleDraft.scheduleTimes,target:{mode:scheduleDraft.scheduleTargetMode,durationMinutes:scheduleDraft.scheduleDurationMinutes,maxItems:scheduleDraft.scheduleMaxItems},reuseExistingTab:scheduleDraft.scheduleReuseExistingTab,lateToleranceMinutes:scheduleDraft.scheduleLateToleranceMinutes}});
      await extension.refresh();setNotice('已保存：浏览采集立即生效，自动翻页从新一轮生效');
    }catch(error){setNotice(error instanceof Error?error.message:String(error));}finally{setSaving(false);}
  };
  const phase:Record<string,string>={read:'读取当前页',submit:'保存本页候选',transition:'翻到下一页',idle:'准备采集下一页'};
  const statusLabel:Record<string,string>={running:'采集中',starting:'正在打开视频库',paused:'已暂停',stopped:'本轮已结束'};
  const busy=Boolean(extension.busyAction);
  return <>
    <section className="feigua-task-card" aria-labelledby="feiguaTaskTitle">
      <div className="feigua-task-heading"><h2 id="feiguaTaskTitle">飞瓜视频库采集</h2><span className="badge">{localOnly?'仅本地保存':'自动上传'}</span></div>

      <div className="feigua-progress" aria-live="polite"><strong>{Math.max(0,(details?.pageCount || 0)-(state.batchStartPages || 0))}<small> / {state.runTarget?.maxPages || savedLimit} 页（本批）</small></strong><span>{statusLabel[state.status || ''] || '准备开始'}</span></div>
      <dl className="feigua-metrics">
        <div><dt>已采集页</dt><dd>{details?.pageCount || 0}</dd></div>
        <div><dt>候选账号</dt><dd>{state.stats?.matched || 0}</dd></div>
        <div><dt>规则命中</dt><dd>{state.stats?.ruleMatched || 0}</dd></div>
        <div><dt>待人工确认</dt><dd>{state.stats?.reviewQueued || 0}</dd></div>
        <div><dt>排除账号</dt><dd>{state.stats?.rejectedProfiles || 0}</dd></div>
        <div><dt>重复跳过</dt><dd>{state.stats?.duplicates || 0}</dd></div>
      </dl>
      <p className="field-note">累计采集 {formatDuration(elapsedRunMs(state,now))}{details?.pageNumber ? ` · 最近采集第 ${details.pageNumber} 页` : ''}{active ? ` · ${state.startupStage || phase[state.runtime?.phase || ''] || '准备采集'}` : ''}</p>
      {state.pauseReason || state.lastError ? <p className="feigua-recovery" role="status">{errorMessage(state.pauseReason || state.lastError)}</p> : null}
      {state.restUntil ? <p className="feigua-recovery" role="status">建议休息至 {new Date(state.restUntil).toLocaleString('zh-CN')}。{now < state.restUntil ? '提前继续可能触发访问限制。' : '建议休息时间已到，可手动继续。'}继续后开始下一批，累计记录保留。</p> : null}
      <div className="actions">
        {active ? <button className="primary" disabled={busy} onClick={()=>void extension.run('pause',draft)}>{state.status==='starting'?'取消恢复':'暂停自动翻页'}</button> : <button className="primary" disabled={busy || (!localOnly && !snapshot.cloud?.connected)} onClick={()=>void extension.run(resumable?'resume':'start',draft)}>{resumable?(state.restUntil && now<state.restUntil?'知晓风险，提前继续':'继续采集'):'开始新一轮采集'}</button>}
        <button disabled={busy || !state.runId || state.status==='stopped'} onClick={()=>void extension.run('stop',draft)}>结束并保存</button>
      </div>
      <button className="feigua-open-page" disabled={busy} onClick={()=>void extension.openFeigua()}>打开飞瓜视频库</button>

    </section>
    {extension.notice.text ? <p className={`message ${extension.notice.error?'error':''}`} role="status">{extension.notice.text}</p> : null}
    <ConfigurationPanel runtime={
      <form className="disclosure-body" onSubmit={event=>{event.preventDefault();void save();}}>
        <section className="setting-group">
          <div className="setting-heading"><strong>采集节奏</strong><span>每批自动暂停</span></div>
          <div className="form-grid three-fields">
            <label>每批页数<input type="number" min="1" max="500" step="1" value={limit} disabled={active || saving} onChange={event=>setLimit(event.target.value)} required /></label>
            <label>最短等待（秒）<input type="number" min="1" max="30" step="0.1" value={minDelay} disabled={active || saving} onChange={event=>setMinDelay(event.target.value)} required /></label>
            <label>最长等待（秒）<input type="number" min={minDelay || '1'} max="30" step="0.1" value={maxDelay} disabled={active || saving} onChange={event=>setMaxDelay(event.target.value)} required /></label>
          </div>
          <p className="field-note">翻页前随机等待；每批结束建议休息 3 小时。</p>
        </section>
        <section className="setting-group">
          <label className="check"><input type="checkbox" checked={snapshot.browsing?.enabled!==false} onChange={event=>{void sendRuntime({type:'DRA_SET_FEIGUA_BROWSING',enabled:event.target.checked}).then(()=>extension.refresh()).catch(error=>setNotice(String(error)));}} />随浏览保存飞瓜数据</label>
          <p className="field-note">支持视频库和详情页 · 已保存 {snapshot.browsing?.count || 0} 条观察</p>
          {snapshot.browsing?.lastError ? <p role="alert">{errorMessage(snapshot.browsing.lastError)}</p> : null}
        </section>
        <ScheduleEditor draft={scheduleDraft} disabled={active || saving} onChange={setScheduleDraft} platform="feigua" />
        <button type="submit" disabled={active || saving}>{saving?'保存中…':'保存飞瓜设置'}</button>
        {notice ? <p className="field-note" role="status">{errorMessage(notice)}</p> : null}
      </form>
    } rules={
      <form className="disclosure-body rules-form" onSubmit={event=>{event.preventDefault();void save();}}>
        <section className="setting-group">
          <div className="setting-heading"><strong>想找的内容</strong><span>命中正向词 → 规则命中</span></div>
          <TermChips label="正向关键词" values={positiveKeywords} disabled={active || saving} onChange={setPositiveKeywords} />
        </section>
        <section className="setting-group">
          <div className="setting-heading"><strong>要剔除的内容</strong><span>负向优先 → 淘汰账号</span></div>
          <TermChips label="负向排除词" values={keywords} disabled={active || saving} onChange={setKeywords} />
        </section>
        <p className="field-note">点击＋添加词条，输入后按回车确认；匹配标题、热词、话题和昵称。其余待人工确认。</p>
        <p className="field-note">保存后浏览采集生效；自动翻页从新一轮生效。</p>
        <button type="submit" disabled={active || saving}>{saving?'保存中…':'保存飞瓜设置'}</button>
        {notice ? <p className="field-note" role="status">{errorMessage(notice)}</p> : null}
      </form>
    } />
    <details className="notice-disclosure">
      <summary>运行说明</summary>
      <p>自动翻页使用飞瓜当前筛选结果，按整账号判断。后续页面命中负向词会移除此前候选；浏览采集按本次页面的同账号内容判断。正向词留空或未命中时保留待人工确认。暂停后继续沿用本轮规则，保留计数和去重记录。</p>
      <p>随浏览采集适配视频库、视频详情和达人详情，用户负责点击，插件只读保存。进入详情会暂停自动翻页。重新打开网页后，请核对飞瓜筛选条件。</p>
      <p>自动翻页先滚动列表触发懒加载，行数据稳定后保存；图片最多额外等待 8 秒。列表等待 30 秒后仍未就绪时记录失败，并尝试下一页。达到批次页数暂停，到达末页结束。随机等待仍有触发访问限制的风险。</p>
      <p>{localOnly?'本轮结果只保存在本机，正式采集的历史待上传记录继续发送。':'每页保存后进入共用上传队列。'}</p>
    </details>
  </>;
}
