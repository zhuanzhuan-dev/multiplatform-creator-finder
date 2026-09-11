import { INITIAL_STATE } from './defaults.js';
import { canResumeRun, elapsedRunMs, normalizeRunTarget, getRunLimitReason } from './run-limits.js';
import { createRunWaits, withTimeout, stepBudget, runtimeStalled } from './runtime-health.js';
import { evaluateVideoRules, evaluateCreatorRules, scoreCreator } from './rule-engine.js';
import { resolveRoute, launchUrl } from '../src/core/platform-router.ts';

export const KUAISHOU_ALARM='dra-kuaishou-watchdog';
export const KUAISHOU_STOP_ALARM='dra-kuaishou-stop';
const initial=()=>({...structuredClone(INITIAL_STATE),route:{platform:'kuaishou',surface:'recommend',label:'快手推荐'}});
export function decideKuaishou(observation,profile,rules) {
  const video=evaluateVideoRules(observation,rules);
  if(!video.matched)return video;
  if(!profile || !Number.isFinite(profile.followers))return {matched:false,needsReview:true,code:'PROFILE_MISSING',reasons:['作者主页未完整读取，保留观察供人工确认']};
  const creator=evaluateCreatorRules(profile,rules);
  if(!creator.matched)return creator;
  const score=scoreCreator({observation,profile,rules,categories:[...(video.categories || []),...(creator.categories || [])]});
  return {matched:true,needsReview:score.level==='B' || video.needsSemanticReview || creator.needsSemanticReview,
    code:score.level==='B' || video.needsSemanticReview || creator.needsSemanticReview?'ACCEPTED_REVIEW':'ACCEPTED',reasons:score.reasons,score};
}
export function createKuaishouRuntime(deps) {
  let state=initial(), seen=[], creators=[], operations=Promise.resolve(), generation=0;
  const waits=createRunWaits();
  const active=()=>['starting','running'].includes(state.status);
  const serial=work=>{const result=operations.then(work);operations=result.catch(()=>{});return result;};
  const save=async()=>{await deps.persist();await deps.indicators();};
  const send=(type,extra={})=>withTimeout(chrome.tabs.sendMessage(state.feedTabId,{type,runId:state.runId,loopId:state.loopId,...extra}),5000);
  const valid=tab=>resolveRoute(tab?.pendingUrl || tab?.url || '')?.platform==='kuaishou' && resolveRoute(tab?.pendingUrl || tab?.url || '')?.runnable;
  const increment=key=>{state.stats[key]=Number(state.stats[key]||0)+1;};
  async function timers(){
    if(state.status==='running'){
      await chrome.alarms.create(KUAISHOU_ALARM,{periodInMinutes:.5});
      if(state.stopAt)await chrome.alarms.create(KUAISHOU_STOP_ALARM,{when:Math.max(Date.now()+100,state.stopAt)});
    }else{await chrome.alarms.clear(KUAISHOU_ALARM);await chrome.alarms.clear(KUAISHOU_STOP_ALARM);}
  }
  function cancel(reason,status='paused'){
    generation++;state.elapsedMs=elapsedRunMs(state);state.activeSince=null;state.status=status;
    state.pausedAt=Date.now();state.endedAt=new Date().toISOString();state.pauseReason=reason;state.startupStage='';waits.cancel();
    if(Number.isInteger(state.feedTabId))void send('DRA_STOP_LOOP').catch(()=>{});
  }
  async function pause(reason='用户暂停'){cancel(reason);await timers();await save();return state;}
  async function stop(){cancel('用户结束本轮','stopped');return serial(async()=>{await timers();await save();return state;});}
  async function openPage({tabId,windowId,focus=true}={}){
    let tab=Number.isInteger(tabId)?await chrome.tabs.get(tabId).catch(()=>null):null;
    if(!valid(tab)){
      const win=windowId ?? tab?.windowId ?? (await chrome.windows.getCurrent()).id;
      tab=(await chrome.tabs.query({windowId:win,url:'https://www.kuaishou.com/*'})).find(t=>t.windowId===win && valid(t));
      if(!tab)tab=await chrome.tabs.create({windowId:win,url:launchUrl('kuaishou','recommend'),active:focus});
    }
    if(focus && !tab.active)tab=await chrome.tabs.update(tab.id,{active:true});
    return deps.waitForTab(tab.id);
  }
  async function launch(tab,own){
    tab=await deps.ensureContent(tab);
    if(own!==generation)return state;
    state.feedTabId=tab.id;state.feedWindowId=tab.windowId;state.loopId=crypto.randomUUID();state.status='running';
    state.startedAt ||=new Date().toISOString();state.activeSince=Date.now();state.endedAt=null;state.pauseReason='';state.lastError='';state.startupStage='';
    state.stopAt=['time','both'].includes(state.runTarget.mode)?Date.now()+Math.max(0,state.runTarget.durationMinutes*60000-state.elapsedMs):null;
    state.runtime={phase:'read',deadlineAt:Date.now()+30000};
    await timers();await save();
    if(own===generation)await send('DRA_START_LOOP',{settings:state.runSettings,rules:state.runRules,resume:{lastVideoId:state.lastVideoId}});
    return state;
  }
  function start(options={}){if(active())return Promise.reject(Error('快手任务正在运行'));const own=++generation;return serial(async()=>{
    if(active())throw Error('快手任务正在运行');
    if(!deps.settings().dryRun)await deps.authorize();
    if(own!==generation)return state;
    state={...initial(),status:'starting',runId:crypto.randomUUID(),elapsedMs:0,backgroundMode:'current-tab',runTarget:normalizeRunTarget(deps.settings().target),runSettings:structuredClone(deps.settings()),runRules:structuredClone(deps.rules()),startupStage:'正在打开快手推荐页'};seen=[];creators=[];
    await save();try{const tab=await openPage(options);return await launch(tab,own);}catch(e){if(own===generation)await pause(e.message);throw e;}
  });}
  function resume(options={}){const own=++generation;return serial(async()=>{
    if(!canResumeRun(state))throw Error('本轮已结束或达到目标，请开始新一轮');
    if(!state.runSettings.dryRun)await deps.authorize();
    if(own!==generation)return state;
    state.status='starting';await save();
    try{return await launch(await openPage({...options,tabId:state.feedTabId,focus:false}),own);}catch(e){if(own===generation)await pause(e.message);throw e;}
  });}
  function bound(message,sender){
    if((sender.frameId ?? 0)!==0 || sender.tab?.id!==state.feedTabId || !valid(sender.tab) || state.status!=='running' || message.runId!==state.runId || message.loopId!==state.loopId)throw Error('消息不属于当前快手任务');
  }
  async function profileFor(observation,own){
    const url=new URL(observation.profileUrl);
    if(url.origin!=='https://www.kuaishou.com' || !/^\/profile\/[\w-]+$/.test(url.pathname))throw Error('快手作者地址无效');
    const tab=await chrome.tabs.create({windowId:state.feedWindowId,url:url.href,active:false});
    try{
      await deps.waitForTab(tab.id);
      for(let i=0;i<15 && own===generation;i++){
        const result=await withTimeout(chrome.tabs.sendMessage(tab.id,{type:'DRA_KUAISHOU_PROFILE_READ'}),3000).catch(()=>null);
        if(result?.ok && result.profile?.profileUrl===url.href)return result.profile;
        if(result?.error?.includes('验证'))throw Error(result.error);
        await waits.wait(Date.now()+1000);
      }
      return null;
    }finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
  }
  async function message(message,sender){
    bound(message,sender);
    if(message.type==='DRA_WAIT')return waits.wait(message.until);
    if(message.type==='DRA_PROGRESS'){state.runtime={phase:message.phase,deadlineAt:Date.now()+stepBudget(message.phase,state.runSettings,message.waitUntil)};if(message.phase==='submit')state.runtime.deadlineAt=Date.now()+90000;await save();return {ok:true};}
    if(message.type==='DRA_TICK_ERROR'){await pause(message.error || '快手页面异常');return {ok:true};}
    if(message.type!=='DRA_KUAISHOU_VIDEO')throw Error('快手消息类型无效');
    return serial(async()=>{
      bound(message,sender);const own=generation, observation=message.observation;
      if(!observation || observation.sourcePlatform!=='kuaishou' || !/^[\w-]+$/.test(observation.videoId || '') || !/^[\w-]+$/.test(observation.authorId || '') || JSON.stringify(observation).length>100000)throw Error('快手观察数据不完整');
      if(seen.includes(observation.videoId))return {ok:true,continue:true,duplicate:true};
      const limit=getRunLimitReason(state,state.runSettings);if(limit){await pause(limit);return {ok:true,continue:false};}
      const video=evaluateVideoRules(observation,state.runRules);
      let profile=null;
      if(video.matched){state.runtime={phase:'profile',deadlineAt:Date.now()+90000};await save();profile=await profileFor(observation,own);}
      if(own!==generation)return {ok:true,continue:false};
      const decision=decideKuaishou(observation,profile,state.runRules);
      await deps.collect(observation,profile,decision,state);
      seen.push(observation.videoId);state.lastVideoId=observation.videoId;increment('scanned');
      if(decision.matched){increment('matched');if(!creators.includes(observation.authorId)){creators.push(observation.authorId);increment('newCreators');if(decision.needsReview)increment('reviewQueued');}}
      else increment(decision.needsReview?'failed':video.matched?'rejectedProfiles':'rejectedVideos');
      deps.recordDecision(decision,observation,profile,state);deps.recordScan(`kuaishou:${observation.videoId}`);
      state.lastTickAt=new Date().toISOString();await save();await deps.scheduleUpload(true);
      if(own!==generation)return {ok:true,continue:false};
      const reached=getRunLimitReason(state,state.runSettings);if(reached){await pause(reached);return {ok:true,continue:false};}
      return {ok:true,continue:true};
    });
  }
  async function inspect(){
    if(state.status!=='running')return;
    const reason=getRunLimitReason(state,state.runSettings);
    if(reason)return pause(reason);
    const tab=await chrome.tabs.get(state.feedTabId).catch(()=>null);
    if(!valid(tab))return pause('快手任务页已关闭或离开推荐页');
    const status=await send('DRA_LOOP_STATUS').catch(()=>null);
    if(!status?.running || status.runId!==state.runId || status.loopId!==state.loopId || runtimeStalled(state.runtime))return pause('快手页面运行中断，请继续本轮');
  }
  function restore(saved){
    if(saved.draKuaishou){state={...initial(),...saved.draKuaishou.state};seen=saved.draKuaishou.seen || [];creators=saved.draKuaishou.creators || [];}
    state.route=initial().route;
    if(state.status==='starting')cancel('启动被中断，请继续本轮');
  }
  return {state:()=>state,active,start,resume,pause,stop,message,inspect,timers,restore,storage:()=>({draKuaishou:{state,seen,creators}}),clear:()=>{state=initial();seen=[];creators=[];}};
}
