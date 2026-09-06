export const MAX_RECENT_DECISIONS = 100;

export function normalizeDecisionHistory(value) {
  return Array.isArray(value) ? value.slice(0, MAX_RECENT_DECISIONS) : [];
}

export function prependDecision(history, entry) {
  return [entry, ...normalizeDecisionHistory(history)].slice(0, MAX_RECENT_DECISIONS);
}
