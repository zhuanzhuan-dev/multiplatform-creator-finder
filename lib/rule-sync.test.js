import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRuleSync} from './rule-sync.js';
import {ruleFingerprint,applyRuleOperations} from '../src/core/plugin-rules.ts';
const base={hard:{minFollowers:10000,maxFollowers:5000000,minVideoDurationSeconds:60,minVideoLikes:3000},gameBlacklist:['游戏','电影'],positiveCategories:[{id:'food',name:'美食',score:20,keywords:['做饭']}]};
async function fixture(){
 const store={};let rules=structuredClone(base),pending=[],fail=false;const calls=[];
 const operations=[{op:'remove',key:'gameBlacklist',value:'游戏'}];const next=applyRuleOperations('douyin',base,operations).rules;
 const item={id:'suggestion-1',platform:'douyin',operations,baseRevision:await ruleFingerprint(base),nextRevision:await ruleFingerprint(next),explanation:'删除误杀词'};pending=[item];
 const deps={storage:{get:async key=>({[key]:structuredClone(store[key])}),set:async v=>Object.assign(store,structuredClone(v))},auth:()=>({device_token:'test-device'}),getRules:()=>rules,saveRules:async(_p,r)=>{rules=r;calls.push('save')},request:async(_token,body)=>{if(fail)return {ok:false,payload:{error:'offline'}};calls.push(body);if(body.receipts.some(r=>['applied','conflict','failed'].includes(r.status)))pending=[];return {ok:true,payload:{pending}}}};
 return {deps,calls,item,next,get rules(){return rules},set rules(r){rules=r},set fail(f){fail=f}};
}
test('sync receives without modifying active config; restart applies only at new start',async()=>{
 const f=await fixture();let sync=createRuleSync(f.deps);await sync.sync();assert.deepEqual(f.rules,base);assert.equal(sync.status().pending.length,1);
 sync=createRuleSync(f.deps);await sync.beforeStart('douyin');assert.deepEqual(f.rules,f.next);assert.equal(f.calls.filter(x=>x==='save').length,1);await sync.beforeStart('douyin');assert.equal(f.calls.filter(x=>x==='save').length,1);
})
test('manual config edit produces conflict and preserves new value',async()=>{
 const f=await fixture();const sync=createRuleSync(f.deps);await sync.sync();f.rules={...base,gameBlacklist:['新手动词']};await sync.beforeStart('douyin');assert.deepEqual(f.rules.gameBlacklist,['新手动词']);assert.equal(sync.status().last.status,'conflict');
})
test('offline receipt survives restart and retries without duplicate mutation',async()=>{
 const f=await fixture();const sync=createRuleSync(f.deps);await sync.sync();f.fail=true;await sync.beforeStart('douyin');assert.deepEqual(f.rules,f.next);assert.match(sync.status().error,/offline/);f.fail=false;const restarted=createRuleSync(f.deps);await restarted.sync();assert.equal(f.calls.filter(x=>x==='save').length,1);assert.ok(f.calls.some(x=>x.receipts?.some(r=>r.status==='applied')));
})
test('wrong platform never applies a pending proposal',async()=>{
 const f=await fixture();const sync=createRuleSync(f.deps);await sync.beforeStart('kuaishou');assert.deepEqual(f.rules,base);assert.equal(sync.status().pending.length,1);
})


test('malformed sync reply retains terminal receipt for the next retry',async()=>{
 const f=await fixture();const sync=createRuleSync(f.deps);await sync.sync();f.fail=true;await sync.beforeStart('douyin');
 f.fail=false;const valid=f.deps.request;f.deps.request=async()=>({ok:true,payload:{pending:null}});
 const restarted=createRuleSync(f.deps);await restarted.sync();assert.match(restarted.status().error,/格式/);
 f.deps.request=valid;await createRuleSync(f.deps).sync();assert.ok(f.calls.some(x=>x.receipts?.some(r=>r.status==='applied')));
});


test('current real platform defaults are accepted by the shared feedback contract',async()=>{
 const {DEFAULT_RULES}=await import('./defaults.js');const {DEFAULT_BILIBILI_RULES}=await import('./bilibili-rules.js');
 for(const platform of ['douyin','kuaishou','feigua'])assert.deepEqual(applyRuleOperations(platform,DEFAULT_RULES,[]).rules,DEFAULT_RULES);
 for(const platform of ['bilibili','bilibili-popular'])assert.deepEqual(applyRuleOperations(platform,DEFAULT_BILIBILI_RULES,[]).rules,DEFAULT_BILIBILI_RULES);
 assert.deepEqual(applyRuleOperations('xingtu',{xingtuKeywords:DEFAULT_RULES.xingtuKeywords},[]).rules.xingtuKeywords,DEFAULT_RULES.xingtuKeywords);
});

test('concurrent starts apply once and preserve the full unrelated configuration',async()=>{
 const f=await fixture();const sync=createRuleSync(f.deps);
 await Promise.all([sync.beforeStart('douyin'),sync.beforeStart('douyin'),sync.sync()]);
 assert.equal(f.calls.filter(x=>x==='save').length,1);
 assert.deepEqual(f.rules,{...base,gameBlacklist:['电影']});
});

test('manual edit to an unrelated field also prevents an old full snapshot overwriting it',async()=>{
 const f=await fixture();const sync=createRuleSync(f.deps);await sync.sync();
 const manuallyEdited={...structuredClone(base),hard:{...base.hard,minVideoLikes:9876},privateConfig:{keep:'独立配置'}};
 f.rules=manuallyEdited;await sync.beforeStart('douyin');
 assert.deepEqual(f.rules,manuallyEdited);assert.equal(f.calls.filter(x=>x==='save').length,0);
 assert.equal(sync.status().last.status,'conflict');
});
