import type { SettingsDraft } from './types';

export function EngagementSettings({ draft, disabled, onChange, saveStatus }: { draft: SettingsDraft; disabled: boolean; onChange(value: SettingsDraft): void; saveStatus: string }) {
  const validRate = Number.isInteger(draft.engagementRate) && Number(draft.engagementRate) >= 0 && Number(draft.engagementRate) <= 100;
  const all = draft.engagementLike && draft.engagementCollect && draft.engagementFollow;
  return <div className="engagement-settings" aria-labelledby="engagement-title">
    <div className="setting-heading inline-heading"><span><strong id="engagement-title">正向互动</strong><small>全部类目共用 · 默认关闭</small></span><button className="compact" disabled={disabled} onClick={() => onChange({ ...draft, engagementLike: !all, engagementCollect: !all, engagementFollow: !all })}>{all ? '全部取消' : '一键全选'}</button></div>
    <div className="engagement-actions">
      {([['engagementLike', '点赞 Z'], ['engagementCollect', '收藏 C'], ['engagementFollow', '关注 G']] as const).map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={draft[key]} disabled={disabled} onChange={event => onChange({ ...draft, [key]: event.target.checked })} />{label}</label>)}
    </div>
    <div className="engagement-rate"><label htmlFor="engagementRate">每项配额上限</label><div className="percent-input"><input id="engagementRate" aria-invalid={!validRate} aria-describedby="engagement-rate-help" type="number" inputMode="numeric" min="0" max="100" step="1" value={draft.engagementRate} disabled={disabled} onChange={event => onChange({ ...draft, engagementRate: event.target.value === '' ? '' : Number(event.target.value) })} /><span aria-hidden="true">%</span></div></div>
    {!validRate ? <p id="engagement-rate-help" className="message error" role="alert">请输入 0–100 的整数百分比</p> : null}
    <div className="engagement-presets" aria-label="互动比例预设">{[5, 10, 20].map(rate => <button key={rate} className="compact" aria-pressed={draft.engagementRate === rate} disabled={disabled} onClick={() => onChange({ ...draft, engagementRate: rate })}>{rate}%</button>)}</div>
    <p className="field-note">{validRate ? `每处理 100 条普通视频，每项最多 ${draft.engagementRate} 次。` : '填写比例后计算配额。'} 仅对明确符合规则的正向内容互动。</p>
    <details className="engagement-help"><summary>配额与生效说明</summary>
      <p className="field-note">通过视频与账号筛选，且命中“想找的内容”时才互动；需人工确认的内容跳过。统一百分比分别限制三项操作，不按类目配置。</p>
      <p className="field-note">按本轮新处理的普通视频数向下取整：10% 时，前 9 条没有配额，每满 10 条增加 1 次。配额是上限，不保证用完。暂停继续保留配额；设置在新一轮生效。</p>
      <p className="field-note">使用 Z / C / G 快捷键，不检查点赞、收藏或关注状态；已有操作可能被取消。本轮同一视频或作者仅发送一次对应按键，发送不确定时仍占配额且不重试。</p>
    </details>
    <p className="field-note" role="status">{saveStatus}</p>
  </div>;
}
