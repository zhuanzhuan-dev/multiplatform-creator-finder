import {createProfileNetworkCapture} from "./lib/douyin-profile-network.js";
import { createTaskInstances, TASK_INSTANCES_KEY, TASK_PROGRESS_KEY, TASK_PLATFORMS } from "./lib/task-instances.js";
import { createInstanceRuntime } from "./lib/instance-runtime.js";
import { createDouyinRuntime, DOUYIN_CONTENT_MESSAGES } from "./lib/douyin-task.js";
import { decisionIpFields } from "./lib/decision-history.js";
import { captureRuleMatch } from "./lib/rule-match.js";
import { createRuleSync } from "./lib/rule-sync.js";
import { createKuaishouRuntime, KUAISHOU_ALARM, KUAISHOU_STOP_ALARM } from './lib/kuaishou-task.js';
import { createBilibiliRuntime, splitLegacyBilibiliStorage, BILIBILI_ALARM, BILIBILI_STOP_ALARM, BILIBILI_POPULAR_ALARM, BILIBILI_POPULAR_STOP_ALARM } from './lib/bilibili-task.js';
import { bilibiliFeedbackFields } from './lib/bilibili-api.js';
import { mergeBilibiliRules, validateBilibiliRules } from './lib/bilibili-rules.js';
import { saveObservations, normalizeDouyinObservation, exportObservations, normalizeFeiguaObservation, normalizeXingtuObservation, observationRecord as feiguaObservationRecord, xingtuObservationRecord, observationStatus, xingtuObservedCreators, pendingObservations, enableCreatorObservationUpload, markObservationsQueued, markObservationsUploaded, cleanupObservations } from './lib/observations.js';
import { evaluateFeiguaRules } from './lib/feigua-rules.js';
import { rowAccountKey } from './lib/feigua-parser.js';
import { createFeiguaRuntime, FEIGUA_ALARM, FEIGUA_STOP_ALARM } from "./lib/feigua-task.js";
import { createXingtuRuntime, XINGTU_ALARM, XINGTU_STOP_ALARM } from "./lib/xingtu-task.js";
import { createHuxuanRuntime, defaultHuxuanSettings, HUXUAN_ALARM } from "./lib/huxuan-task.js";
import { normalizeHuxuanObservation, huxuanObservationRecord } from "./lib/huxuan-collection.js";
import { canonicalXingtuPageUrl } from './lib/xingtu-parser.js';
import { restoreEngagement } from "./lib/engagement.js";
import { rawSamples } from "./lib/raw-sample-store.js";
import { sanitizeRaw } from "./lib/raw-sample.js";
import { accountProfile } from "./lib/account-profile.js";
import { launcherState, toolbarState, aggregateTaskState } from "./lib/launcher-state.js";

import { createDouyinIpLocationReader } from "./lib/douyin-ip-location.js";
import { dailySnapshot, recordDailyScan } from "./lib/daily-stats.js";
import { loadOutbox, writeOutboxChanges } from "./lib/outbox-store.js";
import { CLOUD_DESTINATION, MAX_INGEST_BYTES, MAX_INGEST_RECORDS, buildIngestBody, buildObservationRecord, classifyIngestStatus, createCloudClient, encodeIngestBody, ingestResultSets, pairUrlFor, shrinkRecordsToByteLimit } from "./lib/cloud.js";
import { DEFAULT_RULES, DEFAULT_SETTINGS, INITIAL_STATE, STORAGE_KEYS, TEAM_DESTINATION, mergeRules, mergeSettings, mergeXingtuRules, mergeXingtuSettings, scheduleFrom, validateSettings } from "./lib/defaults.js";
import { migrateDecisionHistory, writeDecisions, cleanupDecisions, decisionPreview, queryDecisions } from "./lib/decision-store.js";
import { normalizeSourcePlatform } from "./lib/source-platform.js";

import { validateRules } from "./lib/rule-engine.js";
import { withTimeout } from "./lib/runtime-health.js";
import { normalizeRunTarget } from "./lib/run-limits.js";
import { nextScheduledOccurrence, validateSchedule } from "./lib/scheduler.js";
import { launchUrl, resolveRoute } from "./src/core/platform-router.ts";

const WATCHDOG_ALARM = "dra-watchdog";
const SCHEDULE_ALARM = "dra-schedule-next";
const BILIBILI_SCHEDULE_ALARM = "dra-schedule-bilibili";
const BILIBILI_POPULAR_SCHEDULE_ALARM = "dra-schedule-bilibili-popular";
const RUN_STOP_ALARM = "dra-run-stop";
const UPLOAD_ALARM = "dra-upload";
const CREATOR_UPLOAD_BACKFILL_ALARM = "dra-creator-upload-backfill";
const CREATOR_UPLOAD_BACKFILL_KEY = "draCreatorUploadBackfillV1";
const MAX_OUTBOX = 1_000;
const SIDE_PANEL_PATH = "sidepanel/index.html";
const panelPorts = new Map();
const cloudClient = createCloudClient();
const MAX_UPLOAD_ATTEMPTS = 8;
const MAX_UPLOAD_BATCHES = 5;
const MAX_UPLOAD_WORK_MS = 5_000;
const COMPANY_SSO_REQUIRED_ERROR = "company_sso_required";
const COMPANY_SSO_REQUIRED_MESSAGE = "请先打开研究台完成公司登录，再重试上传";

let initialized = null;
const pendingPanelSelections = new Map();
let state = structuredClone(INITIAL_STATE);
const readDouyinIpLocation = createDouyinIpLocationReader({ waitForTab: waitForTabComplete });
let settings = mergeSettings();
let rules = mergeRules();
let settingsDraft = null;
let kuaishouConfig = {settings:mergeSettings(),rules:mergeRules(),settingsDraft:null};
let bilibiliConfig = {settings:mergeSettings(),rules:mergeBilibiliRules(),settingsDraft:null};
let bilibiliPopularConfig = {settings:mergeSettings(),rules:mergeBilibiliRules(),settingsDraft:null};
let xingtuConfig = {settings:mergeXingtuSettings(),rules:mergeXingtuRules(),settingsDraft:null};
let huxuanConfig = {settings:defaultHuxuanSettings(),rules:{},settingsDraft:null};
function configurationFor(platform) {
  if (instances.get(platform)) return instances.get(platform).config;
  if (platform === "huxuan") return huxuanConfig;
  if (platform === "kuaishou") return kuaishouConfig;
  if (platform === "bilibili-popular") return bilibiliPopularConfig;
  if (platform === "bilibili") return bilibiliConfig;
  if (platform === "xingtu") return xingtuConfig;
  return {settings,rules,settingsDraft};
}
function taskConfigPlatform(task) {
  if (task?.taskId?.startsWith("task:")) return task.taskId;
  if (task?.route?.platform === "bilibili" && task.route?.surface === "popular") return "bilibili-popular";
  return task?.route?.platform || "douyin";
}
function recommendationSettingsFrom(savedConfig, previousRunSettings, fallback) {
  return mergeSettings(savedConfig?.settings || previousRunSettings || {
    ...fallback,
    target: DEFAULT_SETTINGS.target,
    schedule: { ...fallback?.schedule, target: DEFAULT_SETTINGS.schedule.target }
  });
}
function bilibiliSettingsFrom(savedConfig, previousRunSettings, fallback) {
  const merged = recommendationSettingsFrom(savedConfig, previousRunSettings, fallback);
  if (savedConfig?.scheduleOptIn !== true) merged.schedule = { ...merged.schedule, enabled: false };
  return merged;
}
const SCHEDULED_PLATFORMS = [
  { alarm: SCHEDULE_ALARM, platform: "douyin" },
  { alarm: "dra-schedule-kuaishou", platform: "kuaishou" },
  { alarm: BILIBILI_SCHEDULE_ALARM, platform: "bilibili" },
  { alarm: BILIBILI_POPULAR_SCHEDULE_ALARM, platform: "bilibili-popular" },
  { alarm: "dra-schedule-feigua", platform: "feigua" },
  { alarm: "dra-schedule-xingtu", platform: "xingtu" }
];
function platformSchedule(platform) {
  if (platform === "feigua") return settings.feiguaSchedule;
  return configurationFor(platform).settings?.schedule;
}
function scheduleRuntime(platform) {
  if (platform === "kuaishou") return kuaishou;
  if (platform === "bilibili") return bilibili;
  if (platform === "bilibili-popular") return bilibiliPopular;
  if (platform === "feigua") return feigua;
  if (platform === "xingtu") return xingtu;
  return null;
}
let configQueue = Promise.resolve();
let seenVideos = [];
let creatorIndex = {};
let outbox = [];
const outboxWrites = new Map();
const outboxDeletes = new Map();
let outboxRevision = 0;
let workDataWrites = Promise.resolve();
let browseState = {enabled:true, count:0, lastError:""};
let xingtuBrowseState = {enabled:true, count:0, lastError:""};
let browseWrites=Promise.resolve();
let xingtuBrowseWrites=Promise.resolve();
let dailyStats = null;
let pendingDecisions = [];
let historyWrites = Promise.resolve();
let flushInFlight = null;
let uploadDrainInFlight = null;
let uploadScheduling = Promise.resolve();
let cloudAuth = null;
let pairing = null;
const ruleSync = createRuleSync({ storage:chrome.storage.local, auth:()=>cloudAuth,
  request:(token,body)=>cloudClient.syncRules(token,body,pluginVersion()), getRules:platform=>configurationFor(platform).rules,
  saveRules:(platform,next)=>saveConfiguration({platform,rules:next}) });
async function prepareFeedbackRules(platform) {
  const work=configQueue.then(()=>ruleSync.beforeStart(platform));configQueue=work.catch(()=>undefined);await work;
}


const profileNetwork=createProfileNetworkCapture(chrome.debugger);
const douyin = createDouyinRuntime({
 config:()=>({settings,rules}),identity:()=>({taskId:'douyin',taskName:'默认任务'}),
 changed:value=>{state=value.state;seenVideos=value.seenVideos;creatorIndex=value.creatorIndex;},
 ready:initialize,persist:persistWorkData,persistState,indicators:updateTaskIndicators,
 authorize:checkCloudConnection,beforeStart:()=>prepareFeedbackRules('douyin'),scheduleUpload:requestUpload,
 recordDecision,addOutbox,touchOutbox,outbox:()=>outbox,cloudAuth:()=>cloudAuth,
 recordScan:key=>{dailyStats=recordDailyScan(dailyStats,key);},
 saveSettings:async next=>{settings=next;await chrome.storage.local.set({[STORAGE_KEYS.settings]:settings});},
 selectPage:tabId=>chrome.tabs.get(tabId),ownedElsewhere:tabId=>ownedElsewhere(tabId,'douyin'),
 waitForTabComplete,ensureContentRuntime,sendTabMessage,saveRawSample,readDouyinIpLocation,
 captureProfileIp:profileNetwork.enable,releaseProfileIp:profileNetwork.detach,readCapturedProfileIp:profileNetwork.read
});
function observationRecord(...args){return douyin.observationRecord(...args);}
function setPaused(...args){return douyin.setPaused(...args);}
function syncRunStopAlarm(...args){return douyin.syncRunStopAlarm(...args);}
function startRun(...args){return douyin.startRun(...args);}
function resumeRun(...args){return douyin.resumeRun(...args);}
function stopRun(...args){return douyin.stopRun(...args);}
function watchdog(...args){return douyin.watchdog(...args);}
function handleRunStopAlarm(...args){return douyin.handleRunStopAlarm(...args);}

const feigua = createFeiguaRuntime({
  ownedElsewhere:tabId=>ownedElsewhere(tabId,'feigua'),
  settings:()=>settings, rules:()=>rules, authorize:checkCloudConnection, beforeStart:()=>prepareFeedbackRules("feigua"),
  ensureContent:ensureContentRuntime, waitForTab:waitForTabComplete,
  creatorIndex:()=>creatorIndex, reserveQueue, addOutbox, recordDecision,
  recordScan:key=>{dailyStats=recordDailyScan(dailyStats,key);},
  persist:persistWorkData, indicators:updateTaskIndicators, scheduleUpload:requestUpload,
  savePage:async(page,runId,legacy=false,captureRules=null)=>{
    const items=await saveObservations(page.rows.map(row=>({...normalizeFeiguaObservation(row,page,runId,"automatic"),uploadEligible:!legacy,...(!legacy && captureRules?{ruleContext:{platform:"feigua",rules:structuredClone(captureRules),capturedAt:page.capturedAt},ruleMatch:captureRuleMatch(row.ruleDecision,{route:{label:'飞瓜视频库'}},'feigua')}:{})})));
    void requestUpload();
    return items;
  }
});
const xingtu = createXingtuRuntime({
  ownedElsewhere:tabId=>ownedElsewhere(tabId,'xingtu'),
  settings:()=>xingtuConfig.settings, rules:()=>xingtuConfig.rules, authorize:checkCloudConnection, beforeStart:()=>prepareFeedbackRules("xingtu"),
  ensureContent:ensureContentRuntime, waitForTab:waitForTabComplete,
  creatorIndex:()=>creatorIndex, reserveQueue, addOutbox, recordDecision,
  recordScan:key=>{dailyStats=recordDailyScan(dailyStats,key);},
  persist:persistWorkData, indicators:updateTaskIndicators, scheduleUpload:requestUpload,
  savePage:async(page,runId,legacy=false,captureRules=null)=>{
    const items=await saveObservations(page.rows.map(row=>({...normalizeXingtuObservation(row,page,runId,"automatic"),uploadEligible:!legacy && /^\d{1,30}$/.test(String(row.xingtuId || '')),...(!legacy && captureRules?{ruleContext:{platform:"xingtu",rules:structuredClone(captureRules),capturedAt:page.capturedAt}}:{})})));
    void requestUpload();
    return items;
  }
});
const huxuan = createHuxuanRuntime({
  ownedElsewhere:tabId=>ownedElsewhere(tabId,'huxuan'),
  settings:()=>huxuanConfig.settings, authorize:checkCloudConnection,
  ensureContent:ensureContentRuntime, waitForTab:waitForTabComplete,
  persist:persistWorkData, indicators:updateTaskIndicators, scheduleUpload:requestUpload, recordDecision,
  recordScan:key=>{dailyStats=recordDailyScan(dailyStats,key);},
  savePage:async(page,runId)=>{
    await saveObservations(page.rows.map(row=>normalizeHuxuanObservation(row,page,runId)));
    void requestUpload();
  }
});
const kuaishou = createKuaishouRuntime({
  ownedElsewhere:tabId=>ownedElsewhere(tabId,'kuaishou'),
  settings:()=>kuaishouConfig.settings,rules:()=>kuaishouConfig.rules,authorize:checkCloudConnection,beforeStart:()=>prepareFeedbackRules("kuaishou"),
  ensureContent:ensureContentRuntime,waitForTab:waitForTabComplete,
  persist:persistWorkData,indicators:updateTaskIndicators,scheduleUpload:requestUpload,recordDecision,
  recordScan:key=>{dailyStats=recordDailyScan(dailyStats,key);},
  collect:collectKuaishou
});
async function collectKuaishou(observation,profile,decision,owner){
    await saveObservations([{...normalizeDouyinObservation(observation,profile,owner.runId),sourcePlatform:'kuaishou',accountPlatform:'kuaishou'}]);
    const payload=buildObservationRecord({observation,profile,runId:owner.runId,feedIndex:Number(owner.stats.scanned || 0)+1,
      dwellSeconds:observation.dwellSeconds,isRelevant:decision.matched,decision:decision.matched?'keep':decision.needsReview?'review':'skip',
      action:'collect',score:decision.score,extra:{finderDecision:decision.code,reasons:decision.reasons,ruleMatch:captureRuleMatch(decision,owner,'kuaishou')}});
    payload.comment_count=observation.comments ?? null;payload.favorite_count=observation.favorites ?? null;
    Object.assign(payload.rpa_feedback,{source:'kuaishou-recommend',account_platform:'kuaishou',kuaishou_user_id:observation.authorId,
      kuaishou_id:profile?.kuaishouId || '',kuaishou_handle_source:profile?.kuaishouId?'profile_uid_text':null,
      kuaishou_profile_read:Boolean(profile),no_profile_navigation:false,review_required:Boolean(decision.needsReview)});
    addOutbox(owner.runSettings.dryRun?'dry-run':'pending',payload,'',{owner,captureRules:true});
    await persistWorkData();
}
function collectBilibili(observation,profile,decision,owner) {
  return (async()=>{
    await saveObservations([{...normalizeDouyinObservation(observation,profile,owner.runId),sourcePlatform:'bilibili',accountPlatform:'bilibili'}]);
    const payload=buildObservationRecord({observation,profile,runId:owner.runId,feedIndex:Number(owner.stats.scanned || 0)+1,
      dwellSeconds:observation.dwellSeconds,isRelevant:decision.matched,decision:decision.matched?'keep':decision.needsReview?'review':'skip',
      action:'collect',score:decision.score,extra:{finderDecision:decision.code,reasons:decision.reasons,ruleMatch:captureRuleMatch(decision,owner,'bilibili')}});
    payload.comment_count=observation.comments ?? null;payload.favorite_count=observation.favorites ?? null;
    payload.share_count=observation.shares ?? null;
    Object.assign(payload.rpa_feedback,{source:observation.feedSurface==='popular'?'bilibili-popular':'bilibili-web-recommend',account_platform:'bilibili',bilibili_mid:observation.authorId,
      bilibili_bvid:observation.videoId || '',no_profile_navigation:true,review_required:Boolean(decision.needsReview),
      ...bilibiliFeedbackFields(observation, profile)});
    addOutbox(owner.runSettings.dryRun?'dry-run':'pending',payload,'',{owner,captureRules:true});
    await persistWorkData();
  })();
}
function createBilibiliSurfaceRuntime(surface, config) {
  return createBilibiliRuntime({
    ownedElsewhere:tabId=>ownedElsewhere(tabId,surface==='popular'?'bilibili-popular':'bilibili'),
    settings:()=>config().settings,rules:()=>config().rules,authorize:checkCloudConnection,beforeStart:()=>prepareFeedbackRules(surface === "popular" ? "bilibili-popular" : "bilibili"),
    ensureContent:ensureContentRuntime,waitForTab:waitForTabComplete,
    persist:persistWorkData,indicators:updateTaskIndicators,scheduleUpload:requestUpload,recordDecision,
    persistProgress:()=>persistTaskProgress((surface === 'popular' ? bilibiliPopular : bilibili).progressStorage()),
    recordScan:key=>{dailyStats=recordDailyScan(dailyStats,key);},
    collect:collectBilibili
  }, {surface});
}
const bilibili = createBilibiliSurfaceRuntime("recommend", () => bilibiliConfig);
const bilibiliPopular = createBilibiliSurfaceRuntime("popular", () => bilibiliPopularConfig);
function bilibiliTasks() { return [bilibili, bilibiliPopular]; }
function bilibiliBySelection(platform, url = "") {
  if (platform === "bilibili-popular") return bilibiliPopular;
  if (platform === "bilibili") return bilibili;
  const route = resolveRoute(url);
  if ((platform === "auto" || !platform) && route?.platform === "bilibili") {
    return route.surface === "popular" ? bilibiliPopular : bilibili;
  }
  return null;
}
function bilibiliForTab(tabId) {
  return Number.isInteger(tabId) ? bilibiliTasks().find((task) => task.state().feedTabId === tabId) : null;
}
async function pauseLiveBilibili(reason) {
  for (const task of bilibiliTasks()) {
    if (task.active() && !task.state().runSettings?.dryRun) await task.pause(reason);
  }
}

const instances=createTaskInstances({config:configurationFor,persist:persistWorkData,runtime:entry=>createInstanceRuntime(entry,{
 persist:persistWorkData,persistState:()=>persistTaskProgress(instances.progressStorage()),indicators:updateTaskIndicators,authorize:checkCloudConnection,scheduleUpload:requestUpload,
 ensureContent:ensureContentRuntime,waitForTab:waitForTabComplete,waitForTabComplete,ensureContentRuntime,sendTabMessage,
 recordDecision,addOutbox,touchOutbox,reserveQueue,saveObservations,saveRawSample,readDouyinIpLocation,
 captureProfileIp:profileNetwork.enable,releaseProfileIp:profileNetwork.detach,readCapturedProfileIp:profileNetwork.read,
 collectKuaishou,collectBilibili,outbox:()=>outbox,cloudAuth:()=>cloudAuth,
 recordScan:key=>{dailyStats=recordDailyScan(dailyStats,key);},ownedElsewhere,
 selectPage:async(entry,tabId)=>{
   const previous=entry.runtime.state();
   let tab=Number.isInteger(previous.feedTabId)?await chrome.tabs.get(previous.feedTabId).catch(()=>null):null;
   if(!tab || !isRecommendationFeedUrl(tab.pendingUrl || tab.url || '')){
     const current=Number.isInteger(tabId)?await chrome.tabs.get(tabId).catch(()=>null):null;
     tab=await chrome.tabs.create({url:launchUrl('douyin','recommend'),active:true,...(current?.windowId?{windowId:current.windowId}:{})});
   } else if(!tab.active)tab=await chrome.tabs.update(tab.id,{active:true});
   return {...tab,createdByExtension:true};
 }
})});
function defaultRuntime(platform){return {douyin,kuaishou,bilibili,'bilibili-popular':bilibiliPopular,feigua,xingtu,huxuan}[platform];}
function runtimeFor(platform){return instances.get(platform)?.runtime || defaultRuntime(platform);}
function taskStates(){return [douyinTaskSnapshot(),kuaishou.state(),bilibili.state(),bilibiliPopular.state(),feigua.state(),xingtu.state(),huxuan.state(),...instances.states()];}
function ownedElsewhere(tabId,id){return taskStates().some(task=>Number.isInteger(tabId) && task.feedTabId===tabId && (task.taskId || taskConfigPlatform(task))!==id);}
function instanceForAlarm(name){return instances.values().find(entry=>name==='dra-instance-watch:'+entry.id || name==='dra-instance-stop:'+entry.id || name==='dra-instance-schedule:'+entry.id);}
async function controlTask(message){
  let selection=message.platform;
  if(!selection || selection==='auto')selection=taskConfigPlatform(await selectedTask(message.tabId));
  const task=runtimeFor(selection);
  if(!task)throw Error('找不到该平台任务或分身');
  if(message.type!=='DRA_START' && message.runId && message.runId!==task.state().runId)throw Error('任务已变化，请刷新状态后重试');
  if(message.type==='DRA_PAUSE'){await task.pause('用户暂停');return {ok:true,state:task.state()};}
  if(message.type==='DRA_STOP')return {ok:true,state:await task.stop()};
  if(message.type==='DRA_RESUME')return {ok:true,state:await task.resume({windowId:message.windowId,target:configurationFor(selection).settings.target})};
  let tab=await chrome.tabs.get(message.tabId);
  const entry=instances.get(selection),platform=entry?.platform || selection;
  if(['feigua','xingtu','huxuan'].includes(platform)){
    const route=resolveRoute(tab.pendingUrl || tab.url || '');
    if(route?.platform===platform && route.runnable && !ownedElsewhere(tab.id,selection))return {ok:true,state:await task.start(tab.id)};
    tab=await task.openPage({windowId:tab.windowId});return {ok:true,state:await task.start(tab.id)};
  }
  if(ownedElsewhere(tab.id,selection) && entry?.platform!=='douyin'){
    const base=platform==='bilibili-popular'?'bilibili':platform;
    tab=await chrome.tabs.create({windowId:tab.windowId,url:launchUrl(base,platform==='bilibili-popular'?'popular':'recommend'),active:true});
  }
  return {ok:true,state:await task.start({tabId:tab.id,windowId:tab.windowId})};
}
async function saveInstanceConfiguration(entry,message){
  if(entry.runtime.active())throw Error('请先暂停当前分身再修改设置');
  const current=entry.config,platform=entry.platform;
  const merge=platform.startsWith('bilibili')?mergeBilibiliRules:platform==='xingtu'?mergeXingtuRules:mergeRules;
  const next={...current,settings:{...current.settings,...message.settings},rules:merge(message.rules || current.rules),settingsDraft:null};
  const problems=[...(platform==='xingtu'||platform==='huxuan'?[]:validateSettings(next.settings)),...(platform.startsWith('bilibili')?validateBilibiliRules(next.rules):platform==='xingtu'||platform==='huxuan'?[]:validateRules(next.rules)),...validateSchedule((platform==='feigua'?next.settings.feiguaSchedule:next.settings.schedule) || {enabled:false})];
  if(problems.length && !message.saveDraft)throw Error(problems.join('；'));
  entry.config=problems.length?{...current,settingsDraft:next.settings}:next;
  await persistWorkData();await syncInstanceSchedule(entry);
  return {ok:true,configPlatform:entry.id,...entry.config,problems};
}
async function saveInstanceCatalog(entry,message) {
  const platform=entry.platform;
  const maxPages=Number(message.maxPages),minSeconds=Number(message.minSeconds),maxSeconds=Number(message.maxSeconds);
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>500)throw Error('页数需为1至500的整数');
  if(!Number.isFinite(minSeconds)||!Number.isFinite(maxSeconds)||minSeconds<1||maxSeconds>30||maxSeconds<minSeconds)throw Error('翻页间隔需为1至30秒，最大值应大于或等于最小值');
  const words=(value)=>{
    if(!Array.isArray(value)||value.length>200||value.some(word=>typeof word!=='string'||word.length>100))throw Error('关键词最多200个，每个词最多100字');
    return [...new Set(value.map(word=>word.trim()).filter(Boolean))];
  };
  const settings={...entry.config.settings,[platform+'Target']:{maxPages},[platform+'Delay']:{minSeconds,maxSeconds}};
  let rules=entry.config.rules;
  if(platform!=='huxuan')rules={...rules,[platform+'Keywords']:words(message.keywords)};
  if(platform==='feigua')rules.feiguaPositiveKeywords=words(message.positiveKeywords);
  if(message.schedule){const errors=validateSchedule(message.schedule);if(errors.length)throw Error(errors.join('；'));settings[platform==='feigua'?'feiguaSchedule':'schedule']=scheduleFrom(message.schedule,true);}
  return saveInstanceConfiguration(entry,{settings,rules});
}
async function pauseLiveInstances(reason) {
  for(const entry of instances.values())if(entry.runtime.active() && !entry.runtime.state().runSettings?.dryRun)await entry.runtime.pause(reason);
}
function catalogTaskForTab(platform,tabId) {
  const entry=instances.forTab(tabId);
  if(entry?.platform===platform)return entry.runtime;
  const task=defaultRuntime(platform);
  return task?.state().feedTabId===tabId?task:null;
}
async function pauseCatalogForNavigation(platform,tab) {
  const route=resolveRoute(tab.url || tab.pendingUrl || '');
  if(route?.platform!==platform || !(platform==='feigua'?/#\/(video-detail|blogger-detail)\//.test(tab.url || ''):route.surface==='creator'))return;
  const active=[defaultRuntime(platform),...instances.values().filter(entry=>entry.platform===platform).map(entry=>entry.runtime)].filter(task=>task.active());
  const bound=catalogTaskForTab(platform,tab.id) || catalogTaskForTab(platform,tab.openerTabId);
  const task=bound || (active.length===1?active[0]:null);
  if(task?.active())await task.pause(`你已进入${platform==='feigua'?'飞瓜详情':'星图达人主页'}，自动翻页已暂停`);
}
async function syncInstanceSchedule(entry,from=Date.now()){
  const alarm='dra-instance-schedule:'+entry.id;await chrome.alarms.clear(alarm);
  const schedule=entry.platform==='feigua'?entry.config.settings.feiguaSchedule:entry.config.settings.schedule;
  if(!schedule?.enabled || validateSchedule(schedule).length)return;
  const next=nextScheduledOccurrence(schedule,from);if(next)await chrome.alarms.create(alarm,{when:next.scheduledTime});
}

function observationOwner(item) {
  return {runId:item.sessionId,startedAt:item.firstObservedAt,taskId:item.taskId || item.sourcePlatform,
    taskName:item.taskName || '默认任务',route:{platform:item.sourcePlatform}};
}
function taskForSession(sessionId) { return taskStates().find(task=>task.runId===sessionId); }
function incrementForSession(sessionId,key,amount=1) {
  const owner=taskForSession(sessionId); if(owner) owner.stats[key]=Number(owner.stats[key]||0)+amount;
}
function reserveQueue(count) {
  const settled=new Set(['written','duplicate','dry-run']);
  // The collection journal stays durable even if uploads are slower than collection.
  // Only old settled entries are disposable; the uploader applies its own staging cap.
  let excess=Math.max(0,outbox.length+count-MAX_OUTBOX);
  const discarded = [];
  for (const item of outbox) if (excess && settled.has(item.status)) { excess--; discarded.push(item.id); }
  removeOutbox(discarded);
}

function touchOutbox(...items) {
  for (const item of items) {
    if (!outbox.includes(item)) continue;
    outboxDeletes.delete(item.id);
    outboxWrites.set(item.id, {item, revision:++outboxRevision});
  }
}

function removeOutbox(ids) {
  if (!ids.length) return;
  const removed = new Set(ids);
  outbox = outbox.filter(item => !removed.has(item.id));
  for (const id of removed) {
    outboxWrites.delete(id);
    outboxDeletes.set(id, ++outboxRevision);
  }
}

async function persistOutboxChanges() {
  const writes = [...outboxWrites], deletes = [...outboxDeletes];
  await writeOutboxChanges(writes.map(([, value]) => structuredClone(value.item)), deletes.map(([id]) => id));
  // Changes arriving during IndexedDB work belong to the next write, even for the same ID.
  for (const [id, value] of writes) if (outboxWrites.get(id)?.revision === value.revision) outboxWrites.delete(id);
  for (const [id, revision] of deletes) if (outboxDeletes.get(id) === revision) outboxDeletes.delete(id);
}
function aggregateState() { return aggregateTaskState(taskStates()); }
function syncPower() {
  if(instances.states().some(task=>["running","starting"].includes(task.status) && task.runSettings?.keepSystemAwake)){chrome.power.requestKeepAwake("system");return;}
  if (huxuan.active() && huxuan.state().runSettings?.keepSystemAwake || kuaishou.active() && kuaishou.state().runSettings?.keepSystemAwake || bilibiliTasks().some((task) => task.active() && task.state().runSettings?.keepSystemAwake) || isActiveRunStatus() && settings.keepSystemAwake || feigua.active() && feigua.state().runSettings?.keepSystemAwake || xingtu.active() && xingtu.state().runSettings?.keepSystemAwake) chrome.power.requestKeepAwake('system');
  else chrome.power.releaseKeepAwake();
}
function douyinTaskSnapshot() {
  // Page selection must work before the first run has persisted a route.
  return state.route ? state : {...state,route:{platform:'douyin',surface:'recommend',label:'抖音推荐'}};
}
async function selectedTask(tabId,platform) {
  if(instances.get(platform))return instances.get(platform).runtime.state();
  if(!platform || platform==='auto'){const entry=instances.forTab(tabId);if(entry)return entry.runtime.state();}
  if(platform==='kuaishou') return kuaishou.state();
  if(platform==='bilibili' || platform==='bilibili-popular') return bilibiliBySelection(platform).state();
  if(platform==='feigua') return feigua.state();
  if(platform==='xingtu') return xingtu.state();
  if(platform==='huxuan') return huxuan.state();
  if(platform==='douyin' || !Number.isInteger(tabId)) return douyinTaskSnapshot();
  const tab=Number.isInteger(tabId)?await chrome.tabs.get(tabId).catch(()=>null):null;
  const route=resolveRoute(tab?.pendingUrl || tab?.url || '');
  if(route?.platform==='feigua') return feigua.state();
  if(route?.platform==='xingtu') return xingtu.state();
  if(route?.platform==='huxuan') return huxuan.state();
  if(route?.platform==='kuaishou') return kuaishou.state();
  if(route?.platform==='bilibili') return (route.surface === 'popular' ? bilibiliPopular : bilibili).state();
  if(route?.platform==='douyin')return douyinTaskSnapshot();
  return stateSnapshotForTab(tabId);
}

function isInvalidStoredCreatorName(value) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().replace(/^@/, "");
  return /^\d{4}年\d{1,2}月精选作者$/.test(text)
    || /^(?:前往|打开|进入|查看|访问).{0,12}(?:作者|达人)主页$/.test(text)
    || /^(?:作者|达人)主页$/.test(text);
}

function cloneInitialState() {
  return JSON.parse(JSON.stringify(INITIAL_STATE));
}

function isActiveRunStatus(value = state.status) {
  return value === "starting" || value === "running";
}

function isRecommendationFeedUrl(value) {
  const route = resolveRoute(String(value || ""));
  return route?.platform === "douyin" && route.runnable;
}

async function initialize() {
  if (initialized) return initialized;
  initialized = (async () => {
    const saved = splitLegacyBilibiliStorage(await chrome.storage.local.get([...Object.values(STORAGE_KEYS),TASK_INSTANCES_KEY,TASK_PROGRESS_KEY,CREATOR_UPLOAD_BACKFILL_KEY,"draFeiguaBrowsing","draXingtuBrowsing","draXingtuConfig","draHuxuanConfig","draHuxuanState","draHuxuanCollection","draKuaishou","draKuaishouConfig","draBilibili","draBilibiliState","draBilibiliConfig","draBilibiliPopular","draBilibiliPopularState","draBilibiliPopularConfig"]));
    browseState={...browseState,...saved.draFeiguaBrowsing};
    xingtuBrowseState={...xingtuBrowseState,...saved.draXingtuBrowsing};
    const savedRules = saved[STORAGE_KEYS.rules] || {};
    const savedRulesVersion = Number(savedRules.version || 0);
    settings = mergeSettings(saved[STORAGE_KEYS.settings] || DEFAULT_SETTINGS);
    settings.feiguaSchedule = scheduleFrom(settings.feiguaSchedule, settings.feiguaScheduleOptIn === true);
    settingsDraft = saved[STORAGE_KEYS.settingsDraft] || null;
    rules = mergeRules(savedRules);
    const previousKuaishou = saved.draKuaishouConfig;
    const kuaishouSettings = recommendationSettingsFrom(previousKuaishou, saved.draKuaishou?.state?.runSettings, settings);
    kuaishouSettings.schedule = scheduleFrom(kuaishouSettings.schedule, previousKuaishou?.scheduleOptIn === true);
    kuaishouConfig = {
      settings:kuaishouSettings,
      rules:mergeRules(previousKuaishou?.rules || saved.draKuaishou?.state?.runRules || rules),
      settingsDraft:previousKuaishou?.settingsDraft || null,
      scheduleOptIn:previousKuaishou?.scheduleOptIn === true
    };
    await chrome.storage.local.set({draKuaishouConfig:kuaishouConfig});
    const previousBilibili = saved.draBilibiliConfig;
    bilibiliConfig = {
      settings:bilibiliSettingsFrom(previousBilibili, saved.draBilibiliState?.runSettings, settings),
      rules:mergeBilibiliRules(previousBilibili?.rules || saved.draBilibiliState?.runRules || {}),
      settingsDraft:previousBilibili?.settingsDraft || null,
      scheduleOptIn:previousBilibili?.scheduleOptIn === true
    };
    const previousPopular = saved.draBilibiliPopularConfig;
    bilibiliPopularConfig = {
      settings:bilibiliSettingsFrom(previousPopular, saved.draBilibiliPopularState?.runSettings, bilibiliConfig.settings),
      rules:mergeBilibiliRules(previousPopular?.rules || saved.draBilibiliPopularState?.runRules || bilibiliConfig.rules),
      settingsDraft:previousPopular?.settingsDraft || null,
      scheduleOptIn:previousPopular?.scheduleOptIn === true
    };
    await chrome.storage.local.set({draBilibiliConfig:bilibiliConfig,draBilibiliPopularConfig:bilibiliPopularConfig});
    if (!saved.draBilibili && saved.draBilibiliPopular) await chrome.storage.local.remove("draBilibili");
    const previousXingtu = saved.draXingtuConfig;
    xingtuConfig = {
      settings:mergeXingtuSettings(previousXingtu?.settings || {
        xingtuTarget:settings.xingtuTarget,
        xingtuDelay:settings.xingtuDelay,
        keepSystemAwake:settings.keepSystemAwake
      }, { scheduleOptIn: previousXingtu?.scheduleOptIn === true }),
      rules:mergeXingtuRules(previousXingtu?.rules || {xingtuKeywords:rules.xingtuKeywords}),
      settingsDraft:previousXingtu?.settingsDraft || null,
      scheduleOptIn:previousXingtu?.scheduleOptIn === true
    };
    await chrome.storage.local.set({draXingtuConfig:xingtuConfig});
    dailyStats = saved[STORAGE_KEYS.dailyStats] || null;
    const savedState = saved[STORAGE_KEYS.state] || {};
    state = {
      ...cloneInitialState(),
      ...savedState,
      engagement: restoreEngagement(savedState.engagement),
      stats: { ...INITIAL_STATE.stats, ...(savedState.stats || {}) }
    };
    await migrateDecisionHistory(saved);
    delete state.recentDecisions;
    await chrome.storage.local.remove(STORAGE_KEYS.decisionHistory);
    await chrome.alarms.create("dra-history-cleanup", {periodInMinutes:5});
    if (state.status === "starting") {
      state.status = "paused";
      state.startupStage = "";
      state.pauseReason = "上次启动过程被 Chrome 中断，请重新开始本轮";
    }
    if (["paused", "stopped"].includes(state.status) && !state.endedAt) {
      state.endedAt = state.lastTickAt || new Date().toISOString();
    }
    delete state.workerTabId;
    seenVideos = Array.isArray(saved[STORAGE_KEYS.seenVideos]) ? saved[STORAGE_KEYS.seenVideos] : [];
    // 规则升级后允许旧版本已过滤的视频重新进入判断。
    if (savedRulesVersion < DEFAULT_RULES.version) seenVideos = [];
    creatorIndex = saved[STORAGE_KEYS.creatorIndex] && typeof saved[STORAGE_KEYS.creatorIndex] === "object"
      ? saved[STORAGE_KEYS.creatorIndex]
      : {};
    if (savedState.route?.platform === "feigua" || savedState.route?.platform === "xingtu") state = cloneInitialState();
    douyin.restore({state,seenVideos,creatorIndex});
    feigua.restore(saved);
    huxuanConfig={...huxuanConfig,...saved.draHuxuanConfig};
    huxuan.restore(saved);
    xingtu.restore(saved);
    kuaishou.restore(saved);
    bilibili.restore(saved);
    bilibiliPopular.restore(saved);
    const legacyOutbox = saved[STORAGE_KEYS.outbox] ?? [];
    if (!Array.isArray(legacyOutbox)) throw Error('旧上传队列格式异常，原始记录已保留');
    await markObservationsUploaded(legacyOutbox.filter(item => ['written','duplicate'].includes(item?.status)).map(item => item.id));
    outbox = await loadOutbox(legacyOutbox);
    await chrome.alarms.create("dra-observations-cleanup", {periodInMinutes:60});
    await cleanupStoredObservations();
    await chrome.alarms.create("dra-rule-sync",{periodInMinutes:1});
    cloudAuth = saved[STORAGE_KEYS.cloudAuth] && typeof saved[STORAGE_KEYS.cloudAuth] === "object"
      ? saved[STORAGE_KEYS.cloudAuth]
      : null;
    pairing = saved[STORAGE_KEYS.pairing] && typeof saved[STORAGE_KEYS.pairing] === "object"
      ? saved[STORAGE_KEYS.pairing]
      : null;
    const invalidQueuedKeys = new Set(outbox
      .filter((item) => ["dry-run", "bridge-disabled", "cloud-disabled", "write-error"].includes(item?.status) && isInvalidStoredCreatorName(item?.payload?.accountName || item?.payload?.author))
      .map((item) => item?.payload?.creatorKey)
      .filter(Boolean));
    removeOutbox(outbox.filter((item) => ["dry-run", "bridge-disabled", "cloud-disabled", "write-error"].includes(item?.status) && isInvalidStoredCreatorName(item?.payload?.accountName || item?.payload?.author)).map(item => item.id));
    for (const key of invalidQueuedKeys) {
      if (creatorIndex[key]?.status === "outbox") delete creatorIndex[key];
    }
    instances.restore(saved[TASK_INSTANCES_KEY],saved[TASK_PROGRESS_KEY]);
    await persistOutboxChanges();
    await chrome.storage.local.set({
      [STORAGE_KEYS.settings]: settings,
      [STORAGE_KEYS.rules]: rules,
      [STORAGE_KEYS.state]: state,
      [STORAGE_KEYS.seenVideos]: seenVideos,
      [STORAGE_KEYS.creatorIndex]: creatorIndex,
      [STORAGE_KEYS.profileQueue]: [],
      ...feigua.storage(),
      ...xingtu.storage(),
    ...huxuan.storage(),
    draHuxuanConfig:huxuanConfig,
      ...bilibili.storage(),
      ...bilibiliPopular.storage()
    });
    await feigua.timers();
    await xingtu.timers();
    await huxuan.timers();
    for(const entry of instances.values()){await entry.runtime.timers();await syncInstanceSchedule(entry);}
    await kuaishou.timers();
    await bilibili.timers();
    await bilibiliPopular.timers();
    await updateTaskIndicators();
    await syncScheduleAlarm();
    await syncRunStopAlarm();
    // Large retained creator histories must not block the side panel's first status response.
    await chrome.alarms.create(UPLOAD_ALARM, {when:Date.now()+30_000});
    if(saved[CREATOR_UPLOAD_BACKFILL_KEY]!==true)await chrome.alarms.create(CREATOR_UPLOAD_BACKFILL_ALARM,{when:Date.now()+30_000});
    if (state.status === "running") await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
  })();
  return initialized;
}

let rawQueue = Promise.resolve();
function requireExtensionPage(sender) {
  if (!sender.url?.startsWith(chrome.runtime.getURL(""))) throw Error("此操作仅可从插件设置发起");
}
async function saveRawSample(sample, label = "unconfirmed", manual = false) {
  const saved = await chrome.storage.local.get(STORAGE_KEYS.debugSettings);
  if (!saved[STORAGE_KEYS.debugSettings]?.rawCapture) throw Error("请先开启原始数据采样");
  if (!sample || typeof sample.dom !== "string") throw Error("无效的卡片采样");
  const value = {...sanitizeRaw(sample), dom:sample.dom.slice(0,250000), label,
    runId:manual ? "" : state.runId || "", captureMode:manual ? "manual" : "automatic", version:pluginVersion()};
  const result = rawQueue.then(() => rawSamples("add", value));
  rawQueue = result.catch(() => undefined);
  try { const summary = await result; await chrome.storage.local.set({draRawSampleError:""}); return summary; }
  catch (error) { await chrome.storage.local.set({draRawSampleError:error.message || "本地采样保存失败"}); throw error; }
}

async function updateTaskIndicators() {
  syncPower();
  const badge = toolbarState(aggregateState());
  await Promise.all([
    chrome.action.setBadgeText({ text: badge.text }),
    chrome.action.setBadgeBackgroundColor({ color: badge.color }),
    chrome.action.setTitle({ title: badge.title })
  ]);
}

async function notifyLauncherWindow(windowId) {
  const tabs = await chrome.tabs.query({ windowId, url: ["http://*/*", "https://*/*"] });
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, {
    type: "DRA_LAUNCHER_CHANGED", launcher: launcherState(aggregateState())
  }).catch(() => undefined);
}

chrome.runtime.onConnect.addListener(port => {
  if (!port.name.startsWith("dra-panel:") || port.sender?.url !== chrome.runtime.getURL(SIDE_PANEL_PATH)) return;
  const windowId = Number(port.name.slice("dra-panel:".length));
  if (!Number.isInteger(windowId)) return;
  const ports = panelPorts.get(windowId) || new Set();
  ports.add(port); panelPorts.set(windowId, ports);
  initialize().then(() => notifyLauncherWindow(windowId)).catch(() => undefined);
  port.onDisconnect.addListener(() => {
    ports.delete(port); if (!ports.size) panelPorts.delete(windowId);
    notifyLauncherWindow(windowId).catch(() => undefined);
  });
});

async function flushDecisionHistory() {
  const task = historyWrites.then(async () => {
    if (!pendingDecisions.length) return;
    const batch = pendingDecisions.slice();
    await writeDecisions(batch);
    pendingDecisions.splice(0,batch.length);
    chrome.runtime.sendMessage({type:"DRA_HISTORY_CHANGED"}).catch(() => undefined);
  });
  historyWrites=task.catch(() => undefined);
  return task;
}

async function persistState(notificationTabId = state.feedTabId) {
  const task = workDataWrites.then(async () => {
  await flushDecisionHistory();
  await chrome.storage.local.set({
    [STORAGE_KEYS.state]: state,
    [STORAGE_KEYS.dailyStats]: dailyStats
  });
  void updateTaskIndicators().catch(() => undefined);
  chrome.runtime.sendMessage({ type: "DRA_STATUS_CHANGED", tabId: notificationTabId, state }).catch(() => undefined);
  });
  workDataWrites = task.catch(()=>undefined);
  return task;
}

async function persistTaskProgress(storage) {
  const task = workDataWrites.then(async () => {
    await chrome.storage.local.set(storage);
    chrome.runtime.sendMessage({type:'DRA_STATUS_CHANGED'}).catch(() => undefined);
  });
  workDataWrites = task.catch(() => undefined);
  return task;
}

async function persistWorkData() {
  const task = workDataWrites.then(async () => {
  await flushDecisionHistory();
  await persistOutboxChanges();
  await chrome.storage.local.set({
    [STORAGE_KEYS.state]: state,
    [STORAGE_KEYS.dailyStats]: dailyStats,
    [STORAGE_KEYS.seenVideos]: seenVideos,
    [STORAGE_KEYS.creatorIndex]: creatorIndex,
    [STORAGE_KEYS.profileQueue]: [],
    ...feigua.storage(),
    ...xingtu.storage(),
    ...huxuan.storage(),
    draHuxuanConfig:huxuanConfig,
    ...kuaishou.storage(),
    ...bilibili.storage(),
    ...bilibiliPopular.storage(),
    [STORAGE_KEYS.cloudAuth]: cloudAuth,
    [STORAGE_KEYS.pairing]: pairing,
    ...instances.storage()
  });
  chrome.runtime.sendMessage({type:"DRA_STATUS_CHANGED"}).catch(()=>undefined);
  });
  workDataWrites = task.catch(()=>undefined);
  return task;
}

async function persistCloudAuth() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.cloudAuth]: cloudAuth,
    [STORAGE_KEYS.pairing]: pairing
  });
}

function recordDecision(decision = {}, observation = {}, profile = null, owner = state) {
  const num = (value) => {
    if (value == null || typeof value === 'string' && !value.trim()) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const sourcePlatform = normalizeSourcePlatform(owner.route?.platform || observation.sourcePlatform || observation.platform || "douyin");
  const entry = {
    id: crypto.randomUUID(),
    taskId:owner.taskId || taskConfigPlatform(owner), taskName:owner.taskName || '默认任务',
    runId: owner.runId || "",
    runStartedAt: owner.startedAt || "",
    sourcePlatform,
    code: String(decision.code || "UNKNOWN"),
    reasons: Array.isArray(decision.reasons) ? decision.reasons.filter(Boolean) : [],
    ruleMatch: captureRuleMatch(decision, owner, sourcePlatform),
    accountName: profile?.authorName || observation.authorName || decision.accountName || "",
    ...decisionIpFields(profile),
    tname: String(observation.tname || "").slice(0, 80),
    avatarUrl: profile?.avatarUrl || observation.avatarUrl || decision.avatarUrl || "",
    profileUrl: profile?.profileUrl || observation.profileUrl || decision.profileUrl || "",
    authorId: String(observation.authorId || (sourcePlatform === 'xingtu' ? observation.xingtuId || observation.raw?.xingtuId : '') || profile?.bilibiliMid || profile?.secUid || ""),
    videoId: String(observation.videoId || ""),
    caption: String(observation.caption || observation.title || ""),
    coverUrl: String(observation.coverUrl || ""),
    beforeUrl: String(observation.beforeUrl || ""),
    durationSeconds: num(observation.durationSeconds),
    plays: num(observation.plays),
    likes: num(observation.likes),
    favorites: num(observation.favorites),
    comments: num(observation.comments),
    danmaku: num(observation.danmaku),
    shares: num(observation.shares),
    occurredAt: new Date().toISOString()
  };
  owner.lastDecision = entry;
  pendingDecisions.push(entry);
  return entry;
}

async function withXingtuCreatorDetails(items) {
  const creators=await xingtuObservedCreators(items);
  return items.map(item=>creators[item.id]?{...item,xingtuCreator:creators[item.id]}:item);
}

function addOutbox(status, payload, error = "", { transitionPending = false, owner = state, captureRules = false } = {}) {
  reserveQueue(1);
  if(payload?.rpa_feedback){payload.rpa_feedback.task_id=owner.taskId || taskConfigPlatform(owner);payload.rpa_feedback.task_name=owner.taskName || '默认任务';payload.rpa_feedback.rule_match ||=captureRuleMatch({},owner,owner.route?.platform);}
  const configPlatform=taskConfigPlatform(owner);
  if (captureRules && payload?.rpa_feedback) {
    payload.rpa_feedback.rule_context={platform:instances.get(configPlatform)?.platform || configPlatform, rules:structuredClone(owner.runRules || configurationFor(configPlatform).rules), capturedAt:new Date().toISOString()};
    payload.rpa_feedback.rule_match ||= captureRuleMatch({code:payload.rpa_feedback.finder_decision},owner,payload.rpa_feedback.source_platform);
  }
  const item = {
    id: payload?.record_id || crypto.randomUUID(),
    status,
    payload,
    error,
    transitionPending,
    sessionId: owner.runId || payload?.run_id || "",
    startedAt: owner.startedAt || payload?.observed_at || new Date().toISOString(),
    queuedAt: new Date().toISOString(),
    attempts: 0
  };
  outbox.push(item);
  touchOutbox(item);
  return item;
}

function pluginVersion() {
  return chrome.runtime.getManifest().version;
}

function cloudStatusSnapshot() {
  return {
    ruleSync: ruleSync.status(),
    connected: Boolean(cloudAuth?.device_token) && !cloudAuth?.expired,
    expired: Boolean(cloudAuth?.expired),
    userId: cloudAuth?.user_id || "",
    account: accountProfile(cloudAuth?.account, cloudAuth?.user_id),
    pairedAt: cloudAuth?.pairedAt || "",
    destination: CLOUD_DESTINATION,
    pairing: pairing
      ? {
          status: pairing.status || "pending",
          code: pairing.code || "",
          pairUrl: pairing.pairUrl || "",
          expiresAt: pairing.expiresAt || ""
        }
      : null
  };
}

async function ensureHostFingerprint() {
  if (cloudAuth?.host_fingerprint) return cloudAuth.host_fingerprint;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const fingerprint = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
  cloudAuth = { ...(cloudAuth || {}), host_fingerprint: fingerprint };
  await persistCloudAuth();
  return fingerprint;
}

function cloudReady() {
  // Upload eligibility belongs to each queued item, independent of the next task's test-mode setting.
  return Boolean(cloudAuth?.device_token && !cloudAuth?.expired);
}

function isCompanySsoRequired(result) {
  return result?.payload?.error === COMPANY_SSO_REQUIRED_ERROR;
}

async function reportCompanySsoRequired(owner = null) {
  state.lastError = COMPANY_SSO_REQUIRED_MESSAGE;
  if (owner && owner !== state) owner.lastError = COMPANY_SSO_REQUIRED_MESSAGE;
  await persistWorkData();
  return { status: COMPANY_SSO_REQUIRED_ERROR };
}

function waitForTabComplete(tabId, timeoutMs = 45_000) {
  return new Promise(async (resolve, reject) => {
    const current = await chrome.tabs.get(tabId).catch(() => null);
    if (!current) return reject(new Error("当前推荐流标签页已关闭"));
    if (current.status === "complete") return resolve(current);
    const timeout = setTimeout(() => finish(new Error("当前推荐流页面加载超时")), timeoutMs);
    function finish(error, tab) {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (error) reject(error);
      else resolve(tab);
    }
    function onUpdated(updatedId, changeInfo, tab) {
      if (updatedId === tabId && changeInfo.status === "complete") finish(null, tab);
    }
    function onRemoved(removedId) {
      if (removedId === tabId) finish(new Error("当前推荐流标签页已关闭"));
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

async function sendTabMessage(tabId, message, attempts = 8) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await withTimeout(chrome.tabs.sendMessage(tabId, message), 5_000);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError || new Error("无法连接当前平台页面脚本");
}

async function ensureContentRuntime(tab) {
  const existing = await sendTabMessage(tab.id, { type: "DRA_LOOP_STATUS" }, 1).catch(() => null);
  if (existing?.ok) return tab;
  await chrome.tabs.reload(tab.id);
  const reloaded = await waitForTabComplete(tab.id);
  const status = await sendTabMessage(tab.id, { type: "DRA_LOOP_STATUS" }, 12).catch(() => null);
  if (!status?.ok) throw new Error("当前平台页面脚本未加载，请刷新页面后重试");
  return reloaded;
}

const launcherInjections = new Map();
function ensureTabLauncher(tabId) {
  if (!Number.isInteger(tabId)) return Promise.resolve();
  if (launcherInjections.has(tabId)) return launcherInjections.get(tabId);
  const pending = (async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!/^https?:\/\//.test(tab?.pendingUrl || tab?.url || "")) return;
    const reply = await withTimeout(chrome.tabs.sendMessage(tabId, { type: "DRA_LAUNCHER_PING" }), 1500).catch(() => null);
    if (reply?.launcherVersion === pluginVersion()) return;
    // Only install the small launcher; never start a collector or reload the page.
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content/floating-launcher.js"] });
  })().catch(() => undefined).finally(() => launcherInjections.delete(tabId));
  // Chrome protected pages and withheld site permissions reject injection.
  launcherInjections.set(tabId, pending);
  return pending;
}
async function restoreOpenTabLaunchers() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(tabs.map(tab => ensureTabLauncher(tab.id)));
}

async function configureOpenTabSidePanels() {
  await chrome.sidePanel.setOptions({ path: SIDE_PANEL_PATH, enabled: true });
  // Upgrade tabs carrying the previous per-tab disabled override.
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async tab => {
    const previous = await chrome.sidePanel.getOptions({ tabId: tab.id });
    if (Number.isInteger(previous.tabId)) {
      await chrome.sidePanel.setOptions({ tabId: tab.id, path: SIDE_PANEL_PATH, enabled: true });
    }
  }));
}

async function syncScheduleAlarm(fromMs = Date.now()) {
  for (const item of SCHEDULED_PLATFORMS) {
    await chrome.alarms.clear(item.alarm);
    const schedule = platformSchedule(item.platform);
    if (schedule?.enabled === false || validateSchedule(schedule).length) continue;
    const occurrence = nextScheduledOccurrence(schedule, fromMs);
    if (!occurrence) continue;
    await chrome.alarms.create(item.alarm, { when: occurrence.scheduledTime });
  }
}

async function getScheduleStatus(platform = "douyin") {
  if(instances.get(platform)){const entry=instances.get(platform),schedule=(entry.platform==='feigua'?entry.config.settings.feiguaSchedule:entry.config.settings.schedule)||{enabled:false};const alarm=await chrome.alarms.get('dra-instance-schedule:'+entry.id);return {...schedule,nextRunAt:alarm?.scheduledTime?new Date(alarm.scheduledTime).toISOString():null,lastRunAt:entry.runtime.state().lastScheduleAt,lastResult:entry.runtime.state().lastScheduleResult || ''};}
  const entry = SCHEDULED_PLATFORMS.find((item) => item.platform === platform) || SCHEDULED_PLATFORMS[0];
  const schedule = platformSchedule(entry.platform) || {};
  const task = scheduleRuntime(entry.platform);
  const taskState = task ? task.state() : state;
  const alarm = await chrome.alarms.get(entry.alarm).catch(() => null);
  const fallback = alarm ? null : nextScheduledOccurrence(schedule, Date.now());
  return {
    enabled: schedule.enabled !== false,
    weekdays: schedule.weekdays || [],
    times: schedule.times || [],
    target: normalizeRunTarget(schedule.target),
    reuseExistingTab: schedule.reuseExistingTab !== false,
    nextRunAt: alarm?.scheduledTime
      ? new Date(alarm.scheduledTime).toISOString()
      : fallback?.scheduledTime
        ? new Date(fallback.scheduledTime).toISOString()
        : null,
    lastRunAt: taskState.lastScheduleAt,
    lastResult: taskState.lastScheduleResult || ""
  };
}

function uploadableOutbox() {
  return outbox.filter((item) => {
    if (item.transitionPending || Number(item.retryAt || 0)>Date.now()) return false;
    if (!["pending", "write-error", "failed"].includes(item.status)) return false;
    const record = item.payload;
    return record && typeof record === "object" && typeof record.record_id === "string" && Number.isInteger(record.feed_index);
  });
}

function requestUpload() {
  const task=uploadScheduling.then(async()=>{
    if(!cloudReady())return;
    const when=Date.now()+(uploadableOutbox().length >= 10 ? 100 : 30_000);
    const existing=await chrome.alarms.get(UPLOAD_ALARM);
    if(!existing || existing.scheduledTime>when)await chrome.alarms.create(UPLOAD_ALARM,{when});
  }).catch(error=>{
    state.lastError=`研究台上传调度失败：${error?.message || String(error)}`;
    void persistState().catch(()=>undefined);
  });
  uploadScheduling=task;
  return task;
}

function scheduleUpload(force = false, retry = false) {
  const task=uploadScheduling.then(()=>planUpload(force,retry));
  uploadScheduling=task.catch(()=>undefined);
  return task;
}

async function planUpload(force = false, retry = false) {
  await stageFeiguaObservations();
  await stageXingtuObservations();
  const pending = uploadableOutbox();
  if (!pending.length || !cloudReady()) {
    const retries=outbox.filter(item=>['pending','write-error','failed'].includes(item.status) && item.retryAt>Date.now());
    if(cloudReady() && retries.length)await chrome.alarms.create(UPLOAD_ALARM,{when:Math.min(...retries.map(item=>item.retryAt))});
    else await chrome.alarms.clear(UPLOAD_ALARM);
    return;
  }
  const oldest = Math.min(...pending.map(item => Date.parse(item.queuedAt) || Date.now()));
  const when = retry || flushInFlight ? Date.now() + 30_000
    : force || pending.length >= 10 ? Date.now() + 100 : Math.max(Date.now() + 100, oldest + 60_000);
  const existing = await chrome.alarms.get(UPLOAD_ALARM);
  if (!existing || existing.scheduledTime > when) await chrome.alarms.create(UPLOAD_ALARM, { when });
}

function handleUploadAlarm() {
  if (uploadDrainInFlight) return uploadDrainInFlight;
  uploadDrainInFlight = (async () => {
    await initialize();
    const started = Date.now();
    let successful = false;
    try {
      for (let batch = 0; batch < MAX_UPLOAD_BATCHES && Date.now()-started < MAX_UPLOAD_WORK_MS; batch++) {
        const result = await flushOutbox({force:true});
        successful = result.status === 'ok';
        if (!successful || !(result.accepted || result.duplicated || result.rejected)) break;
      }
    } catch (error) {
      successful = false;
      state.lastError = `研究台同步失败：${error?.message || String(error)}`;
      await persistState();
    } finally {
      await scheduleUpload(successful, !successful);
    }
  })().finally(() => { uploadDrainInFlight = null; });
  return uploadDrainInFlight;
}

async function runCreatorUploadBackfill() {
  await initialize();
  const saved=await chrome.storage.local.get(CREATOR_UPLOAD_BACKFILL_KEY);
  if(saved[CREATOR_UPLOAD_BACKFILL_KEY]===true)return;
  await enableCreatorObservationUpload();
  await chrome.storage.local.set({[CREATOR_UPLOAD_BACKFILL_KEY]:true});
  await requestUpload();
}

function flushOutbox(options = {}) {
  if (flushInFlight) return flushInFlight;
  flushInFlight = flushOutboxBatch(options).finally(() => { flushInFlight = null; });
  return flushInFlight;
}

async function flushOutboxBatch({ force = false, limit = MAX_INGEST_RECORDS } = {}) {
  await stageFeiguaObservations();
  await stageXingtuObservations();
  if (!cloudReady()) return { status: "idle" };
  const pending = uploadableOutbox();
  if (!pending.length) return { status: "idle" };
  const oldest = Math.min(...pending.map((item) => Date.parse(item.queuedAt) || Date.now()));
  if (!force && pending.length < 10 && Date.now() - oldest < 60_000) return { status: "deferred" };

  pending.sort((a,b)=>(Date.parse(a.payload.observed_at) || Date.parse(a.queuedAt) || 0)-(Date.parse(b.payload.observed_at) || Date.parse(b.queuedAt) || 0));
  const first = pending[0];
  const sessionId = first.sessionId || state.runId;

  const owner = taskForSession(sessionId);
  const startedAt = first.startedAt || owner?.startedAt || new Date().toISOString();
  let end=pending.findIndex(item=>(item.sessionId || state.runId)!==sessionId);
  let rows = pending.slice(0,end<0?limit:Math.min(end,limit));
  const encode = (list) => encodeIngestBody(buildIngestBody({
    sessionId,
    pluginVersion: pluginVersion(),
    hostFingerprint: cloudAuth.host_fingerprint || "",
    startedAt,
    stats: owner?.stats || {},
    heartbeat: { pending: uploadableOutbox().length },
    records: list.map((item) => item.payload)
  }));
  rows = shrinkRecordsToByteLimit(rows, encode);
  const xingtuIds=[...new Set(rows.filter(item=>String(item.payload?.rpa_feedback?.source || '').startsWith('xingtu-') && !item.payload.sec_uid && /^\d{1,30}$/.test(String(item.payload.xingtu_id || ''))).map(item=>item.payload.xingtu_id))];
  if(xingtuIds.length){
    const uploadingAuth=cloudAuth;
    let lookup;
    try {lookup=await cloudClient.lookupXingtuSecUids(uploadingAuth.device_token,xingtuIds);}
    catch(error){lookup={ok:false,status:503,payload:{error:error?.message || String(error)}};}
    if(cloudAuth!==uploadingAuth)return {status:'auth_error',reason:'connection_changed'};
    if(!lookup.ok || !Array.isArray(lookup.payload?.matches)){
      if (isCompanySsoRequired(lookup)) return reportCompanySsoRequired(owner);
      if(lookup.status===401){
        cloudAuth.expired=true;
        await persistCloudAuth();
        state.lastError='研究台授权已失效，请重新连接';
        await persistState();
        return {status:'auth_error'};
      }
      const message=`研究台星图身份查询失败：${lookup.payload?.error || lookup.status}`;
      for(const item of rows){item.status='write-error';item.retryAt=Date.now()+30_000;item.error=message;item.lastTriedAt=new Date().toISOString();}
      touchOutbox(...rows);
      if(owner)owner.lastError=message;
      await persistWorkData();
      return {status:'identity_lookup_error'};
    }
    const wanted=new Set(xingtuIds),matches=new Map();
    for(const match of lookup.payload.matches){
      if(!match || !wanted.has(match.xingtu_id) || typeof match.sec_uid!=='string' || !match.sec_uid.trim() || match.sec_uid.length>256 || match.sec_uid.toLowerCase()==='self')continue;
      matches.set(match.xingtu_id,match.sec_uid);
    }
    for(const item of rows){
      const id=item.payload?.xingtu_id;
      if(!wanted.has(id) || item.payload.sec_uid)continue;
      const secUid=matches.get(id);
      item.payload.rpa_feedback={...item.payload.rpa_feedback,sec_uid_lookup:secUid?'matched':'not_found'};
      if(secUid){item.payload.sec_uid=secUid;item.payload.rpa_feedback.sec_uid_source='creator_database_xingtu_id';}
    }
    touchOutbox(...rows);
    await persistWorkData();
  }
  rows = shrinkRecordsToByteLimit(rows, encode);
  const body = encode(rows);
  if (body.length > MAX_INGEST_BYTES) {
    for (const item of rows) {
      item.status = "dead";
      item.error = "单条观察超过上传体积上限";
    }
    incrementForSession(sessionId,"uploadRejected",rows.length);
    touchOutbox(...rows);
    await persistWorkData();
    return { status: "rejected" };
  }

  let result;
  const uploadingAuth = cloudAuth;
  try {
    result = await cloudClient.ingest(uploadingAuth.device_token, body);
  } catch (error) {
    const message = error?.message || String(error);
    for (const item of rows) {
      item.status = "write-error";
      item.retryAt=Date.now()+30_000;
      item.error = message;
      item.lastTriedAt = new Date().toISOString();
    }
    if (owner) owner.lastError = `研究台上传失败：${message}`;
    touchOutbox(...rows);
    await persistWorkData();
    await persistState();
    return { status: "network_error" };
  }

  if (isCompanySsoRequired(result)) return reportCompanySsoRequired(owner);

  const kind = classifyIngestStatus(result.status);
  if (kind === "auth_error") {
    if (cloudAuth !== uploadingAuth) return { status: "auth_error", reason: "connection_changed" };
    if (cloudAuth) cloudAuth.expired = true;
    await persistCloudAuth();
    state.lastError = "研究台授权已失效，请重新连接";
    await persistState();
    return { status: "auth_error", reason: result.payload?.error || "unauthorized" };
  }
  if (!result.ok) {
    const permanent = kind === "rejected";
    for (const item of rows) {
      item.attempts = Number(item.attempts || 0) + 1;
      item.lastTriedAt = new Date().toISOString();
      item.error = result.payload?.error || `HTTP ${result.status}`;
      item.status = permanent || item.attempts >= MAX_UPLOAD_ATTEMPTS ? "dead" : "write-error";
      item.retryAt=Date.now()+Math.min(1800000,30000*2**Math.min(item.attempts,6));
    }
    if (permanent) incrementForSession(sessionId,"uploadRejected",rows.length);
    touchOutbox(...rows);
    await persistWorkData();
    return { status: permanent ? "rejected" : "retry" };
  }

  const sets = ingestResultSets(result.payload);
  await markObservationsUploaded([...sets.accepted,...sets.duplicated]);
  for (const item of rows) {
    const id = String(item.payload.record_id);
    item.attempts = Number(item.attempts || 0) + 1;
    item.lastTriedAt = new Date().toISOString();
    if (sets.accepted.has(id) || sets.duplicated.has(id)) {
      item.status = sets.duplicated.has(id) ? "duplicate" : "written";
      item.flushedAt = new Date().toISOString();
      item.error = "";
      incrementForSession(item.sessionId,"uploaded");
    } else if (sets.rejected.has(id) || item.attempts >= MAX_UPLOAD_ATTEMPTS) {
      item.status = "dead";
      item.error = sets.rejected.get(id) || "retry_exhausted";
      incrementForSession(item.sessionId,"uploadRejected");
    } else {
      item.status = "write-error";
      item.error = "missing acknowledgement";
      item.retryAt=Date.now()+30_000;
    }
  }
  touchOutbox(...rows);
  removeOutbox(rows.filter(item => ['written','duplicate'].includes(item.status)).map(item => item.id));
  await persistWorkData();
  await persistState();
  return { status: "ok", accepted: sets.accepted.size, duplicated: sets.duplicated.size, rejected: sets.rejected.size };
}

async function checkCloudConnection() {
  if (!cloudAuth?.device_token) throw new Error("尚未连接研究台。请先点击「登录并连接研究台」完成授权。");
  const auth = cloudAuth;
  const result = await cloudClient.checkAuth(auth.device_token, pluginVersion());
  if (cloudAuth !== auth) throw new Error("研究台连接已变更，请重试");
  if (isCompanySsoRequired(result)) {
    state.lastError = COMPANY_SSO_REQUIRED_MESSAGE;
    await persistState();
    throw new Error(COMPANY_SSO_REQUIRED_MESSAGE);
  }
  if (result.status === 401) {
    cloudAuth.expired = true;
    await pauseLiveInstances("研究台授权已失效，请重新连接");
    await persistCloudAuth();
    if(kuaishou.active() && !kuaishou.state().runSettings?.dryRun)await kuaishou.pause("研究台授权已失效，请重新连接");
    await pauseLiveBilibili("研究台授权已失效，请重新连接");
    if (feigua.active() && !feigua.state().runSettings?.dryRun) await feigua.pause("研究台授权已失效，请重新登录并连接");
    if (xingtu.active() && !xingtu.state().runSettings?.dryRun) await xingtu.pause("研究台授权已失效，请重新登录并连接");
    if(huxuan.active())await huxuan.pause("研究台授权已失效，请重新连接");
    if (isActiveRunStatus() && !settings.dryRun) await setPaused("研究台授权已失效，请重新登录并连接");
    else await persistState();
    throw new Error("研究台授权已失效，请重新登录并连接。");
  }
  if (!result.ok) throw new Error(result.payload?.error || `研究台检测失败：${result.status}`);
  cloudAuth.expired = false;
  if (result.payload?.account) cloudAuth.account = accountProfile(result.payload.account, cloudAuth.user_id);
  await persistCloudAuth();
  void requestUpload();
  return { ok: true, userId: cloudAuth.user_id || "", destination: CLOUD_DESTINATION };
}

async function startPairing() {
  if (pairing?.status === "pending" && Date.parse(pairing.expiresAt) > Date.now()) {
    pairing = { ...pairing, pairUrl: pairUrlFor(pairing.code) };
    await persistCloudAuth();
    await chrome.tabs.create({ url: pairing.pairUrl, active: true });
    return cloudStatusSnapshot();
  }
  const result = await cloudClient.startPairing();
  if (!result.ok) throw new Error(result.payload?.error || "发起研究台配对失败");
  const code = String(result.payload.code || "");
  const deviceSecret = String(result.payload.device_secret || "");
  if (!code || !deviceSecret) throw new Error("研究台未返回配对码");
  pairing = {
    status: "pending",
    code,
    deviceSecret,
    pairUrl: pairUrlFor(code),
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + Number(result.payload.expires_in_seconds || 600) * 1000).toISOString()
  };
  await persistCloudAuth();
  await chrome.tabs.create({ url: pairing.pairUrl, active: true });
  return cloudStatusSnapshot();
}

async function pollPairing() {
  if (!pairing?.code || !pairing?.deviceSecret) return cloudStatusSnapshot();
  if (pairing.expiresAt && Date.parse(pairing.expiresAt) <= Date.now()) {
    pairing = { ...pairing, status: "expired" };
    await persistCloudAuth();
    throw new Error("配对码已过期，请重新连接研究台");
  }
  const fingerprint = await ensureHostFingerprint();
  const result = await cloudClient.pollPairing({
    code: pairing.code,
    deviceSecret: pairing.deviceSecret,
    hostFingerprint: fingerprint
  });
  if (result.status === 202 || result.payload?.status === "pending") {
    pairing = { ...pairing, status: "pending" };
    await persistCloudAuth();
    return cloudStatusSnapshot();
  }
  if (!result.ok) throw new Error(result.payload?.error || "配对确认失败");
  cloudAuth = {
    device_token: result.payload.device_token,
    user_id: result.payload.user_id || "",
    account: accountProfile(result.payload.account, result.payload.user_id),
    host_fingerprint: fingerprint,
    workbench_url: CLOUD_DESTINATION.workbenchUrl,
    pairedAt: new Date().toISOString()
  };
  pairing = null;
  await persistCloudAuth();
  void requestUpload();
  return cloudStatusSnapshot();
}

async function disconnectCloud() {
  await pauseLiveInstances("研究台已断开，请重新连接后继续");
  if(kuaishou.active() && !kuaishou.state().runSettings?.dryRun)await kuaishou.pause("研究台授权已失效，请重新连接");
  await pauseLiveBilibili("研究台授权已失效，请重新连接");
  if (feigua.active() && !feigua.state().runSettings?.dryRun) await feigua.pause("研究台已断开，请重新连接后继续");
  if (xingtu.active() && !xingtu.state().runSettings?.dryRun) await xingtu.pause("研究台已断开，请重新连接后继续");
  if(huxuan.active())await huxuan.pause("研究台已断开，请重新连接后继续");
  if (isActiveRunStatus() && !settings.dryRun) await setPaused("研究台已断开，请登录并连接后继续");
  cloudAuth = cloudAuth?.host_fingerprint ? { host_fingerprint: cloudAuth.host_fingerprint } : null;
  pairing = null;
  await persistCloudAuth();
  return cloudStatusSnapshot();
}

async function saveConfiguration(message) {
  const platform = message.platform || 'douyin';
  if(instances.get(platform))return saveInstanceConfiguration(instances.get(platform),message);
  if (!['douyin','kuaishou','bilibili','bilibili-popular','feigua','xingtu'].includes(platform)) throw new Error('请选择具体平台后修改设置');
  const configPlatform = platform;
  if (configPlatform === 'xingtu') {
    if (xingtu.active() && message.settings && JSON.stringify(mergeXingtuSettings({...xingtuConfig.settings,keepSystemAwake:message.settings.keepSystemAwake}, { scheduleOptIn: xingtuConfig.scheduleOptIn === true })) !== JSON.stringify(xingtuConfig.settings)) throw new Error('请先暂停当前平台任务再修改设置');
    const nextSettings = mergeXingtuSettings({
      ...xingtuConfig.settings,
      keepSystemAwake: message.settings ? message.settings.keepSystemAwake !== false : xingtuConfig.settings.keepSystemAwake
    }, { scheduleOptIn: xingtuConfig.scheduleOptIn === true });
    const nextRules = mergeXingtuRules(message.rules || xingtuConfig.rules);
    const next = {settings:nextSettings,rules:nextRules,settingsDraft:null,scheduleOptIn:xingtuConfig.scheduleOptIn === true};
    await chrome.storage.local.set({draXingtuConfig:next});
    xingtuConfig = next;
    return {ok:true,configPlatform,...next,problems:[]};
  }
  const current = configurationFor(configPlatform);
  const active = configPlatform === 'kuaishou' ? kuaishou.active() : configPlatform === 'bilibili' ? bilibili.active() : configPlatform === 'bilibili-popular' ? bilibiliPopular.active() : configPlatform === 'feigua' ? feigua.active() : isActiveRunStatus();
  const mergeRuleFn = configPlatform === 'bilibili' || configPlatform === 'bilibili-popular' ? mergeBilibiliRules : mergeRules;
  const validateRuleFn = configPlatform === 'bilibili' || configPlatform === 'bilibili-popular' ? validateBilibiliRules : validateRules;
  if (active && (message.settings && JSON.stringify(mergeSettings(message.settings)) !== JSON.stringify(current.settings) || message.rules && JSON.stringify(mergeRuleFn(message.rules)) !== JSON.stringify(current.rules))) throw new Error('请先暂停当前平台任务再修改设置');
  const nextSettings = mergeSettings(message.settings || current.settings);
  const nextRules = mergeRuleFn(message.rules || current.rules);
  // Recommendation forms do not own Feigua-only fields.
  if (configPlatform === 'douyin') {
    for (const key of Object.keys(current.settings).filter(key=>key.startsWith('feigua') || key.startsWith('xingtu'))) nextSettings[key]=current.settings[key];
    nextRules.feiguaKeywords=current.rules.feiguaKeywords;
    nextRules.feiguaPositiveKeywords=current.rules.feiguaPositiveKeywords;
    nextRules.xingtuKeywords=current.rules.xingtuKeywords;
  }
  const problems = [...validateSettings(nextSettings), ...validateRuleFn(nextRules), ...validateSchedule(nextSettings.schedule)];
  if (problems.length && !message.saveDraft) throw new Error(problems.join('；'));
  const next = problems.length ? {...current,settingsDraft:nextSettings} : {
    settings:nextSettings,rules:nextRules,settingsDraft:message.settings ? null : current.settingsDraft
  };
  if (configPlatform === 'kuaishou') {
    if (!problems.length) next.scheduleOptIn = true;
    await chrome.storage.local.set({draKuaishouConfig:next});
    kuaishouConfig = next;
    if (!problems.length) await syncScheduleAlarm();
  } else if (configPlatform === 'bilibili') {
    if (!problems.length) next.scheduleOptIn = true;
    await chrome.storage.local.set({draBilibiliConfig:next});
    bilibiliConfig = next;
    if (!problems.length) await syncScheduleAlarm();
  } else if (configPlatform === 'bilibili-popular') {
    if (!problems.length) next.scheduleOptIn = true;
    await chrome.storage.local.set({draBilibiliPopularConfig:next});
    bilibiliPopularConfig = next;
    if (!problems.length) await syncScheduleAlarm();
  } else {
    const scheduleChanged = JSON.stringify(settings.schedule) !== JSON.stringify(next.settings.schedule);
    await chrome.storage.local.set({[STORAGE_KEYS.settings]:next.settings,[STORAGE_KEYS.rules]:next.rules,[STORAGE_KEYS.settingsDraft]:next.settingsDraft});
    settings=next.settings; rules=next.rules; settingsDraft=next.settingsDraft;
    if (scheduleChanged) await syncScheduleAlarm();
  }
  return {ok:true,configPlatform:configPlatform,...next,problems};
}

async function handleScheduledAlarm(alarm) {
  await initialize();
  const entry = SCHEDULED_PLATFORMS.find((item) => item.alarm === alarm.name) || SCHEDULED_PLATFORMS[0];
  const task = scheduleRuntime(entry.platform);
  const scheduledTime = Number(alarm?.scheduledTime || Date.now());
  await syncScheduleAlarm(Math.max(Date.now(), scheduledTime + 1_000));
  const schedule = platformSchedule(entry.platform);
  const record = async (result) => {
    if (task) await task.noteSchedule(result);
    else {
      state.lastScheduleAt = new Date().toISOString();
      state.lastScheduleResult = result;
      state.lastError = result.startsWith("定时启动失败") ? result : state.lastError;
      await persistState();
    }
  };
  if (schedule?.enabled === false) return;

  const lateMinutes = Math.max(0, Date.now() - scheduledTime) / 60_000;
  const toleranceMinutes = Math.max(0, Number(schedule?.lateToleranceMinutes || 0));
  if (lateMinutes > toleranceMinutes) {
    await record(`错过计划时间 ${Math.round(lateMinutes)} 分钟，已跳过本次`);
    return;
  }
  if (task ? task.active() : isActiveRunStatus()) {
    await record("到点时已有刷号任务运行，未重复启动");
    return;
  }

  try {
    if (task) {
      const windowInfo = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
      if (entry.platform === "feigua" || entry.platform === "xingtu") {
        const tab = await task.openPage({ windowId: windowInfo?.id, focusTab: false });
        await task.start(tab.id);
        await task.noteSchedule("已按计划启动");
      } else {
        await task.start({
          trigger: "schedule",
          target: schedule.target,
          scheduledFor: new Date(scheduledTime).toISOString(),
          windowId: windowInfo?.id,
          focus: false,
          reuseExisting: schedule.reuseExistingTab !== false
        });
      }
    } else {
      await startRun({
        trigger: "schedule",
        scheduledFor: new Date(scheduledTime).toISOString()
      });
    }
  } catch (error) {
    await record(`定时启动失败：${error?.message || String(error)}`);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await initialize();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await configureOpenTabSidePanels();
  await restoreOpenTabLaunchers();
  const currentVersion = chrome.runtime.getManifest().version;
  if (details.reason === "update" && details.previousVersion && details.previousVersion !== currentVersion) {
    const url = new URL(chrome.runtime.getURL("updates/index.html"));
    url.searchParams.set("from", details.previousVersion);
    await chrome.tabs.create({ url: url.href, active: true });
  }
});

chrome.runtime.onStartup.addListener(() => {
  initialize().then(() => Promise.all([syncScheduleAlarm(), syncRunStopAlarm(), configureOpenTabSidePanels(), restoreOpenTabLaunchers()])).catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if(alarm.name.startsWith('dra-instance-')){void initialize().then(async()=>{const entry=instanceForAlarm(alarm.name);if(!entry)return;if(alarm.name.startsWith('dra-instance-schedule:')){await syncInstanceSchedule(entry,Math.max(Date.now(),alarm.scheduledTime+1000));const schedule=entry.platform==='feigua'?entry.config.settings.feiguaSchedule:entry.config.settings.schedule;if(!schedule?.enabled || entry.runtime.active() || Date.now()-alarm.scheduledTime>Number(schedule.lateToleranceMinutes || 0)*60000)return;const win=await chrome.windows.getLastFocused({windowTypes:['normal']});if(['feigua','xingtu','huxuan'].includes(entry.platform)){const tab=await entry.runtime.openPage({windowId:win.id,focusTab:false});await entry.runtime.start(tab.id);}else await entry.runtime.start({trigger:'schedule',windowId:win.id,focus:false,reuseExisting:false,target:schedule.target});}else await entry.runtime.inspect();}).catch(error=>{const entry=instanceForAlarm(alarm.name);if(entry)void entry.runtime.pause(error.message);});return;}
  if(alarm.name === "dra-rule-sync") initialize().then(()=>ruleSync.sync()).catch(()=>undefined);
  if (alarm.name === "dra-observations-cleanup") {
    initialize().then(()=>cleanupStoredObservations()).then(()=>chrome.runtime.sendMessage({type:"DRA_STATUS_CHANGED"})).catch(()=>undefined);
  }
  if (alarm.name === "dra-history-cleanup") {
    initialize().then(()=>cleanupDecisions()).then(()=>chrome.runtime.sendMessage({type:"DRA_HISTORY_CHANGED"})).catch(()=>undefined);
  }
  if ([KUAISHOU_ALARM,KUAISHOU_STOP_ALARM].includes(alarm.name)) initialize().then(()=>kuaishou.inspect()).catch(error=>kuaishou.pause(error.message));
  if ([BILIBILI_ALARM,BILIBILI_STOP_ALARM].includes(alarm.name)) initialize().then(()=>bilibili.inspect()).catch(error=>bilibili.pause(error.message));
  if ([BILIBILI_POPULAR_ALARM,BILIBILI_POPULAR_STOP_ALARM].includes(alarm.name)) initialize().then(()=>bilibiliPopular.inspect()).catch(error=>bilibiliPopular.pause(error.message));
  if ([FEIGUA_ALARM, FEIGUA_STOP_ALARM].includes(alarm.name)) initialize().then(()=>feigua.inspect()).catch(error=>feigua.pause(error.message));
  if(alarm.name===HUXUAN_ALARM)initialize().then(()=>huxuan.inspect()).catch(error=>huxuan.pause(error.message));
  if ([XINGTU_ALARM, XINGTU_STOP_ALARM].includes(alarm.name)) initialize().then(()=>xingtu.inspect()).catch(error=>xingtu.pause(error.message));
  if (alarm.name === UPLOAD_ALARM) handleUploadAlarm().catch(() => undefined);
  if (alarm.name === CREATOR_UPLOAD_BACKFILL_ALARM) runCreatorUploadBackfill().catch(() => chrome.alarms.create(CREATOR_UPLOAD_BACKFILL_ALARM,{when:Date.now()+60_000}));
  if (alarm.name === WATCHDOG_ALARM) watchdog().catch((error) => setPaused("后台巡检失败", error.message));
  if (alarm.name === RUN_STOP_ALARM) handleRunStopAlarm().catch((error) => setPaused("到点停止任务失败", error.message));
  if (SCHEDULED_PLATFORMS.some((item) => item.alarm === alarm.name)) handleScheduledAlarm(alarm).catch((error) => {
    state.lastScheduleAt = new Date().toISOString();
    state.lastScheduleResult = `定时任务异常：${error?.message || String(error)}`;
    persistState().catch(() => undefined);
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  const launcher=ensureTabLauncher(tabId);
  const navigation=chrome.tabs.get(tabId).then(async tab=>{
    await initialize();
    await pauseCatalogForNavigation('feigua',tab);
    await pauseCatalogForNavigation('xingtu',tab);
  }).catch(()=>{});
  return Promise.all([launcher,navigation]);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  profileNetwork.clear(tabId);
  const entry=instances.forTab(tabId);if(entry?.runtime.active())void entry.runtime.pause('该分身页面已关闭');
  douyin.detached(tabId);
  if (tabId === kuaishou.state().feedTabId && kuaishou.active()) void kuaishou.pause("快手标签页已关闭");
  if (bilibiliForTab(tabId)?.active()) void bilibiliForTab(tabId).pause("B站标签页已关闭");
  if (tabId === feigua.state().feedTabId && tabId===feigua.state().feedTabId && feigua.active()) void feigua.pause("飞瓜标签页已关闭");
  if(tabId===huxuan.state().feedTabId && huxuan.active())void huxuan.pause("互选标签页已关闭");
  if (tabId === xingtu.state().feedTabId && tabId===xingtu.state().feedTabId && xingtu.active()) void xingtu.pause("星图标签页已关闭");
  if (tabId === state.feedTabId && isActiveRunStatus()) setPaused("当前运行标签页已关闭").catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const entry=instances.forTab(tabId);if(entry?.runtime.active() && (changeInfo.url || changeInfo.status==='complete'))void entry.runtime.inspect().catch(error=>entry.runtime.pause(error.message));
  if (changeInfo.status === "complete") void ensureTabLauncher(tabId);
  const url = changeInfo.url || tab.url || tab.pendingUrl || "";
  void pauseCatalogForNavigation('feigua',{...tab,id:tabId,url});
  void pauseCatalogForNavigation('xingtu',{...tab,id:tabId,url});
  if (tabId === kuaishou.state().feedTabId && kuaishou.active() && (changeInfo.url || changeInfo.status === "complete")) void kuaishou.inspect();
  if (bilibiliForTab(tabId)?.active() && (changeInfo.url || changeInfo.status === "complete")) void bilibiliForTab(tabId).inspect();
  if (tabId === feigua.state().feedTabId && feigua.active() && (changeInfo.url || changeInfo.status === "complete")) void feigua.inspect();
  if(tabId===huxuan.state().feedTabId && huxuan.active() && (changeInfo.url || changeInfo.status==="complete"))void huxuan.inspect();
  if (tabId === xingtu.state().feedTabId && xingtu.active() && (changeInfo.url || changeInfo.status === "complete")) void xingtu.inspect();
  if (tabId === state.feedTabId && state.status === "running" && changeInfo.status === "complete") {
    watchdog().catch((error) => setPaused("刷新后恢复失败", error.message));
  }
  if (tabId === state.feedTabId && isActiveRunStatus() && (!isRecommendationFeedUrl(url) || state.route?.platform && resolveRoute(url)?.platform !== state.route.platform)) {
    setPaused("当前标签页已离开原平台采集页").catch(() => undefined);
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  profileNetwork.detach(source.tabId);
  const entry=instances.forTab(source.tabId);entry?.runtime.detached?.(source.tabId);if(entry?.runtime.active() && reason==='canceled_by_user')void entry.runtime.pause('该分身页面调试连接已断开');
  douyin.detached(source.tabId);
  if (source.tabId === state.feedTabId && state.status === "running" && reason === "canceled_by_user") {
    setPaused("页面调试连接已由用户或其他调试工具断开，请重新开始任务").catch(() => undefined);
  }
});

async function stateSnapshotForTab(tabId) {
  if (Number.isInteger(tabId) && tabId === state.feedTabId) return state;
  const tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId).catch(() => null) : null;
  const route = resolveRoute(tab?.url || tab?.pendingUrl || "");
  return {
    ...cloneInitialState(),
    backgroundMode: "current-tab",
    feedTabId: Number.isInteger(tab?.id) ? tab.id : null,
    feedWindowId: Number.isInteger(tab?.windowId) ? tab.windowId : null,
    route: route ? { platform: route.platform, surface: route.surface, label: route.label } : null
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Call immediately in the user gesture, before storage/auth initialization.
  if (message?.type === "DRA_OPEN_PANEL") {
    if (!sender.tab || (sender.frameId ?? 0) !== 0 || !/^https?:\/\//.test(sender.url || "")) { sendResponse({ ok:false }); return false; }
    if (TASK_PLATFORMS.includes(message.platform) || instances.get(message.platform)) pendingPanelSelections.set(sender.tab.windowId,message.platform);
    chrome.sidePanel.open({ windowId: sender.tab.windowId }).then(() => {
      chrome.runtime.sendMessage({type:'DRA_PANEL_SELECTION_CHANGED',windowId:sender.tab.windowId}).catch(()=>undefined);
      sendResponse({ok:true});
    }).catch(error => {pendingPanelSelections.delete(sender.tab.windowId);sendResponse({ok:false,error:error.message});});
    return true;
  }
  (async () => {
    await initialize();
    const entry=instances.forTab(sender.tab?.id);
    if(entry && (DOUYIN_CONTENT_MESSAGES.includes(message?.type) || ['DRA_KUAISHOU_VIDEO','DRA_BILIBILI_VIDEO','DRA_FEIGUA_PAGE','DRA_FEIGUA_PAGE_TIMEOUT','DRA_FEIGUA_COMPLETE','DRA_XINGTU_PAGE','DRA_XINGTU_COMPLETE','DRA_HUXUAN_PAGE'].includes(message?.type)))return entry.runtime.message(message,sender);
    if(['DRA_START','DRA_RESUME','DRA_PAUSE','DRA_STOP'].includes(message?.type))return controlTask(message);
    if (DOUYIN_CONTENT_MESSAGES.includes(message?.type) && sender.tab?.id===state.feedTabId) return douyin.message(message,sender);
    if (sender.tab?.id === kuaishou.state().feedTabId && ['DRA_WAIT','DRA_PROGRESS','DRA_KUAISHOU_VIDEO','DRA_TICK_ERROR'].includes(message?.type)) return kuaishou.message(message,sender);
    if (bilibiliForTab(sender.tab?.id) && ['DRA_WAIT','DRA_PROGRESS','DRA_BILIBILI_VIDEO','DRA_TICK_ERROR'].includes(message?.type)) return bilibiliForTab(sender.tab.id).message(message,sender);
    if (sender.tab?.id === feigua.state().feedTabId && ['DRA_WAIT','DRA_PROGRESS','DRA_FEIGUA_PAGE','DRA_FEIGUA_PAGE_TIMEOUT','DRA_FEIGUA_COMPLETE','DRA_PAGE_BLOCKED','DRA_FEED_STALLED','DRA_TICK_ERROR'].includes(message?.type)) return feigua.message(message,sender);
    if (sender.tab?.id === huxuan.state().feedTabId && ['DRA_WAIT','DRA_PROGRESS','DRA_HUXUAN_PAGE','DRA_TICK_ERROR'].includes(message?.type)) return huxuan.message(message,sender);
    if (sender.tab?.id === xingtu.state().feedTabId && ['DRA_WAIT','DRA_PROGRESS','DRA_XINGTU_PAGE','DRA_XINGTU_COMPLETE','DRA_PAGE_BLOCKED','DRA_FEED_STALLED','DRA_TICK_ERROR'].includes(message?.type)) return xingtu.message(message,sender);
    if (DOUYIN_CONTENT_MESSAGES.includes(message?.type)) return douyin.message(message,sender);
    const configuredInstance=instances.get(message.platform);
    if(configuredInstance && ['DRA_OPEN_FEIGUA','DRA_OPEN_XINGTU','DRA_OPEN_HUXUAN','DRA_SAVE_FEIGUA_CONFIG','DRA_SAVE_XINGTU_CONFIG','DRA_SAVE_HUXUAN_CONFIG'].includes(message?.type)){
      requireExtensionPage(sender);
      const platform=message.type.split('_')[2].toLowerCase();
      if(configuredInstance.platform!==platform)throw Error('分身与所选平台不一致');
      if(message.type.startsWith('DRA_OPEN_')){const tab=await configuredInstance.runtime.openPage({windowId:message.windowId});return {ok:true,tabId:tab.id};}
      const save=configQueue.then(()=>saveInstanceCatalog(configuredInstance,message));configQueue=save.catch(()=>undefined);return save;
    }
    switch (message?.type) {
      case 'DRA_CREATE_TASK':requireExtensionPage(sender);return {ok:true,state:await instances.create(message.platform,message.name)};
      case 'DRA_RENAME_TASK':requireExtensionPage(sender);return {ok:true,state:await instances.rename(message.taskId,message.name)};
      case 'DRA_FEIGUA_TAKEOVER': {
        requireFeiguaSender(sender);
        const task=catalogTaskForTab('feigua',sender.tab.id);if(task?.active())await task.pause('你已接管飞瓜页面，自动翻页已暂停');
        return {ok:true};
      }
      case 'DRA_FEIGUA_BROWSE_ERROR':
        requireFeiguaSender(sender);browseState.lastError=String(message.error || '浏览采集失败').slice(0,500);return {ok:true};
      case 'DRA_FEIGUA_BROWSE_STATUS': {
        requireFeiguaSender(sender);
        await pauseCatalogForNavigation('feigua',{...sender.tab,url:sender.url});
        const task=catalogTaskForTab('feigua',sender.tab.id);
        browseState.lastCheckedAt=new Date().toISOString();
        return {ok:true,enabled:browseState.enabled,automaticTab:!!task?.active()};
      }
      case 'DRA_SET_FEIGUA_BROWSING':
        requireExtensionPage(sender);
        browseState.enabled=message.enabled===true; browseState.lastError='';
        await chrome.storage.local.set({draFeiguaBrowsing:browseState});
        return {ok:true};
      case 'DRA_FEIGUA_BROWSE_PAGE': {
        requireFeiguaSender(sender);
        const work=browseWrites.then(()=>captureBrowsePage(message.page,sender));
        browseWrites=work.catch(()=>{});return work;
      }
      case 'DRA_XINGTU_TAKEOVER': {
        requireXingtuSender(sender);
        const task=catalogTaskForTab('xingtu',sender.tab.id);if(task?.active())await task.pause('你已接管星图页面，自动翻页已暂停');
        return {ok:true};
      }
      case 'DRA_XINGTU_BROWSE_ERROR':
        requireXingtuSender(sender);xingtuBrowseState.lastError=String(message.error || '浏览采集失败').slice(0,500);return {ok:true};
      case 'DRA_XINGTU_BROWSE_STATUS': {
        requireXingtuSender(sender);
        await pauseCatalogForNavigation('xingtu',{...sender.tab,url:sender.url});
        const task=catalogTaskForTab('xingtu',sender.tab.id);
        xingtuBrowseState.lastCheckedAt=new Date().toISOString();
        return {ok:true,enabled:xingtuBrowseState.enabled,automaticTab:!!task?.active()};
      }
      case 'DRA_SET_XINGTU_BROWSING':
        requireExtensionPage(sender);
        xingtuBrowseState.enabled=message.enabled===true; xingtuBrowseState.lastError='';
        await chrome.storage.local.set({draXingtuBrowsing:xingtuBrowseState});
        return {ok:true};
      case 'DRA_XINGTU_BROWSE_PAGE': {
        requireXingtuSender(sender);
        const work=xingtuBrowseWrites.then(()=>captureXingtuBrowsePage(message.page,sender));
        xingtuBrowseWrites=work.catch(()=>{});return work;
      }

      case "DRA_DEBUG_STATUS": {
        requireExtensionPage(sender);
        const saved = await chrome.storage.local.get([STORAGE_KEYS.debugSettings,"draRawSampleError"]);
        return {ok:true, enabled:saved[STORAGE_KEYS.debugSettings]?.rawCapture===true, error:saved.draRawSampleError || "", samples:await rawSamples("status")};
      }
      case "DRA_SET_RAW_CAPTURE":
        requireExtensionPage(sender);
        await chrome.storage.local.set({[STORAGE_KEYS.debugSettings]:{rawCapture:message.enabled===true},draRawSampleError:""});
        return {ok:true};
      case "DRA_CAPTURE_RAW": {
        requireExtensionPage(sender);
        const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
        if (!tab?.url?.startsWith("https://www.douyin.com/")) throw Error("请切换到抖音推荐页后采样");
        const result = await chrome.tabs.sendMessage(tab.id,{type:"DRA_CAPTURE_SAMPLE"});
        if (!result?.ok) throw Error(result?.error || "采样失败，请刷新抖音页面后重试");
        const label = ["video","live","photo","ad"].includes(message.label) ? message.label : "unconfirmed";
        return {ok:true,samples:await saveRawSample(result.sample,label,true)};
      }
      case "DRA_EXPORT_RAW":
        requireExtensionPage(sender);
        return {ok:true,samples:await rawQueue.then(()=>rawSamples("list"))};
      case "DRA_CLEAR_RAW": {
        requireExtensionPage(sender);
        const task=rawQueue.then(()=>rawSamples("clear")); rawQueue=task.catch(()=>undefined);
        return {ok:true,samples:await task};
      }
      case 'DRA_GET_PANEL_SELECTION': {
        requireExtensionPage(sender);
        const platform=pendingPanelSelections.get(message.windowId) || null;
        pendingPanelSelections.delete(message.windowId);
        return {ok:true,platform};
      }
      case "DRA_GET_LAUNCHER":
        return { ok:true, launcher: launcherState(aggregateState()) };
      case 'DRA_EXPORT_OBSERVATIONS':
        requireExtensionPage(sender);
        return {ok:true,records:await exportObservations()};
      case "DRA_QUERY_HISTORY":
        requireExtensionPage(sender);
        await flushDecisionHistory();
        { const result=await queryDecisions(message.options || {});return {ok:true,...result,items:await withXingtuCreatorDetails(result.items)}; }
      case "DRA_GET_STATUS": {
        await flushDecisionHistory();
        const selectedState = await selectedTask(message.tabId, message.platform);
        const history = await decisionPreview(selectedState.route?.platform || (selectedState === state ? 'douyin' : ''),Date.now(),selectedState.taskId || taskConfigPlatform(selectedState));
        const feigua=instances.get(selectedState.taskId)?.platform==='feigua'?instances.get(selectedState.taskId).runtime:defaultRuntime('feigua');
        const xingtu=instances.get(selectedState.taskId)?.platform==='xingtu'?instances.get(selectedState.taskId).runtime:defaultRuntime('xingtu');
        const huxuan=instances.get(selectedState.taskId)?.platform==='huxuan'?instances.get(selectedState.taskId).runtime:defaultRuntime('huxuan');
        return {
          ok: true,
          state: {...selectedState,...(selectedState.route?.platform==='douyin'?{ipCapture:profileNetwork.status(selectedState.feedTabId)}:{})},
          tasks: taskStates(),
          huxuan:{pageCount:huxuan.collection()?.pages.length || 0,pageNumber:huxuan.state().lastPageNumber || "",finalized:huxuan.collection()?.finalized === true,candidates:huxuan.collection()?.recentRows || []},
          feigua: {
            pageCount:feigua.collection()?.pages?.length || 0,
            pageNumber:feigua.state().lastPageNumber || '',
            finalized:feigua.collection()?.finalized === true,
            candidates:Object.values(feigua.collection()?.accounts || {}).slice(0,10).map(row=>({name:row.authorName,followers:row.followerCount || '',avatarUrl:row.avatarUrl || '',profileUrl:row.profileUrl || '',videos:(row.videos || [row]).map(video=>({videoId:video.videoId,title:video.title,coverUrl:video.coverUrl,videoUrl:video.videoUrl,durationSeconds:video.durationSeconds,metrics:video.metrics,hotWords:video.hotWords,observedAt:video.observedAt}))}))
          },
          xingtu: {
            pageCount:xingtu.collection()?.pages?.length || 0,
            pageNumber:xingtu.state().lastPageNumber || '',
            finalized:xingtu.collection()?.finalized === true,
            historyDetailsReady:true,
            candidates:Object.values(xingtu.collection()?.accounts || {}).slice(-10).reverse().map(row=>({name:row.authorName,followers:row.followerCount || '',avatarUrl:row.avatarUrl || '',profileUrl:row.profileUrl || '',xingtuId:row.xingtuId || '',xingtuIndex:row.xingtuIndex || '',tags:row.tags || [],prices:row.prices || {},metrics:row.metrics || {},city:row.city || '',gender:row.gender || '',observedAt:row.observedAt || ''}))
          },
          pageRoute:Number.isInteger(message.tabId)?resolveRoute((await chrome.tabs.get(message.tabId).catch(()=>null))?.url || ''):null,
          browsing:selectedState.route?.platform==='xingtu' ? {...xingtuBrowseState,...await observationStatus('xingtu')} : {...browseState,...await observationStatus('feigua')},
          decisionHistory: await withXingtuCreatorDetails(history.items),
          decisionHistoryTotal: history.total,
          configPlatform:taskConfigPlatform(selectedState),
          ...configurationFor(taskConfigPlatform(selectedState)),
          teamDestination: TEAM_DESTINATION,
          cloud: cloudStatusSnapshot(),
          daily: dailySnapshot(dailyStats),
          schedule: await getScheduleStatus(taskConfigPlatform(selectedState)),
          queueLength: uploadableOutbox().length,
          outboxCount: uploadableOutbox().length,
          outbox: outbox.slice(-20).reverse()
        };
      }
      case "DRA_CHECK_BRIDGE":
      case "DRA_CHECK_CLOUD": {
        const health = await checkCloudConnection();
        return { ok: true, health };
      }
      case "DRA_START_PAIR":
        return { ok: true, cloud: await startPairing() };
      case "DRA_POLL_PAIR":
        return { ok: true, cloud: await pollPairing() };
      case "DRA_CANCEL_PAIR":
        pairing = null;
        await persistCloudAuth();
        return { ok: true, cloud: cloudStatusSnapshot() };
      case "DRA_DISCONNECT_CLOUD":
        return { ok: true, cloud: await disconnectCloud() };
      case "DRA_OPEN_WORKBENCH":
        await chrome.tabs.create({ url: CLOUD_DESTINATION.workbenchUrl, active: true });
        return { ok: true };
      case "DRA_OPEN_FEIGUA": {
        requireExtensionPage(sender);
        const tab=await feigua.openPage({windowId:message.windowId});
        return {ok:true,tabId:tab.id};
      }
      case "DRA_OPEN_HUXUAN": {
        requireExtensionPage(sender);
        const tab=await huxuan.openPage({windowId:message.windowId});
        return {ok:true,tabId:tab.id};
      }
      case "DRA_SAVE_HUXUAN_CONFIG": {
        requireExtensionPage(sender);
        if(huxuan.active())throw Error('请先暂停互选采集再修改设置');
        const maxPages=Number(message.maxPages),minSeconds=Number(message.minSeconds),maxSeconds=Number(message.maxSeconds);
        if(!Number.isInteger(maxPages)||maxPages<1||maxPages>500||!Number.isFinite(minSeconds)||minSeconds<1||!Number.isFinite(maxSeconds)||maxSeconds<minSeconds||maxSeconds>30)throw Error('请填写1至500页，及1至30秒的有效等待区间');
        huxuanConfig={settings:{...huxuanConfig.settings,huxuanTarget:{maxPages},huxuanDelay:{minSeconds,maxSeconds}},rules:{},settingsDraft:null};
        await persistWorkData();return {ok:true};
      }
      case "DRA_OPEN_XINGTU": {
        requireExtensionPage(sender);
        const tab=await xingtu.openPage({windowId:message.windowId});
        return {ok:true,tabId:tab.id};
      }
      case "DRA_SAVE_FEIGUA_CONFIG": {
        requireExtensionPage(sender);
        const save=configQueue.then(async()=>{
          if(feigua.active()) throw Error('请先暂停飞瓜再修改下轮采集设置');
          const maxPages=Number(message.maxPages);
          const minSeconds=Number(message.minSeconds), maxSeconds=Number(message.maxSeconds);
          if(!Number.isInteger(maxPages) || maxPages<1 || maxPages>500) throw Error('页数需为 1 至 500 的整数');
          if(!Number.isFinite(minSeconds) || !Number.isFinite(maxSeconds) || minSeconds<1 || maxSeconds>30 || maxSeconds<minSeconds) throw Error('翻页间隔需为 1 至 30 秒，最大值应大于或等于最小值');
          if(!Array.isArray(message.keywords) || message.keywords.length>200 || message.keywords.some(word=>typeof word!=='string'||word.length>100)) throw Error('规避词格式不正确，最多 200 个词，每个词最多 100 字');
          if(!Array.isArray(message.positiveKeywords) || message.positiveKeywords.length>200 || message.positiveKeywords.some(word=>typeof word!=='string'||word.length>100)) throw Error('正向关键词格式不正确，最多 200 个词，每个词最多 100 字');
          settings={...settings,feiguaTarget:{maxPages},feiguaDelay:{minSeconds,maxSeconds},...(message.schedule ? {feiguaSchedule:scheduleFrom(message.schedule, true),feiguaScheduleOptIn:true} : {})};
          rules={...rules,feiguaKeywords:[...new Set(message.keywords.map(word=>word.trim()).filter(Boolean))],feiguaPositiveKeywords:[...new Set(message.positiveKeywords.map(word=>word.trim()).filter(Boolean))]};
          await chrome.storage.local.set({[STORAGE_KEYS.settings]:settings,[STORAGE_KEYS.rules]:rules});
          if (message.schedule) await syncScheduleAlarm();
          return {ok:true};
        });
        configQueue=save.catch(()=>undefined);return save;
      }
      case "DRA_SAVE_XINGTU_CONFIG": {
        requireExtensionPage(sender);
        const save=configQueue.then(async()=>{
          if(xingtu.active()) throw Error('请先暂停星图再修改下轮采集设置');
          const maxPages=Number(message.maxPages);
          const minSeconds=Number(message.minSeconds), maxSeconds=Number(message.maxSeconds);
          if(!Number.isInteger(maxPages) || maxPages<1 || maxPages>500) throw Error('页数需为 1 至 500 的整数');
          if(!Number.isFinite(minSeconds) || !Number.isFinite(maxSeconds) || minSeconds<1 || maxSeconds>30 || maxSeconds<minSeconds) throw Error('翻页间隔需为 1 至 30 秒，最大值应大于或等于最小值');
          if(!Array.isArray(message.keywords) || message.keywords.length>200 || message.keywords.some(word=>typeof word!=='string'||word.length>100)) throw Error('规避词格式不正确，最多 200 个词，每个词最多 100 字');
          xingtuConfig = {
            settings:mergeXingtuSettings({...xingtuConfig.settings,xingtuTarget:{maxPages},xingtuDelay:{minSeconds,maxSeconds},...(message.schedule ? {schedule:message.schedule} : {})}, { scheduleOptIn: message.schedule ? true : xingtuConfig.scheduleOptIn === true }),
            rules:mergeXingtuRules({xingtuKeywords:[...new Set(message.keywords.map(word=>word.trim()).filter(Boolean))]}),
            settingsDraft:null,
            scheduleOptIn: message.schedule ? true : xingtuConfig.scheduleOptIn === true
          };
          await chrome.storage.local.set({draXingtuConfig:xingtuConfig});
          if (message.schedule) await syncScheduleAlarm();
          return {ok:true};
        });
        configQueue=save.catch(()=>undefined);return save;
      }
      case "DRA_SYNC_RULES":
        await ruleSync.sync(); return {ok:true,status:ruleSync.status()};
      case "DRA_SAVE_CONFIG": {
        const save = configQueue.then(() => saveConfiguration(message));
        configQueue = save.catch(() => undefined);
        return save;
      }
      case "DRA_CLEAR_LOCAL_DATA":
        if (instances.states().some(task=>['running','starting','paused'].includes(task.status)) || isActiveRunStatus() || kuaishou.active() || bilibiliTasks().some((task) => task.active()) || feigua.active() || xingtu.active() || huxuan.active() || huxuan.collection() && !huxuan.collection().finalized || feigua.collection() && !feigua.collection().finalized || xingtu.collection() && !xingtu.collection().finalized) throw new Error("请先结束所有平台任务并保存候选，再清空本地数据");
        for(const entry of instances.values()){entry.runtime.clear();entry.creators={};}
        feigua.clear();
        xingtu.clear();
        huxuan.clear();
        kuaishou.clear();
        bilibili.clear();
        bilibiliPopular.clear();
        douyin.clear();
        removeOutbox(outbox.map(item => item.id));
        await persistWorkData();
        return { ok: true };
      default:
        return null;
    }
  })().then((result) => sendResponse(result)).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

initialize().then(() => Promise.all([
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }),
  configureOpenTabSidePanels(),
  ruleSync.sync()
])).catch(() => undefined);

function requireFeiguaSender(sender) {
  if(!Number.isInteger(sender.tab?.id) || (sender.frameId ?? 0)!==0 || !/^https:\/\/dy\.feigua\.cn\/app\//.test(sender.url || ''))throw Error('消息不是来自飞瓜页面');
}
function requireXingtuSender(sender) {
  if(!Number.isInteger(sender.tab?.id) || (sender.frameId ?? 0)!==0 || !/^https:\/\/(?:www\.)?xingtu\.cn\//.test(sender.url || ''))throw Error('消息不是来自星图页面');
}
async function captureBrowsePage(page,sender) {
  if(!browseState.enabled || catalogTaskForTab('feigua',sender.tab.id)?.active())return {ok:true,skipped:true};
  const tab=await chrome.tabs.get(sender.tab.id);
  if(!tab.active)return {ok:true,skipped:true};
  if(!page || page.pageUrl!==tab.url || !['library','video','creator'].includes(page.surface) || !Array.isArray(page.rows) || page.rows.length>60 || !page.rows.length || JSON.stringify(page).length>500000)throw Error('飞瓜浏览数据不完整或页面已变化');
  const day=new Date().toISOString().slice(0,10);
  const runId=`feigua-browse:${day}`;
  try {
    const items=await saveObservations(page.rows.map(row=>{
      const decision=evaluateFeiguaRules(page.rows.filter(item=>rowAccountKey(item)===rowAccountKey(row)),rules);
      return {...normalizeFeiguaObservation({...row,ruleDecision:decision},page,runId,'browse'),uploadEligible:true,
        ruleMatch:captureRuleMatch(decision,{route:{label:'飞瓜随浏览采集'}},'feigua')};
    }));
    void requestUpload();
    const owner={runId,startedAt:page.capturedAt,route:{platform:'feigua',label:'飞瓜随浏览采集'}};
    for(const item of items)recordDecision(item.raw.ruleDecision,item,null,owner);
    browseState.lastCapturedAt=page.capturedAt; browseState.lastPageUrl=page.pageUrl; browseState.lastError='';
    await chrome.storage.local.set({draFeiguaBrowsing:browseState});
    await flushDecisionHistory();
    await chrome.runtime.sendMessage({type:"DRA_STATUS_CHANGED"}).catch(()=>{});
    return {ok:true,count:items.length};
  } catch(error) {
    browseState.lastError=error.message; browseState.enabled=false;
    await chrome.storage.local.set({draFeiguaBrowsing:browseState});
    if(feigua.active())await feigua.pause(error.message);
    throw error;
  }
}

let stagingObservations=null;
let stagingXingtuObservations=null;
function stageFeiguaObservations() {
  if(stagingObservations)return stagingObservations;
  stagingObservations=(async()=>{
    const items=await pendingObservations();
    const queuedIds=[];
    for(const item of items) {
      if(item.sourcePlatform!=='feigua')continue;
      // Leave durable observations waiting while a full outbox drains.
      if(!outbox.some(queued=>queued.id===item.id) && outbox.filter(queued=>!['written','duplicate','dry-run'].includes(queued.status)).length>=MAX_OUTBOX)break;
      if(!outbox.some(queued=>queued.id===item.id))addOutbox('pending',feiguaObservationRecord(item),'',{owner:observationOwner(item)});
      queuedIds.push(item.id);
    }
    if(queuedIds.length){
      await persistWorkData();
      await markObservationsQueued(queuedIds);
    }
  })().finally(()=>{stagingObservations=null;});
  return stagingObservations;
}
async function captureXingtuBrowsePage(page,sender) {
  if(!xingtuBrowseState.enabled || catalogTaskForTab('xingtu',sender.tab.id)?.active())return {ok:true,skipped:true};
  const tab=await chrome.tabs.get(sender.tab.id);
  if(!tab.active)return {ok:true,skipped:true};
  if(!page || page.pageUrl!==canonicalXingtuPageUrl(tab.url) || !['market','creator'].includes(page.surface) || !Array.isArray(page.rows) || page.rows.length>40 || !page.rows.length || page.rows.some(row=>!/^\d{1,30}$/.test(String(row.xingtuId || ''))) || JSON.stringify(page).length>500000)throw Error('星图浏览数据缺少稳定身份或页面已变化');
  const day=new Date().toISOString().slice(0,10);
  const runId=`xingtu-browse:${day}`;
  try {
    const items=await saveObservations(page.rows.map(row=>({...normalizeXingtuObservation(row,page,runId,'browse'),uploadEligible:true})));
    void requestUpload();
    const owner={runId,startedAt:page.capturedAt,route:{platform:'xingtu'}};
    for(const item of items)recordDecision({code:'XINGTU_OBSERVED',reasons:['浏览采集已保存；自动翻页保持暂停']},item,null,owner);
    xingtuBrowseState.lastCapturedAt=page.capturedAt; xingtuBrowseState.lastPageUrl=page.pageUrl; xingtuBrowseState.lastError='';
    await chrome.storage.local.set({draXingtuBrowsing:xingtuBrowseState});
    await flushDecisionHistory();
    await chrome.runtime.sendMessage({type:"DRA_STATUS_CHANGED"}).catch(()=>{});
    return {ok:true,count:items.length};
  } catch(error) {
    xingtuBrowseState.lastError=error.message; xingtuBrowseState.enabled=false;
    await chrome.storage.local.set({draXingtuBrowsing:xingtuBrowseState});
    if(xingtu.active())await xingtu.pause(error.message);
    throw error;
  }
}
function stageXingtuObservations() {
  if(stagingXingtuObservations)return stagingXingtuObservations;
  stagingXingtuObservations=(async()=>{
    const items=await pendingObservations();
    const queuedIds=[];
    for(const item of items) {
      if(!['xingtu','huxuan'].includes(item.sourcePlatform))continue;
      if(!outbox.some(queued=>queued.id===item.id) && outbox.filter(queued=>!['written','duplicate','dry-run'].includes(queued.status)).length>=MAX_OUTBOX)break;
      if(!outbox.some(queued=>queued.id===item.id))addOutbox('pending',item.sourcePlatform==='huxuan'?huxuanObservationRecord(item):xingtuObservationRecord(item),'',{owner:observationOwner(item)});
      queuedIds.push(item.id);
    }
    if(queuedIds.length){
      await persistWorkData();
      await markObservationsQueued(queuedIds);
    }
  })().finally(()=>{stagingXingtuObservations=null;});
  return stagingXingtuObservations;
}

async function cleanupStoredObservations() {
  const settled=new Set(['written','duplicate','dry-run']);
  await markObservationsUploaded(outbox.filter(item=>['written','duplicate'].includes(item.status)).map(item=>item.id));
  const pending=outbox.filter(item=>!settled.has(item.status));
  const protectedSessions=pending.filter(item=>!item.payload?.aweme_id).map(item=>item.sessionId);
  // Protect the in-progress read before its upload record has been enqueued.
  if(['running','starting'].includes(state.status))protectedSessions.push(state.runId);
  if(huxuan.active())protectedSessions.push(huxuan.state().runId);
  return cleanupObservations({protectedIds:pending.map(item=>item.id),
    protectedEntities:pending.filter(item=>item.payload?.aweme_id).map(item=>JSON.stringify([item.sessionId,item.payload.aweme_id])),protectedSessions});
}
