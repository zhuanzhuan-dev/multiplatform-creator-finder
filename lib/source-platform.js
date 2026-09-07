export const SOURCE_PLATFORMS = Object.freeze({ douyin:'抖音', kuaishou:'快手', feigua:'飞瓜', xingtu:'星图', unknown:'来源未确认' });
export function normalizeSourcePlatform(value) {
  const text=String(value || '').trim().toLowerCase();
  if (Object.hasOwn(SOURCE_PLATFORMS,text)) return text;
  return Object.entries(SOURCE_PLATFORMS).find(([,name])=>name===text)?.[0] || 'unknown';
}
export function sourcePlatformLabel(value) { return SOURCE_PLATFORMS[normalizeSourcePlatform(value)]; }
