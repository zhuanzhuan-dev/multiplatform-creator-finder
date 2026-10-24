import { useEffect, useState } from 'react';
import { sendRuntime } from '../shared/chrome-runtime';
import { errorMessage } from '../shared/error-message';
import type { CloudState } from './types';

type Sync = CloudState['ruleSync'];
export function RuleSyncStatus({ sync, platform }: { sync: Sync; platform: string }) {
  const [current, setCurrent] = useState(sync);
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState('');
  useEffect(() => { setCurrent(sync); }, [sync]);
  const pending = current?.pending?.filter(item => item.platform === platform) || [];
  const last = current?.last?.platform === platform ? current.last : undefined;
  const error = requestError || current?.error || (last?.status === 'failed' ? last.error : '') || '';
  const message = errorMessage(error);
  const status = error ? '规则同步失败'
    : pending.length ? '已接收，下一轮生效'
    : last?.status === 'applied' ? '规则已采用'
    : last?.status === 'conflict' ? '配置已变化，请回工作台重新分析'
    : last?.status === 'failed' ? '应用失败，请回工作台重试'
    : '暂无待采用的规则建议';
  async function synchronize() {
    setBusy(true); setRequestError('');
    try { const result = await sendRuntime<{ok:boolean;status:Sync}>({type:'DRA_SYNC_RULES'}); setCurrent(result.status); }
    catch (cause) { setRequestError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <section className="setting-group" aria-label="反馈规则同步">
    <div className="setting-heading"><strong>反馈学习规则</strong></div>
    <p className="field-note">在工作台的采集记录中点击反馈，助手会生成判断选项与规则建议。采用后同步到这里。</p>
    <p className="field-note" role="status">{busy ? '正在同步规则…' : status}</p>
    {pending.map(item => <p className="field-note" key={item.id}>{item.explanation}</p>)}
    {pending.length > 0 && <p className="field-note">开始新一轮时采用；继续本轮保持当前规则。</p>}
    {error && <p className="message error" role="alert">{message}</p>}
    <button type="button" disabled={busy} onClick={() => void synchronize()}>{busy ? '同步中…' : '同步规则'}</button>
  </section>;
}
