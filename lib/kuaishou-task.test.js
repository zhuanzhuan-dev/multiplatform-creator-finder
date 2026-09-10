import test from 'node:test';
import assert from 'node:assert/strict';
import { createKuaishouRuntime, decideKuaishou } from './kuaishou-task.js';
import { DEFAULT_RULES, DEFAULT_SETTINGS } from './defaults.js';
import { kuaishouVideoId, readKuaishouVideo } from './kuaishou-page.js';
const url='https://www.kuaishou.com/new-reco';
const observation={sourcePlatform:'kuaishou',contentType:'video',videoId:'3xvideo',authorId:'3xauthor',profileUrl:'https://www.kuaishou.com/profile/3xauthor',authorName:'测试',durationSeconds:12,likes:200,caption:'测试视频'};
function harness(options={}){
  const tabs=new Map([[1,{id:1,windowId:9,url,active:false}]]), created=[],sent=[],collected=[];
  let next=10;
  globalThis.chrome={tabs:{get:async id=>tabs.get(id),query:async()=>[...tabs.values()],create:async args=>{const t={...args,id:next++};tabs.set(t.id,t);created.push(t);return t;},update:async(id,args)=>{const t={...tabs.get(id),...args};tabs.set(id,t);return t;},remove:async id=>tabs.delete(id),sendMessage:async(id,msg)=>{sent.push(msg);return {ok:true};}},windows:{getCurrent:async()=>({id:9})},alarms:{create:async()=>{},clear:async()=>{}}};
  const config={...structuredClone(DEFAULT_SETTINGS),dryRun:true,target:{mode:'count',maxItems:2},...options};
  const runtime=createKuaishouRuntime({settings:()=>config,rules:()=>DEFAULT_RULES,authorize:async()=>{},ensureContent:async t=>t,waitForTab:async id=>tabs.get(id),persist:async()=>{},indicators:async()=>{},scheduleUpload:async()=>{},recordDecision:()=>{},recordScan:()=>{},collect:async o=>collected.push(o)});
  const message=(extra={})=>runtime.message({type:'DRA_KUAISHOU_VIDEO',runId:runtime.state().runId,loopId:runtime.state().loopId,observation,...extra},{frameId:0,tab:tabs.get(runtime.state().feedTabId)});
  return {runtime,tabs,created,sent,collected,message};
}
test('Kuaishou video IDs are read from the media cache key, not numeric Douyin IDs',()=>{
  assert.equal(kuaishouVideoId('https://cdn.example/video.mp4?clientCacheKey=3xz8vaysezh45hk_abc'),'3xz8vaysezh45hk');
  assert.equal(kuaishouVideoId('not-a-url'),'');
});
test('Kuaishou requires one active slide and never consumes preloaded siblings',()=>{
  assert.throws(()=>readKuaishouVideo({querySelectorAll:()=>[]}),/唯一/);
  assert.throws(()=>readKuaishouVideo({querySelectorAll:()=>[{},{}]}),/唯一/);
});
test('Kuaishou shares video rules and keeps missing profiles for review',()=>{
  assert.equal(decideKuaishou(observation,null,DEFAULT_RULES).code,'VIDEO_TOO_SHORT');
  assert.equal(decideKuaishou({...observation,durationSeconds:100,likes:20000},null,DEFAULT_RULES).code,'PROFILE_MISSING');
});
test('Kuaishou deduplicates replay and stops at its own count target',async()=>{
  const h=harness();await h.runtime.start({tabId:1});
  await h.message();await h.message();assert.equal(h.collected.length,1);assert.equal(h.runtime.state().stats.scanned,1);
  const result=await h.message({observation:{...observation,videoId:'3xsecond'}});
  assert.equal(result.continue,false);assert.equal(h.runtime.state().status,'paused');assert.equal(h.runtime.state().stats.scanned,2);
  await assert.rejects(h.runtime.resume(),/目标/);
});
test('Kuaishou pause and resume preserve progress and create missing tab in background',async()=>{
  const h=harness();await h.runtime.start({tabId:1});await h.message();await h.runtime.pause();
  const id=h.runtime.state().runId;h.tabs.delete(1);await h.runtime.resume({windowId:9});
  assert.equal(h.created.at(-1).active,false);assert.equal(h.runtime.state().runId,id);assert.equal(h.runtime.state().stats.scanned,1);
  await h.message();assert.equal(h.collected.length,1);await h.runtime.stop();
});
test('Kuaishou rejects stale generation messages and pauses when task leaves recommendation',async()=>{
  const h=harness();await h.runtime.start({tabId:1});await assert.rejects(h.message({loopId:'stale'}),/当前快手任务/);
  h.tabs.get(1).url='https://www.kuaishou.com/profile/other';await h.runtime.inspect();assert.equal(h.runtime.state().status,'paused');
});
test('Kuaishou restores persisted progress independently',async()=>{
  const h=harness();await h.runtime.start({tabId:1});await h.message();await h.runtime.pause();const saved=structuredClone(h.runtime.storage());
  const next=harness();next.runtime.restore(saved);assert.equal(next.runtime.state().stats.scanned,1);assert.equal(next.runtime.state().route.platform,'kuaishou');
  await next.runtime.resume();await next.message();assert.equal(next.collected.length,0);await next.runtime.stop();
});

test('Kuaishou uses creator rules after video rules without manufacturing missing followers',()=>{
  const video={...observation,durationSeconds:100,likes:20000};
  assert.equal(decideKuaishou(video,{followers:null},DEFAULT_RULES).code,'PROFILE_MISSING');
  assert.equal(decideKuaishou(video,{followers:999999999},DEFAULT_RULES).code,'FOLLOWERS_TOO_HIGH');
});
test('Kuaishou time deadline pauses independently of scanned count',async()=>{
  const h=harness({target:{mode:'time',durationMinutes:1}});await h.runtime.start({tabId:1});h.runtime.state().stopAt=Date.now()-1;
  await h.runtime.inspect();assert.equal(h.runtime.state().status,'paused');assert.match(h.runtime.state().pauseReason,/时长/);
});
test('Starting a second Kuaishou task does not replace an active run',async()=>{
  const h=harness();await h.runtime.start({tabId:1});const id=h.runtime.state().runId;
  await assert.rejects(h.runtime.start({tabId:1}),/正在运行/);await h.message();assert.equal(h.runtime.state().runId,id);assert.equal(h.collected.length,1);await h.runtime.stop();
});
