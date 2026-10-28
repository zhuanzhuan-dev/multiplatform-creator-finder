import { normalizeSourcePlatform } from './source-platform.js';

// Stable platform identities only. Display names and page URLs are not merge keys.
export function funnelScan(decision, observation, profile, owner, userId, pluginVersion, id, occurredAt) {
  if (owner?.runSettings?.dryRun) return null;
  const source = normalizeSourcePlatform(owner?.route?.platform || observation?.sourcePlatform || observation?.platform || 'douyin');
  if (source === 'unknown') return null;
  const raw = observation?.raw || {};
  const candidates = source === 'kuaishou'
    ? [['kuaishou_id', observation?.authorId]]
    : source === 'bilibili'
      ? [['bilibili_id', observation?.authorId || profile?.bilibiliMid]]
      : source === 'huxuan'
        ? [['wechat_channels_id', observation?.authorId]]
        : [['sec_uid', profile?.secUid || observation?.secUid || raw.secUid], ['uid', profile?.uid || observation?.uid || raw.uid],
          ['xingtu_id', observation?.xingtuId || raw.xingtuId], ['feigua_blogger_id', observation?.bloggerId || raw.bloggerId]];
  const identity = candidates.map(([kind, value]) => [kind, String(value || '').trim()])
    .find(([, value]) => value.length > 0 && value.length <= 200);
  if (!identity && !observation?.videoId && !observation?.authorName) return null;
  const platform = source === 'kuaishou' ? 'kuaishou' : source === 'bilibili' ? 'bilibili' : source === 'huxuan' ? 'wechat_channels' : 'douyin';
  return {
    id, userId: String(userId || ''), sessionKey: String(owner?.runId || ''),
    sourcePlatform: source, accountPlatform: platform,
    identityKind: identity?.[0] || null, identityValue: identity?.[1] || null,
    decisionCode: String(decision?.code || 'UNKNOWN').slice(0, 128), occurredAt,
    pluginVersion: String(pluginVersion || ''),
  };
}
