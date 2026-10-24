import { applyRuleOperations, ruleFingerprint, RULE_PLATFORMS } from '../src/core/plugin-rules.ts';
export function createRuleSync({ storage, auth, request, getRules, saveRules }) {
  let serial = Promise.resolve();
  let latest = { pending: [], receipts: [], error: '', syncedAt: '' };
  const enqueue = fn => { const result=serial.then(fn); serial=result.catch(()=>undefined); return result; };
  async function load() {
    const account=auth(); if(!account?.device_token || account.expired){latest={pending:[],receipts:[],error:'',syncedAt:''};return null;}
    const key=`draRuleSync:${await ruleFingerprint({token:account.device_token})}`;
    const saved=(await storage.get(key))[key] || {pending:[],receipts:[],error:'',syncedAt:''};
    return {key,saved,token:account.device_token};
  }
  async function persist(owner) { latest=owner.saved; await storage.set({[owner.key]:owner.saved}); }
  async function syncUnlocked() {
    const owner=await load();if(!owner)return;
    try {
      const configs=RULE_PLATFORMS.map(platform=>({platform,rules:getRules(platform)}));
      const result=await request(owner.token,{contractVersion:1,configs,receipts:owner.saved.receipts});
      if(!result.ok)throw Error(result.payload?.error || '规则同步失败');
      if(auth()?.device_token!==owner.token)return;
      const incoming=result.payload?.pending;
      if(!Array.isArray(incoming))throw Error('规则同步响应格式错误');
      if(incoming.some(item=>!item || !RULE_PLATFORMS.includes(item.platform)||!Array.isArray(item.operations)))throw Error('不支持的规则建议');
      owner.saved.receipts=[];
      for(const item of incoming) {
        if(owner.saved.pending.some(p=>p.id===item.id))continue;
        if(!RULE_PLATFORMS.includes(item.platform)||!Array.isArray(item.operations))throw Error('不支持的规则建议');
        owner.saved.pending.push(item);
        owner.saved.receipts.push({id:item.id,status:'received'});
      }
      // Only retain pending IDs still requested by the server.
      owner.saved.pending=owner.saved.pending.filter(p=>incoming.some(i=>i.id===p.id));
      owner.saved.error='';owner.saved.syncedAt=new Date().toISOString();
    }catch(error){owner.saved.error=error.message || String(error);}
    await persist(owner);
  }
  async function applyUnlocked(platform) {
    const owner=await load();if(!owner)return;
    for(const item of owner.saved.pending.filter(p=>p.platform===platform)) {
      let status='applied',error='';
      try{
        const current=getRules(platform),revision=await ruleFingerprint(current);
        if(revision!==item.nextRevision) {
          if(revision!==item.baseRevision){status='conflict';throw Error('插件规则已手动修改，旧建议未覆盖，请回工作台重新分析');}
          const applied=applyRuleOperations(platform,current,item.operations);
          if(await ruleFingerprint(applied.rules)!==item.nextRevision)throw Error('规则建议校验失败');
          if(auth()?.device_token!==owner.token)return;
          await saveRules(platform,applied.rules);
          if(await ruleFingerprint(getRules(platform))!==item.nextRevision)throw Error('保存后的规则与建议不一致');
        }
      }catch(e){error=e.message||String(e);if(status!=='conflict')status='failed';}
      owner.saved.receipts=owner.saved.receipts.filter(r=>r.id!==item.id);
      owner.saved.receipts.push({id:item.id,status,error,revision:item.nextRevision});
      owner.saved.pending=owner.saved.pending.filter(p=>p.id!==item.id);
      owner.saved.last={id:item.id,platform,status,error};
      await persist(owner);
    }
  }
  return {
    sync:()=>enqueue(syncUnlocked),
    beforeStart:platform=>enqueue(async()=>{await syncUnlocked();await applyUnlocked(platform);await syncUnlocked();}),
    status:()=>({pending:latest.pending.map(p=>({id:p.id,platform:p.platform,explanation:p.explanation})),last:latest.last,error:latest.error,syncedAt:latest.syncedAt}),
  };
}
