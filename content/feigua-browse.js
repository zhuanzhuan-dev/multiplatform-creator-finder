import { collectCurrentPage, collectDetailPage, browsingSurface, pageAccessProblem } from './feigua-page.js';
// Passive collection never clicks or changes the page. Mutation bursts settle twice.
export function installFeiguaBrowsing({isRunning,cancelAutomatic}) {
  let timer=null, stopped=false, last='', stable='', sending=false;
  const status=value=>{if(document.documentElement)document.documentElement.dataset.draFeiguaBrowse=value;};
  status('ready');
  const send=message=>chrome.runtime.sendMessage(message);
  const schedule=()=>{if(stopped || timer!==null)return;timer=setTimeout(()=>{timer=null;return scan();},1200);};
  async function scan() {
    if(stopped)return;
    if(sending){schedule();return;}
    sending=true;
    try {
      const surface=browsingSurface();
      const problem=pageAccessProblem();
      status(!surface?'unsupported':document.visibilityState!=='visible'?'background':problem || 'checking');
      if(!surface || document.visibilityState!=='visible' || problem){stable='';if(problem==='loading')schedule();return;}
      const config=await send({type:'DRA_FEIGUA_BROWSE_STATUS',surface});
      if(!config?.enabled || config.automaticTab || isRunning()){status(config?.automaticTab?'automatic':`disabled:${JSON.stringify(config)}`);return;}
      const page=surface==='library'?collectCurrentPage():collectDetailPage(surface);
      if(page?.pendingImages){stable='';status('waiting-images');schedule();return;}
      if(!page?.rows?.length){status('no-data');return;}
      page.surface=surface;
      const signature=JSON.stringify([surface,location.hash.split('?')[0],page.rows]);
      if(signature===last){status('unchanged');return;}
      if(signature!==stable){stable=signature;status('settling');schedule();return;}
      const result=await send({type:'DRA_FEIGUA_BROWSE_PAGE',page});
      status(result?.skipped?'waiting-active':result?.ok?'saved':`error:${result?.error || 'unknown'}`);
      if(result?.ok && !result.skipped)last=signature;
      else if(result?.skipped)schedule();
    } catch(error) { status(`error:${error.message}`);void send({type:'DRA_FEIGUA_BROWSE_ERROR',error:error.message || String(error)}).catch(()=>{}); }
    finally {sending=false;}
  }
  const observer=new MutationObserver(schedule);
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['src','aria-selected','class']});
  document.addEventListener('visibilitychange',schedule);
  window.addEventListener('hashchange',()=>{last='';stable='';schedule();});
  // Script-generated pagination is untrusted and never treated as user takeover.
  const takeover=event=>{
    if(!event.isTrusted || !isRunning())return;
    const target=event.target instanceof Element?event.target:null;
    if(!target || target.closest('#dra-floating-launcher'))return;
    if(event.type==='click' && !target.closest('a,button,input,select,[role="tab"],.el-pager,.el-checkbox,.el-radio,.el-tag,.sort-title,.order,.el-select,li'))return;
    cancelAutomatic();
    void send({type:'DRA_FEIGUA_TAKEOVER',reason:'你已接管飞瓜页面，自动翻页已暂停'}).catch(()=>{});
    schedule();
  };
  document.addEventListener('click',takeover,true);
  document.addEventListener('change',takeover,true);
  chrome.storage.onChanged?.addListener((_changes,area)=>{if(area==='local')schedule();});
  schedule();
  return ()=>{stopped=true;clearTimeout(timer);observer.disconnect();};
}
