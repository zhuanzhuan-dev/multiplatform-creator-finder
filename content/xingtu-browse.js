import { collectCurrentPage, collectDetailPage, browsingSurface, pageAccessProblem } from './xingtu-page.js';

export function installXingtuBrowsing({isRunning,cancelAutomatic}) {
  let timer=null, stopped=false, last='', stable='', sending=false, waitingSince=null;
  const status=value=>{if(document.documentElement)document.documentElement.dataset.draXingtuBrowse=value;};
  status('ready');
  const send=message=>chrome.runtime.sendMessage(message);
  const schedule=()=>{if(stopped || timer!==null)return;timer=setTimeout(()=>{timer=null;return scan();},1200);};
  const waitForData=reason=>{
    stable='';
    waitingSince ??= Date.now();
    status(reason);
    if(Date.now()-waitingSince<60000)schedule();
    else status(`waiting-page-change:${reason}`);
  };
  async function scan() {
    if(stopped)return;
    if(sending){schedule();return;}
    sending=true;
    try {
      const surface=browsingSurface();
      const problem=pageAccessProblem();
      status(!surface?'unsupported':document.visibilityState!=='visible'?'background':problem || 'checking');
      if(!surface || document.visibilityState!=='visible' || problem){stable='';if(problem==='loading')waitForData('loading');return;}
      const config=await send({type:'DRA_XINGTU_BROWSE_STATUS',surface});
      if(!config?.enabled || config.automaticTab || isRunning()){status(config?.automaticTab?'automatic':`disabled:${JSON.stringify(config)}`);return;}
      const page=surface==='market'?collectCurrentPage():collectDetailPage(surface);
      if(page?.pendingImages){waitForData('waiting-image-urls');return;}
      if(!page?.rows?.length || page.diagnostics && page.diagnostics.candidateCount!==page.diagnostics.parsedCount){waitForData('waiting-rows');return;}
      waitingSince=null;
      page.surface=surface;
      const signature=JSON.stringify([surface,location.pathname,location.search,page.pageNumber,page.rows]);
      if(signature===last){status('unchanged');return;}
      if(signature!==stable){stable=signature;status('settling');schedule();return;}
      const result=await send({type:'DRA_XINGTU_BROWSE_PAGE',page});
      status(result?.skipped?'waiting-active':result?.ok?'saved':`error:${result?.error || 'unknown'}`);
      if(result?.ok && !result.skipped)last=signature;
      else if(result?.skipped)schedule();
    } catch(error) { status(`error:${error.message}`);void send({type:'DRA_XINGTU_BROWSE_ERROR',error:error.message || String(error)}).catch(()=>{}); }
    finally {sending=false;}
  }
  const observer=new MutationObserver(schedule);
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['src','srcset','data-src','data-original','data-lazy-src','aria-selected','aria-busy','class']});
  document.addEventListener('load',schedule,true);
  document.addEventListener('error',schedule,true);
  document.addEventListener('dra-xingtu-api-update',schedule);
  document.addEventListener('visibilitychange',schedule);
  window.addEventListener('popstate',()=>{last='';stable='';waitingSince=null;schedule();});
  const takeover=event=>{
    if(!event.isTrusted || !isRunning())return;
    const target=event.target instanceof Element?event.target:null;
    if(!target || target.closest('#dra-floating-launcher'))return;
    if(event.type==='click' && !target.closest('a,button,input,select,[role="tab"],[role="button"],.ant-pagination,.el-pager,.ant-select,li'))return;
    cancelAutomatic();
    void send({type:'DRA_XINGTU_TAKEOVER',reason:'你已接管星图页面，自动翻页已暂停'}).catch(()=>{});
    schedule();
  };
  document.addEventListener('click',takeover,true);
  document.addEventListener('change',takeover,true);
  chrome.storage.onChanged?.addListener((_changes,area)=>{if(area==='local')schedule();});
  schedule();
  return ()=>{stopped=true;clearTimeout(timer);observer.disconnect();};
}
