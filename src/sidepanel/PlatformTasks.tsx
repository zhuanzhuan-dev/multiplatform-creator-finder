import { useEffect, useRef, useState } from "react";
import type { RunState } from './types';

type Props = { tasks: RunState[]; selected: string; resolved?: string; busy: boolean; onSelect: (platform: string) => void };
const platforms = [{id:'douyin',label:'抖音推荐',unit:'条'}, {id:'feigua',label:'飞瓜视频库',unit:'页'}];
const statuses: Record<string,string> = {running:'运行中',starting:'启动中',paused:'已暂停',stopped:'已结束'};
export function PlatformTasks({tasks,selected,resolved,busy,onSelect}: Props) {
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const close=()=>{setOpen(false);trigger.current?.focus();};
  useEffect(()=>{
    if(!open) return;
    root.current?.querySelector<HTMLInputElement>('input')?.focus();
    const outside=(event:Event)=>{if(event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close();}};
    document.addEventListener('pointerdown',outside);
    document.addEventListener('focusin',outside);
    document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  const current = selected === 'auto' ? resolved : selected;
  const currentLabel = platforms.find(platform=>platform.id===current)?.label;
  return <div className="platform-picker" ref={root}>
    <button ref={trigger} className="platform-trigger" aria-label={`平台任务：${currentLabel || '自动跟随'}`} aria-haspopup="dialog" aria-expanded={open} aria-controls="platformTasksPopover" onClick={()=>setOpen(!open)}>
      {currentLabel ? <span className={`platform-logo ${current}`}><img src={`../brands/${current}.${current==='feigua'?'png':'ico'}`} alt="" /></span> : null}
      <span>{current==='feigua'?'飞瓜':current==='douyin'?'抖音':'平台'}</span><span aria-hidden="true">⌄</span>
    </button>
    <section id="platformTasksPopover" className="platform-tasks platform-popover" role="dialog" hidden={!open} aria-labelledby="platformTasksTitle">
    <div className="platform-heading">
      <h2 id="platformTasksTitle">平台任务</h2>
      <label className="platform-follow">自动跟随<input type="checkbox" role="switch" checked={selected==='auto'} disabled={busy} onChange={event=>onSelect(event.target.checked?'auto':currentLabel?current!:'douyin')} /><span className="follow-track" aria-hidden="true" /></label>
    </div>
    <div className="platform-list" role="group" aria-label="选择要控制的平台">
      {platforms.map(platform=>{
        const task=tasks.find(item=>item.route?.platform===platform.id);
        const count=platform.id==='feigua'?task?.stats?.pagesCollected:task?.stats?.scanned;
        const chosen=current===platform.id;
        return <button key={platform.id} className="platform-row" aria-pressed={chosen} disabled={busy} onClick={()=>{onSelect(platform.id);close();}}>
          <span className={`platform-logo ${platform.id}`}><img src={`../brands/${platform.id}.${platform.id==='feigua'?'png':'ico'}`} alt="" /></span>
          <span className="platform-copy"><strong>{platform.label}</strong><span>{statuses[task?.status || ''] || '未开始'} · {count || 0} {platform.unit}</span></span>
          <span className="platform-selection" aria-hidden="true">{chosen?'✓':'›'}</span>
        </button>;
      })}
    </div>
    <details className="platform-help"><summary>{currentLabel?`当前操作仅作用于${currentLabel}`:'切换到抖音或飞瓜网页以跟随任务'}</summary><p>选择任务只切换控制对象。开启自动跟随后随当前标签页切换；手动选择平台会关闭自动跟随。两个平台可同时运行，暂停、继续和结束各自独立。</p></details>
  </section></div>;
}
