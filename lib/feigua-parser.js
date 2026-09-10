// Adapted from the existing Feigua collector; reads rendered page facts only.
  const DEFAULT_KEYWORDS = [
    "meme",
    "正能量",
    "随拍",
    "爱心",
    "惊悚",
    "恐怖",
    "悲痛",
    "社会百态"
  ];

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

    source
      .split(/[\n,，、;；]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => {
        const key = compactText(item);
        if (!seen.has(key)) {
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
    return String(line || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isMetricLine(line) {
    const text = cleanLine(line);
    if (!text) return true;
    return /^(传播指数|播放|点赞|评论|分享|收藏|发布(?:时间)?|视频时长|热词|粉丝数)\s*[：:]?/i.test(text) ||
      /^[\d.,]+(?:万|w)?$/i.test(text) ||
      /^\d{1,2}[\/-]\d{1,2}(?:\s+\d{1,2}:\d{2})?$/.test(text);
  }

  function sanitizeAuthor(value) {
    const text = cleanLine(value)
      .replace(/^达人(?:\s*[：:]\s*|\s+)/, "")
      .replace(/\s*粉丝数\s*[：:].*$/i, "")
      .trim();

    if (!text || text.length > 80 || isMetricLine(text)) return "";
    return text;
  }

  function chooseAuthor(lines, followerIndex, hint) {
    const hinted = sanitizeAuthor(hint);
    if (hinted) return hinted;

    if (followerIndex >= 0) {
      const followerLine = lines[followerIndex];
      const inlineMatch = followerLine.match(/^(.*?)\s*粉丝数\s*[：:]/i);
      if (inlineMatch) {
        const inlineAuthor = sanitizeAuthor(inlineMatch[1]);
        if (inlineAuthor) return inlineAuthor;
      }

      for (let index = followerIndex - 1; index >= 0; index -= 1) {
        const candidate = sanitizeAuthor(lines[index]);
        if (candidate && !/^视频内容$|^达人$/i.test(candidate)) return candidate;
      }
    }

    return "";
  }

  function chooseTitle(lines, authorName, hint) {
    const hinted = cleanLine(hint);
    if (hinted) return hinted;

    return lines.find((line) => {
      const text = cleanLine(line);
      if (!text || text === authorName || isMetricLine(text)) return false;
      if (/^(视频内容|达人|高级筛选|共找到)/.test(text)) return false;
      return text.length >= 2;
    }) || "";
  }

  function extractTopics(title) {
    return Array.from(new Set((String(title || "").match(/#[^#\s]+/g) || []).map(cleanLine)));
  }

  function extractHotWords(lines, rawText) {
    const values = [];

    lines.forEach((line) => {
      const match = line.match(/^热词\s*[：:]\s*(.+)$/);
      if (match) values.push(match[1]);
    });

    if (!values.length) {
      const compact = String(rawText || "").replace(/\s+/g, " ");
      const match = compact.match(/热词\s*[：:]\s*(.+?)(?:视频时长|粉丝数|传播指数|播放|点赞|评论|分享|收藏)/);
      if (match) values.push(match[1]);
    }

    return Array.from(new Set(values.map(cleanLine).filter(Boolean)));
  }

  function extractFollowerCount(rawText, hint) {
    const hinted = cleanLine(hint).replace(/\s+/g, "");
    if (hinted) return hinted;

    const match = String(rawText || "").match(
      /粉丝数\s*[：:]?\s*([\d,.]+(?:\.\d+)?\s*(?:万|亿|w|k)?)/i
    );
    return match ? cleanLine(match[1]).replace(/\s+/g, "") : "";
  }

  function parseRowText(rawText, hints) {
    const safeHints = hints || {};
    const lines = String(rawText || "")
      .split(/\n+/)
      .map(cleanLine)
      .filter(Boolean);
    const followerIndex = lines.findIndex((line) => /粉丝数\s*[：:]?/i.test(line));
    const authorName = chooseAuthor(lines, followerIndex, safeHints.authorName);
    const title = chooseTitle(lines, authorName, safeHints.title);
    const topics = Array.from(new Set([
      ...extractTopics(title),
      ...(safeHints.topics || []).map(cleanLine).filter(Boolean)
    ]));
    const hotWords = Array.from(new Set([
      ...extractHotWords(lines, rawText),
      ...(safeHints.hotWords || []).map(cleanLine).filter(Boolean)
    ]));
    const followerCount = extractFollowerCount(rawText, safeHints.followerCount);

    return {
      authorName,
      followerCount,
      title,
      topics,
      hotWords,
      profileUrl: safeHints.profileUrl || "",
      rawText: String(rawText || ""),
      searchText: [title, topics.join(" "), hotWords.join(" "), authorName].join(" ")
    };
  }

  function rowAccountKey(row) {
    const profile = String(row && row.profileUrl || "");
    try {
      const url = new URL(profile);
      const hash = url.hash.split("?");
      const id = new URLSearchParams(hash[1] || "").get("bloggerId");
      if (url.hostname === "dy.feigua.cn" && hash[0] === "#/blogger-detail/index" && id && /^\d+$/.test(id)) return `blogger:${id}`;
    } catch { /* Older rows can have a name without a profile link. */ }
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
        const matchedKeywords = matchKeywords(row.searchText, keywords);
        if (matchedKeywords.length) {
          exclusion = {
            key,
            authorName: row.authorName,
            matchedKeywords,
            matchedTitle: row.title || "",
            profileUrl: row.profileUrl || ""
          };
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
          videoCount: accountRows.length
        });
      }
    });

    return { accounts, excluded, invalidRows };
  }


export { DEFAULT_KEYWORDS, normalizeText, compactText, canonicalName, parseKeywords, matchKeywords, extractFollowerCount, parseRowText, rowAccountKey, decideRows };
