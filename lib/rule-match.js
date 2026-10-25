import { sourcePlatformLabel } from './source-platform.js';

const textList = values => [...new Set((values || []).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];

// Capture the completed judgment, never re-evaluate historical observations with today's rules.
export function captureRuleMatch(decision = {}, owner = {}, sourcePlatform = 'douyin') {
  const baseName = owner.route?.label || sourcePlatformLabel(sourcePlatform);
  const taskName = owner.taskId?.startsWith('task:') ? `${baseName} · ${owner.taskName}` : baseName;
  const collectionOnly = /^(?:XINGTU_OBSERVED|XINGTU_PENDING_REVIEW|XINGTU_CANDIDATE_REVIEW|HUXUAN_)/.test(decision.code || '');
  return {
    ...(owner.taskId?.startsWith('task:') ? {taskId:owner.taskId} : {}),
    taskName,
    ruleName: `${taskName}${collectionOnly ? '采集' : '筛选规则'}`,
    matchedItems: textList([...(decision.categories || []).map(category => category.name), ...(decision.matchedKeywords || [])]),
  };
}

export function normalizeRuleMatch(value) {
  if (!value || typeof value !== 'object' || typeof value.ruleName !== 'string') return null;
  return {
    ...(typeof value.taskId==='string' ? {taskId:value.taskId.slice(0,100)} : {}),
    taskName: String(value.taskName || '').slice(0, 300),
    ruleName: value.ruleName.slice(0, 300),
    matchedItems: textList(Array.isArray(value.matchedItems) ? value.matchedItems : []).map(item => item.slice(0, 300)),
  };
}
