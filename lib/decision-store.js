import { HISTORY_WINDOW_MS, historyMatches, historyTone, normalizeHistoryEntry, prepareLegacyHistory } from './decision-history.js';
const DB_NAME='dra-decision-history';
function openDatabase() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{
      if (!request.result.objectStoreNames.contains('records')) {
        const store=request.result.createObjectStore('records',{keyPath:'id'});
        store.createIndex('time',['occurredAtMs','id']);
        store.createIndex('sourceTime',['sourcePlatform','occurredAtMs','id']);
        request.result.createObjectStore('meta');
      }
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
function openFunnelDatabase() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('dra-funnel-scans',1);
    request.onupgradeneeded=()=>{const store=request.result.createObjectStore('funnelScans',{keyPath:'id'});store.createIndex('userId','userId');};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function transaction(mode, operation, stores=['records'], open=openDatabase) {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,mode);let result;
    tx.oncomplete=()=>{db.close();resolve(result);};
    tx.onabort=tx.onerror=()=>{db.close();reject(tx.error || Error('历史记录存储失败'));};
    try { operation(tx,value=>{result=value;}); } catch(error) { tx.abort();db.close();reject(error); }
  });
}
function deleteExpired(store, now) {
  const request=store.index('time').openKeyCursor(IDBKeyRange.upperBound([now-HISTORY_WINDOW_MS,[]]));
  request.onsuccess=()=>{const cursor=request.result;if(cursor){store.delete(cursor.primaryKey);cursor.continue();}};
}
export async function migrateDecisionHistory(saved, now=Date.now()) {
  const entries=prepareLegacyHistory(saved,now);
  await transaction('readwrite',(tx)=>{
    const meta=tx.objectStore('meta'), store=tx.objectStore('records');
    const request=meta.get('legacyImported');
    request.onsuccess=()=>{
      if (!request.result) { for(const entry of entries)store.put(entry); meta.put(true,'legacyImported'); }
      deleteExpired(store,now);
    };
  },['records','meta']);
}
export async function writeDecisions(entries, now=Date.now()) {
  const normalized=entries.filter(entry=>!entry.funnelOnly).map(entry=>normalizeHistoryEntry(entry)).filter(entry=>entry && entry.occurredAtMs>now-HISTORY_WINDOW_MS);
  await transaction('readwrite',tx=>{const store=tx.objectStore('records');for(const entry of normalized)store.put(entry);deleteExpired(store,now);});
  const pending=entries.filter(entry=>entry.funnelScan?.userId && entry.funnelScan.sessionKey);
  if (!pending.length) return;
  try {
    await transaction('readwrite',tx=>{const scans=tx.objectStore('funnelScans');for(const entry of pending)scans.put(entry.funnelScan);},['funnelScans'],openFunnelDatabase);
  } catch(error) {
    console.error('funnel scan queue could not be persisted', error);
  }
}
export function pendingFunnelScans(userId, limit=100) {
  return transaction('readonly',(tx,done)=>{const items=[];done(items);const req=tx.objectStore('funnelScans').index('userId').openCursor(IDBKeyRange.only(userId));
    req.onsuccess=()=>{const cursor=req.result;if(!cursor)return;items.push(cursor.value);if(items.length<limit)cursor.continue();};
  },['funnelScans'],openFunnelDatabase);
}
export function removeFunnelScans(ids) {
  return transaction('readwrite',tx=>{const store=tx.objectStore('funnelScans');for(const id of ids)store.delete(id);},['funnelScans'],openFunnelDatabase);
}
export function cleanupDecisions(now=Date.now()) { return transaction('readwrite',tx=>deleteExpired(tx.objectStore('records'),now)); }
function timeRange(now, asOf=now) { return IDBKeyRange.bound([now-HISTORY_WINDOW_MS,[]],[asOf,[]],true,false); }
export function decisionPreview(sourcePlatform='', now=Date.now(), taskId='') {
  return transaction('readonly',(tx,done)=>{
    const index=tx.objectStore('records').index(sourcePlatform?'sourceTime':'time');
    const range=sourcePlatform ? IDBKeyRange.bound([sourcePlatform,now-HISTORY_WINDOW_MS,[]],[sourcePlatform,now,[]],true,false) : timeRange(now);
    const result={items:[],total:0};done(result);
    if(!taskId){const count=index.count(range);count.onsuccess=()=>{result.total=count.result;};}
    const request=index.openCursor(range,'prev');
    request.onsuccess=()=>{const cursor=request.result;if(cursor){const entry=normalizeHistoryEntry(cursor.value);if(!taskId || entry.taskId===taskId){if(taskId)result.total++;if(result.items.length<5)result.items.push(entry);}if(taskId || result.items.length<5)cursor.continue();}};
  });
}
export function queryDecisions(options={}, now=Date.now()) {
  const limit=Math.min(100, Math.max(1, Number(options.limit) || 50));
  const asOf=Math.min(Number(options.asOf)||now,now);
  if(asOf<=now-HISTORY_WINDOW_MS)return Promise.resolve({items:[],total:0,counts:{good:0,review:0,reject:0},runs:[],nextCursor:null,asOf});
  return transaction('readonly',(tx,done)=>{
    const store=tx.objectStore('records');
    const result={items:[],total:0,counts:{good:0,review:0,reject:0},runs:[],nextCursor:null,asOf};
    const runs=new Map();done(result);
    const platform=typeof options.sourcePlatform==='string' ? options.sourcePlatform : '';
    const index=store.index(platform?'sourceTime':'time');
    const range=platform ? IDBKeyRange.bound([platform,now-HISTORY_WINDOW_MS,[]],[platform,asOf,[]],true,false) : timeRange(now,asOf);
    const request=index.openCursor(range,'prev');
    request.onsuccess=()=>{
      const cursor=request.result;
      if(!cursor){result.runs=[...runs].map(([id,startedAt])=>({id,startedAt}));return;}
      const entry=normalizeHistoryEntry(cursor.value);
      if((!options.taskId || entry.taskId===options.taskId) && entry.runId&&!runs.has(entry.runId))runs.set(entry.runId,entry.runStartedAt || entry.occurredAt);
      if(historyMatches(entry,options)) {
        const tone=historyTone(entry.code);result.counts[tone]++;
        if(!options.tone || options.tone===tone) {
          result.total++;
          const after=options.cursor;
          const eligible=!after || entry.occurredAtMs<after.at || entry.occurredAtMs===after.at && entry.id<after.id;
          if(eligible){
            if(result.items.length<limit) result.items.push(entry);
            else if(!result.nextCursor){const last=result.items.at(-1);result.nextCursor={at:last.occurredAtMs,id:last.id};}
          }
        }
      }
      cursor.continue();
    };
  });
}
