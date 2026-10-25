export const TASK_INSTANCES_KEY = 'draTaskInstances';
export const TASK_PROGRESS_KEY = 'draTaskInstanceProgress';
export const TASK_PLATFORMS = ['douyin','kuaishou','bilibili','bilibili-popular','feigua','xingtu','huxuan'];

// 分身只保存自己的配置与采集状态，授权、上传队列和原始观测继续共用。
export function createTaskInstances(deps) {
  const entries = new Map();
  const values = () => [...entries.values()];
  function decorate(entry) {
    const runtime = entry.runtime;
    const read = runtime.state;
    runtime.state = () => Object.assign(read(), {taskId:entry.id,taskName:entry.name});
    runtime.state();
    return entry;
  }
  function install(value) {
    if (!TASK_PLATFORMS.includes(value.platform) || typeof value.id !== 'string' || !value.id.startsWith('task:')) throw Error('分身数据格式无效');
    const entry = {...value,creators:value.creators || {}};
    entry.runtime = deps.runtime(entry);
    if (value.data) entry.runtime.restore(value.data);
    entries.set(entry.id, decorate(entry));
    return entry;
  }
  function restore(saved = [], progress={}) {
    if (!Array.isArray(saved)) throw Error('分身列表格式异常，已保留原数据');
    for (const value of saved) {const entry=install(value);Object.assign(entry.runtime.state(),progress[value.id] || {});if(entry.runtime.state().status==='starting')Object.assign(entry.runtime.state(),{status:'paused',pauseReason:'上次启动被中断，请继续本轮'});}
  }
  async function create(platform, name) {
    if (!TASK_PLATFORMS.includes(platform)) throw Error('请选择要新增分身的平台');
    const config = structuredClone(deps.config(platform));
    for (const key of ['schedule','feiguaSchedule']) if (config.settings[key]) config.settings[key].enabled = false;
    config.settingsDraft = null;
    const entry = install({id:`task:${crypto.randomUUID()}`,platform,name:cleanName(name || `分身 ${values().filter(v=>v.platform===platform).length+1}`),config});
    await deps.persist();
    return entry.runtime.state();
  }
  function cleanName(value) {
    const name=typeof value==='string'?value.trim():'';
    if (!name || name.length>40) throw Error('分身名称请填写1至40个字');
    return name;
  }
  async function rename(id, name) {
    const entry=entries.get(id);
    if (!entry) throw Error('找不到该分身');
    entry.name=cleanName(name);
    entry.runtime.state();
    await deps.persist();
    return entry.runtime.state();
  }
  return {values,get:id=>entries.get(id),restore,create,rename,
    states:()=>values().map(e=>e.runtime.state()),
    progressStorage:()=>entries.size?{[TASK_PROGRESS_KEY]:Object.fromEntries(values().map(entry=>[entry.id,entry.runtime.state()]))}:{},
    storage:()=>entries.size?{[TASK_PROGRESS_KEY]:Object.fromEntries(values().map(entry=>[entry.id,entry.runtime.state()])),[TASK_INSTANCES_KEY]:values().map(({runtime,...entry})=>{runtime.state();return {...entry,data:runtime.storage()};})}:{},
    forTab:tabId=>Number.isInteger(tabId)?values().find(e=>e.runtime.state().feedTabId===tabId):null,
  };
}
