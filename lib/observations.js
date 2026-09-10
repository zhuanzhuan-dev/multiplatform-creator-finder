import { parseCompactNumber } from './normalizers.js';
import { rowAccountKey } from './feigua-parser.js';
import { buildObservationRecord } from './cloud.js';
const KEY='draObservations';
const DB_NAME='dra-observations';
let initialized;
const RETENTION_MS=24*60*60*1000;

function observationKey(item) {
  return JSON.stringify([item.sourcePlatform,item.sessionId,item.surface,item.viewKey || '',item.entityKey]);
}
function storedObservation(item) {
  const last=Date.parse(item.lastObservedAt || item.observedAt || '');
  const cleanupAt=(!item.uploadEligible || item.uploadConfirmed) && Number.isFinite(last) ? last+RETENTION_MS : undefined;
  return {...item,key:observationKey(item),pending:item.uploadEligible && !item.uploadConfirmed && item.queuedId!==item.id ? 1 : 0,cleanupAt};
}
function openDatabase() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,2);
    request.onupgradeneeded=event=>{
      const db=request.result;
      if(event.oldVersion===0){
      const records=db.createObjectStore('records',{keyPath:'id'});
      records.createIndex('sequence','sequence');
      records.createIndex('source','sourcePlatform');
      records.createIndex('sourceSequence',['sourcePlatform','sequence']);
      records.createIndex('pendingSequence',['pending','sequence']);
      db.createObjectStore('heads');
      db.createObjectStore('meta');
      }
      const records=request.transaction.objectStore('records');
      records.createIndex('expiry',['cleanupAt','id']);
      const cursor=records.openCursor();
      cursor.onsuccess=()=>{const item=cursor.result;if(item){item.update(storedObservation(item.value));item.continue();}};
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function transaction(mode,operation) {
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['records','heads','meta'],mode);
    let result,cause;
    const fail=error=>{cause=error;tx.abort();};
    const listen=(request,fn)=>{request.onsuccess=()=>{try{fn(request.result);}catch(error){fail(error);}};};
    tx.oncomplete=()=>{db.close();resolve(result);};
    tx.onabort=()=>{db.close();reject(cause || tx.error || Error('本地观察保存失败，已有数据保留，请检查磁盘空间后继续'));};
    try{operation(tx,value=>{result=value;},listen);}catch(error){fail(error);}
  });
}
function ensureInitialized() {
  if(!initialized)initialized=(async()=>{
    const migrated=await transaction('readonly',(tx,done,on)=>on(tx.objectStore('meta').get('migrated'),done));
    if(!migrated){
      const legacy=(await chrome.storage.local.get(KEY))[KEY];
      await transaction('readwrite',(tx,_done,on)=>{
        const meta=tx.objectStore('meta');
        // Another extension context may have completed migration while storage was read.
        on(meta.get('migrated'),already=>{
          if(already)return;
          const records=tx.objectStore('records'),heads=tx.objectStore('heads');
          let sequence=legacy?.sequence || 0;
          for(const item of [...(legacy?.records || [])].sort((a,b)=>a.sequence-b.sequence)){
            if(!item.id || !Number.isSafeInteger(item.sequence))throw Error('旧观察记录格式异常，已保留原数据，请检查后重试');
            const record=storedObservation(item);
            records.put(record);heads.put(record.id,record.key);
            sequence=Math.max(sequence,record.sequence);
          }
          meta.put(sequence,'sequence');meta.put(true,'migrated');
        });
      });
    }
    // Only remove the legacy copy after the durable transaction commits. A failed
    // cleanup is harmless: the migration marker prevents reimport after restart.
    await chrome.storage.local.remove(KEY).catch(()=>{});
  })().catch(error=>{initialized=undefined;throw error;});
  return initialized;
}

export async function saveObservations(items) {
  await ensureInitialized();
  return transaction('readwrite',(tx,done,on)=>{
    const records=tx.objectStore('records'),heads=tx.objectStore('heads'),meta=tx.objectStore('meta');
    const changed=[];done(changed);
    on(meta.get('sequence'),savedSequence=>{
      let sequence=savedSequence || 0,offset=0;
      function next(){
        if(offset===items.length){meta.put(sequence,'sequence');return;}
        const input=items[offset++],key=observationKey(input);
        on(heads.get(key),id=>{
          const apply=previous=>{
            const result=mergeObservations({records:previous?[previous]:[],sequence},[input]);
            const latest=storedObservation(result.saved.records.at(-1));
            if(previous && result.saved.records.length===1 && previous.id!==latest.id)records.delete(previous.id);
            records.put(latest);heads.put(latest.id,key);
            sequence=result.saved.sequence;changed.push(...result.changed);next();
          };
          if(id)on(records.get(id),apply);else apply(null);
        });
      }
      next();
    });
  });
}
export async function observationStatus() {
  await ensureInitialized();
  return transaction('readonly',(tx,done,on)=>{
    const records=tx.objectStore('records'),result={count:0,latest:[]};done(result);
    on(records.index('source').count('feigua'),count=>{result.count=count;});
    on(records.index('sourceSequence').openCursor(IDBKeyRange.bound(['feigua',0],['feigua',Number.MAX_SAFE_INTEGER]),'prev'),cursor=>{
      if(cursor){result.latest.push(cursor.value);if(result.latest.length<5)cursor.continue();}
    });
  });
}
export async function pendingObservations() {
  await ensureInitialized();
  return transaction('readonly',(tx,done,on)=>on(tx.objectStore('records').index('pendingSequence').getAll(IDBKeyRange.bound([1,0],[1,Number.MAX_SAFE_INTEGER]),250),done));
}
export async function markObservationsQueued(ids) {
  await ensureInitialized();
  return transaction('readwrite',(tx,_done,on)=>{
    const records=tx.objectStore('records');
    for(const id of ids)on(records.get(id),item=>{if(item)records.put({...item,queuedId:id,pending:0});});
  });
}
export async function markObservationsUploaded(ids) {
  await ensureInitialized();
  return transaction('readwrite',(tx,_done,on)=>{
    const records=tx.objectStore('records');
    for(const id of ids)on(records.get(id),item=>{if(item)records.put(storedObservation({...item,uploadConfirmed:true}));});
  });
}
export async function cleanupObservations({now=Date.now(),protectedIds=[],protectedEntities=[],protectedSessions=[]}={}) {
  await ensureInitialized();
  const ids=new Set(protectedIds),entities=new Set(protectedEntities),sessions=new Set(protectedSessions);
  let after=null,deleted=0;
  for(;;){
    const result=await transaction('readwrite',(tx,done,on)=>{
      const records=tx.objectStore('records'),heads=tx.objectStore('heads');
      const result={scanned:0,deleted:0,after:null};done(result);
      const range=after?IDBKeyRange.bound(after,[now,[]],true,false):IDBKeyRange.upperBound([now,[]]);
      on(records.index('expiry').openCursor(range),cursor=>{
        if(!cursor)return;
        const item=cursor.value;result.scanned++;result.after=cursor.key;
        if(!ids.has(item.id) && !sessions.has(item.sessionId) && !entities.has(JSON.stringify([item.sessionId,item.entityKey]))){
          cursor.delete();result.deleted++;
          on(heads.get(item.key),id=>{if(id===item.id)heads.delete(item.key);});
        }
        if(result.scanned<250)cursor.continue();
      });
    });
    deleted+=result.deleted;
    if(result.scanned<250)return deleted;
    after=result.after;
  }
}
export async function exportObservations() {
  await ensureInitialized();
  return transaction('readonly',(tx,done,on)=>on(tx.objectStore('records').index('sequence').getAll(),done));
}

export function normalizeFeiguaObservation(row,page,sessionId,mode) {
  const metrics=row.metrics || {};
  const number=label=>parseCompactNumber(metrics[label]);
  const identity=row.videoId ? `video:${row.videoId}` : `account:${rowAccountKey(row)}`;
  return { schemaVersion:1, sessionId, mode, sourcePlatform:'feigua', accountPlatform:'douyin',
    entityKey:identity, viewKey:row.selectedTab || '', surface:page.surface || 'library', observedAt:page.capturedAt || new Date().toISOString(),
    pageUrl:page.pageUrl, authorName:row.authorName || '', avatarUrl:row.avatarUrl || '',
    profileUrl:row.profileUrl || '', followers:parseCompactNumber(row.followerCount),
    videoId:row.videoId || '', caption:row.title || '', coverUrl:row.coverUrl || '',
    durationSeconds:row.durationSeconds ?? null, likes:number('点赞'), comments:number('评论'),
    shares:number('分享'), favorites:number('收藏'), plays:number('播放'),
    spreadIndex:/^\d+(?:\.\d+)?$/.test(metrics['传播指数'] || '')?Number(metrics['传播指数']):null, publishedTimeText:metrics['发布时间'] || '',
    raw:row };
}
export function observationRecord(item) {
  const record=buildObservationRecord({observation:{...item,contentType:item.surface==='creator'?'unknown':'video',sourcePlatform:item.sourcePlatform,profileUrl:item.raw.douyinProfileUrl || '',beforeUrl:item.pageUrl,hashtags:item.raw.topics},profile:{followers:item.followers},runId:item.sessionId,feedIndex:item.sequence,isRelevant:false,decision:'observed',action:'collect'});
  record.record_id=item.id;
  record.comment_count=item.comments; record.share_count=item.shares; record.favorite_count=item.favorites;
  Object.assign(record.rpa_feedback,{source:item.mode==='automatic'?'feigua-video-library':'feigua-browser',collection_mode:item.mode,account_platform:'douyin',feigua_profile_url:item.profileUrl,unique_id:item.raw.uniqueId || '',play_count:item.plays,spread_index:item.spreadIndex,raw_fields:item.raw,surface:item.surface});
  return record;
}
export function mergeObservations(saved,items) {
  const records=(saved.records || []).map(item=>({...item,key:JSON.stringify([item.sourcePlatform,item.sessionId,item.surface,item.viewKey || '',item.entityKey])}));let sequence=saved.sequence || 0;const changed=[];
  for(const input of items) {
    const key=JSON.stringify([input.sourcePlatform,input.sessionId,input.surface,input.viewKey || '',input.entityKey]);
    const index=records.findLastIndex(item=>item.key===key);
    const previous=records[index];
    const comparable=item=>JSON.stringify({...item.raw,observedAt:undefined,pageUrl:undefined,profileUrl:undefined,videoDetailUrl:undefined});
    if(previous && comparable(previous)===comparable(input)){records[index]={...previous,lastObservedAt:input.observedAt};continue;}
    const item={...input,key,id:crypto.randomUUID(),sequence:++sequence,lastObservedAt:input.observedAt,firstObservedAt:previous?.firstObservedAt || input.observedAt};
    if(index>=0 && !(previous.uploadEligible && !previous.uploadConfirmed))records[index]=item;else records.push(item);
    changed.push(item);
  }
  const result={records,sequence};
  return {saved:result,changed};
}
export function normalizeDouyinObservation(observation,profile,sessionId) {
  const raw={...observation,profile:profile || null};
  return {schemaVersion:1,sessionId,mode:'automatic',sourcePlatform:'douyin',accountPlatform:'douyin',
    entityKey:observation.videoId || `${observation.beforeUrl || ''}:${observation.caption || ''}`,surface:'recommend',
    observedAt:observation.observedAt || new Date().toISOString(),pageUrl:observation.beforeUrl || '',
    authorName:observation.authorName || profile?.authorName || '',avatarUrl:profile?.avatarUrl || observation.avatarUrl || '',
    raw,uploadEligible:false};
}
