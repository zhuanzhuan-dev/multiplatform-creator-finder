import {createDouyinRuntime} from './douyin-task.js';
import {createKuaishouRuntime} from './kuaishou-task.js';
import {createBilibiliRuntime} from './bilibili-task.js';
import {createFeiguaRuntime} from './feigua-task.js';
import {createXingtuRuntime} from './xingtu-task.js';
import {createHuxuanRuntime} from './huxuan-task.js';
import {normalizeFeiguaObservation,normalizeXingtuObservation} from './observations.js';
import {normalizeHuxuanObservation} from './huxuan-collection.js';
import {captureRuleMatch} from './rule-match.js';

export function createInstanceRuntime(entry, deps) {
  const {id,platform}=entry;
  const identity=()=>({taskId:id,taskName:entry.name});
  const owner=()=>Object.assign(entry.runtime.state(),identity());
  const common={...deps,settings:()=>entry.config.settings,rules:()=>entry.config.rules,
    beforeStart:async()=>{},creatorIndex:()=>entry.creators,
    ownedElsewhere:tabId=>deps.ownedElsewhere(tabId,id),
    recordDecision:(decision,observation,profile,state)=>deps.recordDecision(decision,observation,profile,Object.assign(state,identity())),
    addOutbox:(status,payload,error,options={})=>deps.addOutbox(status,payload,error,{...options,owner:Object.assign(options.owner || owner(),identity())}),
  };
  const options={alarm:`dra-instance-watch:${id}`,stopAlarm:`dra-instance-stop:${id}`};
  if(platform==='douyin')return createDouyinRuntime({...common,config:()=>entry.config,identity,
    ready:async()=>{},persistState:deps.persistState,
    saveSettings:async next=>{entry.config.settings=next;await deps.persist();},
    selectPage:tabId=>deps.selectPage(entry,tabId),
  },options);
  if(platform==='kuaishou')return createKuaishouRuntime({...common,collect:(o,p,d,s)=>deps.collectKuaishou(o,p,d,Object.assign(s,identity()))},options);
  if(platform==='bilibili' || platform==='bilibili-popular')return createBilibiliRuntime({...common,
    collect:(o,p,d,s)=>deps.collectBilibili(o,p,d,Object.assign(s,identity())),persistProgress:deps.persistState,
  },{...options,surface:platform==='bilibili-popular'?'popular':'recommend'});
  if(platform==='huxuan')return createHuxuanRuntime({...common,
    savePage:(page,runId)=>deps.saveObservations(page.rows.map(row=>({...normalizeHuxuanObservation(row,page,runId),taskId:id,taskName:entry.name}))),
  },options);
  const normalize=platform==='feigua'?normalizeFeiguaObservation:normalizeXingtuObservation;
  const savePage=async(page,runId,legacy=false,rules=null)=>{
    const rows=page.rows.map(row=>({...normalize(row,page,runId,'automatic'),taskId:id,taskName:entry.name,
      uploadEligible:!legacy && (platform!=='xingtu' || /^\d{1,30}$/.test(String(row.xingtuId || ''))),
      ...(!legacy && rules?{ruleContext:{platform,rules:structuredClone(rules),capturedAt:page.capturedAt},
        ruleMatch:captureRuleMatch(row.ruleDecision || {},owner(),platform)}:{})}));
    const saved=await deps.saveObservations(rows);void deps.scheduleUpload();return saved;
  };
  return platform==='feigua'?createFeiguaRuntime({...common,savePage},options):createXingtuRuntime({...common,savePage},options);
}
