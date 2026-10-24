import type { Decision } from '../sidepanel/types';
import { errorMessage } from './error-message';
import { formatLocalDateTime } from '../sidepanel/format';
import './decision-rule-match.css';

export function DecisionRuleMatch({ decision }: { decision: Decision }) {
  const match = decision.ruleMatch;
  if (!match) return <span>{decision.reasons?.map(errorMessage).join(' · ') || decision.code}</span>;
  const hit = decision.code === 'ACCEPTED' || decision.code === 'FEIGUA_MATCHED';
  const summary = match.matchedItems.length
    ? `${hit ? '命中' : '已识别'}：${match.matchedItems.join('、')}`
    : '查看判定依据';
  return <div className="decision-rule-match">
    <p className="rule-match-source">所用规则：{match.ruleName}</p>
    <details>
      <summary>{summary}</summary>
      {decision.runStartedAt ? <p>本轮开始：{formatLocalDateTime(decision.runStartedAt)}</p> : null}
      <ul>{(decision.reasons || []).map((condition, index) => <li key={`${index}:${condition}`}>{errorMessage(condition)}</li>)}</ul>
    </details>
  </div>;
}
