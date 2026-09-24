import test from "node:test";
import assert from "node:assert/strict";
import * as core from "./xingtu-parser.js";

test("从达人广场卡片文本解析昵称、粉丝、报价和星图 id", () => {
  const row = core.parseCardText(`
    顾一
    粉丝数 43.3万
    内容类型：美食 探店
    1-20s ¥800
    21-60s ¥1500
    60s+ ¥2500
    星图指数 452
    抖音号 guyi_food
  `, { authorName: "顾一", profileUrl: "https://www.xingtu.cn/ad/creator/author/douyin/9876543210" });

  assert.equal(row.authorName, "顾一");
  assert.equal(row.xingtuId, "9876543210");
  assert.equal(row.followerCount, "43.3万");
  assert.equal(row.uniqueId, "guyi_food");
  assert.equal(row.prices["1-20s"], "800");
  assert.equal(row.prices["21-60s"], "1500");
  assert.equal(row.prices["60s+"], "2500");
  assert.equal(row.xingtuIndex, "452");
  assert.deepEqual(row.tags, ["美食", "探店"]);
});

test("粉丝写在数字后面时仍能提取", () => {
  assert.equal(core.extractFollowerCount("达人甲\n128.5万粉丝\n报价"), "128.5万");
});

test("星图主页链接解析 id，查询参数变化仍视为同一账号", () => {
  const a = { authorName: "同名账号", profileUrl: "https://www.xingtu.cn/ad/creator/author/douyin/12?from=a" };
  const b = { authorName: "同名账号", profileUrl: "https://www.xingtu.cn/ad/creator/author/douyin/13" };
  assert.equal(core.extractXingtuId(a.profileUrl), "12");
  assert.notEqual(core.rowAccountKey(a), core.rowAccountKey(b));
  assert.equal(core.rowAccountKey(a), core.rowAccountKey({ ...a, authorName: "改名账号", profileUrl: "https://www.xingtu.cn/ad/creator/author/douyin/12?ts=2" }));
  const current = "https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/7261082806409756709?possessStarId";
  assert.equal(core.extractXingtuId(current), "7261082806409756709");
  assert.equal(core.canonicalXingtuPageUrl(`${current}&market_track_id=secret`), 'https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/7261082806409756709');
  assert.equal(core.canonicalXingtuPageUrl('https://www.xingtu.cn/#/ad/creator/market?search_session_id=secret'), 'https://www.xingtu.cn/#/ad/creator/market');
  assert.equal(core.canonicalXingtuPageUrl('https://www.xingtu.cn/ad/creator/author?star_id=12&search_session_id=secret'), 'https://www.xingtu.cn/ad/creator/author?star_id=12');
  assert.equal(core.canonicalXingtuPageUrl('https://example.com/ad/creator/author-homepage/douyin-video/7261082806409756709'), '');
  assert.equal(core.extractXingtuId("https://example.com/ad/creator/author-homepage/douyin-video/7261082806409756709"), "");
});

test("同一账号命中规避词时排除整个账号", () => {
  const rows = [
    { authorName: "测试达人", xingtuId: "42", tags: ["美食"], searchText: "测试达人 美食" },
    { authorName: "测试达人", xingtuId: "42", tags: ["游戏"], searchText: "测试达人 游戏" }
  ];
  const result = core.decideRows(rows, ["游戏"]);
  assert.equal(result.accounts.length, 0);
  assert.equal(result.excluded.length, 1);
  assert.deepEqual(result.excluded[0].matchedKeywords, ["游戏"]);
});

test("缺少星图 ID 的同名行不合并成达人", () => {
  const rows = [
    { authorName: "同名账号", tags: ["美食"] },
    { authorName: "同名账号", tags: ["游戏"] }
  ];
  const result = core.decideRows(rows, []);
  assert.equal(result.accounts.length, 0);
  assert.equal(result.invalidRows.length, 2);
});

test("规避词支持中文逗号、英文逗号和换行并去重", () => {
  assert.deepEqual(core.parseKeywords("游戏，动漫\n影视,游戏"), ["游戏", "动漫", "影视"]);
});

test("找达人宽表单元格能拆出昵称、性别、城市和榜单标签", () => {
  const cell = core.parseAuthorCell("陈翔六点半\n男\n昆明市\n精选达人\n头部必接榜第2名");
  assert.equal(cell.authorName, "陈翔六点半");
  assert.equal(cell.gender, "男");
  assert.equal(cell.city, "昆明市");
  assert.deepEqual(cell.tags, ["精选达人", "头部必接榜第2名"]);
});

test("单行达人信息仍能取出昵称", () => {
  const cell = core.parseAuthorCell("脱缰凯 男 沈阳市 精选达人");
  assert.equal(cell.authorName, "脱缰凯");
  assert.equal(cell.gender, "男");
  assert.equal(cell.city, "沈阳市");
});

test("找达人列表无报价时按列对齐提取预期CPM等指标", () => {
  const metrics = core.mapTableMetrics(
    ["达人信息", "预期CPM", "预期播放量", "互动率", "完播率", "爆文率"],
    ["陈翔六点半\n男\n昆明市\n精选达人", "28.6", "1,327w", "2.3%", "7.9%", "100%"]
  );
  assert.equal(metrics["预期CPM"], "28.6");
  assert.equal(metrics["预期播放量"], "1,327w");
  assert.equal(metrics["互动率"], "2.3%");
  assert.equal(metrics["完播率"], "7.9%");
  assert.equal(metrics["爆文率"], "100%");
});

test("宽表前面多一列勾选时仍按达人信息列对齐", () => {
  const metrics = core.mapTableMetrics(
    ["达人信息", "预期CPM", "预期播放量", "互动率", "完播率", "爆文率"],
    ["", "朱铁雄\n男\n北京", "24.3", "7,398.2w", "-", "-", "-"]
  );
  assert.equal(metrics["预期CPM"], "24.3");
  assert.equal(metrics["预期播放量"], "7,398.2w");
  assert.equal(metrics["互动率"], undefined);
});

test("无表头时从找达人行文本按顺序回填五项指标", () => {
  const row = core.parseCardText("李螃蟹\n女\n深圳市\n精选达人\n看后必接榜第3名\n23.3\n2,579w\n4.5%\n12%\n100%");
  assert.equal(row.authorName, "李螃蟹");
  assert.equal(row.city, "深圳市");
  assert.equal(row.metrics["预期CPM"], "23.3");
  assert.equal(row.metrics["预期播放量"], "2,579w");
  assert.equal(row.metrics["爆文率"], "100%");
});

test("短链 /ad/creator/author/{id} 也能解析星图 id", () => {
  assert.equal(core.extractXingtuId("https://www.xingtu.cn/ad/creator/author/987654"), "987654");
});
