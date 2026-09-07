export const RAW_LIMITS = { count:200, bytes:25*1024*1024, sampleBytes:1024*1024 };
const database = 'dra-local-raw-samples';
function openStore() {
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(database,1);
    r.onupgradeneeded=()=>r.result.createObjectStore('samples',{keyPath:'id',autoIncrement:true});
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
export async function rawSamples(action, value) {
  const db=await openStore();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('samples',action==='list'||action==='status'?'readonly':'readwrite');
    const store=tx.objectStore('samples');let result;
    tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||Error('本地采样保存失败'));};
    if(action==='clear'){store.clear();result={count:0,bytes:0};return;}
    if(action==='add'){
      const bytes=new TextEncoder().encode(JSON.stringify(value)).byteLength;
      if(bytes>RAW_LIMITS.sampleBytes){tx.abort();return;}
      store.add({...value,bytes});
    }
    const request=store.getAll();
    request.onsuccess=()=>{
      const all=request.result;
      if(action==='list'){result=all;return;}
      let bytes=all.reduce((sum,row)=>sum+row.bytes,0),count=all.length;
      if(action==='add')for(const row of all){if(count<=RAW_LIMITS.count&&bytes<=RAW_LIMITS.bytes)break;store.delete(row.id);bytes-=row.bytes;count--;}
      result={count,bytes};
    };
  });
}
