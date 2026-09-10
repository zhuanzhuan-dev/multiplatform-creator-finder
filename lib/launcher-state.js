export function launcherState(state = {}) {
  const status = state.status || 'idle';
  const label = status === 'running' ? '运行中' : status === 'starting' ? '启动中'
    : status === 'paused' ? (state.lastError ? '需要处理' : '已暂停')
    : status === 'stopped' ? '本轮已结束' : '打开找号助手';
  const tasks = (state.tasks || []).filter(task => ['starting','running','paused'].includes(task.status)).map(task => ({
    platform:task.route?.platform, name:{douyin:'抖音',kuaishou:'快手',feigua:'飞瓜'}[task.route?.platform] || '任务',
    status:task.status, label:launcherState(task).label, count:Number(task.stats?.scanned || 0),
    unit:task.route?.platform === 'feigua' ? '页' : '条'
  }));
  const runningCount=tasks.filter(task=>['running','starting'].includes(task.status)).length;
  return { status, label, count: Number(state.stats?.scanned || 0), visible: true, tasks, runningCount };
}

export function toolbarState(state = {}) {
  const text = { running: '运行', starting: '启动', paused: '暂停' }[state.status] || '';
  return { text, color: state.status === 'paused' ? '#966300' : '#187653',
    title: text ? `多平台自动找号助手 · ${text} · 本轮已刷 ${Number(state.stats?.scanned || 0)} · 点击打开面板` : '打开多平台自动找号助手' };
}

export function aggregateTaskState(tasks) {
  const selected = tasks.find(task => task.status === 'running') || tasks.find(task => task.status === 'starting') || tasks.find(task => task.status === 'paused') || tasks[0] || {};
  return {...selected, tasks, stats: {...selected.stats, scanned: tasks.reduce((total, task) => total + Number(task.stats?.scanned || 0), 0)}};
}
