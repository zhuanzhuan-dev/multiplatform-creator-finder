import { useEffect, useRef, useState } from "react";
import type { RunState } from './types';

type Props = { tasks: RunState[]; selected: string; resolved?: string; busy: boolean; onSelect: (platform: string) => void };
const platforms = [
  {id:'douyin',label:'抖音推荐',unit:'条',brand:'douyin'},
  {id:'kuaishou',label:'快手推荐',unit:'条',brand:'kuaishou'},
  {id:'bilibili',label:'B站首页推荐',unit:'条',brand:'bilibili'},
  {id:'bilibili-popular',label:'B站综合热门',unit:'条',brand:'bilibili'},
  {id:'feigua',label:'飞瓜视频库',unit:'页',brand:'feigua'},
  {id:'xingtu',label:'星图达人广场',unit:'页',brand:'xingtu'}
];
const statuses: Record<string,string> = {running:'运行中',starting:'启动中',paused:'已暂停',stopped:'已结束'};
const platformShort: Record<string,string> = {douyin:'抖音',kuaishou:'快手',bilibili:'B站', 'bilibili-popular':'热门', feigua:'飞瓜', xingtu:'星图'};

function taskFor(tasks: RunState[], platformId: string) {
  if (platformId === 'bilibili') return tasks.find(item => item.route?.platform === 'bilibili' && item.route?.surface !== 'popular');
  if (platformId === 'bilibili-popular') return tasks.find(item => item.route?.platform === 'bilibili' && item.route?.surface === 'popular')
    || tasks.find(item => item.route?.platform === 'bilibili' && ['starting','running','paused'].includes(item.status || '') && item.route?.surface === 'popular');
  return tasks.find(item => item.route?.platform === platformId);
}

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
  const currentMeta = platforms.find(platform=>platform.id===current);
  const brand = currentMeta?.brand || current;
  return <div className="platform-picker" ref={root}>
    <button ref={trigger} className="platform-trigger" aria-label={`平台任务：${currentMeta?.label || '自动跟随'}`} aria-haspopup="dialog" aria-expanded={open} aria-controls="platformTasksPopover" onClick={()=>setOpen(!open)}>
      {currentMeta ? <span className={`platform-logo ${brand}`}><img src={`../brands/${brand}.${brand==='feigua'?'png':'ico'}`} alt="" /></span> : null}
      <span>{platformShort[current || ''] || '平台'}</span><span aria-hidden="true">⌄</span>
    </button>
    <section id="platformTasksPopover" className="platform-tasks platform-popover" role="dialog" hidden={!open} aria-labelledby="platformTasksTitle">
    <div className="platform-heading">
      <h2 id="platformTasksTitle">平台任务</h2>
      <label className="platform-follow">自动跟随<input type="checkbox" role="switch" checked={selected==='auto'} disabled={busy} onChange={event=>onSelect(event.target.checked?'auto':currentMeta?current!:'douyin')} /><span className="follow-track" aria-hidden="true" /></label>
    </div>
    <div className="platform-list" role="group" aria-label="选择要控制的平台">
      {platforms.map(platform=>{
        const task=taskFor(tasks, platform.id);
        const count=['feigua','xingtu'].includes(platform.id)?task?.stats?.pagesCollected:task?.stats?.scanned;
        const chosen=current===platform.id;
        return <button key={platform.id} className="platform-row" aria-pressed={chosen} disabled={busy} onClick={()=>{onSelect(platform.id);close();}}>
          <span className={`platform-logo ${platform.brand}`}><img src={`../brands/${platform.brand}.${platform.brand==='feigua'?'png':'ico'}`} alt="" /></span>
          <span className="platform-copy"><strong>{platform.label}</strong><span>{statuses[task?.status || ''] || '未开始'} · {count || 0} {platform.unit}</span></span>
          <span className="platform-selection" aria-hidden="true">{chosen?'✓':'›'}</span>
        </button>;
      })}
    </div>
    <details className="platform-help"><summary>{currentMeta?`当前操作仅作用于${currentMeta.label}`:'切换到抖音、快手、B站、飞瓜或星图网页以跟随任务'}</summary><p>B 站首页推荐与综合热门各自独立运行、目标和规则分开保存，可并行采集；飞瓜和星图按已登录网页翻页采集。各平台可切换控制，上传共用队列。</p></details>
  </section></div>;
}
