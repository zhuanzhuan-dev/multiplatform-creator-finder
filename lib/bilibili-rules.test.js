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
  assert.equal(DEFAULT_BILIBILI_RULES.hard.minPlays, 100_000);
  assert.equal(DEFAULT_BILIBILI_RULES.hard.rejectPlaysBelow, 10_000);
  assert.equal(DEFAULT_BILIBILI_RULES.hard.minVideoDurationSeconds, 60);
  assert.equal(DEFAULT_BILIBILI_RULES.includeDigital, false);
});

test("rejects plays below hard reject line", () => {
  const result = evaluateBilibiliVideoRules(video({ plays: 9_999 }), DEFAULT_BILIBILI_RULES);
  assert.equal(result.code, "PLAYS_HARD_REJECT");
  assert.equal(result.matched, false);
});

test("rejects short videos under one minute", () => {
  const result = evaluateBilibiliVideoRules(video({ durationSeconds: 45 }), DEFAULT_BILIBILI_RULES);
  assert.equal(result.code, "VIDEO_TOO_SHORT");
});

test("rejects early videos under admission plays", () => {
  const result = evaluateBilibiliVideoRules(video({ plays: 50_000 }), DEFAULT_BILIBILI_RULES);
  assert.equal(result.code, "PLAYS_TOO_LOW_EARLY");
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

test("validateBilibiliRules rejects inverted play thresholds", () => {
  const problems = validateBilibiliRules(mergeBilibiliRules({
    hard: { minPlays: 1000, rejectPlaysBelow: 5000 }
  }));
  assert.ok(problems.some((item) => /剔除线/.test(item)));
});
