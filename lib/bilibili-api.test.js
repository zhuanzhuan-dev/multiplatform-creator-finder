import assert from "node:assert/strict";
import test from "node:test";
import { md5Hex } from "./bilibili-md5.js";
import { encodeWbiWithKeys } from "./bilibili-wbi.js";
import { mapBilibiliProfile, mapBilibiliRecommendItem, sampleBilibiliBatchSeconds } from "./bilibili-api.js";
import { decideBilibili } from "./bilibili-task.js";
import { DEFAULT_BILIBILI_RULES } from "./bilibili-rules.js";

test("md5 matches common vector", () => {
  assert.equal(md5Hex(""), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(md5Hex("abc"), "900150983cd24fb0d6963f7d28e17f72");
});

test("wbi signing adds sorted wts and w_rid", () => {
  const signed = encodeWbiWithKeys({ foo: "1", bar: "2" }, { img_key: "a".repeat(32), sub_key: "b".repeat(32) }, 1_700_000_000_000);
  assert.equal(signed.wts, 1700000000);
  assert.match(signed.w_rid, /^[a-f0-9]{32}$/);
  assert.equal(signed.foo, "1");
});

test("maps only av recommend cards with owner mid", () => {
  const item = mapBilibiliRecommendItem({
    goto: "av",
    bvid: "BV1xx411c7mD",
    title: "测试视频",
    pic: "https://example.com/cover.jpg",
    duration: 120,
    pubdate: 1700000000,
    uri: "https://www.bilibili.com/video/BV1xx411c7mD",
    owner: { mid: 12345, name: "UP主", face: "https://example.com/face.jpg" },
    stat: { view: 1000, like: 20, danmaku: 3, favorite: 4 },
    rcmd_reason: { content: "已关注" }
  }, "2026-09-15T00:00:00.000Z");
  assert.equal(item?.sourcePlatform, "bilibili");
  assert.equal(item?.videoId, "BV1xx411c7mD");
  assert.equal(item?.authorId, "12345");
  assert.equal(item?.plays, 1000);
  assert.equal(item?.rcmdReason, "已关注");
  assert.equal(mapBilibiliRecommendItem({ goto: "live", bvid: "BV1" }), null);
  assert.deepEqual(mapBilibiliProfile(item, 8888).followers, 8888);
});

test("decideBilibili accepts play-qualified videos and reviews missing followers", () => {
  const observation = {
    sourcePlatform: "bilibili",
    contentType: "video",
    videoId: "BV1xx411c7mD",
    authorId: "12345",
    authorName: "美食探店UP",
    caption: "美食探店合集",
    durationSeconds: 120,
    likes: 20000,
    plays: 100000,
    pubdateSeconds: Math.floor(Date.now() / 1000) - 86400
  };
  const result = decideBilibili(observation, { followers: null }, DEFAULT_BILIBILI_RULES);
  assert.equal(result.matched, true);
  assert.equal(result.code, "ACCEPTED_REVIEW");
});

test("bilibili batch delay samples within configured range", () => {
  assert.equal(sampleBilibiliBatchSeconds({ bilibiliBatchDelay: { minSeconds: 8, maxSeconds: 8 } }, () => 0.5), 8);
  assert.equal(sampleBilibiliBatchSeconds({ bilibiliBatchDelay: { minSeconds: 4, maxSeconds: 10 } }, () => 0), 4);
  assert.equal(sampleBilibiliBatchSeconds({ bilibiliBatchDelay: { minSeconds: 4, maxSeconds: 10 } }, () => 1), 10);
});
