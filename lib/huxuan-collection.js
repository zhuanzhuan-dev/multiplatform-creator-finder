import { buildObservationRecord } from './cloud.js';

export function normalizeHuxuanObservation(row,page,sessionId) {
  return {schemaVersion:1,sessionId,mode:'automatic',sourcePlatform:'huxuan',accountPlatform:'wechat_channels',entityKey:row.authorId,surface:'market',observedAt:page.capturedAt,pageUrl:page.pageUrl,authorId:row.authorId,authorName:row.authorName,avatarUrl:row.avatarUrl,profileUrl:row.profileUrl,followers:null,raw:row,uploadEligible:true};
}
export function huxuanObservationRecord(item) {
  const row=item.raw;
  const record=buildObservationRecord({observation:{...item,sourcePlatform:'huxuan',contentType:'unknown',beforeUrl:item.pageUrl,hashtags:row.tags},runId:item.sessionId,feedIndex:item.sequence,isRelevant:true,decision:'keep',action:'collect',extra:{finderDecision:'HUXUAN_CANDIDATE_REVIEW',reasons:['腾讯互选视频号列表候选，待研究台复核']}});
  record.record_id=item.id;
  Object.assign(record,{source:'xingtu',source_platform:'huxuan',account_platform:'wechat_channels',wechat_channels_id:row.authorId,avatar_url:row.avatarUrl,quote_1_60s:row.shortPrice,quote_60s_plus:row.longPrice,content_tags:row.tags});
  Object.assign(record.rpa_feedback,{source:'huxuan-author-market',source_platform:'huxuan',account_platform:'wechat_channels',wechat_channels_id:row.authorId,followers_text:row.followerCount,city:row.city,synopsis:row.synopsis,raw_fields:row,review_required:true});
  return record;
}
