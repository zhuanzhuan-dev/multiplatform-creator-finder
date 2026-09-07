import { useEffect, useState } from 'react';

async function request(message: Record<string, unknown>) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw Error(result?.error || '操作失败');
  return result;
}
export function RawCaptureSettings() {
  const [enabled,setEnabled] = useState(false);
  const [samples,setSamples] = useState({count:0,bytes:0});
  const [label,setLabel] = useState('unconfirmed');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const refresh = async () => {
    const r=await request({type:'DRA_DEBUG_STATUS'});
    setEnabled(r.enabled);setSamples(r.samples);if(r.error)setNotice(r.error);
  };
  useEffect(()=>{void refresh().catch(e=>setNotice(e.message));},[]);
  const action = async (type:string) => {
    setBusy(true);setNotice('');
    try {
      const r=await request({type,label,enabled:!enabled});
      if(type==='DRA_EXPORT_RAW') {
        const blob=new Blob([JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),samples:r.samples},null,2)],{type:'application/json'});
        const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`推荐流原始采样-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
      await refresh();setNotice(type==='DRA_CAPTURE_RAW'?'当前卡片已保存':type==='DRA_CLEAR_RAW'?'采样已清空':type==='DRA_EXPORT_RAW'?'已导出 JSON':'采样设置已保存');
    }catch(e){setNotice(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  return <div className="raw-capture-settings">
    <label className="check"><input type="checkbox" checked={enabled} disabled={busy} onChange={()=>void action('DRA_SET_RAW_CAPTURE')} />保存推荐流原始采样</label>
    <p className="field-note">开启后，运行中自动保存当前卡片的 DOM、类型判断和可读取的页面原始字段，仅存本机。最多 200 条 / 25 MB，超限替换最早样本。</p>
    <label className="field">人工确认类型<select aria-label="人工确认类型" value={label} onChange={e=>setLabel(e.target.value)}><option value="unconfirmed">尚未确认</option><option value="video">视频</option><option value="live">直播（含图文直播）</option><option value="photo">图文</option><option value="ad">广告</option></select></label>
    <p className="field-note">选择你实际看到的类型，再点击采样。自动采样均标记为“尚未确认”。</p>
    <div className="bridge-actions"><button disabled={busy||!enabled} onClick={()=>void action('DRA_CAPTURE_RAW')}>采样当前卡片</button><button disabled={busy} onClick={()=>void action('DRA_EXPORT_RAW')}>导出采样</button><button disabled={busy} className="danger-text" onClick={()=>void action('DRA_CLEAR_RAW')}>清空采样</button></div>
    <p className="field-note">已保存 {samples.count} 条 · {(samples.bytes/1024/1024).toFixed(1)} MB <button disabled={busy} onClick={()=>void refresh().catch(e=>setNotice(e.message))}>刷新</button></p>
    <p className="field-note" role="status">{notice}</p>
  </div>;
}
