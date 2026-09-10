import { readKuaishouVideo, readKuaishouProfile, kuaishouBlocked, KUAISHOU_ACTIVE } from '../lib/kuaishou-page.js';
import { evaluateVideoRules } from '../lib/rule-engine.js';
import { sampleDwellSeconds } from '../lib/dwell.js';

let generation=0, running=false, runId='',loopId='';
const stop=()=>{generation++;running=false;};
chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
  if(message.type==='DRA_LOOP_STATUS'){reply({ok:true,running,runId,loopId});return false;}
  if(message.type==='DRA_STOP_LOOP'){stop();reply({ok:true});return false;}
  if(message.type==='DRA_KUAISHOU_PROFILE_READ'){
    try{if(kuaishouBlocked())throw Error('快手主页需要验证或登录');reply({ok:true,profile:readKuaishouProfile()});}catch(error){reply({ok:false,error:error.message});}return false;
  }
  if(message.type!=='DRA_START_LOOP')return false;
  stop();running=true;runId=message.runId;loopId=message.loopId;
  const own= generation;
  const assert=()=>{if(!running || own!==generation)throw Error('任务已取消');if(location.pathname!=='/new-reco')throw Error('已离开快手推荐页');if(kuaishouBlocked())throw Error('快手要求验证或登录，请手动处理后继续');};
  const send=async(type,extra={})=>{assert();const r=await chrome.runtime.sendMessage({type,runId:message.runId,loopId:message.loopId,...extra});if(!r?.ok)throw Error(r?.error || '任务已暂停');assert();return r;};
  const sleep=async(ms)=>{const until=Date.now()+ms;while(Date.now()<until){await send('DRA_WAIT',{until:Math.min(until,Date.now()+1000)});}};
  const read=async()=>{let error;for(let i=0;i<15;i++){assert();try{return readKuaishouVideo();}catch(e){error=e;await sleep(1000);}}throw error;};
  const progress=(phase,extra={})=>send('DRA_PROGRESS',{phase,...extra});
  void(async()=>{
    let last=message.resume?.lastVideoId || '';
    while(running && own===generation){
      await progress('read');const observation=await read();
      if(observation.videoId!==last){
        const seconds=evaluateVideoRules(observation,message.rules).matched ? sampleDwellSeconds(message.settings?.dwell) : 0;
        const started=Date.now();
        await progress('dwell',{waitUntil:started+seconds*1000});
        // Natural autoplay may advance short clips before the configured dwell ends.
        // Preserve the observed clip, then avoid advancing the new clip a second time.
        while(Date.now()-started<seconds*1000){
          await sleep(Math.min(1000,started+seconds*1000-Date.now()));
          try{if(readKuaishouVideo().videoId!==observation.videoId)break;}catch{break;}
        }
        await progress('submit');const result=await send('DRA_KUAISHOU_VIDEO',{observation:{...observation,dwellSeconds:(Date.now()-started)/1000}});
        last=observation.videoId;
        if(!result.continue){stop();return;}
      }
      await progress('transition');assert();
      const current=await read();
      if(current.videoId!==last)continue;
      const next=document.querySelectorAll(`${KUAISHOU_ACTIVE} .nextVideo .next`);
      if(next.length!==1)throw Error('未识别到唯一的快手下一条按钮，已保存当前视频');
      next[0].click();
      let changed=false;
      for(let i=0;i<15;i++){await sleep(1000);try{if(readKuaishouVideo().videoId!==last){changed=true;break;}}catch{}}
      if(!changed)throw Error('快手视频切换未成功，已暂停避免重复操作');
    }
  })().catch(async error=>{if(own!==generation)return;running=false;await chrome.runtime.sendMessage({type:'DRA_TICK_ERROR',runId:message.runId,loopId:message.loopId,error:error.message}).catch(()=>{});});
  reply({ok:true});return false;
});
