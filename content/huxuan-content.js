import { HUXUAN_CHANNEL as channel } from '../lib/huxuan-api.js';

let loop = null;
const pending = new Map();
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel || event.data.direction !== 'response') return;
  const request = pending.get(event.data.requestId);
  if (request) { pending.delete(event.data.requestId); clearTimeout(request.timer); request.resolve(event.data); }
});
function pageRequest(action, args = {}) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => {pending.delete(requestId);reject(Error('互选页面接口未响应，请刷新页面后继续'));},30000);
    pending.set(requestId,{resolve,timer});
    window.postMessage({channel,direction:'request',requestId,action,...args},location.origin);
  });
}
async function run(owner) {
  const send = async (type, data = {}) => {
    const result = await chrome.runtime.sendMessage({type,runId:owner.runId,loopId:owner.loopId,...data});
    if(result?.ok===false && type!=='DRA_WAIT') throw Error(result.error || '互选页面保存失败');
    return result;
  };
  try {
    let context;
    for (let attempt=0;attempt<20 && loop===owner;attempt++) {
      context = await pageRequest('status');
      if (context.ok) break;
      await send('DRA_WAIT',{until:Date.now()+500});
    }
    if (loop!==owner) return;
    if (!context?.ok) throw Error(context?.error || '互选列表尚未加载');
    if (owner.queryKey && owner.queryKey!==context.queryKey) throw Error('互选筛选条件或账号已变化，请结束本轮后重新开始');
    let pageNumber = owner.nextPage || context.pageNumber;
    while (loop===owner) {
      await send('DRA_PROGRESS',{phase:'read'});
      const result = await pageRequest('page',{pageNumber,queryKey:context.queryKey});
      if (loop!==owner) return;
      if (!result.ok) throw Error(result.error);
      const saved = await send('DRA_HUXUAN_PAGE',{page:result.page});
      if (loop!==owner || !saved?.continue) return;
      pageNumber++;
      const delay = owner.settings?.huxuanDelay || {minSeconds:4,maxSeconds:6};
      const seconds = delay.minSeconds + Math.random()*(delay.maxSeconds-delay.minSeconds);
      await send('DRA_PROGRESS',{phase:'wait'});
      const waited = await send('DRA_WAIT',{until:Date.now()+seconds*1000});
      if (!waited?.ok) return;
    }
  } catch (error) { if (loop===owner) await send('DRA_TICK_ERROR',{error:error.message}).catch(()=>{}); }
  finally { if (loop===owner) loop=null; }
}
chrome.runtime.onMessage.addListener((message,_sender,respond) => {
  if (message.type === 'DRA_LOOP_STATUS') { respond({ok:true,running:!!loop,runId:loop?.runId,loopId:loop?.loopId,visibilityState:document.visibilityState,hasFocus:document.hasFocus()}); return; }
  if (message.type === 'DRA_STOP_LOOP') {
    loop=null;
    window.postMessage({channel,direction:'request',requestId:crypto.randomUUID(),action:'cancel'},location.origin);
    respond({ok:true}); return;
  }
  if (message.type === 'DRA_START_LOOP') { const owner={...message};loop=owner;respond({ok:true});void run(owner); }
});
