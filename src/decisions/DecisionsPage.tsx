import { errorMessage } from '../shared/error-message';
import { useEffect, useRef, useState } from 'react';
import { decisionMeta, formatLocalDateTime } from '../sidepanel/format';
import type { Decision } from '../sidepanel/types';
import { sendRuntime } from '../shared/chrome-runtime';
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
  const [data,setData]=useState<HistoryResponse|null>(null);
  const [filters,setFilters]=useState({sourcePlatform:'',runId:'',query:'',tone:''});
  const [page,setPage]=useState<{cursor:Cursor;previous:Cursor[];asOf?:number}>({cursor:null,previous:[]});
  const [revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const sequence=useRef(0);
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==='visible')setRevision(r=>r+1);};
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
    <header className="page-header"><div><p className="eyebrow">DISCOVERY / HISTORY</p><h1>近 24 小时记录</h1><p className="subtitle">从当前时间往前推 24 小时，跨轮次保留；每页 50 条，到期自动清理。</p></div><span className="run-status">本机历史</span></header>
    <section className="decision-rail" aria-label="处理结果汇总">
      {[['','全部记录',counts.good+counts.review+counts.reject],['good','符合条件',counts.good],['review','需人工确认',counts.review],['reject','淘汰与跳过',counts.reject]].map(([tone,label,count])=><button key={tone} className={`${tone} ${filters.tone===tone?'selected':''}`} onClick={()=>change({tone:String(tone)})}><span>{label}</span><strong>{count}</strong></button>)}
    </section>
    <section className="ledger" aria-labelledby="ledgerTitle" aria-busy={busy}>
      <div className="ledger-toolbar"><div><h2 id="ledgerTitle">处理记录</h2><span>{busy?'读取中…':`匹配 ${data?.total || 0} 条`}</span></div>
        <label>平台来源<select aria-label="筛选平台来源" value={filters.sourcePlatform} onChange={e=>change({sourcePlatform:e.target.value,runId:''})}><option value="">全部来源</option>{Object.entries(SOURCE_PLATFORMS).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label>轮次<select aria-label="筛选轮次" value={filters.runId} onChange={e=>change({runId:e.target.value})}><option value="">全部轮次</option>{data?.runs.map(run=><option key={run.id} value={run.id}>{formatLocalDateTime(run.startedAt)}</option>)}</select></label>
        <label><span className="visually-hidden">搜索账号或原因</span><input type="search" value={filters.query} placeholder="搜索账号、结果或原因" onChange={e=>change({query:e.target.value})} /></label>
      </div>
      {error?<p className="empty-state" role="alert">{errorMessage(error)}<button onClick={()=>setRevision(r=>r+1)}>重试</button></p>:!data?<p className="empty-state">正在读取记录…</p>:visible.length===0?<p className="empty-state">近 24 小时内没有符合条件的记录。</p>:<div className="table-scroll"><table>
        <thead><tr><th>时间</th><th>平台来源</th><th>账号</th><th>处理结果</th><th>处理依据</th><th><span className="visually-hidden">操作</span></th></tr></thead>
        <tbody>{visible.map((decision,index)=>{const meta=decisionMeta(decision.code);return <tr key={decision.id || index}>
          <td data-label="时间"><time dateTime={decision.occurredAt}>{formatLocalDateTime(decision.occurredAt)}</time></td>
          <td data-label="平台来源">{sourcePlatformLabel(decision.sourcePlatform)}</td>
          <td data-label="账号"><span className="creator"><DecisionAvatar decision={decision} /><strong>{decision.accountName || '未识别账号'}</strong></span></td>
          <td data-label="处理结果"><span className={`decision-badge ${meta.tone}`}>{meta.label}</span></td>
          <td data-label="处理依据" className="reason">{decision.reasons?.map(errorMessage).join(' · ') || decision.code}</td>
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
