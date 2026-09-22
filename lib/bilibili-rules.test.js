import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BILIBILI_RULES,
  decideBilibili,
  evaluateBilibiliVideoRules,
  mergeBilibiliRules,
  validateBilibiliRules
} from "./bilibili-rules.js";
import { mapBilibiliPopularItem } from "./bilibili-api.js";

function video(patch = {}) {
  return {
    sourcePlatform: "bilibili",
    contentType: "video",
    videoId: "BV1xx411c7mD",
    authorId: "12345",
    authorName: "美食探店UP",
    caption: "周末美食探店合集",
    tname: "美食",
    durationSeconds: 120,
    plays: 150_000,
    comments: 80,
    pubdateSeconds: Math.floor(Date.now() / 1000) - 2 * 86400,
    ...patch
  };
}

test("default bilibili rules enforce play and duration gates", () => {
  assert.deepEqual(DEFAULT_BILIBILI_RULES.playRules.reject, [{ plays: 10_000, playsOp: "<", days: 3, daysOp: ">" }]);
  assert.deepEqual(DEFAULT_BILIBILI_RULES.playRules.prefer, [{ plays: 100_000, playsOp: ">=", days: 3, daysOp: "<=" }]);
  assert.equal(DEFAULT_BILIBILI_RULES.hard.minVideoDurationSeconds, 60);
  assert.equal(DEFAULT_BILIBILI_RULES.includeDigital, false);
});

test("rejects low plays only after the rule's age", () => {
  const young = evaluateBilibiliVideoRules(video({ plays: 9_999, pubdateSeconds: Math.floor(Date.now() / 1000) - 3600 }), DEFAULT_BILIBILI_RULES);
  assert.equal(young.code, "PLAYS_REVIEW");
  assert.equal(young.needsReview, true);
  const old = evaluateBilibiliVideoRules(video({ plays: 9_999, pubdateSeconds: Math.floor(Date.now() / 1000) - 4 * 86400 }), DEFAULT_BILIBILI_RULES);
  assert.equal(old.code, "PLAYS_HARD_REJECT");
  assert.equal(old.matched, false);
});

test("rejects short videos under one minute", () => {
  const result = evaluateBilibiliVideoRules(video({ durationSeconds: 45 }), DEFAULT_BILIBILI_RULES);
  assert.equal(result.code, "VIDEO_TOO_SHORT");
});

test("switched compare marks change which videos match", () => {
  const rules = mergeBilibiliRules({
    playRules: {
      reject: [{ plays: 10_000, playsOp: "<=", days: 3, daysOp: ">=" }],
      prefer: [{ plays: 100_000, playsOp: ">", days: 1, daysOp: "<" }]
    }
  });
  const matched = evaluateBilibiliVideoRules(video({ plays: 10_000, pubdateSeconds: Math.floor(Date.now() / 1000) - 4 * 86400 }), rules);
  assert.equal(matched.code, "PLAYS_HARD_REJECT");
  const youngHit = evaluateBilibiliVideoRules(video({ plays: 100_001, pubdateSeconds: Math.floor(Date.now() / 1000) - 12 * 3600 }), rules);
  assert.equal(youngHit.code, "HARD_FILTER_PASSED");
});

test("reject rules are OR across rows and AND inside a row", () => {
  const now = Date.now();
  const published = (days) => Math.floor(now / 1000) - days * 86400;
  const rules = mergeBilibiliRules({
    playRules: {
      reject: [
        { plays: 10_000, playsOp: "<", days: 3, daysOp: ">" },
        { plays: 100_000, playsOp: "<", days: 15, daysOp: ">" }
      ],
      prefer: [{ plays: 100_000, playsOp: ">=", days: 3, daysOp: "<=" }]
    }
  });
  assert.equal(evaluateBilibiliVideoRules(video({ plays: 9_999, pubdateSeconds: published(4) }), rules, now).code, "PLAYS_HARD_REJECT");
  assert.equal(evaluateBilibiliVideoRules(video({ plays: 50_000, pubdateSeconds: published(16) }), rules, now).code, "PLAYS_HARD_REJECT");
  assert.equal(evaluateBilibiliVideoRules(video({ plays: 50_000, pubdateSeconds: published(10) }), rules, now).code, "PLAYS_REVIEW");
  assert.equal(evaluateBilibiliVideoRules(video({ plays: 5_000, pubdateSeconds: published(1) }), rules, now).code, "PLAYS_REVIEW");
  assert.equal(evaluateBilibiliVideoRules(video({ plays: 120_000, pubdateSeconds: published(2) }), rules, now).code, "HARD_FILTER_PASSED");
});

test("exclusive operators do not reject values sitting on the threshold", () => {
  const now = 1_700_000_000_000;
  const published = (days) => now / 1000 - days * 86400;
  const rules = mergeBilibiliRules({
    playRules: {
      reject: [{ plays: 100_000, playsOp: "<", days: 15, daysOp: ">" }],
      prefer: []
    }
  });
  assert.equal(evaluateBilibiliVideoRules(video({ plays: 100_000, pubdateSeconds: published(16) }), rules, now).code, "PLAYS_REVIEW");
  assert.equal(evaluateBilibiliVideoRules(video({ plays: 99_999, pubdateSeconds: published(15) }), rules, now).code, "PLAYS_REVIEW");
  assert.equal(evaluateBilibiliVideoRules(video({ plays: 99_999, pubdateSeconds: published(16) }), rules, now).code, "PLAYS_HARD_REJECT");
});

test("plays between reject and prefer lines go to review", () => {
  const result = evaluateBilibiliVideoRules(video({ plays: 50_000 }), DEFAULT_BILIBILI_RULES);
  assert.equal(result.matched, true);
  assert.equal(result.needsReview, true);
  assert.equal(result.code, "PLAYS_REVIEW");
});

test("partition and keywords match separately, either one counts", () => {
  const byPartition = evaluateBilibiliVideoRules(video({
    tname: "美食",
    caption: "今天随便聊聊",
    authorName: "小王"
  }), DEFAULT_BILIBILI_RULES);
  assert.equal(byPartition.code, "HARD_FILTER_PASSED");
  assert.deepEqual(byPartition.matchedGroups, ["food"]);

  const byKeyword = evaluateBilibiliVideoRules(video({
    tname: "游戏",
    caption: "周末探店",
    authorName: "小王"
  }), DEFAULT_BILIBILI_RULES);
  assert.equal(byKeyword.code, "HARD_FILTER_PASSED");
  assert.deepEqual(byKeyword.matchedGroups, ["food"]);

  const keywordIgnoresPartition = evaluateBilibiliVideoRules(video({
    tname: "生活",
    caption: "今天随便聊聊",
    authorName: "小王"
  }), mergeBilibiliRules({ contentBlacklist: ["生活"] }));
  assert.notEqual(keywordIgnoresPartition.code, "CONTENT_EXCLUDED");
});

test("excludes anime and movie partition content", () => {
  assert.equal(evaluateBilibiliVideoRules(video({ tname: "动漫", caption: "新番速看" }), DEFAULT_BILIBILI_RULES).code, "CONTENT_EXCLUDED");
  assert.equal(evaluateBilibiliVideoRules(video({ caption: "院线电影解说" }), DEFAULT_BILIBILI_RULES).code, "CONTENT_EXCLUDED");
  assert.equal(evaluateBilibiliVideoRules(video({ isOgv: true }), DEFAULT_BILIBILI_RULES).code, "CONTENT_EXCLUDED");
});

test("digital-only matches are skipped unless includeDigital", () => {
  const digital = video({ caption: "手机开箱评测", tname: "数码", authorName: "数码评测" });
  assert.equal(evaluateBilibiliVideoRules(digital, DEFAULT_BILIBILI_RULES).code, "DIGITAL_EXCLUDED");
  assert.equal(evaluateBilibiliVideoRules(digital, mergeBilibiliRules({ includeDigital: true })).matched, true);
});

test("decideBilibili keeps missing followers for review after play gate", () => {
  const result = decideBilibili(video(), { followers: null }, DEFAULT_BILIBILI_RULES);
  assert.equal(result.matched, true);
  assert.equal(result.needsReview, true);
  assert.equal(result.code, "ACCEPTED_REVIEW");
});

test("maps popular items with feedSurface popular", () => {
  const item = mapBilibiliPopularItem({
    bvid: "BV1yy411c7mD",
    title: "热门视频",
    pic: "https://example.com/c.jpg",
    duration: 200,
    pubdate: 1_700_000_000,
    owner: { mid: 99, name: "UP", face: "https://example.com/f.jpg" },
    stat: { view: 200_000, like: 1, reply: 2, danmaku: 3 },
    tname: "生活",
    is_ogv: false
  });
  assert.equal(item?.feedSurface, "popular");
  assert.equal(item?.plays, 200_000);
});

test("validateBilibiliRules rejects a blank play rule", () => {
  const problems = validateBilibiliRules(mergeBilibiliRules({
    playRules: { reject: [{ plays: "", days: 3 }], prefer: [] }
  }));
  assert.ok(problems.some((item) => /播放量/.test(item)));
});
