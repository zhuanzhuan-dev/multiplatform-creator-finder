import test from "node:test";
import assert from "node:assert/strict";
import { contentTypeOf, contentSkipDecision } from "./content-type.js";
import { evaluateVideoRules } from "./rule-engine.js";
import { buildObservationRecord } from "./cloud.js";

test("only identified ordinary video can enter screening; ad is independent of media type", () => {
  for (const [observation, code] of [
    [{ contentType: "live" }, "LIVE_SKIPPED"],
    [{ contentType: "photo" }, "PHOTO_SKIPPED"],
    [{ contentType: "video", isAd: true }, "AD_SKIPPED"],
    [{ durationSeconds: 90, likes: 5000 }, "UNKNOWN_TYPE_SKIPPED"],
    [{ contentType: "photo", isLive: true }, "LIVE_SKIPPED"]
  ]) {
    const decision = evaluateVideoRules(observation, { includeLive: true });
    assert.equal(decision.code, code);
    assert.equal(decision.matched, false);
  }
  assert.equal(contentSkipDecision({ contentType: "video" }), null);
  assert.equal(contentTypeOf({ caption: "直播中，进入直播间", contentType: "video" }), "video");
  const record = buildObservationRecord({ observation: { contentType: "video", isAd: true } });
  assert.equal(record.content_type, "video");
  assert.equal(record.rpa_feedback.is_ad, true);
  assert.equal(buildObservationRecord({ observation: { contentType: "photo" } }).content_type, "photo");
});
