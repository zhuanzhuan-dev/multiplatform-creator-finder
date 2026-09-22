import assert from "node:assert/strict";
import test from "node:test";
import { md5Hex } from "./bilibili-md5.js";
import { encodeWbiWithKeys, resetWbiCache } from "./bilibili-wbi.js";
import {
  BILIBILI_SPACE_PAGE_SIZE,
  clipBilibiliObservation,
  enrichMatchedBilibili,
  mapBilibiliProfile,
  mapBilibiliRecommendItem,
  mapBilibiliSpaceItem,
  parseBilibiliClockLength,
  sampleBilibiliBatchSeconds,
  sampleBilibiliEnrichSeconds
} from "./bilibili-api.js";
import { decideBilibili } from "./bilibili-task.js";
import { DEFAULT_BILIBILI_RULES } from "./bilibili-rules.js";

function jsonOk(data) {
  return { ok: true, json: async () => data };
}

function navOk() {
  return jsonOk({
    code: 0,
    data: {
      isLogin: true,
      wbi_img: {
        img_url: "https://i0.hdslb.com/bfs/wbi/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
        sub_url: "https://i0.hdslb.com/bfs/wbi/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png"
      }
    }
  });
}

function mockBilibiliFetch(routes) {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/x/web-interface/nav")) return navOk();
    const handler = routes[parsed.pathname];
    if (!handler) throw new Error(`unexpected ${parsed.pathname}`);
    return handler(parsed);
  };
}

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

test("enrich delay defaults slower than batch delay", () => {
  assert.equal(sampleBilibiliEnrichSeconds({ bilibiliEnrichDelay: { minSeconds: 10, maxSeconds: 10 } }, () => 0.5), 10);
  assert.equal(sampleBilibiliEnrichSeconds({}, () => 0), 8);
  assert.equal(sampleBilibiliEnrichSeconds({}, () => 1), 16);
});

test("parses space clock length and compact archive cards", () => {
  assert.equal(parseBilibiliClockLength("12:34"), 754);
  assert.equal(parseBilibiliClockLength("1:02:03"), 3723);
  const item = mapBilibiliSpaceItem({
    bvid: "BV1aa411c7mD",
    title: "近作",
    pic: "https://example.com/a.jpg",
    description: "x".repeat(400),
    length: "08:20",
    play: 12345,
    comment: 9,
    video_review: 4,
    created: 1700000000,
    mid: 12345,
    typeid: 76,
    copyright: "1",
    is_union_video: 0,
    meta: null,
    is_charging_arc: false
  });
  assert.equal(item.videoId, "BV1aa411c7mD");
  assert.equal(item.durationSeconds, 500);
  assert.equal(item.description.length, 400);
  assert.equal(item.typeid, 76);
  assert.equal(item.copyright, "1");
  assert.equal(item.meta, null);
  assert.equal(item.is_charging_arc, false);
});

test("enrichMatchedBilibili pulls view, followers and only the first 30 archives", async () => {
  resetWbiCache();
  const calls = [];
  const delays = [];
  const fetchImpl = mockBilibiliFetch({
    "/x/web-interface/wbi/view": () => {
      calls.push("view");
      return jsonOk({
        code: 0,
        data: {
          bvid: "BV1xx411c7mD",
          title: "详情标题",
          desc: "完整简介",
          duration: 188,
          pubdate: 1700000100,
          pic: "https://example.com/view.jpg",
          tname: "美食",
          stat: { view: 222000, like: 300, reply: 12, danmaku: 5, favorite: 8, coin: 40, share: 6 }
        }
      });
    },
    "/x/relation/stat": () => {
      calls.push("followers");
      return jsonOk({ code: 0, data: { follower: 9876 } });
    },
    "/x/space/wbi/arc/search": (parsed) => {
      calls.push(`space:${parsed.searchParams.get("pn")}`);
      const make = (suffix) => ({
        bvid: `BV1${suffix}`,
        title: `稿件${suffix}`,
        pic: `https://example.com/${suffix}.jpg`,
        length: "03:00",
        play: 1000,
        created: 1700000000,
        mid: 12345
      });
      return jsonOk({
        code: 0,
        data: {
          list: { vlist: Array.from({ length: BILIBILI_SPACE_PAGE_SIZE }, (_, index) => make(`a${index}`)) },
          page: { count: 80, pn: 1, ps: 30 }
        }
      });
    }
  });

  const result = await enrichMatchedBilibili({
    videoId: "BV1xx411c7mD",
    authorId: "12345",
    caption: "测试视频",
    plays: 100000
  }, {
    fetchImpl,
    settings: { bilibiliEnrichDelay: { minSeconds: 9, maxSeconds: 9 } },
    delay: async (seconds) => delays.push(seconds),
    random: () => 0
  });

  assert.deepEqual(calls, ["view", "followers", "space:1"]);
  assert.deepEqual(delays, [9, 9, 9]);
  assert.equal(result.followers, 9876);
  assert.equal(result.archives.length, 30);
  assert.equal(result.archiveCount, 80);
  assert.equal(result.archivesComplete, false);
  assert.equal(result.observation.plays, 222000);
  assert.equal(result.observation.description, "完整简介");
  assert.equal(result.observation.coins, 40);
  const profile = mapBilibiliProfile(result.observation, result.followers, result);
  assert.equal(profile.ready, true);
  assert.equal(profile.videoCount, 80);
  assert.equal(profile.worksListComplete, false);
  assert.equal(profile.recentVideos.length, 24);
});

test("clipBilibiliObservation drops raw payload before overflowing", () => {
  const clipped = clipBilibiliObservation({
    videoId: "BV1xx411c7mD",
    raw: { blob: "z".repeat(95_000) },
    authorArchives: [{ videoId: "BV1a", description: "keep" }]
  });
  assert.equal(clipped.raw, null);
  assert.equal(clipped.authorArchives[0].description, "keep");
});
