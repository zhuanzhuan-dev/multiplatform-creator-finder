import * as core from "../lib/xingtu-parser.js";
import { xingtuApiPage, xingtuApiProblem } from './xingtu-api-cache.js';

const MARKET_HEADERS = ["达人信息", "预期CPM", "预期播放量", "互动率", "完播率", "爆文率"];
const AUTHOR_HREF = /\/ad\/creator\/(?:author-homepage\/douyin-video|author(?:\/douyin)?)\//i;

function ownText(element) {
  return Array.from(element.childNodes || [])
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRendered(element) {
  if (!(element instanceof Element)) return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function looksLikeAuthorRow(element) {
  const text = element.innerText || element.textContent || "";
  if (!isRendered(element)) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 360 || rect.height < 36 || rect.height > 320) return false;
  if (/^(达人信息|预期CPM|预期播放量)$/.test(text.trim()) || (/达人信息/.test(text) && /预期CPM/.test(text))) return false;
  return /预期CPM|互动率|完播率|爆文率|精选达人|头部必接|看后必接|精选达人/.test(text)
    || AUTHOR_HREF.test(element.innerHTML || "")
    || (/\d+(?:\.\d+)?(?:w|万|%)/i.test(text) && /[\u4e00-\u9fff]{2,}/.test(text) && !/达人信息/.test(text.split("\n")[0] || ""));
}

function authorAnchors(root = document) {
  return Array.from(root.querySelectorAll('a[href*="/ad/creator/author"]')).filter(isRendered);
}

function rowRank(element) {
  if (element.matches?.("tr, [role='row']")) return 3;
  if (childCells(element).length >= 4) return 2;
  return 1;
}

function uniqueRows(rows) {
  const unique = [];
  rows.forEach((row) => {
    if (!row || unique.includes(row)) return;
    const nested = unique.findIndex((known) => known.contains(row) || row.contains(known));
    if (nested >= 0) {
      const known = unique[nested];
      if (rowRank(row) > rowRank(known) || (rowRank(row) === rowRank(known) && row.contains(known))) unique[nested] = row;
      return;
    }
    unique.push(row);
  });
  return unique.slice(0, 40);
}

function childCells(row) {
  const explicit = Array.from(row.querySelectorAll(':scope > td, :scope > th, :scope > [role="cell"], :scope > [role="columnheader"]'));
  if (explicit.length >= 3) return explicit;
  const children = Array.from(row.children).filter(isRendered);
  return children.length >= 3 ? children : [];
}

function findHeaderRow() {
  const markers = Array.from(document.querySelectorAll("th, div, span, td")).filter((element) => {
    if (!isRendered(element)) return false;
    const text = (ownText(element) || (element.textContent || "")).replace(/\s+/g, " ").trim();
    return /^(达人信息|预期CPM|预期播放量)\b/.test(text);
  });
  for (const marker of markers) {
    let current = marker;
    for (let depth = 0; current && depth < 8; depth += 1) {
      const labels = childCells(current).map((cell) => (cell.innerText || cell.textContent || "").replace(/\s+/g, " ").trim());
      if (labels.some((label) => MARKET_HEADERS.includes(label.split(" ")[0] || label))) return current;
      current = current.parentElement;
    }
  }
  return null;
}

function rowsFromHeader(headerRow) {
  const table = headerRow.closest("table");
  if (table) {
    const bodyRows = Array.from(table.querySelectorAll("tbody tr")).filter(looksLikeAuthorRow);
    if (bodyRows.length) return bodyRows;
  }
  const parent = headerRow.parentElement;
  if (!parent) return [];
  const siblings = Array.from(parent.children).filter((child) => child !== headerRow && looksLikeAuthorRow(child));
  if (siblings.length) return siblings;
  const section = parent.parentElement;
  if (!section) return [];
  return Array.from(section.querySelectorAll('[class*="row"], [role="row"], tr')).filter((row) => row !== headerRow && looksLikeAuthorRow(row));
}

function genericRows() {
  const selectors = [
    "table tbody tr",
    '[role="row"]',
    '[class*="table-row"]',
    '[class*="TableRow"]',
    '[class*="author-row"]'
  ];
  return uniqueRows(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))).filter(looksLikeAuthorRow));
}

function rowFromAnchor(anchor) {
  let current = anchor;
  const viable = [];
  for (let depth = 0; current && current !== document.body && depth < 14; depth += 1) {
    if (looksLikeAuthorRow(current)) viable.push(current);
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((child) => looksLikeAuthorRow(child));
      if (siblings.length >= 2 && looksLikeAuthorRow(current)) return current;
    }
    current = parent;
  }
  return viable.sort((left, right) => left.getBoundingClientRect().height - right.getBoundingClientRect().height)[0] || null;
}

export function imageUrl(element) {
  const image = element?.querySelector?.("img") || element;
  if (!image) return "";
  const source = (value) => {
    if (!value || !/^(https?:|\/\/|\/)/i.test(value)) return "";
    try {
      const url = new URL(value, globalThis.location?.href || "https://www.xingtu.cn/");
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || /(?:^|[\/_.-])(?:placeholder|transparent|blank|loading)(?:[\/_.-]|$)/i.test(url.pathname)) return "";
      return url.href;
    } catch { return ""; }
  };
  const lazy = ["data-src", "data-original", "data-lazy-src"].map((name) => image.getAttribute?.(name)).map(source).find(Boolean);
  const tiny = image.naturalWidth > 0 && image.naturalWidth <= 2 && image.naturalHeight > 0 && image.naturalHeight <= 2;
  return lazy || (!tiny && [image.currentSrc, image.src, image.getAttribute?.("src")].map(source).find(Boolean)) || "";
}
export function pendingImage(image) {
  return imageUrl(image) ? 0 : 1;
}

function headerLabels(headerRow) {
  return childCells(headerRow).map((cell) => {
    const text = (cell.innerText || cell.textContent || "").replace(/\s+/g, " ").trim();
    return MARKET_HEADERS.find((label) => text.startsWith(label)) || text;
  });
}

function extractRow(row, headers = []) {
  const rawText = row.innerText || row.textContent || "";
  const cells = childCells(row);
  const cellTexts = cells.map((cell) => (cell.innerText || cell.textContent || "").trim());
  const metrics = core.mapTableMetrics(headers, cellTexts);
  const infoCell = cells.find((cell) => core.parseAuthorCell(cell.innerText || cell.textContent || "").authorName)
    || cells[headers.indexOf("达人信息")]
    || cells[0];
  const anchor = authorAnchors(row)[0] || Array.from(row.querySelectorAll("a[href]")).find((link) => AUTHOR_HREF.test(link.getAttribute("href") || "") || /xingtu\.cn\/ad\/creator/i.test(link.href || ""));
  const profileUrl = anchor ? core.canonicalXingtuPageUrl(new URL(anchor.href, location.href).href) : "";
  const anchorName = (anchor?.getAttribute("title") || "").trim() || cleanAnchorName(anchor);
  const parsed = core.parseCardText(rawText, {
    authorName: anchorName,
    authorCell: infoCell?.innerText || rawText,
    profileUrl,
    xingtuId: core.extractXingtuId(profileUrl),
    tags: Array.from(row.querySelectorAll('[class*="tag"],[class*="Tag"],.ant-tag')).map((node) => (node.textContent || "").trim()).filter(Boolean),
    metrics
  });
  parsed.avatarUrl = imageUrl(row.querySelector("img"));
  return parsed.authorName ? parsed : null;
}

function cleanAnchorName(anchor) {
  const text = (anchor?.innerText || anchor?.textContent || "").split("\n").map((line) => line.trim()).find((line) => line && !/达人|必接|榜|男|女/.test(line) && line.length <= 30);
  return text || "";
}

export function collectCurrentPage() {
  const pageNumber = pagination()?.number || '';
  const response = xingtuApiPage(pageNumber);
  const visibleNames = Array.from(document.querySelectorAll('.author-info-column .author-nickname'))
    .filter(isRendered).map(node => node.textContent?.trim()).filter(Boolean);
  const names = new Set(response?.rows.map(row => row.authorName) || []);
  const settled = visibleNames.length > 0 && visibleNames.every(name => names.has(name));
  const parsed = settled ? response.rows : [];
  return {
    pageUrl: core.canonicalXingtuPageUrl(location.href),
    pageNumber,
    pageTitle: document.title,
    capturedAt: new Date().toISOString(),
    rows: parsed,
    last: response?.last === true,
    pendingImages: 0,
    diagnostics: {
      strategy: 'market-api',
      markerCount: visibleNames.length,
      candidateCount: response?.rows.length || 0,
      parsedCount: parsed.length,
      missingIdentityCount: response?.missingIdentityCount || 0
    }
  };
}

export function pageFingerprint(page) {
  return JSON.stringify(page.rows.map((row) => [core.rowAccountKey(row), row.xingtuId || row.authorName]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

export function pagination() {
  const ants = Array.from(document.querySelectorAll(".ant-pagination, [class*='pagination']")).filter((root) => isRendered(root) && root.querySelector("li,button,a"));
  const root = ants.find((node) => node.classList.contains("ant-pagination")) || ants.at(-1);
  if (root) {
    const next = root.querySelector("li.ant-pagination-next, button.btn-next, [aria-label='下一页'], [class*='next']");
    if (next && isRendered(next)) {
      return {
        next,
        number: root.querySelector(".ant-pagination-item-active, .el-pager .active, [class*='active']")?.textContent?.trim() || "",
        last: next.classList.contains("ant-pagination-disabled") || next.classList.contains("is-disabled") || next.getAttribute("aria-disabled") === "true" || next.disabled === true
      };
    }
  }
  const labeled = Array.from(document.querySelectorAll("button,a,[role='button']")).find((node) => isRendered(node) && /^(下一页|后一页)$/.test((node.textContent || "").trim()));
  if (!labeled) return null;
  return {
    next: labeled,
    number: Array.from(document.querySelectorAll("[class*='pagination'] [class*='active']")).find(isRendered)?.textContent?.trim() || "",
    last: labeled.disabled || labeled.getAttribute("aria-disabled") === "true" || labeled.classList.contains("disabled")
  };
}

export function pageAccessProblem() {
  const apiError = xingtuApiProblem(pagination()?.number || '');
  if (apiError) return `星图列表接口返回错误：${apiError}`;
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .ant-modal, .el-message-box__wrapper, .el-dialog__wrapper, [class*="captcha"], [class*="verify"]')).filter(isRendered);
  const text = dialogs.map((element) => element.innerText || "").join(" ");
  if (/验证|访问频繁|操作频繁|登录|权限不足|购买|升级|未登录/.test(text)) return "星图页面需要人工处理登录、验证或访问限制";
  const blocking = Array.from(document.querySelectorAll(".ant-spin-spinning, .el-loading-mask, [class*='loading-mask']")).filter((element) => {
    if (!isRendered(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 120 && rect.height >= 80;
  });
  if (blocking.length && !document.body.innerText.includes("达人信息")) return "loading";
  return "";
}

export function browsingSurface() {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const hash = (location.hash.split("?")[0] || "").replace(/^#/, "");
  if (path === "/ad/creator/market" || path.startsWith("/ad/creator/market/") || hash === "/ad/creator/market" || hash.startsWith("/ad/creator/market")) return "market";
  if (/^\/ad\/creator\/(?:author-homepage\/douyin-video|author(?:\/douyin)?)\/\d+$/.test(path) || /^\/ad\/creator\/(?:author-homepage\/douyin-video|author(?:\/douyin)?)\/\d+$/.test(hash)) return "creator";
  if (document.body?.innerText.includes("达人信息") && document.body.innerText.includes("预期CPM")) return "market";
  return null;
}

export function pageProblem() {
  return pageAccessProblem() || (browsingSurface() !== "market" ? "请打开星图达人广场后开始" : "");
}

export function collectDetailPage(surface) {
  const visible = (selector) => Array.from(document.querySelectorAll(selector)).find(isRendered);
  const rawText = document.body.innerText.slice(0, 80000);
  const profileUrl = core.canonicalXingtuPageUrl(location.href);
  const xingtuId = core.extractXingtuId(profileUrl);
  const authorName = visible("h1,h2,[class*='nickname'],[class*='author-name']")?.textContent?.trim() || "";
  if (!xingtuId) return { rows: [] };
  const avatar = visible("img[class*='avatar'], img");
  const row = core.parseCardText(rawText, { authorName, xingtuId, profileUrl });
  row.avatarUrl = imageUrl(avatar);
  return {
    pageUrl: profileUrl,
    pageTitle: document.title,
    surface,
    capturedAt: new Date().toISOString(),
    pendingImages: 0,
    rows: [row]
  };
}
