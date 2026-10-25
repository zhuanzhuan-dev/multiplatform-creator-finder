import { DecisionIpLocation } from '../shared/DecisionIpLocation';
import { DecisionRuleMatch } from '../shared/DecisionRuleMatch';
import { errorMessage } from '../shared/error-message';
import { useEffect, useRef, useState } from 'react';
import { decisionMeta, decisionMetricLine, formatLocalDateTime } from '../sidepanel/format';
import type { Decision, RunState } from '../sidepanel/types';
import { sendRuntime } from '../shared/chrome-runtime';
import { AccountVideosControl } from '../shared/AccountVideosControl';
import { SOURCE_PLATFORMS, sourcePlatformLabel } from '../../lib/source-platform.js';

type Cursor = {at:number;id:string} | null;
interface HistoryResponse {
  ok:boolean; items:Decision[]; total:number; counts:{good:number;review:number;reject:number};
  runs:{id:string;startedAt:string}[]; nextCursor:Cursor; asOf:number;
}
function DecisionAvatar({decision}:{decision:Decision}) {
  const [failed,setFailed]=useState(false);
  if (!decision.avatarUrl || failed) return <span className="avatar-fallback" aria-hidden="true">{(decision.accountName || '?').slice(0,1)}</span>;
  return <img src={decision.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)} />;
}
export function DecisionsPage() {
  const [tasks,setTasks]=useState<RunState[]>([]);
  const [data,setData]=useState<HistoryResponse|null>(null);
  const [filters,setFilters]=useState({sourcePlatform:'',taskId:'',runId:'',query:'',tone:''});
  const [page,setPage]=useState<{cursor:Cursor;previous:Cursor[];asOf?:number}>({cursor:null,previous:[]});
  const [revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [now,setNow]=useState(Date.now());
  const sequence=useRef(0);
  useEffect(()=>{
    const loadTasks=()=>void sendRuntime<{ok:boolean;tasks:RunState[]}>({type:'DRA_GET_STATUS',platform:'douyin'}).then(result=>setTasks(result.tasks)).catch(()=>undefined);
    loadTasks();
    const refresh=()=>{loadTasks();if(document.visibilityState==='visible'){setRevision(r=>r+1);setNow(Date.now());}};
    const listener=(message:{type?:string})=>{if(message.type==='DRA_HISTORY_CHANGED')refresh();};
    chrome.runtime.onMessage.addListener(listener);
    document.addEventListener('visibilitychange',refresh);
    const timer=setInterval(refresh,60_000);
    return ()=>{clearInterval(timer);chrome.runtime.onMessage.removeListener(listener);document.removeEventListener('visibilitychange',refresh);};
  },[]);
  useEffect(()=>{
    const id=++sequence.current;setBusy(true);setError('');
    const timer=setTimeout(()=>{
      void sendRuntime<HistoryResponse>({type:'DRA_QUERY_HISTORY',options:{...filters,cursor:page.cursor,asOf:page.asOf}})
        .then(result=>{if(id===sequence.current)setData(result);})
        .catch(e=>{if(id===sequence.current)setError(e.message);})
        .finally(()=>{if(id===sequence.current)setBusy(false);});
    },150);
    return ()=>{clearTimeout(timer);sequence.current++;};
  },[filters,page,revision]);
  const change=(patch:Partial<typeof filters>)=>{setFilters(f=>({...f,...patch}));setPage({cursor:null,previous:[]});};
  const counts=data?.counts || {good:0,review:0,reject:0};
  const visible=data?.items || [];
  return <main>
    <header className="page-header"><div><p className="eyebrow">DISCOVERY / HISTORY</p><h1>近 24 小时记录</h1><p className="subtitle">从当前时间往前推 24 小时，跨轮次保留；每页 50 条，到期自动清理。视频来源可点「视频」查看播放、时长和互动数据；星图显示达人资料。</p></div><span className="run-status">本机历史</span></header>
    <section className="decision-rail" aria-label="处理结果汇总">
      {[['','全部记录',counts.good+counts.review+counts.reject],['good','符合条件',counts.good],['review','需人工确认',counts.review],['reject','淘汰与跳过',counts.reject]].map(([tone,label,count])=><button key={tone} className={`${tone} ${filters.tone===tone?'selected':''}`} onClick={()=>change({tone:String(tone)})}><span>{label}</span><strong>{count}</strong></button>)}
    </section>
    <section className="ledger" aria-labelledby="ledgerTitle" aria-busy={busy}>
      <div className="ledger-toolbar"><div><h2 id="ledgerTitle">处理记录</h2><span>{busy?'读取中…':`匹配 ${data?.total || 0} 条`}</span></div>
        <label>平台来源<select aria-label="筛选平台来源" value={filters.sourcePlatform} onChange={e=>change({sourcePlatform:e.target.value,taskId:'',runId:''})}><option value="">全部来源</option>{Object.entries(SOURCE_PLATFORMS).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label>运行任务<select aria-label="筛选运行任务" value={filters.taskId} onChange={e=>change({taskId:e.target.value,runId:''})}><option value="">全部任务</option>{tasks.filter(task=>!filters.sourcePlatform || task.route?.platform===filters.sourcePlatform).map(task=>{const id=task.taskId || (task.route?.platform==='bilibili' && task.route.surface==='popular'?'bilibili-popular':task.route?.platform);return <option key={id} value={id}>{task.route?.label} · {task.taskName || '默认任务'}</option>;})}</select></label>
        <label>轮次<select aria-label="筛选轮次" value={filters.runId} onChange={e=>change({runId:e.target.value})}><option value="">全部轮次</option>{data?.runs.map(run=><option key={run.id} value={run.id}>{formatLocalDateTime(run.startedAt)}</option>)}</select></label>
        <label><span className="visually-hidden">搜索账号或原因</span><input type="search" value={filters.query} placeholder="搜索账号、结果或原因" onChange={e=>change({query:e.target.value})} /></label>
      </div>
      {error?<p className="empty-state" role="alert">{errorMessage(error)}<button onClick={()=>setRevision(r=>r+1)}>重试</button></p>:!data?<p className="empty-state">正在读取记录…</p>:visible.length===0?<p className="empty-state">近 24 小时内没有符合条件的记录。</p>:<div className="table-scroll"><table>
        <thead><tr><th>时间</th><th>平台来源</th><th>账号</th><th>采集内容</th><th>处理结果</th><th>处理依据</th><th><span className="visually-hidden">操作</span></th></tr></thead>
        <tbody>{visible.map((decision,index)=>{const meta=decisionMeta(decision.code);return <tr key={decision.id || index}>
          <td data-label="时间"><time dateTime={decision.occurredAt}>{formatLocalDateTime(decision.occurredAt)}</time></td>
          <td data-label="平台来源">{sourcePlatformLabel(decision.sourcePlatform)}<small className="creator-meta">{decision.taskName || '默认任务'}</small></td>
          <td data-label="账号"><span className="creator"><DecisionAvatar decision={decision} /><span className="creator-copy"><strong>{decision.accountName || '未识别账号'}</strong>{decision.sourcePlatform === 'douyin' || decision.ipLocationStatus || decision.tname ? <span className="creator-meta"><DecisionIpLocation decision={decision} />{decision.tname ? <small>{decision.tname}</small> : null}</span> : null}</span></span></td>
          <td data-label="采集内容" className="video-cell">
            {decision.sourcePlatform === 'xingtu' ? <div className="video-summary"><strong>达人资料</strong>{decision.authorId ? <span>星图 ID：{decision.authorId}</span> : null}{decision.xingtuCreator ? <>
              <span>{[decision.xingtuCreator.followers && `粉丝 ${decision.xingtuCreator.followers}`,decision.xingtuCreator.metrics?.['预期CPM'] && `预期CPM ${decision.xingtuCreator.metrics['预期CPM']}`].filter(Boolean).join(' · ') || '星图未提供粉丝量和预期CPM'}</span>
              {decision.xingtuCreator.tags.length ? <span>标签：{decision.xingtuCreator.tags.join('、')}</span> : null}
            </> : decision.code === 'XINGTU_OBSERVED' ? <span>达人指标暂未显示</span> : null}</div> : decision.sourcePlatform === 'huxuan' ? <div className="video-summary"><strong>视频号达人资料</strong><span>视频号 ID：{decision.authorId || '待补数'}</span></div> : <>
              <div className="video-summary">
                <strong>{decision.caption || decision.videoId || '—'}</strong>
                <span>{decisionMetricLine(decision)}</span>
              </div>
              <AccountVideosControl decision={decision} now={now} />
            </>}
          </td>
          <td data-label="处理结果"><span className={`decision-badge ${meta.tone}`}>{meta.label}</span></td>
          <td data-label="处理依据" className="reason"><DecisionRuleMatch decision={decision} /></td>
          <td className="row-action">{decision.profileUrl?<a href={decision.profileUrl} target="_blank" rel="noreferrer">查看主页 ↗</a>:<span>—</span>}</td>
        </tr>;})}</tbody>
      </table></div>}
      <nav className="history-pagination" aria-label="记录分页">
        <button disabled={busy||!page.previous.length} onClick={()=>setPage(p=>({cursor:p.previous.at(-1) || null,previous:p.previous.slice(0,-1),asOf:p.previous.length>1?p.asOf:undefined}))}>上一页</button>
        <span>第 {page.previous.length+1} 页</span>
        <button disabled={busy||!data?.nextCursor} onClick={()=>{if(data?.nextCursor)setPage(p=>({cursor:data.nextCursor,previous:[...p.previous,p.cursor],asOf:data.asOf}));}}>下一页</button>
        <button disabled={busy} onClick={()=>{setPage({cursor:null,previous:[]});setRevision(r=>r+1);}}>刷新最新</button>
      </nav>
    </section>
  </main>;
}
