import { HUXUAN_PROFILE_DATASETS, huxuanDateRange } from './huxuan-api.js';

export const huxuanCaptureKey = (authorId, dataset, pageIndex = null) => `${authorId}:${dataset}:${pageIndex ?? ''}`;

// Each endpoint/page is durable before the next request. The list-page cursor
// advances only after every creator's homepage has been saved.
export async function collectHuxuanProfiles({rows, checkpoint = {}, request, save, progress, wait, active}) {
  const completed = {...checkpoint.completed};
  const authors = {...checkpoint.authors};
  const range = checkpoint.range || huxuanDateRange();
  const capture = async (row, dataset, pageIndex = null, validate = () => {}) => {
    const key = huxuanCaptureKey(row.authorId,dataset,pageIndex);
    if (completed[key]) {validate(completed[key]);return completed[key];}
    if (!active()) throw Error('互选采集已暂停');
    await progress(row.authorName,dataset);
    const result = dataset === 'list' ? {ok:true,capture:{authorId:row.authorId,dataset,status:'available',capturedAt:new Date().toISOString(),data:row.listFields}} : await request(row.authorId,dataset,{pageIndex,...range});
    if (!active()) throw Error('互选采集已暂停');
    if (!result.ok && !result.unavailable) throw Error(result.error || '互选主页采集失败');
    const value = result.ok ? result.capture : {authorId:row.authorId,dataset,pageIndex,status:'unavailable',capturedAt:new Date().toISOString(),error:result.error,data:null};
    validate(huxuanCaptureSummary(value));
    const summary = await save(row,value,{range});
    completed[key] = summary;
    if (dataset !== 'list') await wait();
    return summary;
  };
  for (const row of rows) {
    await capture(row,'list');
    if (authors[row.authorId]) continue;
    for (const dataset of HUXUAN_PROFILE_DATASETS) await capture(row,dataset);
    // The homepage exposes all videos and commercial cases over a 180-day
    // date range; commercial cases can contain metrics absent from all-videos.
    for (const dataset of ['videos:0','videos:1']) {
      let received = 0;
      const fingerprints = new Set();
      for (let pageIndex = 0;;pageIndex++) {
        const result = await capture(row,dataset,pageIndex, value => {
          if (value.status === 'unavailable') return;
          if (value.count === 0 && received < value.total) throw Error('互选作品分页提前返回空页，已保存进度，请稍后继续');
          if (value.count && fingerprints.has(value.fingerprint)) throw Error('互选作品接口重复返回同一页，已保存进度，请稍后继续');
        });
        if (result.status === 'unavailable') break;
        fingerprints.add(result.fingerprint);
        received += result.count;
        if (received >= result.total) break;
      }
    }
    await save(row,{authorId:row.authorId,dataset:'complete',status:'available',capturedAt:new Date().toISOString(),data:{range}}, {range});
    authors[row.authorId] = true;
  }
  return {range};
}

export function huxuanCaptureSummary(capture) {
  const videos = capture.data?.video_list;
  return {status:capture.status,...(Array.isArray(videos)?{count:videos.length,total:capture.data.total_cnt,fingerprint:JSON.stringify(videos.map(v=>v.export_id))}:{})};
}

// Keep complete responses below the existing ingestion body's byte budget.
// Oversized sections are losslessly reassembled by joining fragments in order
// and parsing the resulting JSON; ordinary sections remain structured JSON.
export function huxuanCaptureRows(row, capture) {
  const {listFields: _list, ...preview} = row;
  const key = huxuanCaptureKey(row.authorId,capture.dataset,capture.pageIndex);
  const serialized = JSON.stringify(capture.data ?? null);
  const encoder = new TextEncoder();
  if (encoder.encode(serialized).length <= 90_000) return [{...preview,captureKey:key,capture}];
  const fragments=[];let fragment='',bytes=0;
  for (const character of serialized) {
    const length=encoder.encode(character).length;
    if (bytes+length>90_000) {fragments.push(fragment);fragment='';bytes=0;}
    fragment+=character;bytes+=length;
  }
  if(fragment)fragments.push(fragment);
  return fragments.map((data,index)=>({...preview,captureKey:`${key}:fragment:${index}`,capture:{...capture,data,encoding:'json-fragments',fragmentIndex:index,fragmentCount:fragments.length}}));
}
