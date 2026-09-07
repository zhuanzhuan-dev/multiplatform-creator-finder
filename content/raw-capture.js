import { rawCardSnapshot } from '../lib/raw-sample.js';
let enabled = false;
chrome.storage.local.get('draDebugSettings').then(s=>{enabled=s.draDebugSettings?.rawCapture===true;});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.draDebugSettings)enabled=changes.draDebugSettings.newValue?.rawCapture===true;});
export function rawCaptureEnabled(){return enabled;}
export async function captureCurrentRaw(observation) {
  const parser=globalThis.DouyinAutoFinderParser;
  const card=parser.visibleFeedItem(document);
  const sample=rawCardSnapshot(card,observation);
  const id=crypto.randomUUID();
  const structured=await new Promise(resolve=>{
    let timer;
    const finish=value=>{clearTimeout(timer);window.removeEventListener('message',listener);resolve(value);};
    const listener=event=>{if(event.source===window&&event.data?.channel==='DOUYIN_AUTO_FINDER_PAGE'&&event.data?.direction==='response'&&event.data?.id===id)finish(event.data.result);};
    window.addEventListener('message',listener);timer=setTimeout(()=>finish({candidates:[],reason:'page data timed out'}),1000);
    window.postMessage({channel:'DOUYIN_AUTO_FINDER_PAGE',direction:'request',id,command:'GET_FEED_RAW',payload:{videoId:observation?.videoId||''}},'*');
  });
  const current=parser.parseCurrentFeed(document);
  if (parser.visibleFeedItem(document)!==card || current?.videoId!==observation?.videoId) throw Error('页面已切换，本次采样已取消');
  return {...sample,sourcePlatform:'douyin',structured,sourceUrl:location.origin+location.pathname,version:chrome.runtime.getManifest().version};
}
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(message?.type!=='DRA_CAPTURE_SAMPLE')return;
  if(!enabled){respond({ok:false,error:'请先开启原始数据采样'});return;}
  const observation=globalThis.DouyinAutoFinderParser.parseCurrentFeed(document);
  captureCurrentRaw(observation).then(sample=>respond({ok:true,sample})).catch(e=>respond({ok:false,error:e.message}));return true;
});
