import {profileIpFact,profileRequestIdentity} from './douyin-profile-api.js';

// 复用任务已有的调试连接，只读取网站已发出的资料响应。
// 按标签页隔离，避免分身之间串用同一达人的采集结果。
export function createProfileNetworkCapture(debuggerApi) {
  const enabled=new Set(),pending=new Map(),facts=new Map(),diagnostics=new Map();
  const status=tabId=>{if(!diagnostics.has(tabId))diagnostics.set(tabId,{responses:0,captured:0,error:''});return diagnostics.get(tabId);};
  let sequence=0;
  const key=(tabId,requestId)=>`${tabId}:${requestId}`;
  async function onEvent(source,method,params) {
    const tabId=source.tabId;
    if(!enabled.has(tabId))return;
    const id=key(tabId,params.requestId);
    if(method==='Network.requestWillBeSent'){
      const secUid=profileRequestIdentity(params.request.url,params.request.method);
      if(secUid){pending.set(id,{tabId,source,secUid,order:++sequence});if(pending.size>256)pending.delete(pending.keys().next().value);}
      return;
    }
    const request=pending.get(id);
    if(!request)return;
    if(method==='Network.responseReceived'){
      if(params.response.status<200 || params.response.status>=300)pending.delete(id);
      else {request.success=true;status(tabId).responses++;}
    } else if(method==='Network.loadingFailed')pending.delete(id);
    else if(method==='Network.loadingFinished'){
      pending.delete(id);
      if(!request.success)return;
      try {
        const result=await debuggerApi.sendCommand(request.source,'Network.getResponseBody',{requestId:params.requestId});
        const body=result.base64Encoded?new TextDecoder().decode(Uint8Array.from(atob(result.body),char=>char.charCodeAt(0))):result.body;
        const fact=profileIpFact(request.secUid,JSON.parse(body));
        if(!fact || !enabled.has(tabId))return;
        const cache=facts.get(tabId) || new Map();
        if((cache.get(request.secUid)?.order || 0)>request.order)return;
        cache.delete(request.secUid);cache.set(request.secUid,{order:request.order,fact});
        if(cache.size>100)cache.delete(cache.keys().next().value);
        facts.set(tabId,cache);status(tabId).captured++;status(tabId).error='';
      } catch(error) {status(tabId).error=String(error?.message || error).slice(0,160);}
    }
  }
  debuggerApi.onEvent.addListener((source,method,params)=>onEvent(source,method,params));
  return {
    enable:async tabId=>{if(enabled.has(tabId))return;await debuggerApi.sendCommand({tabId},'Network.enable',{maxTotalBufferSize:4*1024*1024,maxResourceBufferSize:1024*1024});enabled.add(tabId);},
    status:tabId=>({...status(tabId)}),
    read:(tabId,secUid)=>facts.get(tabId)?.get(secUid)?.fact || null,
    detach:tabId=>{enabled.delete(tabId);for(const [id,request] of pending)if(request.tabId===tabId)pending.delete(id);},
    clear:tabId=>{enabled.delete(tabId);facts.delete(tabId);diagnostics.delete(tabId);for(const [id,request] of pending)if(request.tabId===tabId)pending.delete(id);},
  };
}
