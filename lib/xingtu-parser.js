const DEFAULT_KEYWORDS = ["游戏", "动漫", "电影", "电视剧"];
const AUTHOR_PATH = /\/ad\/creator\/author\/douyin\/([^/?#]+)/i;

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function canonicalName(value) {
  return compactText(value)
    .replace(/^[·•・\s]+|[·•・\s]+$/g, "")
    .replace(/\.{3,}$|…+$/g, "")
    .trim();
}

function parseKeywords(value) {
  const source = Array.isArray(value) ? value.join("\n") : String(value || "");
  const seen = new Set();
  const result = [];
  source.split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean).forEach((item) => {
    const key = compactText(item);
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  });
  return result;
}

function matchKeywords(searchText, keywords) {
  const haystack = compactText(searchText);
  if (!haystack) return [];
  return parseKeywords(keywords).filter((keyword) => {
    const needle = compactText(keyword);
    return needle && haystack.includes(needle);
  });
}

function cleanLine(line) {
  return String(line || "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

function extractXingtuId(url) {
  try {
    const href = String(url || "");
    const parsed = href.startsWith("http") ? new URL(href) : new URL(href, "https://www.xingtu.cn/");
    const match = parsed.pathname.match(/\/ad\/creator\/author\/(?:douyin\/)?([^/?#]+)/i);
    if (match && !/^(douyin|index)$/i.test(match[1])) return decodeURIComponent(match[1]);
    return parsed.searchParams.get("star_id") || parsed.searchParams.get("uid") || "";
  } catch { /* Name-only rows remain identifiable by nickname. */ }
  return "";
}

function extractFollowerCount(rawText, hint) {
  const hinted = cleanLine(hint).replace(/\s+/g, "");
  if (hinted) return hinted;
  const compact = String(rawText || "").replace(/\s+/g, " ");
  const labeled = compact.match(/(?:粉丝数?)\s*[：:]?\s*([\d,.]+(?:\.\d+)?\s*(?:万|亿|w|k)?)/i);
  if (labeled) return cleanLine(labeled[1]).replace(/\s+/g, "");
  const trailing = compact.match(/([\d,.]+(?:\.\d+)?\s*(?:万|亿|w|k)?)\s*粉丝/i);
  return trailing ? cleanLine(trailing[1]).replace(/\s+/g, "") : "";
}

function extractPrice(rawText, pattern) {
  const match = String(rawText || "").replace(/\s+/g, " ").match(pattern);
  return match ? cleanLine(match[1]).replace(/\s+/g, "") : "";
}

function extractPrices(rawText, hints = {}) {
  const source = String(rawText || "");
  return {
    "1-20s": hints["1-20s"] || extractPrice(source, /1\s*[-~～至到]\s*20\s*(?:s|秒)?\s*[¥￥:]?\s*([\d,.]+(?:\.\d+)?\s*(?:万)?)/i),
    "21-60s": hints["21-60s"] || extractPrice(source, /21\s*[-~～至到]\s*60\s*(?:s|秒)?\s*[¥￥:]?\s*([\d,.]+(?:\.\d+)?\s*(?:万)?)/i),
    "60s+": hints["60s+"] || extractPrice(source, /(?:^|[^\d-])60\s*(?:s|秒)?\s*(?:\+|以上)\s*[¥￥:]?\s*([\d,.]+(?:\.\d+)?\s*(?:万)?)/i)
  };
}

const MARKET_METRIC_LABELS = ["预期CPM", "预期播放量", "互动率", "完播率", "爆文率"];

function isMetricToken(line) {
  return /^(?:-|[\d,.]+(?:\.\d+)?\s*(?:万|w)?%?)$/i.test(line);
}

function parseAuthorCell(text) {
  const raw = String(text || "");
  const lines = raw.split(/\n+/).map(cleanLine).filter(Boolean);
  const gender = lines.find((line) => /^(男|女)$/.test(line)) || raw.match(/(?:^|[\s])([男女])(?:[\s]|$)/)?.[1] || "";
  const city = lines.find((line) => /^[\u4e00-\u9fff]{2,8}[市区县]$/.test(line))
    || raw.match(/([\u4e00-\u9fff]{2,8}[市区县])/)?.[1]
    || "";
  const isMeta = (line) => {
    if (!line || line === gender || line === city) return true;
    if (/^(男|女|达人信息|预期CPM|预期播放量|互动率|完播率|爆文率)$/.test(line)) return true;
    if (/达人|必接|榜|%$/.test(line) || isMetricToken(line)) return true;
    return false;
  };
  let authorName = lines.find((line) => !isMeta(line) && line.length >= 2 && line.length <= 30) || "";
  if (!authorName && lines[0]) {
    const stripped = lines[0]
      .replace(gender, " ")
      .replace(city, " ")
      .replace(/精选达人|头部必接\S*|看后必接\S*|必接榜\S*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (stripped.length >= 2 && stripped.length <= 30 && !/达人|必接|榜/.test(stripped)) authorName = stripped;
  }
  const tags = lines.filter((line) => line && line !== authorName && /达人|必接|榜|精选/.test(line) && !MARKET_METRIC_LABELS.includes(line));
  return { authorName, gender, city, tags };
}

function extractUnlabeledMarketMetrics(rawText) {
  const tokens = String(rawText || "").split(/\n+/).map(cleanLine).filter(isMetricToken);
  if (tokens.length < 5) return {};
  const pick = (index) => {
    const value = tokens[index];
    return !value || value === "-" ? "" : value;
  };
  return {
    预期CPM: pick(0),
    预期播放量: pick(1),
    互动率: pick(2),
    完播率: pick(3),
    爆文率: pick(4)
  };
}

function mapTableMetrics(headers, cellTexts) {
  const cells = (cellTexts || []).map(cleanLine);
  const heads = Array.isArray(headers) ? headers : [];
  const headerInfo = heads.indexOf("达人信息");
  let offset = 0;
  if (headerInfo >= 0) {
    const cellInfo = cells.findIndex((text) => parseAuthorCell(text).authorName);
    if (cellInfo >= 0) offset = cellInfo - headerInfo;
  } else if (cells.length > heads.length) {
    offset = cells.length - heads.length;
  }
  const metrics = {};
  heads.forEach((label, index) => {
    const text = cells[index + offset] || "";
    if (label && MARKET_METRIC_LABELS.includes(label) && text && text !== "-") metrics[label] = text;
  });
  return metrics;
}

function extractMarketMetrics(rawText, hints = {}) {
  const compact = String(rawText || "").replace(/\s+/g, " ");
  const unlabeled = extractUnlabeledMarketMetrics(rawText);
  const metric = (label, fallback) => {
    const hinted = cleanLine(hints[label] || "");
    if (hinted && hinted !== "-") return hinted;
    return fallback || unlabeled[label] || "";
  };
  return {
    预期CPM: metric("预期CPM", compact.match(/预期CPM\s*[：:]?\s*([\d,.]+)/)?.[1] || ""),
    预期播放量: metric("预期播放量", compact.match(/预期播放量\s*[：:]?\s*([\d,.]+(?:\.\d+)?\s*(?:万|w)?)/i)?.[1] || ""),
    互动率: metric("互动率", compact.match(/互动率\s*[：:]?\s*([\d,.]+%?)/)?.[1] || ""),
    完播率: metric("完播率", compact.match(/完播率\s*[：:]?\s*([\d,.]+%?)/)?.[1] || ""),
    爆文率: metric("爆文率", compact.match(/爆文率\s*[：:]?\s*([\d,.]+%?)/)?.[1] || "")
  };
}

function extractTags(rawText, hints = []) {
  const hinted = (Array.isArray(hints) ? hints : []).map(cleanLine).filter(Boolean);
  const compact = String(rawText || "").replace(/\s+/g, " ");
  const labeled = compact.match(/(?:内容类型|行业|标签)\s*[：:]\s*([^\n]+?)(?:粉丝|报价|星图指数|1-20|$)/);
  const fromLabel = labeled ? labeled[1].split(/[\/|,，、\s]+/).map(cleanLine).filter((item) => item.length >= 2 && item.length <= 12) : [];
  return [...new Set([...hinted, ...fromLabel])];
}

function parseCardText(rawText, hints) {
  const safe = hints || {};
  const cell = parseAuthorCell(safe.authorCell || rawText);
  const authorName = cleanLine(safe.authorName) || cell.authorName;
  const xingtuId = cleanLine(safe.xingtuId) || extractXingtuId(safe.profileUrl);
  const uniqueId = cleanLine(safe.uniqueId) || String(rawText || "").match(/抖音号\s*[：:]?\s*([A-Za-z0-9._]+)/)?.[1] || "";
  const followerCount = extractFollowerCount(rawText, safe.followerCount);
  const tags = extractTags(rawText, [...(safe.tags || []), ...cell.tags]);
  const prices = extractPrices(rawText, safe.prices);
  const metrics = { ...extractMarketMetrics(rawText, safe.metrics), ...(safe.metrics || {}) };
  const xingtuIndex = cleanLine(safe.xingtuIndex) || String(rawText || "").replace(/\s+/g, " ").match(/星图指数\s*[：:]?\s*([\d,.]+)/)?.[1] || "";
  return {
    authorName,
    xingtuId,
    uniqueId,
    followerCount,
    profileUrl: safe.profileUrl || (xingtuId ? `https://www.xingtu.cn/ad/creator/author/douyin/${xingtuId}` : ""),
    tags,
    prices,
    metrics,
    xingtuIndex,
    city: cleanLine(safe.city) || cell.city,
    gender: cleanLine(safe.gender) || cell.gender,
    rawText: String(rawText || ""),
    searchText: [authorName, uniqueId, tags.join(" "), rawText].join(" ")
  };
}

function rowAccountKey(row) {
  const id = cleanLine(row && row.xingtuId) || extractXingtuId(row && row.profileUrl);
  if (id) return `star:${id}`;
  return canonicalName(row && row.authorName);
}

function decideRows(rows, keywords) {
  const grouped = new Map();
  const invalidRows = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = rowAccountKey(row);
    if (!key || !row.authorName) {
      invalidRows.push(row);
      return;
    }
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  const accounts = [];
  const excluded = [];
  grouped.forEach((accountRows, key) => {
    let exclusion = null;
    for (const row of accountRows) {
      const matchedKeywords = matchKeywords(row.searchText || [row.authorName, ...(row.tags || [])].join(" "), keywords);
      if (matchedKeywords.length) {
        exclusion = { key, authorName: row.authorName, matchedKeywords, profileUrl: row.profileUrl || "", xingtuId: row.xingtuId || "" };
        break;
      }
    }
    if (exclusion) {
      excluded.push(exclusion);
    } else {
      const representative = accountRows.find((row) => row.followerCount) || accountRows[0];
      accounts.push({
        key,
        authorName: representative.authorName,
        followerCount: representative.followerCount || "",
        profileUrl: representative.profileUrl || "",
        xingtuId: representative.xingtuId || ""
      });
    }
  });
  return { accounts, excluded, invalidRows };
}

export {
  DEFAULT_KEYWORDS,
  AUTHOR_PATH,
  normalizeText,
  compactText,
  canonicalName,
  parseKeywords,
  matchKeywords,
  extractXingtuId,
  extractFollowerCount,
  extractPrices,
  parseAuthorCell,
  extractMarketMetrics,
  mapTableMetrics,
  parseCardText,
  rowAccountKey,
  decideRows
};
