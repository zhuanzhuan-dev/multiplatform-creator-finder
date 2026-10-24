import test from "node:test";
import assert from "node:assert/strict";
import { mergeRules } from "./defaults.js";
import { validateRules, evaluateVideoRules } from "./rule-engine.js";

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
  const result = evaluateVideoRules({ contentType: "video",
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
  const result = evaluateVideoRules({ contentType: "video",
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
  const result = evaluateVideoRules({ contentType: "video",
    cardText: "作者声明：内容由 AI 生成",
    durationSeconds: 90,
    likes: 5000
  }, rules);

  assert.equal(result.matched, true);
  assert.deepEqual(result.matchedGroups, ["ai"]);
});

test("blacklist ignores unrelated card text when structured text exists", () => {
  const result = evaluateVideoRules({ contentType: "video",
    caption: "户外旅行记录",
    authorName: "旅行记录者",
    cardText: "弹幕：我在玩我的世界",
    durationSeconds: 90,
    likes: 5000
  }, rules);

  assert.equal(result.code, "HARD_FILTER_PASSED");
});


test("zero likes threshold is applied without restoring the default", () => {
  const zeroRules = mergeRules({hard: {minVideoLikes: 0, preferredVideoLikes: 0, minFollowers: 0}});
  assert.deepEqual(validateRules(zeroRules), []);
  assert.equal(evaluateVideoRules({ contentType: "video",caption: "探店", durationSeconds: 90, likes: 0}, zeroRules).matched, true);
  for (const key of ["minVideoLikes", "minFollowers", "maxFollowers"]) {
    assert.ok(validateRules({...zeroRules, hard: {...zeroRules.hard, [key]: ""}}).length, key);
  }
  const category = zeroRules.positiveCategories[0];
  assert.deepEqual(validateRules({...zeroRules, positiveCategories: [{...category, score: 0}]}), []);
  assert.ok(validateRules({...zeroRules, positiveCategories: [{...category, score: ""}]}).length);
});

test('content-scoped exclusions preserve words and stop nickname-only rejection',async()=>{
 const {evaluateCreatorRules}=await import('./rule-engine.js');
 const scoped={...rules,contentOnlyExclusionTerms:['我的世界'],hard:{...rules.hard,minFollowers:10000,maxFollowers:5000000}};
 const video={contentType:'video',authorName:'我的世界厨房',caption:'今天做饭',durationSeconds:90,likes:5000};
 assert.equal(evaluateVideoRules(video,rules).code,'RISK_FILTERED');
 assert.equal(evaluateVideoRules(video,scoped).matched,true);
 assert.equal(evaluateVideoRules({...video,caption:'我的世界游戏教程'},scoped).code,'RISK_FILTERED');
 const profile={followers:50000,authorName:'我的世界厨房',bio:'我的世界',douyinId:'我的世界',recentVideos:[{text:'今天做饭'}]};
 assert.equal(evaluateCreatorRules(profile,scoped).matched,true);
 assert.equal(evaluateCreatorRules({...profile,recentVideos:[{text:'我的世界游戏教程'}]},scoped).code,'PROFILE_RISK_FILTERED');
 assert.deepEqual(scoped.gameBlacklist,['我的世界']);
 assert.equal(evaluateVideoRules({...video,caption:'另一个排除词'},{...scoped,gameBlacklist:['我的世界','另一个排除词']}).code,'RISK_FILTERED');
 assert.deepEqual(mergeRules({}).contentOnlyExclusionTerms,[]);
});
