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
    :host { all:initial; position:fixed; left:0; top:0; z-index:2147483646; display:none; color-scheme:light; }
    :host([data-visible]) { display:block; }
    button { --ink:#185c45; --glass:rgba(250,255,252,.94); --line:rgba(29,96,69,.24); position:relative; width:36px; height:36px; display:grid; place-items:center; padding:0; border:1px solid var(--line); border-radius:12px; color:var(--ink); background:radial-gradient(circle at var(--x,30%) var(--y,15%),rgba(255,255,255,.85),transparent 65%),var(--glass); box-shadow:inset 0 1px 0 #fff,0 4px 18px #173f3026; backdrop-filter:blur(18px); cursor:pointer; touch-action:none; user-select:none; transition:transform .18s,box-shadow .18s; }
    :host([data-theme=dark]) button { --ink:#72dfb5; --glass:rgba(25,37,33,.96); --line:rgba(150,230,197,.28); background:radial-gradient(circle at var(--x,30%) var(--y,15%),#94dcb627,transparent 65%),var(--glass); box-shadow:inset 0 1px 0 #d8ffe426,0 4px 18px #0005; }
    button:hover { transform:translateY(-1px); } button:active { transform:scale(.96); } button:focus-visible { outline:3px solid #379e79; outline-offset:3px; }
    :host([data-compact]) button { width:28px;height:28px;border-radius:9px; }
    :host([data-compact]) svg { width:19px;height:19px; }
    svg { width:23px;height:23px; } .status { position:absolute;right:0;bottom:0;min-width:9px;height:9px;border:2px solid var(--glass);border-radius:8px;background:#20845c;color:white;font:bold 8px/9px system-ui;text-align:center; }
    :host([data-status=paused]) .status { background:#946000; }
    .hint { position:absolute;right:44px;top:0;width:max-content;max-width:min(220px,calc(100vw - 90px));padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--glass);color:var(--ink);font:12px/1.5 system-ui;box-shadow:0 3px 14px #0002;opacity:0;pointer-events:none;transform:translateX(4px);transition:opacity .15s,transform .15s; }
    :host([data-hint-side=right]) .hint { right:auto;left:44px; }
    :host([data-status=idle]) .status { display:none; }
    :host([data-dragging]) button { cursor:grabbing;transform:none; }
    button:hover .hint,button:focus-visible .hint { opacity:1;transform:none; }
    @media(prefers-reduced-motion:reduce) { button,.hint { transition:none;transform:none!important; } }
  </style><button type="button"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="13" stroke="currentColor"/><circle cx="16" cy="16" r="8" stroke="currentColor" opacity=".45"/><path d="M16 3v26M3 16h26M16 16l9-9" stroke="currentColor" opacity=".65"/><path d="M16 16V3a13 13 0 0 1 9 4Z" fill="currentColor" opacity=".2"/><circle cx="16" cy="16" r="2" fill="currentColor"/></svg><span class="status" aria-hidden="true"></span><span class="hint" aria-hidden="true"></span></button>`;
  document.documentElement.append(host);
  const button = shadow.querySelector('button'), hint = shadow.querySelector('.hint'), dot = shadow.querySelector('.status');
  const system = matchMedia('(prefers-color-scheme: dark)');
  let theme = 'system', savedPosition = normalizeLauncherPosition(), drag = null, moved = false;
  const siteKey = launcherSiteKey(location.hostname);
  let preferences = launcherPreferences(), preferencesReady = false, visitHidden = visitHiddenInitially;
  let currentInfo = { visible: true, status: 'idle' };
  let taskStates = {douyin:{},feigua:{}};
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
    const text = info?.status === 'idle' ? '多平台自动找号助手' : `${info?.label || '任务'} · 本轮已刷 ${info?.count || 0}`;
    hint.textContent = `${text} · 点击打开面板`;
    button.setAttribute('aria-label', `${text}，打开找号助手。拖动或使用方向键移动位置`);
    dot.textContent = info?.status === 'paused' ? 'Ⅱ' : info?.status === 'stopped' ? '✓' : '';
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
  button.addEventListener('click', async event => {
    if (moved && event.detail !== 0) { moved=false;return; }
    try { const r=await chrome.runtime.sendMessage({type:'DRA_OPEN_PANEL'});if(!r?.ok) throw Error(r?.error); }
    catch { hint.textContent='请点击 Chrome 工具栏中的找号助手图标打开面板';button.setAttribute('aria-label',hint.textContent); }
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
    if(changes.draState || changes.draFeiguaState) render(launcherState(aggregateTaskState(Object.values(taskStates))));
    if(changes.draLauncherPosition && !drag){savedPosition=normalizeLauncherPosition(changes.draLauncherPosition.newValue);position();}
  });
  chrome.storage.local.get(['draState','draFeiguaState','draTheme','draLauncherPosition',LAUNCHER_ENABLED_KEY,LAUNCHER_COMPACT_KEY,siteKey]).then(saved=>{taskStates={douyin:saved.draState||{},feigua:saved.draFeiguaState||{}};render(launcherState(aggregateTaskState(Object.values(taskStates))));preferences=launcherPreferences(saved,location.hostname);preferencesReady=true;visibility();theme=saved.draTheme||'system';savedPosition=normalizeLauncherPosition(saved.draLauncherPosition);appearance();position();}).catch(()=>host.remove());
  system.addEventListener('change',appearance);addEventListener('resize',position);
  void refresh();
})();
