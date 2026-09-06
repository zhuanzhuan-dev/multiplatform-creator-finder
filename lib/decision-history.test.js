import test from "node:test";
import assert from "node:assert/strict";
import { MAX_RECENT_DECISIONS, normalizeDecisionHistory, prependDecision } from "./decision-history.js";

test("keeps enough recent decisions for the side panel to expand", () => {
  const history = Array.from({ length: MAX_RECENT_DECISIONS + 5 }, (_, index) => ({ id: index }));

  assert.equal(normalizeDecisionHistory(history).length, MAX_RECENT_DECISIONS);
  assert.deepEqual(prependDecision(history, { id: "new" }).slice(0, 2), [{ id: "new" }, { id: 0 }]);
  assert.equal(prependDecision(history, { id: "new" }).length, MAX_RECENT_DECISIONS);
});

test("normalizes an invalid stored decision history to an empty list", () => {
  assert.deepEqual(normalizeDecisionHistory(null), []);
});
