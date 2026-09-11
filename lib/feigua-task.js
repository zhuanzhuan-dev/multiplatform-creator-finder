import { feiguaPolicy, feiguaBatchReached, FEIGUA_REST_MS } from './feigua-policy.js';
import { newFeiguaCollection, mergeFeiguaPage, feiguaRecord } from './feigua-collection.js';
import { INITIAL_STATE } from './defaults.js';
import { canResumeRun, elapsedRunMs } from './run-limits.js';
import { createRunWaits, withTimeout } from './runtime-health.js';
import { resolveRoute, launchUrl } from '../src/core/platform-router.ts';

export const FEIGUA_ALARM = 'dra-feigua-watchdog';
export const FEIGUA_STOP_ALARM = 'dra-feigua-stop';
export function createFeiguaRuntime(deps) {
  let state = {...structuredClone(INITIAL_STATE), route: {platform:'feigua',surface:'library',label:'飞瓜视频库'}};
  let feiguaCollection = null;
  let operations = Promise.resolve();
  let controlGeneration = 0;
  const waits = createRunWaits();
  const active = () => ['starting','running'].includes(state.status);
  const serial = work => { const result = operations.then(work); operations = result.catch(()=>{}); return result; };
  const increment = (key, amount=1) => { state.stats[key] = Number(state.stats[key] || 0) + amount; };
  const persistWorkData = () => deps.persist();
  const persistState = () => deps.persist();
  const send = (type, extra={}) => withTimeout(chrome.tabs.sendMessage(state.feedTabId,{type,runId:state.runId,loopId:state.loopId,...extra}),5000);
  function bound(sender,message) {
    if (sender.frameId && sender.frameId !== 0 || sender.tab?.id !== state.feedTabId || message.runId !== state.runId || message.loopId !== state.loopId || state.status !== 'running') throw Error('消息不属于当前飞瓜任务');
  }
  async function save() { await deps.persist(); await deps.indicators(); }
  async function timers() {
    if (state.status === 'running') {
      await chrome.alarms.create(FEIGUA_ALARM,{periodInMinutes:.5});
      if (state.stopAt) await chrome.alarms.create(FEIGUA_STOP_ALARM,{when:Math.max(Date.now()+100,state.stopAt)});
    } else {
      await chrome.alarms.clear(FEIGUA_ALARM); await chrome.alarms.clear(FEIGUA_STOP_ALARM);
    }
  }
  function cancel(reason) {
    controlGeneration++;
    state.elapsedMs = elapsedRunMs(state); state.activeSince = null;
    state.status = 'paused'; state.pausedAt = Date.now(); state.endedAt = new Date().toISOString();
    state.pauseReason = reason; state.startupStage = ''; waits.cancel();
    void send('DRA_STOP_LOOP').catch(()=>{});
  }
  async function pause(reason='用户暂停') { cancel(reason); await timers(); await save(); return state; }
  async function validTab(tabId) {
    const tab = await chrome.tabs.get(tabId).catch(()=>null);
    const route = resolveRoute(tab?.pendingUrl || tab?.url || '');
    if (!tab || route?.platform !== 'feigua' || !route.runnable) throw Error('请在原飞瓜标签页恢复视频列表后继续，或结束本轮保存已有候选');
    return tab;
  }
  async function openPage({windowId, focusTab=true}={}) {
    const preferredWindow = Number.isInteger(windowId) ? windowId : state.feedWindowId;
    const targetWindow = Number.isInteger(preferredWindow) ? await chrome.windows.get(preferredWindow).catch(()=>null) : null;
    const destinationWindowId = targetWindow ? targetWindow.id ?? preferredWindow : (await chrome.windows.getCurrent()).id;
    let tab = Number.isInteger(state.feedTabId) ? await chrome.tabs.get(state.feedTabId).catch(()=>null) : null;
    if (!tab || resolveRoute(tab.pendingUrl || tab.url || '')?.platform !== 'feigua') {
      const tabs=await chrome.tabs.query({windowId:destinationWindowId,url:'https://dy.feigua.cn/app/*'});
      tab=tabs.find(candidate=>candidate.windowId===destinationWindowId && resolveRoute(candidate.pendingUrl || candidate.url || '')?.platform==='feigua' && resolveRoute(candidate.pendingUrl || candidate.url || '')?.runnable) || null;
    }
    if (!tab) tab=await chrome.tabs.create({windowId:destinationWindowId,url:launchUrl('feigua','library'),active:focusTab});
    else if (!resolveRoute(tab.pendingUrl || tab.url || '')?.runnable) tab=await chrome.tabs.update(tab.id,{url:launchUrl('feigua','library'),...(focusTab ? {active:true} : {})});
    else if (focusTab && !tab.active) tab=await chrome.tabs.update(tab.id,{active:true});
    return deps.waitForTab(tab.id);
  }
  async function launch() {
    let tab = await validTab(state.feedTabId);
    tab = await deps.ensureContent(tab);
    const status = await withTimeout(chrome.tabs.sendMessage(tab.id,{type:'DRA_LOOP_STATUS'}),5000).catch(()=>null);
    if (!status?.ok) throw Error('飞瓜页面脚本未加载，请刷新飞瓜页面后重试');
    if (state.status !== 'starting') return state;
    state.loopId = crypto.randomUUID(); state.status = 'running'; state.activeSince = Date.now();
    state.startedAt ||= new Date().toISOString(); state.pausedAt = null; state.endedAt = null; state.pauseReason = ''; state.lastError = ''; state.startupStage = '';
    state.runtime = {phase:'idle',progressAt:Date.now()};
    state.stopAt = null;
    await timers(); await save();
    if (state.status === 'running') await send('DRA_START_LOOP',{settings:state.runSettings,rules:state.runRules});
    return state;
  }
  const start = tabId => { const generation=++controlGeneration; return serial(async()=>{
    if (active()) throw Error('飞瓜任务正在运行，请先暂停或停止该平台任务');
    await validTab(tabId);
    if (deps.settings().feiguaUploadEnabled === true && !deps.settings().dryRun) await deps.authorize();
    if (generation !== controlGeneration) return state;
    await finalizeFeiguaCollection();
    if(feiguaCollection) {
      const rows=Object.values(feiguaCollection.accounts).flatMap(account=>account.videos || [account]);
      for(let index=0;index<rows.length;index+=60) await deps.savePage({rows:rows.slice(index,index+60),surface:'library',pageUrl:rows[index]?.pageUrl || '',capturedAt:rows[index]?.observedAt || state.startedAt},feiguaCollection.runId,true);
    }
    const tab = await validTab(tabId);
    if (generation !== controlGeneration) return state;
    state = {...structuredClone(INITIAL_STATE),route:{platform:'feigua',surface:'library',label:'飞瓜视频库'},status:'starting',runId:crypto.randomUUID(),loopId:crypto.randomUUID(),feedTabId:tab.id,feedWindowId:tab.windowId,backgroundMode:'current-tab',runTarget:{mode:'pages',maxPages:feiguaPolicy(deps.settings()).maxPages},batchStartPages:0,restUntil:null,elapsedMs:0,runSettings:{...structuredClone(deps.settings()),dryRun:deps.settings().dryRun || deps.settings().feiguaUploadEnabled !== true},runRules:structuredClone(deps.rules())};
    feiguaCollection = newFeiguaCollection(state.runId,state.runSettings.dryRun); feiguaCollection.keywords=[...state.runRules.feiguaKeywords];
    await save();
    try { return await launch(); } catch(error) { await pause(error.message); throw error; }
  }); };
  const resume = (options={}) => { const generation=++controlGeneration; return serial(async()=>{
    if (!canResumeRun(state) || feiguaCollection?.finalized) throw Error('本轮已结束或达到目标，请开始新一轮');
    if (deps.settings().feiguaUploadEnabled !== true) {
      state.runSettings = {...state.runSettings,dryRun:true};
      if (feiguaCollection && !feiguaCollection.finalized) feiguaCollection.dryRun=true;
    }
    if (!state.runSettings?.dryRun) await deps.authorize();
    if (generation !== controlGeneration) return state;
    if (state.restUntil) { state.batchStartPages=Number(state.stats.pagesCollected || 0); state.restUntil=null; }
    state.status='starting'; state.startupStage='正在恢复飞瓜视频库，保留已采集记录'; await save();
    try {
      const tab=await openPage({...options,focusTab:false});
      if (generation !== controlGeneration) return state;
      state.feedTabId=tab.id; state.feedWindowId=tab.windowId; state.resumeReplay=true;
      return await launch();
    } catch(error) { await pause(error.message); throw error; }
  }); };
  async function finish(reason='用户结束本轮') {
    cancel(reason);
    await timers();
    try { await finalizeFeiguaCollection(); state.status='stopped'; state.pauseReason=reason; state.restUntil=null; }
    catch(error) { state.lastError=error.message; await save(); throw error; }
    await save(); await deps.scheduleUpload(true); return state;
  }
  const stop = () => { cancel('用户结束本轮'); return serial(()=>finish()); };
  async function inspect() {
    if (state.status !== 'running') return;
    try {
      await validTab(state.feedTabId);
      const status=await send('DRA_LOOP_STATUS');
      if (state.status !== 'running') return;
      if (!status?.running || status.runId !== state.runId || status.loopId !== state.loopId) return pause('飞瓜页面循环中断，请检查页面后继续');
      if (Date.now()-(state.runtime?.progressAt || Date.parse(state.startedAt))>90000) return pause('飞瓜列表处理超时，请检查页面后继续');
      state.pageVisibility=status.visibilityState; state.pageHasFocus=status.hasFocus;
      await save();
    } catch(error) { await pause(error.message); }
  }
  async function message(message,sender) {
    bound(sender,message);
    if (message.type === 'DRA_WAIT') {
      const until=Number(message.until);
      if (!Number.isFinite(until) || until>Date.now()+300000) throw Error('无效的等待时间');
      const result=await waits.wait(Math.min(until,Date.now()+30000));
      if (!active() || state.runId!==message.runId || state.loopId!==message.loopId) return {ok:false,canceled:true};
      return {...result,ok:result.ok && state.status==='running'};
    }
    if (message.type === 'DRA_PAGE_BLOCKED' || message.type === 'DRA_TICK_ERROR' || message.type === 'DRA_FEED_STALLED') { await pause(message.reason || message.error || '飞瓜需要人工处理'); return {ok:true}; }
    return serial(async()=>{
      bound(sender,message);
      if (message.type === 'DRA_PROGRESS') { state.runtime={phase:message.phase,progressAt:Date.now()}; await save(); return {ok:true}; }
      if (message.type === 'DRA_FEIGUA_COMPLETE') { await finish('飞瓜已采集到最后一页'); return {ok:true}; }
      if (message.type !== 'DRA_FEIGUA_PAGE') throw Error('飞瓜不支持此操作');
      if (resolveRoute(message.page?.pageUrl || '')?.platform !== 'feigua') throw Error('飞瓜采集来源不匹配');
      const result=await handleFeiguaPage(message.page,message.runId,message.loopId);
      if (message.page.last) { await finish('飞瓜已采集到当前筛选的最后一页'); return {continue:false}; }
      if (feiguaBatchReached(state)) {
        state.restUntil=Date.now()+FEIGUA_REST_MS;
        await pause(`本批已采集 ${state.runTarget.maxPages} 页，建议休息至少 3 小时。提前继续可能增加访问限制风险，可手动继续采集。`);
        return {continue:false};
      }
      return result;
    });
  }
  function restore(saved) {
    const previous = saved.draFeiguaState || (saved.draState?.route?.platform==='feigua' ? saved.draState : null);
    feiguaCollection=saved.draFeiguaCollection || null;
    if (previous) state={...state,...previous,stats:{...state.stats,...previous.stats},runSettings:previous.runSettings || structuredClone(deps.settings()),runRules:previous.runRules || structuredClone(deps.rules())};
    else if (feiguaCollection && !feiguaCollection.finalized) state={...state,status:'paused',runId:feiguaCollection.runId,startedAt:new Date().toISOString(),pauseReason:'已保留旧版飞瓜候选，请结束本轮保存',runSettings:structuredClone(deps.settings())};
    state.route={platform:'feigua',surface:'library',label:'飞瓜视频库'};
    if (deps.settings().feiguaUploadEnabled !== true) {
      state.runSettings={...state.runSettings,dryRun:true};
      if (feiguaCollection && !feiguaCollection.finalized) feiguaCollection.dryRun=true;
    }
    // Persisted video-count runs keep candidates and migrate to page batches.
    if (state.runTarget?.mode !== 'pages') {
      state.runTarget={mode:'pages',maxPages:feiguaPolicy(deps.settings()).maxPages};
      state.batchStartPages=0; state.stopAt=null;
    }
    if (state.status==='starting') { state.status='paused'; state.pauseReason='启动被中断，请检查原页面后继续'; }
  }
  return {state:()=>state,collection:()=>feiguaCollection,restore,start,resume,stop,pause,message,openPage,inspect:()=>serial(inspect),timers,active,storage:()=>({draFeiguaState:state,draFeiguaCollection:feiguaCollection}),clear:()=>{feiguaCollection=null;},increment};
async function handleFeiguaPage(page, runId, loopId) {
  if (state.status !== "running" || state.runId !== runId || state.loopId !== loopId || feiguaCollection?.runId !== runId || feiguaCollection.finalized) return { continue: false };
  if (!Array.isArray(page?.rows) || !page.rows.length || page.rows.length > 60 || typeof page.fingerprint !== "string") throw new Error("飞瓜列表数据不完整");
  if (!state.resumeReplay && feiguaCollection.pages.includes(page.fingerprint) && feiguaCollection.pages.at(-1) !== page.fingerprint) throw new Error("飞瓜翻页返回已采集的旧页面，请检查分页后继续");
  if (!feiguaCollection.pages.includes(page.fingerprint)) state.resumeReplay=false;
  const available = 5000 - feiguaCollection.seen.length;
  // Process account exclusions for the whole rendered page before accepting a bounded batch.
  const copy = structuredClone(feiguaCollection);
  const result = mergeFeiguaPage(copy, page, copy.keywords);
  if (result.fresh.length > available) {
    const allowed = new Set(result.fresh.slice(0, available).map(row => JSON.stringify([row.authorName, row.videoId || row.title])));
    for (const [key, row] of Object.entries(copy.accounts)) {
      if (!feiguaCollection.accounts[key] && !allowed.has(JSON.stringify([row.authorName, row.videoId || row.title]))) delete copy.accounts[key];
    }
  }
  if (Object.keys(copy.accounts).length > 900 || copy.seen.length > 5060) throw new Error("飞瓜本轮本地候选已达容量，请结束本轮后再开始");
  await deps.savePage(page,runId);
  copy.observationPipeline=true;
  feiguaCollection = copy;
  state.stats.pagesCollected = copy.pages.length;
  state.lastPageNumber = String(page.pageNumber || "");
  state.lastPageUrl = page.pageUrl;
  increment("scanned", Math.min(available, result.fresh.length));
  increment("duplicates", result.duplicates);
  state.stats.matched = Object.keys(copy.accounts).length;
  state.stats.newCreators = Object.keys(copy.accounts).filter(key => !deps.creatorIndex()[`${copy.dryRun ? "dry:" : ""}${key}`]).length;
  state.stats.reviewQueued = state.stats.newCreators;
  state.stats.rejectedProfiles = Object.keys(copy.excluded).length;
  for (const event of result.events) deps.recordDecision(event, { ...event.row, sourcePlatform: "feigua" }, null, state);
  for (const row of result.fresh.slice(0, available)) deps.recordScan( `feigua:${row.videoId || row.authorName + row.title}`);
  state.lastTickAt = new Date().toISOString();
  await persistWorkData();
  await persistState();
  return { continue: state.status === "running" && state.runId === runId };
}

async function finalizeFeiguaCollection() {
  if (!feiguaCollection || feiguaCollection.finalized) return;
  const collection = feiguaCollection;
  const entries = Object.entries(collection.accounts).filter(([key]) => !deps.creatorIndex()[`${collection.dryRun ? "dry:" : ""}${key}`]);
  if(collection.observationPipeline && !collection.dryRun){collection.finalized=true;await persistWorkData();return;}
  deps.reserveQueue(entries.length);
  for (const [key, row] of entries) {
    const record = feiguaRecord(row, collection.runId);
    deps.addOutbox(collection.dryRun ? "dry-run" : "pending", record, "", { owner: state });
    deps.creatorIndex()[`${collection.dryRun ? "dry:" : ""}${key}`] = { status: "indexed", lastSeenAt: new Date().toISOString(), sourceVideoId: row.videoId || "" };
  }
  collection.finalized = true;
  await persistWorkData();
}


}
