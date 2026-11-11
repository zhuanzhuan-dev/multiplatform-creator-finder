import test from "node:test";
import assert from "node:assert/strict";
import { captureFeedFrame, footageStatusLine, OFFICIAL_AI_HINTS, readDouyinAiHint, readDouyinFootageCaption } from "./footage-frame.js";

function element(spec, parent = null) {
  const node = {
    textContent: spec.text || "",
    className: spec.className || "",
    children: [],
    parentElement: parent,
    tag: spec.tag || "",
    attrs: spec.attrs || {},
    rect: spec.rect || { left: 0, top: 0, width: 0, height: 0, bottom: 0 },
    shadowRoot: null,
    getAttribute(name) { return this.attrs[name] || null; },
    closest(selector) {
      const wanted = selector.split(",").map((item) => item.trim());
      let current = this;
      while (current) {
        const marker = current.getAttribute?.("data-e2e");
        const matched = wanted.some((item) => item === `.${current.className}` || (marker && item === `[data-e2e="${marker}"]`) || (item === "a" && current.tag === "a"));
        if (matched) return current;
        current = current.parentElement;
      }
      return null;
    },
    getBoundingClientRect() { return this.rect; },
    querySelectorAll(selector) {
      const found = [];
      const visit = (current) => {
        for (const child of current.children) {
          if (selector === "*" || (selector === ".safetyBar" && child.className.split(/\s+/).includes("safetyBar")) || (selector === "video" && child.tag === "video")) found.push(child);
          visit(child);
          if (child.shadowRoot) visit(child.shadowRoot);
        }
      };
      visit(this);
      return found;
    },
  };
  node.children = (spec.children || []).map((child) => element(child, node));
  if (spec.shadow) {
    node.shadowRoot = element({ children: spec.shadow }, node);
    node.shadowRoot.querySelectorAll = node.querySelectorAll.bind(node.shadowRoot);
  }
  return node;
}

test("official AI hints are the platform phrases, including the short corner mark", () => {
  assert.deepEqual(OFFICIAL_AI_HINTS, [
    "疑似使用了AI生成技术，请谨慎甄别",
    "作品含AI生成内容",
    "内容由AI生成",
    "人工智能生成",
    "AI生成",
  ]);
});

test("safety bar text is an AI mark and ordinary copy is not", () => {
  const card = element({ children: [
    { className: "safetyBar", text: "作者声明：内容由 AI 生成" },
    { tag: "a", attrs: { "data-e2e": "video-desc" }, children: [{ text: "AI生成" }] },
    { className: "safetyBar", text: "个人观点，仅供参考" },
  ] });
  assert.deepEqual(readDouyinAiHint(card), { text: "内容由AI生成", source: "safetyBar" });
});

test("a lower-left AI生成 label counts, including one inside an open shadow root", () => {
  const video = element({ tag: "video", rect: { left: 100, top: 100, width: 400, height: 700, bottom: 800 } });
  video.videoWidth = 400;
  const card = element({ children: [
    video,
    { text: "AI生成", rect: { left: 112, top: 760, width: 48, height: 16, bottom: 776 } },
    { text: "AI生成", rect: { left: 360, top: 140, width: 48, height: 16, bottom: 156 } },
  ] });
  assert.deepEqual(readDouyinAiHint(card, video), { text: "AI生成", source: "corner" });

  const shadowed = element({ children: [{ shadow: [{ className: "safetyBar", text: "作品含AI生成内容" }] }] });
  assert.equal(readDouyinAiHint(shadowed)?.text, "作品含AI生成内容");
});

test("a lower-left declaration with an icon child still counts", () => {
  const video = element({ tag: "video", rect: { left: 0, top: 0, width: 400, height: 700, bottom: 700 } });
  const card = element({ children: [
    video,
    {
      className: "ai-pill",
      text: "作者声明：内容由 AI 生成",
      rect: { left: 16, top: 640, width: 180, height: 20, bottom: 660 },
      children: [{ tag: "i", text: "", rect: { left: 16, top: 642, width: 12, height: 12, bottom: 654 } }],
    },
  ] });
  assert.deepEqual(readDouyinAiHint(card, video), { text: "内容由AI生成", source: "corner" });
});

test("description tags are sent as caption and stay outside the official AI hint", () => {
  const card = element({ children: [
    { attrs: { "data-e2e": "video-desc" }, text: "夜景延时 #即梦AI 展开" },
    { tag: "a", attrs: { href: "https://www.douyin.com/search/%E5%8D%B3%E6%A2%A6AI" }, text: "#即梦AI" },
    { tag: "a", attrs: { href: "https://www.douyin.com/search/%E7%BE%8E%E9%A3%9F" }, text: "#美食" },
    { attrs: { "data-e2e": "feed-video-nickname" }, text: "@发呆先生" },
  ] });
  assert.equal(readDouyinFootageCaption(card), "夜景延时 #即梦AI #美食");
  assert.equal(readDouyinAiHint(card), null);

  const taggedOnly = element({ children: [
    { tag: "a", attrs: { href: "/search/AI创作" }, text: "#AI创作" },
  ] });
  assert.equal(readDouyinFootageCaption(taggedOnly), "#AI创作");
  assert.equal(readDouyinAiHint(taggedOnly), null);
});

test("frame capture waits until one second without seeking, and keeps an already-later frame", async () => {
  let clock = 1_000;
  const early = { videoWidth: 320, videoHeight: 180, currentTime: 0.2 };
  const waited = await captureFeedFrame(early, {
    now: () => clock,
    sleep: async () => { clock += 80; early.currentTime += 0.5; },
    draw: () => "data:image/jpeg;base64,abc",
  });
  assert.equal(waited.currentTime >= 1, true);
  assert.equal(waited.capturedAt, clock);
  assert.equal(early.seeking, undefined);

  const late = { videoWidth: 320, videoHeight: 180, currentTime: 3 };
  let slept = false;
  const immediate = await captureFeedFrame(late, {
    now: () => 5_000,
    sleep: async () => { slept = true; },
    draw: () => "data:image/jpeg;base64,xyz",
  });
  assert.equal(slept, false);
  assert.equal(immediate.currentTime, 3);
  assert.equal(immediate.capturedAt, 5_000);
});

test("status line shows the page hint without treating a missing hint as non-AI", () => {
  assert.equal(footageStatusLine(null), "");
  assert.equal(
    footageStatusLine({ verdict: "非实拍", reason: "页面提示「AI生成」", domAiHint: "AI生成", elapsedMs: 1400, modelMs: 900 }),
    "画面：非实拍，页面提示「AI生成」。页面提示：AI（AI生成）。看画面到返回 1400 ms（模型 900 ms）",
  );
  assert.equal(
    footageStatusLine({ verdict: "实拍", reason: "真人出镜", domAiHint: null }),
    "画面：实拍，真人出镜。页面提示：无",
  );
});
