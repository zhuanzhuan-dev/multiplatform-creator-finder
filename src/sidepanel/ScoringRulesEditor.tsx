import { NumberInput, inputNumber } from '../shared/NumberInput';
import type { ScoringRules } from './types';

export function ScoringRulesEditor({ value, disabled, onChange }: { value: ScoringRules; disabled: boolean; onChange(value: ScoringRules): void }) {
  const setLikes = (index: number, patch: Partial<ScoringRules['likes'][number]>) => onChange({ ...value, likes: value.likes.map((row, i) => i === index ? { ...row, ...patch } : row) });
  const setFollowers = (index: number, patch: Partial<ScoringRules['followers'][number]>) => onChange({ ...value, followers: value.followers.map((row, i) => i === index ? { ...row, ...patch } : row) });
  const optionalNumber = (text: string) => text === '' ? null : Number(text);
  return <section className="setting-group" aria-labelledby="scoringRulesTitle">
    <div className="setting-heading"><strong id="scoringRulesTitle">评分与分级</strong><span>各平台独立保存</span></div>
    <p className="field-note">同一项命中多档时取最高加分；均赞、粉丝与内容类目加分相加。均赞未读到时使用当前视频点赞。</p>
    <details className="category-editor">
      <summary><span className="category-dot" aria-hidden="true" /><span><strong>平均点赞加分</strong><small>{value.likes.length} 个档位</small></span></summary>
      <div className="category-fields">
        <p className="field-note">原“优选点赞”已迁入此处及 S 级最低均赞，两处可独立调整。删除全部档位后，该项不加分。</p>
        {value.likes.map((row, i) => <div key={i}>
          <div className="form-grid">
            <label>均赞下限<NumberInput aria-label={`均赞档位 ${i + 1} 下限`} min="0" value={row.min} disabled={disabled} onChange={e => setLikes(i, { min: inputNumber(e.target.value) })} /></label>
            <label>加分<NumberInput aria-label={`均赞档位 ${i + 1} 加分`} min="0" max="100" value={row.points} disabled={disabled} onChange={e => setLikes(i, { points: inputNumber(e.target.value) })} /></label>
          </div>
          <button type="button" className="danger-text compact" disabled={disabled} onClick={() => onChange({ ...value, likes: value.likes.filter((_, index) => index !== i) })}>删除均赞档位 {i + 1}</button>
        </div>)}
        <button type="button" className="add-category" disabled={disabled} onClick={() => onChange({ ...value, likes: [...value.likes, { min: 0, points: 0 }] })}>＋ 添加均赞档位</button>
      </div>
    </details>
    <details className="category-editor">
      <summary><span className="category-dot" aria-hidden="true" /><span><strong>粉丝区间加分</strong><small>{value.followers.length} 个档位</small></span></summary>
      <div className="category-fields">
        <p className="field-note">区间包含上下限；上限留空表示不限。删除全部档位后，该项不加分。</p>
        {value.followers.map((row, i) => <div key={i}>
          <div className="form-grid">
            <label>粉丝下限<NumberInput aria-label={`粉丝档位 ${i + 1} 下限`} min="0" value={row.min} disabled={disabled} onChange={e => setFollowers(i, { min: inputNumber(e.target.value) })} /></label>
            <label>粉丝上限<NumberInput aria-label={`粉丝档位 ${i + 1} 上限`} allowEmpty placeholder="不限" min={row.min || 0} value={row.max ?? ''} disabled={disabled} onChange={e => setFollowers(i, { max: optionalNumber(e.target.value) })} /></label>
            <label>加分<NumberInput aria-label={`粉丝档位 ${i + 1} 加分`} min="0" max="100" value={row.points} disabled={disabled} onChange={e => setFollowers(i, { points: inputNumber(e.target.value) })} /></label>
          </div>
          <button type="button" className="danger-text compact" disabled={disabled} onClick={() => onChange({ ...value, followers: value.followers.filter((_, index) => index !== i) })}>删除粉丝档位 {i + 1}</button>
        </div>)}
        <button type="button" className="add-category" disabled={disabled} onClick={() => onChange({ ...value, followers: [...value.followers, { min: 0, max: null, points: 0 }] })}>＋ 添加粉丝档位</button>
      </div>
    </details>
    <p className="field-note">分级按 S → A 顺序判断，需同时满足该级全部条件；均未满足时为 B 级。分级独立于总分。</p>
    {(['S', 'A'] as const).map(level => {
      const row = value.levels[level];
      const set = (patch: Partial<typeof row>) => onChange({ ...value, levels: { ...value.levels, [level]: { ...row, ...patch } } });
      return <details className="category-editor" key={level}>
        <summary><span className="category-dot" aria-hidden="true" /><span><strong>{level} 级条件</strong><small>{row.enabled ? '已启用' : '已关闭'}</small></span></summary>
        <div className="category-fields">
          <label className="check"><input type="checkbox" checked={row.enabled} disabled={disabled} onChange={e => set({ enabled: e.target.checked })} />启用 {level} 级</label>
          <div className="form-grid">
            <label>粉丝下限<NumberInput aria-label={`${level} 级粉丝下限`} min="0" value={row.minFollowers} disabled={disabled || !row.enabled} onChange={e => set({ minFollowers: inputNumber(e.target.value) })} /></label>
            <label>粉丝上限<NumberInput aria-label={`${level} 级粉丝上限`} allowEmpty placeholder="不限" min={row.minFollowers || 0} value={row.maxFollowers ?? ''} disabled={disabled || !row.enabled} onChange={e => set({ maxFollowers: optionalNumber(e.target.value) })} /></label>
            <label>最低均赞<NumberInput aria-label={`${level} 级最低均赞`} min="0" value={row.minAverageLikes} disabled={disabled || !row.enabled} onChange={e => set({ minAverageLikes: inputNumber(e.target.value) })} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={row.requireCategory} disabled={disabled || !row.enabled} onChange={e => set({ requireCategory: e.target.checked })} />要求命中内容类目</label>
        </div>
      </details>;
    })}
  </section>;
}
