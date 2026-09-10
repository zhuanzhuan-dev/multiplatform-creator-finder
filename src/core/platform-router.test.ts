import assert from "node:assert/strict";
import test from "node:test";
import { DOUYIN_RECOMMEND_URL, firstRunnableTabInWindow, isRunnableRoute, launchUrl, resolveRoute } from "./platform-router.ts";

test("routes the current Douyin recommendation feed", () => {
  const route = resolveRoute(DOUYIN_RECOMMEND_URL);
  assert.equal(route?.platform, "douyin");
  assert.equal(route?.surface, "recommend");
  assert.equal(route?.runnable, true);
});

test("recognizes Douyin featured without enabling an unfinished runner", () => {
  const route = resolveRoute("https://www.douyin.com/");
  assert.equal(route?.surface, "featured");
  assert.equal(route?.runnable, false);
});

test("keeps future providers explicit and disabled until implemented", () => {
  assert.equal(resolveRoute("https://www.kuaishou.com/")?.platform, "kuaishou");
  assert.equal(isRunnableRoute("https://www.kuaishou.com/"), false);
  assert.equal(launchUrl("douyin", "recommend"), DOUYIN_RECOMMEND_URL);
});

test("selects a recommendation tab only from the requested window", () => {
  const tabs = [
    { id: 1, windowId: 8, url: DOUYIN_RECOMMEND_URL },
    { id: 2, windowId: 7, url: "https://www.douyin.com/" },
    { id: 3, windowId: 7, pendingUrl: DOUYIN_RECOMMEND_URL },
  ];
  assert.equal(firstRunnableTabInWindow(tabs, 7)?.id, 3);
  assert.equal(firstRunnableTabInWindow(tabs, 9), null);
});

test("skips recommendation tabs that are navigating away", () => {
  const tabs = [{ id: 1, windowId: 7, url: DOUYIN_RECOMMEND_URL, pendingUrl: "https://www.douyin.com/" }];
  assert.equal(firstRunnableTabInWindow(tabs, 7), null);
});

test('runs only the implemented Feigua video library route', () => {
  assert.equal(resolveRoute('https://dy.feigua.cn/app/#/video/library/all')?.surface, 'library');
  assert.equal(isRunnableRoute('https://dy.feigua.cn/app/#/video/library/all?keyword=food'), true);
  for (const url of ['https://dy.feigua.cn/app/#/workbench/index', 'https://dy.feigua.cn/app/#/blogger-detail/index?bloggerId=42', 'https://dy.feigua.cn/app/#/video/library/all-other', 'https://www.feigua.cn/', 'http://dy.feigua.cn/app/#/video/library/all', 'https://dy.feigua.cn.evil.test/app/#/video/library/all']) assert.equal(isRunnableRoute(url), false, url);
});
