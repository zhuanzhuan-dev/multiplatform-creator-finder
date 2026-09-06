export function launcherState(state = {}, panelVisible = false, now = Date.now()) {
  const status = state.status || 'idle';
  const ended = Date.parse(state.endedAt || '') || 0;
  const finished = status === 'stopped' && now - ended < 8000;
  const label = status === 'running' ? '运行中' : status === 'starting' ? '启动中'
    : status === 'paused' ? (state.lastError ? '需要处理' : '已暂停') : '本轮已结束';
  return { status, label, count: Number(state.stats?.scanned || 0),
    visible: !panelVisible && (['running', 'starting', 'paused'].includes(status) || finished),
    hideAt: finished ? ended + 8000 : null };
}

export function toolbarState(state = {}) {
  const text = { running: '运行', starting: '启动', paused: '暂停' }[state.status] || '';
  return { text, color: state.status === 'paused' ? '#966300' : '#187653',
    title: text ? `多平台自动找号助手 · ${text} · 本轮已刷 ${Number(state.stats?.scanned || 0)} · 点击打开面板` : '打开多平台自动找号助手' };
}
