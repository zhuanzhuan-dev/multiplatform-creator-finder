import { normalizeSourcePlatform } from './source-platform.js';
export const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
export function historyTone(code = '') {
  const value=String(code).toUpperCase();
  if (value==='FEIGUA_OBSERVED') return 'review';
  if (value==='ACCEPTED') return 'good';
  if (value.includes('REVIEW') || value.includes('PANEL') || value.includes('MISSING') || value.includes('INVALID')) return 'review';
  return 'reject';
}
export function normalizeHistoryEntry(entry, fallbackPlatform = 'unknown') {
  const occurredAtMs=Date.parse(entry?.occurredAt || '');
  if (!Number.isFinite(occurredAtMs)) return null;
  return {
    id:String(entry.id || crypto.randomUUID()), occurredAtMs, occurredAt:new Date(occurredAtMs).toISOString(),
    runId:String(entry.runId || ''), runStartedAt:String(entry.runStartedAt || ''),
    sourcePlatform:normalizeSourcePlatform(entry.sourcePlatform || fallbackPlatform),
    code:String(entry.code || 'UNKNOWN').slice(0,128),
    reasons:Array.isArray(entry.reasons) ? entry.reasons.slice(0,4).map(r=>String(r).slice(0,2000)) : [],
    accountName:String(entry.accountName || '').slice(0,300),
    avatarUrl:String(entry.avatarUrl || '').slice(0,4000), profileUrl:String(entry.profileUrl || '').slice(0,4000)
  };
}
export function prepareLegacyHistory(saved, now = Date.now()) {
  const state=saved.draState || {};
  const entries=Array.isArray(saved.draDecisionHistory) ? saved.draDecisionHistory : Array.isArray(state.recentDecisions) ? state.recentDecisions : [];
  return entries.map((entry,index)=>normalizeHistoryEntry({...entry,
    id:entry.id || `legacy:${entry.runId || state.runId || ''}:${entry.occurredAt || ''}:${index}`,
    runId:entry.runId || state.runId, runStartedAt:entry.runStartedAt || state.startedAt
  },'douyin')).filter(entry=>entry && entry.occurredAtMs>now-HISTORY_WINDOW_MS && entry.occurredAtMs<=now);
}
export function historyMatches(entry, {sourcePlatform='',runId='',query=''} = {}) {
  if (sourcePlatform && entry.sourcePlatform!==sourcePlatform || runId && entry.runId!==runId) return false;
  const term=String(query).trim().toLocaleLowerCase('zh-CN');
  return !term || [entry.accountName,entry.code,...entry.reasons].join(' ').toLocaleLowerCase('zh-CN').includes(term);
}
