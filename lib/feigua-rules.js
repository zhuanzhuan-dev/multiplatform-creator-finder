import { parseRowText, matchKeywords, DEFAULT_KEYWORDS } from './feigua-parser.js';

// Only use content fields, never unrelated metrics or a supplied searchText.
export function evaluateFeiguaRules(rows, rules = {}) {
  const text = rows.map(row => parseRowText(row.rawText || '', row).searchText).join('\n');
  const excluded = matchKeywords(text, rules.feiguaKeywords ?? DEFAULT_KEYWORDS);
  if (excluded.length) return { code: 'FEIGUA_EXCLUDED', matched: false, needsReview: false, reasons: [`命中负向排除词：${excluded.join('、')}`] };
  const hits = matchKeywords(text, rules.feiguaPositiveKeywords || []);
  if (hits.length) return { code: 'FEIGUA_MATCHED', matched: true, needsReview: false, reasons: [`命中正向关键词：${hits.join('、')}`] };
  return { code: 'FEIGUA_PENDING_REVIEW', matched: false, needsReview: true, reasons: [rules.feiguaPositiveKeywords?.length ? '未命中正向关键词，待人工确认' : '尚未配置正向关键词，待人工确认'] };
}
