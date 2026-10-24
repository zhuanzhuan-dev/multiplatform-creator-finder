import { INITIAL_STATE } from './defaults.js';
import { createRunWaits, withTimeout } from './runtime-health.js';
import { elapsedRunMs } from './run-limits.js';
import { huxuanContext, huxuanId } from './huxuan-api.js';

export const HUXUAN_ALARM='dra-huxuan-watchdog';
export const defaultHuxuanSettings=()=>({huxuanTarget:{maxPages:50},huxuanDelay:{minSeconds:4,maxSeconds:6},keepSystemAwake:true,dryRun:false});
const route={platform:'huxuan',surface:'market',label:'腾讯互选视频号'};
export function createHuxuanRuntime(deps) {
  let state={...structuredClone(INITIAL_STATE),route}, collection=null, operations=Promise.resolve(),generation=0;
  const waits=createRunWaits();
  const active=()=>['starting','running'].includes(state.status);
  const serial=work=>{const result=operations.then(work);operations=result.catch(()=>{});return result;};
  const save=async()=>{await deps.persist();await deps.indicators();};
  const send=(type,extra={})=>withTimeout(chrome.tabs.sendMessage(state.feedTabId,{type,runId:state.runId,loopId:state.loopId,...extra}),5000);
  const timers=()=>state.status==='running'?chrome.alarms.create(HUXUAN_ALARM,{periodInMinutes:.5}):chrome.alarms.clear(HUXUAN_ALARM);
  async function validTab(id) {
    const tab=await chrome.tabs.get(id).catch(()=>null);
    if (!tab || !huxuanContext(tab.url || tab.pendingUrl || '')) throw Error('请打开已登录的腾讯互选视频号创作者广场');
    return tab;
  }
  async function openPage({windowId,focusTab=true}={}) {
    const tabs=await chrome.tabs.query({url:'https://huxuan.qq.com/*',...(Number.isInteger(windowId)?{windowId}:{})});
    let tab=tabs.find(t=>t.id===state.feedTabId && huxuanContext(t.url || '')) || tabs.find(t=>huxuanContext(t.url || ''));
    if(!tab) tab=await chrome.tabs.create({url:state.lastPageUrl || 'https://huxuan.qq.com/',active:focusTab,...(Number.isInteger(windowId)?{windowId}:{})});
    else if(focusTab) await chrome.tabs.update(tab.id,{active:true});
    return deps.waitForTab(tab.id);
  }
  async function pause(reason='用户暂停') {
    generation++;waits.cancel();state.elapsedMs=elapsedRunMs(state);state.activeSince=null;
    state.status='paused';state.pauseReason=reason;state.pausedAt=Date.now();state.startupStage='';
    void send('DRA_STOP_LOOP').catch(()=>{});await timers();await save();return state;
  }
  async function launch(id,version) {
    const tab=await deps.ensureContent(await validTab(id));
    if(version!==generation)return state;
    state.feedTabId=tab.id;state.feedWindowId=tab.windowId;state.loopId=crypto.randomUUID();
    state.status='running';state.activeSince=Date.now();state.pausedAt=null;state.pauseReason='';state.lastError='';state.startupStage='';state.lastTickAt=new Date().toISOString();
    await timers();await save();
    if(version===generation && state.status==='running') await send('DRA_START_LOOP',{settings:state.runSettings,nextPage:state.nextPage,queryKey:state.queryKey});
    return state;
  }
  const start=id=>{const version=++generation;return serial(async()=>{
    if(active())throw Error('互选任务正在运行');
    const tab=await validTab(id);await deps.authorize();
    if(version!==generation)return state;
    state={...structuredClone(INITIAL_STATE),route,status:'starting',runId:crypto.randomUUID(),feedTabId:tab.id,feedWindowId:tab.windowId,startedAt:new Date().toISOString(),elapsedMs:0,runSettings:structuredClone(deps.settings()),runTarget:{mode:'pages',maxPages:deps.settings().huxuanTarget.maxPages},lastPageUrl:tab.url,nextPage:null,queryKey:null};
    collection={runId:state.runId,accounts:{},recentRows:[],pages:[],finalized:false};await save();
    try{return await launch(tab.id,version);}catch(error){if(version===generation)await pause(error.message);throw error;}
  });};
  const resume=(options={})=>{const version=++generation;return serial(async()=>{
    if(!state.runId || !collection || collection.finalized)throw Error('本轮已结束，请开始新一轮');
    await deps.authorize();if(version!==generation)return state;
    state.status='starting';state.startupStage='正在恢复互选接口采集';await save();
    try{return await launch((await openPage({...options,focusTab:false})).id,version);}catch(error){if(version===generation)await pause(error.message);throw error;}
  });};
  async function finish(reason) {
    await pause(reason);state.status='stopped';state.endedAt=new Date().toISOString();
    if(collection)collection.finalized=true;await save();void deps.scheduleUpload(true);return state;
  }
  const stop=()=>{generation++;waits.cancel();state.status='paused';void send('DRA_STOP_LOOP').catch(()=>{});return serial(()=>finish('用户结束本轮'));};
  function bound(message,sender) {
    if((sender.frameId ?? 0)!==0 || sender.tab?.id!==state.feedTabId || !huxuanContext(sender.url || sender.tab?.url || '') || state.status!=='running' || message.runId!==state.runId || message.loopId!==state.loopId) throw Error('消息不属于当前互选任务');
  }
  async function message(message,sender) {
    bound(message,sender);
    if(message.type==='DRA_WAIT') {
      const until=Number(message.until);if(!Number.isFinite(until)||until>Date.now()+30000)throw Error('无效等待时间');
      return waits.wait(until);
    }
    if(message.type==='DRA_TICK_ERROR') {await pause(message.error || '互选采集失败');return {ok:true};}
    return serial(async()=>{
      bound(message,sender);
      if(message.type==='DRA_PROGRESS'){state.runtime={phase:message.phase,progressAt:Date.now()};await save();return {ok:true};}
      if(message.type!=='DRA_HUXUAN_PAGE')throw Error('互选不支持此消息');
      const page=message.page;
      if(!page || !huxuanContext(page.pageUrl) || huxuanContext(page.pageUrl).accountId!==huxuanContext(sender.url || sender.tab.url).accountId || !Array.isArray(page.rows) || page.rows.length>100 || page.rows.some(r=>!huxuanId(r.authorId) || !r.authorName) || !Number.isInteger(page.pageNumber) || page.pageNumber<1 || typeof page.queryKey!=='string' || page.queryKey.length>100000)throw Error('互选页面数据不完整');
      if(state.queryKey && state.queryKey!==page.queryKey)throw Error('互选筛选条件或账号已变化，请重新开始');
      if(state.nextPage && state.nextPage!==page.pageNumber)throw Error('互选页码与续跑进度不一致');
      await deps.savePage(page,state.runId);
      state.queryKey=page.queryKey;state.nextPage=page.pageNumber+1;state.lastPageNumber=String(page.pageNumber);state.lastPageUrl=page.pageUrl;
      if(!collection.pages.includes(page.pageNumber))collection.pages.push(page.pageNumber);
      let fresh=0;
      for(const row of page.rows){
        if(!collection.accounts[row.authorId]){
          fresh++;
          deps.recordDecision?.({code:'HUXUAN_CANDIDATE_REVIEW',reasons:['互选列表候选，待研究台人工复核']},{...row,sourcePlatform:'huxuan'},null,state);
        }
        collection.accounts[row.authorId]=true;
      }
      collection.recentRows=page.rows.slice(-10);
      state.stats={...state.stats,pagesCollected:collection.pages.length,matched:Object.keys(collection.accounts).length,scanned:Number(state.stats.scanned||0)+page.rows.length,duplicates:Number(state.stats.duplicates||0)+page.rows.length-fresh};
      for(const row of page.rows)deps.recordScan(`huxuan:${row.authorId}`);
      state.lastTickAt=new Date().toISOString();await save();
      if(page.last || page.rows.length===0){await finish('当前筛选结果已采集完毕');return {continue:false};}
      if(collection.pages.length>=state.runTarget.maxPages){await finish('已达到本轮采集页数');return {continue:false};}
      return {continue:state.status==='running'};
    });
  }
  async function inspect() {
    if(state.status!=='running')return;
    try {
      await validTab(state.feedTabId);
      const status=await send('DRA_LOOP_STATUS');
      if(state.status==='running' && (!status?.running || status.runId!==state.runId || status.loopId!==state.loopId || Date.now()-(state.runtime?.progressAt || Date.parse(state.lastTickAt))>90000))await pause('互选页面采集已中断，请检查后继续');
    }catch(error){await pause(error.message);}
  }
  function restore(saved) {
    collection=saved.draHuxuanCollection || null;
    state={...state,...saved.draHuxuanState,route};
    if(active()){state.elapsedMs=elapsedRunMs(state);state.activeSince=null;state.status='paused';state.pauseReason='插件已恢复，点击继续从已保存页码采集';}
  }
  return {state:()=>state,collection:()=>collection,storage:()=>({draHuxuanState:state,draHuxuanCollection:collection}),restore,start,resume,pause,stop,openPage,inspect,timers,active,message,clear:()=>{collection=null;}};
}
