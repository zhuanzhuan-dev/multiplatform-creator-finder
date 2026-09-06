import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIngestBody,
  buildObservationRecord,
  classifyIngestStatus,
  createCloudClient,
  encodeIngestBody,
  functionUrl,
  hashtagsFrom,
  ingestResultSets,
  normalizeAuthorName,
  pairedAuthorHref,
  pairUrlFor,
  shrinkRecordsToByteLimit,
} from "./cloud.js";

test("author name strips leading @ and collapses spaces", () => {
  assert.equal(normalizeAuthorName("@@@  美食日记  "), "美食日记");
});

test("author_href stays empty unless name and href are both present", () => {
  assert.deepEqual(pairedAuthorHref("", "https://www.douyin.com/user/abc"), { author: "", author_href: "" });
  assert.deepEqual(pairedAuthorHref("店长", ""), { author: "店长", author_href: "" });
  assert.deepEqual(
    pairedAuthorHref("@店长", "https://www.douyin.com/user/abc"),
    { author: "店长", author_href: "https://www.douyin.com/user/abc" },
  );
});

test("hashtags keep caption tags and normalize list items", () => {
  assert.deepEqual(
    hashtagsFrom({ hashtags: ["#美食", "探店"], caption: "今晚 #夜宵 真香" }),
    ["#美食", "#探店", "#夜宵"],
  );
});

test("observation record matches ingest contract v2", () => {
  const record = buildObservationRecord({
    observation: {
      contentType: "video",
      videoId: "751234567890",
      caption: "探店 #成都",
      authorName: "@小馆",
      profileUrl: "https://www.douyin.com/user/sec123",
      likes: 4200,
      durationSeconds: 88,
      dwellSeconds: 30,
      beforeUrl: "https://www.douyin.com/?recommend=1&from_nav=1",
      afterUrl: "https://www.douyin.com/?recommend=1&from_nav=1",
      scrollDelta: 800,
      transitionOk: true,
      observedAt: "2026-09-02T12:00:00.000Z",
      hashtags: ["#探店"],
    },
    profile: { authorName: "小馆", profileUrl: "https://www.douyin.com/user/sec123", followers: 12000, averageLikes: 3800 },
    feedIndex: 3,
    runId: "run-1",
    isRelevant: true,
    decision: "keep",
    action: "watch_then_next",
    score: { score: 42, level: "A" },
    extra: { finderDecision: "ACCEPTED", reasons: ["视频 88 秒"] },
  });

  assert.equal(record.contract_version, 2);
  assert.equal(typeof record.record_id, "string");
  assert.ok(record.record_id.length >= 1);
  assert.equal(record.feed_index, 3);
  assert.equal(record.is_relevant, true);
  assert.equal(record.decision, "keep");
  assert.equal(record.action, "watch_then_next");
  assert.equal(record.author, "小馆");
  assert.equal(record.author_href, "https://www.douyin.com/user/sec123");
  assert.equal(record.aweme_id, "751234567890");
  assert.equal(record.like_count, 4200);
  assert.equal(record.duration_seconds, 88);
  assert.equal(record.dwell_seconds, 30);
  assert.equal(record.interest_score, 42);
  assert.equal(record.content_type, "video");
  assert.equal(record.transition_ok, true);
  assert.equal(record.before_url, "https://www.douyin.com/?recommend=1&from_nav=1");
  assert.equal(record.after_url, "https://www.douyin.com/?recommend=1&from_nav=1");
  assert.equal(record.scroll_delta, 800);
  assert.ok(record.hashtags.includes("#探店"));
  assert.ok(record.hashtags.includes("#成都"));
  assert.equal(record.rpa_feedback.source, "douyin-feed-finder");
  assert.equal(record.rpa_feedback.followers, 12000);
  for (const key of Object.keys(record)) {
    assert.notEqual(key.toLowerCase(), "cookie");
    assert.notEqual(key.toLowerCase(), "authorization");
  }
});

test("observation transition fields stay empty until the page reports a real result", () => {
  const record = buildObservationRecord({
    observation: { videoId: "751234567890", beforeUrl: "https://www.douyin.com/?recommend=1&from_nav=1" },
    feedIndex: 1,
  });
  assert.equal(record.before_url, "https://www.douyin.com/?recommend=1&from_nav=1");
  assert.equal(record.after_url, "");
  assert.equal(record.scroll_delta, null);
  assert.equal(record.transition_ok, null);
});

test("ingest body uses contract 2 and keeps plugin identity", () => {
  const body = buildIngestBody({
    sessionId: "11111111-2222-4333-8444-555555555555",
    pluginVersion: "1.0.0",
    hostFingerprint: "abcd1234abcd1234",
    startedAt: "2026-09-02T12:00:00.000Z",
    records: [{ record_id: "r1", feed_index: 1, is_relevant: false, decision: "skip", action: "skip" }],
  });
  assert.equal(body.contract_version, 2);
  assert.equal(body.client.plugin_version, "1.0.0");
  assert.equal(body.client.host_fingerprint, "abcd1234abcd1234");
  assert.equal(body.records.length, 1);
  assert.ok(encodeIngestBody(body).includes("\"contract_version\":2"));
});

test("byte limiter halves oversized batches", () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ id: `r${index}`, blob: "x".repeat(80) }));
  const encoded = shrinkRecordsToByteLimit(rows, (list) => JSON.stringify(list).padEnd(500_000, "y"));
  assert.ok(encoded.length < rows.length);
  assert.ok(encoded.length >= 1);
});

test("ingest acknowledgement sets accepted and rejected", () => {
  const sets = ingestResultSets({
    accepted: ["a"],
    duplicated: ["b"],
    rejected: [{ id: "c", reason: "bad" }],
  });
  assert.equal(sets.accepted.has("a"), true);
  assert.equal(sets.duplicated.has("b"), true);
  assert.equal(sets.rejected.get("c"), "bad");
});

test("status classification matches no_swipe retry policy", () => {
  assert.equal(classifyIngestStatus(401), "auth_error");
  assert.equal(classifyIngestStatus(429), "retry");
  assert.equal(classifyIngestStatus(400), "rejected");
  assert.equal(classifyIngestStatus(500), "retry");
  assert.equal(classifyIngestStatus(200), "ok");
});

test("cloud urls point at the shared supabase project", () => {
  assert.equal(functionUrl("ingest"), "https://kigrzhmcphrkqtuqthwb.supabase.co/functions/v1/ingest");
  assert.equal(pairUrlFor("XK7-P2M"), "https://whislte.cc.cd/pair?code=XK7-P2M");
});

test("ingest client posts the no_swipe contract with device token", async () => {
  const calls = [];
  const client = createCloudClient(undefined, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ accepted: ["r1"], duplicated: [], rejected: [] }),
      };
    },
  });
  const result = await client.ingest("nsd_test_token", { contract_version: 2, records: [] });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "https://kigrzhmcphrkqtuqthwb.supabase.co/functions/v1/ingest");
  assert.equal(calls[0].options.headers.authorization, "Bearer nsd_test_token");
  assert.equal(calls[0].options.headers.apikey.startsWith("sb_publishable_"), true);
  assert.match(calls[0].options.body, /"contract_version":2/);
});
