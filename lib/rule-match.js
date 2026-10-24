import { sourcePlatformLabel } from './source-platform.js';

const textList = values => [...new Set((values || []).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];

// Capture the completed judgment, never re-evaluate historical observations with today's rules.
export function captureRuleMatch(decision = {}, owner = {}, sourcePlatform = 'douyin') {
  const taskName = owner.route?.label || sourcePlatformLabel(sourcePlatform);
  const collectionOnly = /^(?:XINGTU_OBSERVED|XINGTU_PENDING_REVIEW|XINGTU_CANDIDATE_REVIEW|HUXUAN_)/.test(decision.code || '');
  return {
    taskName,
    ruleName: `${taskName}${collectionOnly ? '采集' : '筛选规则'}`,
    matchedItems: textList([...(decision.categories || []).map(category => category.name), ...(decision.matchedKeywords || [])]),
  };
}

export function normalizeRuleMatch(value) {
  if (!value || typeof value !== 'object' || typeof value.ruleName !== 'string') return null;
  return {
    taskName: String(value.taskName || '').slice(0, 300),
    ruleName: value.ruleName.slice(0, 300),
    matchedItems: textList(Array.isArray(value.matchedItems) ? value.matchedItems : []).map(item => item.slice(0, 300)),
  };
}
