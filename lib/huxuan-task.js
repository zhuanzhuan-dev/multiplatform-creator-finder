import { INITIAL_STATE } from './defaults.js';
import { createRunWaits, withTimeout } from './runtime-health.js';
import { elapsedRunMs } from './run-limits.js';
import { huxuanContext, huxuanId, huxuanQueryKey, HUXUAN_PROFILE_DATASETS, huxuanDateRange } from './huxuan-api.js';
import { huxuanCaptureKey, huxuanCaptureRows, huxuanCaptureSummary } from './huxuan-capture.js';

export const HUXUAN_ALARM='dra-huxuan-watchdog';
export const defaultHuxuanSettings=()=>({huxuanTarget:{maxPages:50},huxuanVideoMaxPages:1,huxuanDelay:{minSeconds:2,maxSeconds:4},huxuanPageDelay:{minSeconds:2,maxSeconds:4},keepSystemAwake:true,dryRun:false});
const route={platform:'huxuan',surface:'market',label:'腾讯互选视频号'};
export function createHuxuanRuntime(deps, options={}) {
  const huxuan_alarm=options.alarm || HUXUAN_ALARM;
  let state={...structuredClone(INITIAL_STATE),route}, collection=null, operations=Promise.resolve(),generation=0;
  const waits=createRunWaits();
  const active=()=>['starting','running'].includes(state.status);
  const serial=work=>{const result=operations.then(work);operations=result.catch(()=>{});return result;};
  const save=async()=>{await deps.persist();await deps.indicators();};
  const send=(type,extra={})=>withTimeout(chrome.tabs.sendMessage(state.feedTabId,{type,runId:state.runId,loopId:state.loopId,...extra}),5000);
  const timers=()=>state.status==='running'?chrome.alarms.create(huxuan_alarm,{periodInMinutes:.5}):chrome.alarms.clear(huxuan_alarm);
  async function validTab(id) {
    const tab=await chrome.tabs.get(id).catch(()=>null);
    if (!tab || !huxuanContext(tab.url || tab.pendingUrl || '')) throw Error('请打开已登录的腾讯互选视频号创作者广场');
    return tab;
  }
  async function openPage({windowId,tabId,focusTab=true}={}) {
    const tabs=await chrome.tabs.query({url:'https://huxuan.qq.com/*',...(Number.isInteger(windowId)?{windowId}:{})});
    const available=tabs.filter(t=>!deps.ownedElsewhere?.(t.id));
    let tab=available.find(t=>t.id===tabId) || available.find(t=>t.active) || available.find(t=>t.id===state.feedTabId) || available.find(t=>huxuanContext(t.url || '')) || available[0];
    if(!tab) tab=await chrome.tabs.create({url:state.lastPageUrl || 'https://huxuan.qq.com/',active:true,...(Number.isInteger(windowId)?{windowId}:{})});
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
    if(version===generation && state.status==='running') await send('DRA_START_LOOP',{settings:state.runSettings,nextPage:state.nextPage,queryKey:state.queryKey,checkpoint:{range:collection.range,...collection.capture,authors:collection.enrichedAccounts || {}}});
    return state;
  }
  const start=id=>{const version=++generation;return serial(async()=>{
    if(active())throw Error('互选任务正在运行');
    const tab=await validTab(id);await deps.authorize();
    if(version!==generation)return state;
    state={...structuredClone(INITIAL_STATE),route,status:'starting',runId:crypto.randomUUID(),feedTabId:tab.id,feedWindowId:tab.windowId,startedAt:new Date().toISOString(),elapsedMs:0,runSettings:structuredClone(deps.settings()),runTarget:{mode:'pages',maxPages:deps.settings().huxuanTarget.maxPages},lastPageUrl:tab.url,nextPage:null,queryKey:null};
    collection={runId:state.runId,accounts:{},recentRows:[],pages:[],listPages:[],finalized:false};await save();
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
  function validatePage(page) {
    if(!page || !huxuanContext(page.pageUrl) || !Array.isArray(page.rows) || page.rows.length>100 || page.rows.some(r=>!huxuanId(r.authorId) || !r.authorName) || !Number.isInteger(page.pageNumber) || page.pageNumber<1 || typeof page.queryKey!=='string' || page.queryKey.length>100000)throw Error('互选页面数据不完整');
    if(state.queryKey===page.queryKey && state.nextPage && state.nextPage!==page.pageNumber)throw Error('互选页码与续跑进度不一致');
  }
  function recordCandidates(page) {
    let fresh=0;
    for(const row of page.rows){
      if(!collection.accounts[row.authorId]){
        fresh++;
        deps.recordDecision?.({code:'HUXUAN_CANDIDATE_REVIEW',reasons:['互选列表候选，待研究台人工复核']},{...row,sourcePlatform:'huxuan'},null,state);
      }
      collection.accounts[row.authorId]=true;
      deps.recordScan(`huxuan:${row.authorId}`);
    }
    collection.recentRows=page.rows.slice(-10).map(({listFields:_fields,...preview})=>({...preview,observedAt:page.capturedAt}));
    state.stats={...state.stats,matched:Object.keys(collection.accounts).length,scanned:Number(state.stats.scanned||0)+page.rows.length,duplicates:Number(state.stats.duplicates||0)+page.rows.length-fresh};
  }
  async function message(message,sender) {
    bound(message,sender);
    if(message.type==='DRA_WAIT') {
      const until=Number(message.until);if(!Number.isFinite(until)||until>Date.now()+30000)throw Error('无效等待时间');
      state.runtime={...state.runtime,progressAt:Date.now()};
      return waits.wait(until);
    }
    if(message.type==='DRA_TICK_ERROR') {await pause(message.error || '互选采集失败');return {ok:true};}
    return serial(async()=>{
      bound(message,sender);
      if(message.type==='DRA_PROGRESS'){state.runtime={phase:message.phase,authorName:message.authorName,dataset:message.dataset,pageIndex:message.pageIndex,received:message.received,total:message.total,progressAt:Date.now()};await save();return {ok:true};}
      if(message.type==='DRA_HUXUAN_LIST') {
        const page=message.page;validatePage(page);
        if(!collection.capture || collection.capture.page.queryKey!==page.queryKey) {
          await deps.savePage(page,state.runId);bound(message,sender);
          const rows=page.rows.map(({listFields:_fields,...preview})=>preview);
          collection.range ||= huxuanDateRange();
          collection.capture={pageNumber:page.pageNumber,range:collection.range,page:{...page,rows},candidatesRegistered:true,completed:Object.fromEntries(rows.map(row=>[huxuanCaptureKey(row.authorId,'list'),{status:'available'}]))};
          recordCandidates(page);
          const pageKey=JSON.stringify([page.queryKey,page.pageNumber]);
          if(!collection.listPages.includes(pageKey))collection.listPages.push(pageKey);
          state.queryKey=page.queryKey;state.nextPage=page.pageNumber;state.lastPageUrl=page.pageUrl;state.lastTickAt=new Date().toISOString();await save();
        }
        return {ok:true,checkpoint:{...collection.capture,authors:collection.enrichedAccounts || {}}};
      }
      if(message.type==='DRA_HUXUAN_PART') {
        const {row,capture,pageNumber,pageUrl,queryKey,range}=message;
        if(!row || !huxuanId(row.authorId) || !row.authorName || capture?.authorId!==row.authorId || !['list','complete',...HUXUAN_PROFILE_DATASETS,'videos:0','videos:1'].includes(capture?.dataset) || !['available','empty','unavailable'].includes(capture.status) || !Number.isInteger(pageNumber) || pageNumber<1 || typeof queryKey!=='string' || queryKey.length>100000 || !huxuanContext(pageUrl)) throw Error('互选主页数据不完整');
        if(state.queryKey && state.queryKey!==queryKey || state.nextPage && state.nextPage!==pageNumber)throw Error('互选资料与当前保存页不一致');
        const current=collection.capture || {pageNumber,range,completed:{}};
        if(current.pageNumber!==pageNumber)throw Error('互选主页续跑页码不一致');
        const key=huxuanCaptureKey(row.authorId,capture.dataset,capture.pageIndex);
        if(current.completed[key])return {ok:true,summary:current.completed[key]};
        if(capture.dataset==='complete') {
          for(const dataset of ['list',...HUXUAN_PROFILE_DATASETS,'videos:0','videos:1'])if(!current.completed[huxuanCaptureKey(row.authorId,dataset,dataset.startsWith('videos:')?0:null)])throw Error('互选达人仍有未保存栏目');
          for(const dataset of ['videos:0','videos:1']) {
            let count=0;
            for(let index=0;index<(state.runSettings?.huxuanVideoMaxPages ?? 1);index++) {
              const part=current.completed[huxuanCaptureKey(row.authorId,dataset,index)];
              if(!part)throw Error('互选达人作品仍有未保存分页');
              if(part.status==='unavailable')break;
              count+=part.count;
              if(count>=part.total)break;
            }
          }
        }
        const rows=huxuanCaptureRows(row,capture);
        await deps.savePage({rows,pageUrl,queryKey,capturedAt:capture.capturedAt},state.runId);
        // Pause/stop can arrive while IndexedDB is committing; the saved part
        // remains durable but must not revive or advance a stopped task.
        bound(message,sender);
        current.completed[key]=huxuanCaptureSummary(capture);collection.capture=current;collection.range=range;
        if(capture.dataset==='complete') {
          collection.enrichedAccounts ||= {};collection.enrichedAccounts[row.authorId]=true;
          const {listFields:_fields,...preview}=row;
          collection.recentRows=[...collection.recentRows.filter(item=>item.authorId!==row.authorId),{...preview,observedAt:current.page?.capturedAt,completedAt:capture.capturedAt}].slice(-10);
        }
        state.queryKey=queryKey;state.nextPage=pageNumber;state.lastPageUrl=pageUrl;state.lastTickAt=new Date().toISOString();
        await save();
        return {ok:true,summary:current.completed[key]};
      }
      if(message.type!=='DRA_HUXUAN_PAGE')throw Error('互选不支持此消息');
      const page=message.page;
      validatePage(page);
      if(page.profileCollection && page.rows.some(row=>!collection.enrichedAccounts?.[row.authorId]))throw Error('互选本页达人主页尚未全部保存');
      if(!page.profileCollection)await deps.savePage(page,state.runId);
      bound(message,sender);
      state.queryKey=page.queryKey;state.nextPage=page.pageNumber+1;state.lastPageNumber=String(page.pageNumber);state.lastPageUrl=page.pageUrl;
      const pageKey=JSON.stringify([page.queryKey,page.pageNumber]);
      if(!collection.pages.includes(pageKey))collection.pages.push(pageKey);
      if(!collection.listPages.includes(pageKey))collection.listPages.push(pageKey);
      if(!collection.capture?.candidatesRegistered || collection.capture.page?.queryKey!==page.queryKey || collection.capture.pageNumber!==page.pageNumber)recordCandidates(page);
      collection.capture=null;
      state.stats={...state.stats,pagesCollected:collection.pages.length};
      state.lastTickAt=new Date().toISOString();await save();
      if(page.last){await finish('当前筛选结果已采集完毕');return {continue:false};}
      if(collection.listPages.length>=state.runTarget.maxPages){await finish('已达到本轮采集页数');return {continue:false};}
      return {continue:state.status==='running',...(page.profileCollection?{authors:collection.enrichedAccounts}:{})};
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
    if(state.queryKey) {
      let savedQuery;
      try {savedQuery=JSON.parse(state.queryKey);} catch { /* Opaque saved keys remain usable until the next captured search. */ }
      if(Array.isArray(savedQuery) && savedQuery[1] && typeof savedQuery[1]==='object') {
        const [accountId,query]=savedQuery;
        state.queryKey=huxuanQueryKey({...query,page:{size:query.pageSize}},accountId);
      }
      if(collection?.capture?.page)collection.capture.page.queryKey=state.queryKey;
      if(collection)collection.pages=collection.pages.map(page=>Number.isInteger(page)?JSON.stringify([state.queryKey,page]):page);
    }
    if(collection) {
      collection.listPages ||= [...collection.pages];
      const page=collection.capture?.page;
      if(page) {
        const pageKey=JSON.stringify([page.queryKey,page.pageNumber]);
        if(!collection.listPages.includes(pageKey))collection.listPages.push(pageKey);
        // Older builds saved the roster but only registered candidates after
        // every profile finished. Recover that already durable roster once.
        if(!collection.capture.candidatesRegistered) {
          if(!collection.pages.includes(pageKey))recordCandidates(page);
          collection.capture.candidatesRegistered=true;
        }
      }
    }
    if(active()){state.elapsedMs=elapsedRunMs(state);state.activeSince=null;state.status='paused';state.pauseReason='插件已恢复，点击继续从已保存页码采集';}
  }
  return {state:()=>state,collection:()=>collection,storage:()=>({draHuxuanState:state,draHuxuanCollection:collection}),restore,start,resume,pause,stop,openPage,inspect,timers,active,message,clear:()=>{collection=null;}};
}
