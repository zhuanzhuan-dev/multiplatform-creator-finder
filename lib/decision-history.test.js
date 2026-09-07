import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_WINDOW_MS, prepareLegacyHistory, normalizeHistoryEntry, historyMatches } from './decision-history.js';
import { normalizeSourcePlatform, sourcePlatformLabel } from './source-platform.js';

test('legacy migration keeps valid 24 hour records with stable IDs and known Douyin origin',()=>{
 const now=1788000000000;
 const saved={draState:{runId:'run',startedAt:new Date(now-60000).toISOString(),recentDecisions:[{code:'ACCEPTED',occurredAt:new Date(now-1000).toISOString()},{occurredAt:new Date(now-HISTORY_WINDOW_MS).toISOString()},{occurredAt:'bad'}]}};
 const entries=prepareLegacyHistory(saved,now);assert.equal(entries.length,1);assert.equal(entries[0].sourcePlatform,'douyin');assert.equal(entries[0].id,prepareLegacyHistory(saved,now)[0].id);
});
test('history normalization preserves source and no longer truncates to 100 entries',()=>{
 const now=Date.now();const saved={draDecisionHistory:Array.from({length:140},(_,i)=>({id:String(i),occurredAt:new Date(now-i).toISOString(),sourcePlatform:'星图'}))};
 const entries=prepareLegacyHistory(saved,now);assert.equal(entries.length,140);assert.equal(entries[0].sourcePlatform,'xingtu');
 assert.equal(normalizeHistoryEntry({occurredAt:'invalid'}),null);
 assert.equal(normalizeSourcePlatform('快手'),'kuaishou');assert.equal(sourcePlatformLabel('feigua'),'飞瓜');
});
test('source, run and text filters compose',()=>{
 const entry=normalizeHistoryEntry({occurredAt:new Date().toISOString(),sourcePlatform:'feigua',runId:'r',accountName:'张三',reasons:['美食']});
 assert.equal(historyMatches(entry,{sourcePlatform:'feigua',runId:'r',query:'美食'}),true);
 assert.equal(historyMatches(entry,{sourcePlatform:'douyin'}),false);
 assert.equal(historyMatches(entry,{runId:'old'}),false);
});
