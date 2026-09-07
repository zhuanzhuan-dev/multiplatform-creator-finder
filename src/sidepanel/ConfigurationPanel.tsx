import { useRef, useState } from 'react';
import type { ReactNode, KeyboardEvent } from 'react';

export function ConfigurationPanel({ runtime, rules }: { runtime: ReactNode; rules: ReactNode }) {
  const [selected, setSelected] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const labels = ['运行设置', '视频与账号规则'];
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? 1 - index : null;
    if (next === null) return;
    event.preventDefault(); setSelected(next); buttons.current[next]?.focus();
  };
  return <details className="disclosure configuration-panel">
    <summary><strong>任务设置</strong><span className="summary-copy">运行方式与筛选规则</span><svg className="configuration-chevron" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></summary>
    <div className="configuration-tabs" role="tablist" aria-label="任务设置分类">
      {labels.map((label, index) => <button key={label} ref={element => { buttons.current[index] = element; }} type="button" role="tab" id={`configuration-tab-${index}`} aria-selected={selected === index} aria-controls={`configuration-panel-${index}`} tabIndex={selected === index ? 0 : -1} onKeyDown={event => navigate(event, index)} onClick={() => setSelected(index)}>{label}</button>)}
    </div>
    {[runtime, rules].map((content, index) => <div key={index} role="tabpanel" id={`configuration-panel-${index}`} aria-labelledby={`configuration-tab-${index}`} hidden={selected !== index}>{content}</div>)}
  </details>;
}
