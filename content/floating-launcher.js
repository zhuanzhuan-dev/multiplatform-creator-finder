// Isolated shadow tree keeps the control outside recommendation-card parsing.
(function installLauncher() {
  if (document.getElementById('dra-floating-launcher')) return;
  const host = document.createElement('div');
  host.id = 'dra-floating-launcher';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host { all:initial; position:fixed; right:12px; top:65%; z-index:2147483646; display:none; color-scheme:light; }
    :host([data-visible]) { display:block; }
    button { --ink:#185c45; --glass:rgba(250,255,252,.94); --line:rgba(29,96,69,.24); position:relative; width:48px; height:48px; display:grid; place-items:center; padding:0; border:1px solid var(--line); border-radius:18px; color:var(--ink); background:radial-gradient(circle at var(--x,30%) var(--y,15%),rgba(255,255,255,.85),transparent 65%),var(--glass); box-shadow:inset 0 1px 0 #fff,0 4px 18px #173f3026; backdrop-filter:blur(18px); cursor:pointer; touch-action:none; transition:transform .18s,box-shadow .18s; }
    :host([data-theme=dark]) button { --ink:#72dfb5; --glass:rgba(25,37,33,.96); --line:rgba(150,230,197,.28); background:radial-gradient(circle at var(--x,30%) var(--y,15%),#94dcb627,transparent 65%),var(--glass); box-shadow:inset 0 1px 0 #d8ffe426,0 4px 18px #0005; }
    button:hover { transform:translateY(-1px); } button:active { transform:scale(.96); } button:focus-visible { outline:3px solid #379e79; outline-offset:3px; }
    svg { width:30px;height:30px; } .status { position:absolute;right:3px;bottom:3px;min-width:12px;height:12px;border:2px solid var(--glass);border-radius:8px;background:#20845c;color:white;font:bold 9px/12px system-ui;text-align:center; }
    :host([data-status=paused]) .status { background:#946000; }
    .hint { position:absolute;right:58px;top:0;width:max-content;max-width:min(220px,calc(100vw - 90px));padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--glass);color:var(--ink);font:12px/1.5 system-ui;box-shadow:0 3px 14px #0002;opacity:0;pointer-events:none;transform:translateX(4px);transition:opacity .15s,transform .15s; }
    button:hover .hint,button:focus-visible .hint { opacity:1;transform:none; }
    @media(prefers-reduced-motion:reduce) { button,.hint { transition:none;transform:none!important; } }
  </style><button type="button"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="13" stroke="currentColor"/><circle cx="16" cy="16" r="8" stroke="currentColor" opacity=".45"/><path d="M16 3v26M3 16h26M16 16l9-9" stroke="currentColor" opacity=".65"/><path d="M16 16V3a13 13 0 0 1 9 4Z" fill="currentColor" opacity=".2"/><circle cx="16" cy="16" r="2" fill="currentColor"/></svg><span class="status" aria-hidden="true"></span><span class="hint" aria-hidden="true"></span></button>`;
  document.documentElement.append(host);
  const button = shadow.querySelector('button'), hint = shadow.querySelector('.hint'), dot = shadow.querySelector('.status');
  const system = matchMedia('(prefers-color-scheme: dark)');
  let theme = 'system', ratio = .65, drag = null, moved = false, hideTimer;
  function appearance() { host.dataset.theme = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme; }
  function position() { host.style.top = `${Math.max(12, Math.min(innerHeight - 60, ratio * innerHeight))}px`; }
  function render(info) {
    clearTimeout(hideTimer);
    host.toggleAttribute('data-visible', Boolean(info?.visible));
    host.dataset.status = info?.status || 'idle';
    const text = `${info?.label || '任务'} · 本轮已刷 ${info?.count || 0}`;
    hint.textContent = `${text} · 点击打开面板`;
    button.setAttribute('aria-label', `${text}，打开找号助手。上下方向键调整位置`);
    dot.textContent = info?.status === 'paused' ? 'Ⅱ' : info?.status === 'stopped' ? '✓' : '';
    if (info?.hideAt) hideTimer = setTimeout(() => host.removeAttribute('data-visible'), Math.max(0, info.hideAt - Date.now()));
  }
  async function refresh() {
    try { const response = await chrome.runtime.sendMessage({ type:'DRA_GET_LAUNCHER' }); if (response?.ok) render(response.launcher); }
    catch { host.remove(); }
  }
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    moved = false; drag = { y:event.clientY, top:host.getBoundingClientRect().top }; button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointermove', event => {
    const box=button.getBoundingClientRect();button.style.setProperty('--x',`${event.clientX-box.left}px`);button.style.setProperty('--y',`${event.clientY-box.top}px`);
    if (!drag) return;
    if (Math.abs(event.clientY-drag.y)>5) moved=true;
    if (moved) { ratio=Math.max(0,Math.min(1,(drag.top+event.clientY-drag.y)/innerHeight));position(); }
  });
  const endDrag=()=>{ if(drag && moved) void chrome.storage.local.set({draLauncherPosition:ratio});drag=null; };
  button.addEventListener('pointerup',endDrag);button.addEventListener('pointercancel',endDrag);
  button.addEventListener('keydown', event => {
    if (!['ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();ratio=Math.max(0,Math.min(1,ratio+(event.key==='ArrowUp'?-24:24)/innerHeight));position();void chrome.storage.local.set({draLauncherPosition:ratio});
  });
  button.addEventListener('click', async event => {
    if (moved && event.detail !== 0) { moved=false;return; }
    try { const r=await chrome.runtime.sendMessage({type:'DRA_OPEN_PANEL'});if(!r?.ok) throw Error(r?.error); }
    catch { hint.textContent='请点击 Chrome 工具栏中的找号助手图标打开面板';button.setAttribute('aria-label',hint.textContent); }
  });
  chrome.runtime.onMessage.addListener(message => { if(message?.type==='DRA_LAUNCHER_CHANGED') render(message.launcher); });
  chrome.storage.onChanged.addListener((changes,area) => {
    if(area!=='local')return;
    if(changes.draTheme){theme=changes.draTheme.newValue||'system';appearance();}
    if(changes.draState)void refresh();
  });
  chrome.storage.local.get(['draTheme','draLauncherPosition']).then(saved=>{theme=saved.draTheme||'system';ratio=Number.isFinite(saved.draLauncherPosition)?saved.draLauncherPosition:.65;appearance();position();});
  system.addEventListener('change',appearance);addEventListener('resize',position);
  void refresh();
})();
