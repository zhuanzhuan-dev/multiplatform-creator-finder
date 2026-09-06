import test from "node:test";
import assert from "node:assert/strict";
import { evaluateVideoRules } from "./rule-engine.js";

const rules = {
  includeLive: false,
  hard: { minVideoDurationSeconds: 60, minVideoLikes: 3000 },
  positiveCategories: [
    { id: "ai", name: "AI内容", score: 15, keywords: ["AI漫剧", "内容由 AI 生成"] },
    { id: "food", name: "美食", score: 20, keywords: ["探店"] }
  ],
  gameBlacklist: ["我的世界"]
};

test("video keywords use normalized structured fields", () => {
  const result = evaluateVideoRules({
    caption: "第1集：雾山精神病院",
    authorName: "早早动漫",
    hashtags: ["#ＡＩ漫剧"],
    cardText: "页面按钮和弹幕",
    durationSeconds: 493,
    likes: 258000
  }, rules);

  assert.equal(result.matched, true);
  assert.deepEqual(result.matchedGroups, ["ai"]);
  assert.deepEqual(result.categories[0].hits, ["ai漫剧"]);
});

test("card text does not create false category hits when structured text exists", () => {
  const result = evaluateVideoRules({
    caption: "今天记录普通生活",
    authorName: "旅行记录者",
    hashtags: [],
    cardText: "弹幕：附近新开了一家探店餐厅",
    durationSeconds: 90,
    likes: 5000
  }, rules);

  assert.equal(result.matched, true);
  assert.deepEqual(result.matchedGroups, []);
  assert.equal(result.needsSemanticReview, true);
});

test("card text remains a fallback when all structured text is missing", () => {
  const result = evaluateVideoRules({
    cardText: "作者声明：内容由 AI 生成",
    durationSeconds: 90,
    likes: 5000
  }, rules);

  assert.equal(result.matched, true);
  assert.deepEqual(result.matchedGroups, ["ai"]);
});

test("blacklist ignores unrelated card text when structured text exists", () => {
  const result = evaluateVideoRules({
    caption: "户外旅行记录",
    authorName: "旅行记录者",
    cardText: "弹幕：我在玩我的世界",
    durationSeconds: 90,
    likes: 5000
  }, rules);

  assert.equal(result.code, "HARD_FILTER_PASSED");
});
