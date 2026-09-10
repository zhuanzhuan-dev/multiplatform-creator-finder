import test from "node:test";
import assert from "node:assert/strict";
import * as core from "./feigua-parser.js";
test("解析飞瓜列表行的标题、热词、达人名称和粉丝量", () => {
  const row = core.parseRowText(`
    这城市那么空 这回忆那么凶 #hongkong
    热词：世界 城市 真的 知道 大家
    视频时长：8秒
    顾一
    粉丝数：43.3w
    99.1
    3533.6w
  `);

  assert.equal(row.title, "这城市那么空 这回忆那么凶 #hongkong");
  assert.equal(row.authorName, "顾一");
  assert.equal(row.followerCount, "43.3w");
  assert.deepEqual(row.topics, ["#hongkong"]);
  assert.deepEqual(row.hotWords, ["世界 城市 真的 知道 大家"]);
});

test("粉丝标签与数字分行时仍能提取粉丝量", () => {
  assert.equal(core.extractFollowerCount("达人甲\n粉丝数：\n3409.3w\n50.2"), "3409.3w");
});

test("同一账号任一视频命中规避词时排除整个账号", () => {
  const rows = [
    { authorName: "测试达人", title: "普通美食分享", topics: [], hotWords: [], searchText: "普通美食分享 测试达人" },
    { authorName: "测试达人", title: "今日社会百态记录", topics: [], hotWords: [], searchText: "今日社会百态记录 测试达人" }
  ];
  const result = core.decideRows(rows, ["社会百态"]);

  assert.equal(result.accounts.length, 0);
  assert.equal(result.excluded.length, 1);
  assert.deepEqual(result.excluded[0].matchedKeywords, ["社会百态"]);
});

test("英文规避词忽略大小写且采用包含匹配", () => {
  assert.deepEqual(core.matchKeywords("Funny MEME collection", ["meme"]), ["meme"]);
});

test("同一账号多条未命中视频只生成一个账号", () => {
  const rows = [
    { authorName: "账号甲", followerCount: "12.6w", title: "视频一", topics: [], hotWords: [], searchText: "视频一 账号甲" },
    { authorName: "账号甲", followerCount: "12.6w", title: "视频二", topics: [], hotWords: [], searchText: "视频二 账号甲" }
  ];
  const result = core.decideRows(rows, core.DEFAULT_KEYWORDS);

  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].videoCount, 2);
  assert.equal(result.accounts[0].followerCount, "12.6w");
});

test("同名账号即使主页链接参数变化仍视为重复账号", () => {
  const rows = [
    { authorName: "账号甲", profileUrl: "https://example.com/author?id=1&from=a", title: "视频一", searchText: "视频一 账号甲" },
    { authorName: "账号甲", profileUrl: "https://example.com/author?id=1&from=b", title: "视频二", searchText: "视频二 账号甲" }
  ];
  const result = core.decideRows(rows, []);

  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].videoCount, 2);
});

test("规避词支持中文逗号、英文逗号和换行并去重", () => {
  assert.deepEqual(core.parseKeywords("meme，正能量\n随拍,meme"), ["meme", "正能量", "随拍"]);
});


test('真实昵称以达人开头时保留完整名称', () => {
 assert.equal(core.parseRowText('', {authorName:'达人甲', title:'美食'}).authorName, '达人甲');
});

test('飞瓜达人ID用于去重，同名不同ID分别保存，签名变化保持同一账号', () => {
 const a={authorName:'同名账号',profileUrl:'https://dy.feigua.cn/app/#/blogger-detail/index?bloggerId=12&ts=1&sign=a'};
 const b={...a,profileUrl:'https://dy.feigua.cn/app/#/blogger-detail/index?bloggerId=13'};
 assert.notEqual(core.rowAccountKey(a),core.rowAccountKey(b));
 assert.equal(core.rowAccountKey(a),core.rowAccountKey({...a,authorName:'改名账号',profileUrl:a.profileUrl.replace('ts=1&sign=a','ts=2&sign=b')}));
});
