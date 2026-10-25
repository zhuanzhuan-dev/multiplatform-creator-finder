import { useEffect, useRef, useState } from 'react';
import type { RunState } from './types';

type Props = {
  tasks: RunState[]; selected: string; resolved?: string; busy: boolean;
  onSelect: (taskId: string) => void;
  onCreate: (platform: string, name: string) => Promise<void>;
  onRename: (taskId: string, name: string) => Promise<void>;
};
const platforms = [
  {id:'douyin',label:'抖音推荐',unit:'条',brand:'douyin'},
  {id:'kuaishou',label:'快手推荐',unit:'条',brand:'kuaishou'},
  {id:'bilibili',label:'B站首页推荐',unit:'条',brand:'bilibili'},
  {id:'bilibili-popular',label:'B站综合热门',unit:'条',brand:'bilibili'},
  {id:'feigua',label:'飞瓜视频库',unit:'页',brand:'feigua'},
  {id:'xingtu',label:'星图达人广场',unit:'页',brand:'xingtu'},
  {id:'huxuan',label:'腾讯互选视频号',unit:'页',brand:'huxuan'}
];
const statuses: Record<string,string> = {running:'运行中',starting:'启动中',paused:'已暂停',stopped:'已结束'};
const platformShort: Record<string,string> = {douyin:'抖音',kuaishou:'快手',bilibili:'B站', 'bilibili-popular':'热门', feigua:'飞瓜', xingtu:'星图', huxuan:'互选'};
function platformOf(task?: RunState) {
  return task?.route?.platform === 'bilibili' && task.route.surface === 'popular' ? 'bilibili-popular' : task?.route?.platform;
}

export function PlatformTasks({tasks,selected,resolved,busy,onSelect,onCreate,onRename}: Props) {
  const [open,setOpen]=useState(false);
  const [expanded,setExpanded]=useState<string|null>(null);
  const [editing,setEditing]=useState<{platform:string;taskId?:string}|null>(null);
  const [name,setName]=useState('');
  const [error,setError]=useState('');
  const root=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const nameInput=useRef<HTMLInputElement>(null);
  const addButton=useRef<HTMLButtonElement>(null);
  const editorTrigger=useRef<HTMLButtonElement|null>(null);
  const dismiss=()=>{setOpen(false);setExpanded(null);setEditing(null);setError('');};
  const close=()=>{dismiss();trigger.current?.focus();};
  useEffect(()=>{
    if(!open) return;
    (root.current?.querySelector<HTMLButtonElement>('.platform-row[data-current="true"]') || root.current?.querySelector<HTMLButtonElement>('.platform-row'))?.focus();
    const outside=(event:Event)=>{if(event.target instanceof Node && !root.current?.contains(event.target))dismiss();};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close();}};
    document.addEventListener('pointerdown',outside);
    document.addEventListener('focusin',outside);
    document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  const editorKey=editing ? editing.taskId || 'new' : null;
  useEffect(()=>{
    if(editing){nameInput.current?.focus();nameInput.current?.select();}
    else if(open)(editorTrigger.current?.isConnected?editorTrigger.current:addButton.current)?.focus();
  },[editorKey]);
  const current = selected === 'auto' ? resolved : selected;
  const currentTask = tasks.find(task=>(task.taskId || platformOf(task))===current);
  const currentMeta = platforms.find(platform=>platform.id===(platformOf(currentTask) || current));
  const currentName = current?.startsWith('task:') ? currentTask?.taskName : '';
  const edit=(platform:string,task?:RunState,source?:HTMLButtonElement)=>{editorTrigger.current=source || null;setEditing({platform,taskId:task?.taskId});setName(task?.taskName || `分身 ${tasks.filter(item=>platformOf(item)===platform && item.taskId?.startsWith('task:')).length+1}`);setError('');};
  const save=async()=>{
    if(!editing)return;
    try {
      if(editing.taskId)await onRename(editing.taskId,name.trim());
      else await onCreate(editing.platform,name.trim());
      close();
    } catch(error){setError(error instanceof Error?error.message:String(error));nameInput.current?.focus();}
  };
  return <div className="platform-picker" ref={root}>
    <button ref={trigger} className="platform-trigger" aria-label={`平台任务：${currentMeta?.label || '自动跟随'}${currentName?` · ${currentName}`:''}`} aria-haspopup="dialog" aria-expanded={open} aria-controls="platformTasksPopover" onClick={()=>{if(open)close();else setOpen(true);}}>
      {currentMeta ? <span className={`platform-logo ${currentMeta.brand}`}><img src={`../brands/${currentMeta.brand}.${currentMeta.brand==='huxuan'||currentMeta.brand==='feigua'?'png':'ico'}`} alt="" /></span> : null}
      <span className="platform-trigger-name">{currentName || platformShort[current || ''] || '平台'}</span><span aria-hidden="true">⌄</span>
    </button>
    <section id="platformTasksPopover" className="platform-tasks platform-popover" role="dialog" hidden={!open} aria-labelledby="platformTasksTitle">
      <div className="platform-heading">
        <h2 id="platformTasksTitle">平台任务</h2>
        <label className="platform-follow">自动跟随<input type="checkbox" role="switch" checked={selected==='auto'} disabled={busy} onChange={event=>onSelect(event.target.checked?'auto':current || 'douyin')} /><span className="follow-track" aria-hidden="true" /></label>
      </div>
      <div className="platform-list" role="group" aria-label="选择要控制的任务或分身">
        {platforms.map(platform=>{
          const group=tasks.filter(task=>platformOf(task)===platform.id);
          const defaultTask=group.find(task=>!task.taskId?.startsWith('task:'));
          const clones=group.filter(task=>task.taskId?.startsWith('task:'));
          const hasClones=clones.length>0;
          const isExpanded=expanded===platform.id;
          const chosen=currentMeta?.id===platform.id;
          const shownTask=chosen && currentName?currentTask:defaultTask;
          const count=platform.unit==='页'?shownTask?.stats?.pagesCollected:shownTask?.stats?.scanned;
          const summary=`${chosen && currentName?`${currentName} · `:''}${statuses[shownTask?.status || ''] || '未开始'} · ${count || 0} ${platform.unit}`;
          return <div className="platform-group" key={platform.id}>
            <button className="platform-row" data-current={chosen} aria-pressed={hasClones?undefined:chosen} aria-expanded={hasClones?isExpanded:undefined} aria-controls={hasClones?`platform-children-${platform.id}`:undefined} disabled={busy} onClick={()=>{if(hasClones)setExpanded(isExpanded?null:platform.id);else{onSelect(defaultTask?.taskId || platform.id);close();}}}>
              <span className={`platform-logo ${platform.brand}`}><img src={`../brands/${platform.brand}.${platform.brand==='huxuan'||platform.brand==='feigua'?'png':'ico'}`} alt="" /></span>
              <span className="platform-copy"><strong>{platform.label}</strong><span title={summary}>{summary}</span></span>
              {hasClones?<span className="platform-clone-count">{clones.length} 个分身</span>:null}
              <span className={`platform-selection${hasClones?' platform-chevron':''}`} aria-hidden="true">{hasClones?'⌄':chosen?'✓':'›'}</span>
            </button>
            {hasClones && isExpanded?<div className="task-instance-list" id={`platform-children-${platform.id}`} role="group" aria-label={`${platform.label}的任务`}>
            {[defaultTask || {taskId:platform.id},...clones].map(task=>{
              const id=task.taskId || platform.id;
              const count=platform.unit==='页'?task.stats?.pagesCollected:task.stats?.scanned;
              const chosen=current===id;
              return <div className="task-instance-row" key={id}>
                <button className="platform-row" aria-pressed={chosen} disabled={busy} onClick={()=>{onSelect(id);close();}}>
                  <span className="platform-copy"><strong>{task.taskName || '默认任务'}</strong><span>{statuses[task.status || ''] || '未开始'} · {count || 0} {platform.unit}</span></span>
                  <span className="platform-selection" aria-hidden="true">{chosen?'✓':'›'}</span>
                </button>
                {id.startsWith('task:')?<button className="task-rename" disabled={busy} aria-label={`重命名${task.taskName}`} onClick={event=>edit(platform.id,task,event.currentTarget)}>改名</button>:null}
              </div>;
            })}
            </div>:null}
          </div>;
        })}
      </div>
      <div className="platform-footer"><button ref={addButton} className="task-add" disabled={busy || Boolean(editing)} onClick={event=>edit(currentMeta?.id || 'douyin',undefined,event.currentTarget)}>＋ 新增分身</button></div>
      {editing?<form className="task-name-form" onSubmit={event=>{event.preventDefault();void save();}}>
        {!editing.taskId?<><label htmlFor="taskInstancePlatform">平台</label><select id="taskInstancePlatform" value={editing.platform} disabled={busy} onChange={event=>{setEditing({...editing,platform:event.target.value});setError('');}}>{platforms.map(platform=><option key={platform.id} value={platform.id}>{platform.label}</option>)}</select></>:null}
        <label htmlFor="taskInstanceName">{editing.taskId?'分身改名':'分身名称'}</label>
        <input ref={nameInput} id="taskInstanceName" value={name} maxLength={40} required disabled={busy} onChange={event=>setName(event.target.value)} aria-describedby="taskNameHint" />
        <p id="taskNameHint" className="field-note">{editing.taskId?'改名保留原有规则与进度。':'复制该平台默认规则，使用独立任务、进度和网页，共用登录账号。'}</p>
        {error?<p className="error" role="alert">{error}</p>:null}
        <div className="task-name-actions"><button type="button" disabled={busy} onClick={()=>{setEditing(null);setError('');}}>取消</button><button type="submit" className="primary" disabled={busy || !name.trim()}>{busy?'保存中…':editing.taskId?'保存':'创建'}</button></div>
      </form>:null}
    </section>
  </div>;
}
