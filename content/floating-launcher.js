import { launcherPreferences, launcherIsVisible, launcherSiteKey, LAUNCHER_ENABLED_KEY, LAUNCHER_COMPACT_KEY } from "../lib/launcher-preferences.js";
import { launcherState, aggregateTaskState } from "../lib/launcher-state.js";
import { normalizeLauncherPosition, launcherCoordinates, launcherPositionFromPoint } from "../lib/launcher-position.js";
// Isolated shadow tree keeps the control outside recommendation-card parsing.
(function installLauncher() {
  if (window !== window.top) return;
  const version = chrome.runtime.getManifest().version;
  const existing = document.getElementById('dra-floating-launcher');
  if (existing?.dataset.launcherVersion === version) return;
  const visitHiddenInitially = existing?.dataset.visitHidden === 'true';
  existing?.remove();
  const host = document.createElement('div');
  host.id = 'dra-floating-launcher';
  host.dataset.launcherVersion = version;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host { --ink:#185c45; --glass:rgba(250,255,252,.96); --line:rgba(29,96,69,.24); all:initial; position:fixed; left:0; top:0; z-index:2147483646; display:none; color-scheme:light; }
    :host([data-visible]) { display:block; }
    button { --ink:#185c45; --glass:rgba(250,255,252,.94); --line:rgba(29,96,69,.24); position:relative; width:36px; height:36px; display:grid; place-items:center; padding:0; border:1px solid var(--line); border-radius:12px; color:var(--ink); background:radial-gradient(circle at var(--x,30%) var(--y,15%),rgba(255,255,255,.85),transparent 65%),var(--glass); box-shadow:inset 0 1px 0 #fff,0 4px 18px #173f3026; backdrop-filter:blur(18px); cursor:pointer; touch-action:none; user-select:none; transition:transform .18s,box-shadow .18s; }
    :host([data-theme=dark]) {--ink:#72dfb5;--glass:rgba(25,37,33,.96);--line:rgba(150,230,197,.28);}
    :host([data-theme=dark]) button { --ink:#72dfb5; --glass:rgba(25,37,33,.96); --line:rgba(150,230,197,.28); background:radial-gradient(circle at var(--x,30%) var(--y,15%),#94dcb627,transparent 65%),var(--glass); box-shadow:inset 0 1px 0 #d8ffe426,0 4px 18px #0005; }
    button:hover { transform:translateY(-1px); } button:active { transform:scale(.96); } button:focus-visible { outline:3px solid #379e79; outline-offset:3px; }
    :host([data-compact]) button { width:28px;height:28px;border-radius:9px; }
    :host([data-compact]) svg { width:19px;height:19px; }
    svg { width:23px;height:23px; } .status { position:absolute;right:0;bottom:0;min-width:9px;height:9px;border:2px solid var(--glass);border-radius:8px;background:#20845c;color:white;font:bold 8px/9px system-ui;text-align:center; }
    :host([data-status=paused]) .status { background:#946000; }
    .hint { position:absolute;right:36px;top:0;width:max-content;max-width:min(220px,calc(100vw - 90px));padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--glass);color:var(--ink);font:12px/1.5 system-ui;box-shadow:0 3px 14px #0002;opacity:0;pointer-events:none;transform:translateX(4px);transition:opacity .15s,transform .15s; }
    :host([data-hint-side=right]) .hint { right:auto;left:36px; }
    :host([data-status=idle]) .status { display:none; }
    :host([data-dragging]) button { cursor:grabbing;transform:none; }
     :host(:hover) .hint,:host(:focus-within) .hint { opacity:1;transform:none;pointer-events:auto; }
    :host([data-compact]) .hint {right:28px;}
    :host([data-compact][data-hint-side=right]) .hint {right:auto;left:28px;}
    .hint::after { content:'';position:absolute;top:0;bottom:0;right:-12px;width:12px; }
    :host([data-hint-side=right]) .hint::after {right:auto;left:-12px;}
    .hint { max-height:calc(100vh - 32px);overflow:auto; }
    .summary {display:block;font-weight:600;margin-bottom:4px;}
    .task {width:100%;height:auto;display:flex;justify-content:space-between;gap:16px;padding:8px 4px;border:0;border-radius:6px;background:transparent;box-shadow:none;font:12px/1.5 system-ui;white-space:nowrap;}
    .task + .task {border-top:1px solid var(--line);}
    :host([data-theme=dark]) .task {background:transparent;box-shadow:none;}
    :host([data-compact]) .task {width:100%;height:auto;}
    .task[data-state=paused] {color:#a87919;}
    :host([data-theme=dark]) .task[data-state=paused] {color:#e6bb65;}
    .task:hover {background:#55a88618;transform:none;}
    .footer {display:block;opacity:.7;font-size:11px;margin-top:4px;}
    :host([data-dismissed]) .hint {opacity:0;pointer-events:none;}

    @media(prefers-reduced-motion:reduce) { button,.hint { transition:none;transform:none!important; } }
  </style><button type="button"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="13" stroke="currentColor"/><circle cx="16" cy="16" r="8" stroke="currentColor" opacity=".45"/><path d="M16 3v26M3 16h26M16 16l9-9" stroke="currentColor" opacity=".65"/><path d="M16 16V3a13 13 0 0 1 9 4Z" fill="currentColor" opacity=".2"/><circle cx="16" cy="16" r="2" fill="currentColor"/></svg><span class="status" aria-hidden="true"></span></button><div class="hint" aria-label="平台任务"><strong class="summary"></strong><div class="task-list"></div><span class="footer">点击平台打开面板</span></div>`;
  document.documentElement.append(host);
  const button = shadow.querySelector('button'), hint = shadow.querySelector('.hint'), dot = shadow.querySelector('.status');
  const system = matchMedia('(prefers-color-scheme: dark)');
  let theme = 'system', savedPosition = normalizeLauncherPosition(), drag = null, moved = false;
  const siteKey = launcherSiteKey(location.hostname);
  let preferences = launcherPreferences(), preferencesReady = false, visitHidden = visitHiddenInitially;
  let currentInfo = { visible: true, status: 'idle' };
  let taskStates = {douyin:{},kuaishou:{},feigua:{}};
  const size = () => preferences.compact ? 28 : 36;
  function visibility() {
    host.dataset.visitHidden = String(visitHidden);
    host.toggleAttribute('data-visible', preferencesReady && Boolean(currentInfo?.visible) && launcherIsVisible(preferences, visitHidden));
    host.toggleAttribute('data-compact', preferences.compact);
  }
  function appearance() { host.dataset.theme = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme; }
  function position() {
    const point = launcherCoordinates(savedPosition, innerWidth, innerHeight, size());
    host.style.left = `${point.left}px`;
    host.style.top = `${point.top}px`;
    host.dataset.hintSide = savedPosition.x < .5 ? 'right' : 'left';
  }
  function moveTo(left, top) {
    savedPosition = launcherPositionFromPoint(left, top, innerWidth, innerHeight, size());
    position();
  }
  function persistPosition() { void chrome.storage.local.set({draLauncherPosition:savedPosition}).catch(()=>undefined); }
  function render(info) {
    currentInfo = info;
    visibility();
    host.dataset.status = info?.status || 'idle';
    const tasks=info?.tasks || [];
    const summary=tasks.length ? info.runningCount ? `${info.runningCount} 个任务运行中` : `${tasks.length} 个任务已暂停` : '多平台自动找号助手';
    hint.querySelector('.summary').textContent=summary;
    hint.querySelector('.footer').textContent=tasks.length ? '点击平台打开面板' : '点击图标打开面板';
    const list=hint.querySelector('.task-list');
    // Update rows in place so live progress does not steal keyboard focus.
    for (const row of [...list.children]) if (!tasks.some(task=>task.platform===row.dataset.platform)) row.remove();
    for (const task of tasks) {
      let row=[...list.children].find(row=>row.dataset.platform===task.platform);
      if (!row) {
        row=document.createElement('button');row.type='button';row.className='task';row.dataset.platform=task.platform;
        row.append(document.createElement('span'),document.createElement('span'));
        row.addEventListener('click',()=>void openPanel(task.platform));list.append(row);
      }
      row.dataset.state=task.status;
      row.children[0].textContent=`${task.name} · ${task.label}`;
      row.children[1].textContent=`${task.platform==='feigua'?'已采集':'已刷'} ${task.count} ${task.unit}`;
    }
    button.title=summary;
    hint.style.top='0px';
    const overflow=hint.getBoundingClientRect().bottom-innerHeight+12;
    if(overflow>0)hint.style.top=`-${overflow}px`;
    button.setAttribute('aria-label', `${summary}，打开找号助手。悬停或按 Tab 查看平台任务，拖动或使用方向键移动位置`);
    dot.textContent = info?.runningCount > 1 ? String(info.runningCount) : info?.status === 'paused' ? 'Ⅱ' : info?.status === 'stopped' ? '✓' : '';
  }
  async function refresh() {
    try { const response = await chrome.runtime.sendMessage({ type:'DRA_GET_LAUNCHER' }); if (response?.ok) render(response.launcher); }
    catch { host.remove(); }
  }
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    const box = host.getBoundingClientRect();
    moved = false;
    drag = { id:event.pointerId, x:event.clientX, y:event.clientY, left:box.left, top:box.top };
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointermove', event => {
    const box=button.getBoundingClientRect();button.style.setProperty('--x',`${event.clientX-box.left}px`);button.style.setProperty('--y',`${event.clientY-box.top}px`);
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX-drag.x, dy = event.clientY-drag.y;
    if (Math.hypot(dx,dy)>5) moved=true;
    if (moved) {
      host.setAttribute('data-dragging','');
      moveTo(drag.left+dx, drag.top+dy);
    }
  });
  const endDrag=event=>{
    if (!drag || event.pointerId !== drag.id) return;
    if (event.type === 'pointercancel') moved = true;
    if (moved) persistPosition();
    drag=null;host.removeAttribute('data-dragging');
  };
  button.addEventListener('pointerup',endDrag);button.addEventListener('pointercancel',endDrag);button.addEventListener('lostpointercapture',endDrag);
  button.addEventListener('keydown', event => {
    const moves = {ArrowUp:[0,-24],ArrowDown:[0,24],ArrowLeft:[-24,0],ArrowRight:[24,0]};
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();event.stopPropagation();
    const point = launcherCoordinates(savedPosition,innerWidth,innerHeight,size());
    moveTo(point.left+delta[0],point.top+delta[1]);persistPosition();
  });
  async function openPanel(platform) {
    try { const r=await chrome.runtime.sendMessage({type:'DRA_OPEN_PANEL',platform});if(!r?.ok)throw Error(r?.error); }
    catch { hint.querySelector('.footer').textContent='请点击 Chrome 工具栏中的找号助手图标'; }
  }
  host.addEventListener('pointerenter',()=>host.removeAttribute('data-dismissed'));
  host.addEventListener('focusin',()=>host.removeAttribute('data-dismissed'));
  host.addEventListener('keydown',event=>{if(event.key==='Escape'){button.focus();host.setAttribute('data-dismissed','');}});
  button.addEventListener('click', async event => {
    if (moved && event.detail !== 0) { moved=false;return; }
    await openPanel();
  });
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if(message?.type==='DRA_LAUNCHER_CHANGED') render(message.launcher);
    if(message?.type==='DRA_LAUNCHER_PING') reply({launcherVersion:version, visitHidden});
    if(message?.type==='DRA_LAUNCHER_VISIT') {
      visitHidden = message.hidden === true; visibility();
      reply({ok:true, visitHidden});
    }
    return false;
  });
  chrome.storage.onChanged.addListener((changes,area) => {
    if(area!=='local')return;
    if(changes[LAUNCHER_ENABLED_KEY]) preferences.enabled = changes[LAUNCHER_ENABLED_KEY].newValue !== false;
    if(changes[LAUNCHER_COMPACT_KEY]) preferences.compact = changes[LAUNCHER_COMPACT_KEY].newValue === true;
    if(changes[siteKey]) preferences.siteBlocked = changes[siteKey].newValue === true;
    visibility();position();
    if(changes.draTheme){theme=changes.draTheme.newValue||'system';appearance();}
    if(changes.draState) taskStates.douyin=changes.draState.newValue || {};
    if(changes.draFeiguaState) taskStates.feigua=changes.draFeiguaState.newValue || {};
    if(changes.draKuaishou) taskStates.kuaishou=changes.draKuaishou.newValue?.state || {};
    if(changes.draState || changes.draFeiguaState || changes.draKuaishou) render(launcherState(aggregateTaskState(Object.entries(taskStates).map(([platform,task])=>({...task,route:{platform}})))));
    if(changes.draLauncherPosition && !drag){savedPosition=normalizeLauncherPosition(changes.draLauncherPosition.newValue);position();}
  });
  chrome.storage.local.get(['draState','draFeiguaState','draKuaishou','draTheme','draLauncherPosition',LAUNCHER_ENABLED_KEY,LAUNCHER_COMPACT_KEY,siteKey]).then(saved=>{taskStates={douyin:{...saved.draState,route:{platform:"douyin"}},kuaishou:{...saved.draKuaishou?.state,route:{platform:"kuaishou"}},feigua:{...saved.draFeiguaState,route:{platform:"feigua"}}};render(launcherState(aggregateTaskState(Object.entries(taskStates).map(([platform,task])=>({...task,route:{platform}})))));preferences=launcherPreferences(saved,location.hostname);preferencesReady=true;visibility();theme=saved.draTheme||'system';savedPosition=normalizeLauncherPosition(saved.draLauncherPosition);appearance();position();}).catch(()=>host.remove());
  system.addEventListener('change',appearance);addEventListener('resize',position);
  void refresh();
})();
