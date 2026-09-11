import * as core from "../lib/feigua-parser.js";
  const FOLLOWER_PATTERN = /粉丝数\s*[：:]?/i;

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

  function looksLikeVideoRow(element) {
    const text = element.innerText || element.textContent || "";
    if (!FOLLOWER_PATTERN.test(text)) return false;
    const rect = element.getBoundingClientRect();
    const hasVideoSignals = /视频时长|传播指数|播放|点赞|评论|分享|收藏/.test(text);
    return isRendered(element) && rect.width >= 500 && rect.height >= 45 && rect.height <= 420 && hasVideoSignals;
  }

  function rowFromMarker(marker) {
    const tableRow = marker.closest(".list-row, tbody tr, .el-table__row, .ant-table-row, [role='row']");
    if (tableRow && looksLikeVideoRow(tableRow)) return tableRow;

    let current = marker;
    const viable = [];

    for (let depth = 0; current && current !== document.body && depth < 14; depth += 1) {
      if (looksLikeVideoRow(current)) viable.push(current);

      const parent = current.parentElement;
      if (parent) {
        const matchingSiblings = Array.from(parent.children).filter((child) =>
          FOLLOWER_PATTERN.test(child.innerText || child.textContent || "")
        );
        if (matchingSiblings.length >= 2 && looksLikeVideoRow(current)) return current;
      }
      current = parent;
    }

    viable.sort((left, right) => {
      const a = left.getBoundingClientRect();
      const b = right.getBoundingClientRect();
      return (a.width * a.height) - (b.width * b.height);
    });
    return viable[0] || null;
  }

  function findFollowerMarkers() {
    const elements = Array.from(document.querySelectorAll("body *"));
    const directMatches = elements.filter((element) => FOLLOWER_PATTERN.test(ownText(element)));
    if (directMatches.length) return directMatches.slice(0, 80);

    return elements
      .filter((element) => element.children.length <= 2 && FOLLOWER_PATTERN.test(element.textContent || ""))
      .slice(0, 80);
  }

  function uniqueRows(rows) {
    const unique = [];
    rows.forEach((row) => {
      if (!row || unique.includes(row)) return;
      if (unique.some((known) => known.contains(row) || row.contains(known))) {
        const existingIndex = unique.findIndex((known) => known.contains(row));
        if (existingIndex >= 0 && looksLikeVideoRow(row)) unique[existingIndex] = row;
        return;
      }
      unique.push(row);
    });
    return unique.slice(0, 60);
  }

  function genericRows() {
    const selectors = [
      ".list-row",
      ".el-table__body-wrapper tbody tr",
      ".ant-table-tbody > tr",
      "tbody tr",
      "[class*='video-list'] > [class*='item']",
      "[class*='videoList'] > [class*='item']",
      "[class*='list-content'] > [class*='item']"
    ];
    return uniqueRows(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))).filter(looksLikeVideoRow));
  }

  function textCandidateElements(row) {
    return Array.from(row.querySelectorAll("a, [title], p, span, div"))
      .filter(isRendered)
      .map((element) => {
        const title = element.getAttribute("title") || "";
        const text = (title || ownText(element) || "").replace(/\s+/g, " ").trim();
        return { element, text, rect: element.getBoundingClientRect(), title };
      })
      .filter((item) => item.text && item.text.length <= 260);
  }

  function findMarkerInRow(row) {
    return Array.from(row.querySelectorAll("*"))
      .filter((element) => FOLLOWER_PATTERN.test(ownText(element)))
      .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0] || null;
  }

  function findAuthorHint(row, marker, candidates) {
    if (!marker) return "";
    const markerRect = marker.getBoundingClientRect();

    const scored = candidates
      .filter((item) => {
        if (FOLLOWER_PATTERN.test(item.text) || item.text.length > 80) return false;
        if (/^(视频时长|热词|传播指数|播放|点赞|评论|分享|收藏|发布)/.test(item.text)) return false;
        if (/^[\d.,]+(?:万|w)?$/i.test(item.text)) return false;
        const horizontal = Math.abs(item.rect.left - markerRect.left);
        const vertical = markerRect.top - item.rect.top;
        return horizontal <= 220 && vertical >= -20 && vertical <= 100;
      })
      .map((item) => {
        const horizontal = Math.abs(item.rect.left - markerRect.left);
        const vertical = Math.abs(markerRect.top - item.rect.bottom);
        const anchorBonus = item.element.closest("a") ? 25 : 0;
        return { ...item, score: 200 - horizontal - (vertical * 2) + anchorBonus };
      })
      .sort((a, b) => b.score - a.score);

    return scored[0] ? scored[0].text : "";
  }

  function findTitleHint(row, marker, candidates) {
    const rowRect = row.getBoundingClientRect();
    const markerRect = marker ? marker.getBoundingClientRect() : { left: rowRect.right };

    const scored = candidates
      .filter((item) => {
        if (item.text.length < 3 || item.rect.left >= markerRect.left - 100) return false;
        if (/^(热词|视频时长|粉丝数|传播指数|播放|点赞|评论|分享|收藏)/.test(item.text)) return false;
        return item.rect.top >= rowRect.top - 5 && item.rect.top <= rowRect.bottom;
      })
      .map((item) => {
        const anchorBonus = item.element.closest("a") ? 35 : 0;
        const titleBonus = item.title ? 25 : 0;
        const topBonus = Math.max(0, 80 - Math.abs(item.rect.top - rowRect.top));
        return { ...item, score: Math.min(item.text.length, 120) + anchorBonus + titleBonus + topBonus };
      })
      .sort((a, b) => b.score - a.score);

    return scored[0] ? scored[0].text : "";
  }

  function findProfileUrl(row, marker, authorHint) {
    const anchors = Array.from(row.querySelectorAll("a[href]"));
    const authorAnchor = anchors.find((anchor) => authorHint && (anchor.textContent || "").includes(authorHint));
    if (authorAnchor) return new URL(authorAnchor.href, location.href).href;

    if (marker) {
      const markerRect = marker.getBoundingClientRect();
      const nearby = anchors
        .map((anchor) => ({ anchor, rect: anchor.getBoundingClientRect() }))
        .filter((item) => Math.abs(item.rect.left - markerRect.left) <= 240)
        .sort((a, b) => Math.abs(a.rect.top - markerRect.top) - Math.abs(b.rect.top - markerRect.top))[0];
      if (nearby) return new URL(nearby.anchor.href, location.href).href;
    }
    return "";
  }

  function extractRow(row) {
    const rawText = row.innerText || row.textContent || "";
    const marker = findMarkerInRow(row);
    const candidates = textCandidateElements(row);
    const authorName = row.querySelector(".blogger-name")?.textContent?.trim() || findAuthorHint(row, marker, candidates);
    const title = row.querySelector(".video-title")?.textContent?.trim() || findTitleHint(row, marker, candidates);
    const profileUrl = row.querySelector(".blogger-name[href]")?.href || findProfileUrl(row, marker, authorName);
    const parsed = core.parseRowText(rawText, { authorName, title, profileUrl });
    const links = Array.from(row.querySelectorAll("a[href]")).map(a => a.href);
    parsed.videoId = links.map(link => link.match(/\/(?:share\/)?video\/(\d{8,})|[?&]awemeId=(\d{8,})/)).find(Boolean)?.slice(1).find(Boolean) || "";
    parsed.douyinProfileUrl = links.find(link => /^https:\/\/www\.douyin\.com\/user\//.test(link)) || "";
    parsed.avatarUrl = imageUrl(row.querySelector(".blogger-avatar"));
    parsed.coverUrl = imageUrl(row.querySelector(".video-cover-link img"));
    const duration = rawText.match(/视频时长[：:]\s*(?:(\d+)分)?(?:(\d+)秒)?/);
    parsed.durationSeconds = duration && (duration[1] || duration[2]) ? Number(duration[1] || 0) * 60 + Number(duration[2] || 0) : null;
    let container = row.parentElement;
    while (container && !container.querySelector('.list-hd')) container = container.parentElement;
    const headers = Array.from(container?.querySelector('.list-hd')?.children || []).filter(e => e.classList.contains('col-item'));
    const cells = Array.from(row.children).filter(e => e.classList.contains('col-item'));
    parsed.metrics = {};
    if (headers.length === cells.length) headers.forEach((header, index) => {
      const label = (header.innerText || header.textContent || '').trim();
      if (['传播指数','播放','点赞','评论','分享','收藏','发布时间'].includes(label)) {
        parsed.metrics[label] = (cells[index].innerText || '').replace(/\s+/g, ' ').trim();
      }
    });
    parsed.videoUrl = row.querySelector('.video-cover-link[href]')?.href || '';
    parsed.videoDetailUrl = row.querySelector('.video-title a[href]')?.href || '';
    parsed.hotWords = Array.from(row.querySelectorAll('.video-info .el-tag')).map(e => e.textContent.trim()).filter(Boolean);
    return parsed.authorName ? parsed : null;
  }

  function collectCurrentPage() {
    const knownRows = Array.from(document.querySelectorAll(".list-row")).filter(looksLikeVideoRow);
    const markers = knownRows.length ? [] : findFollowerMarkers();
    const semanticRows = uniqueRows(markers.map(rowFromMarker).filter(Boolean));
    const rows = knownRows.length ? knownRows : semanticRows.length ? semanticRows : genericRows();
    const parsed = rows.map(extractRow).filter(Boolean);

    return {
      pageUrl: location.href,
      pageNumber: pagination()?.number || "",
      pageTitle: document.title,
      capturedAt: new Date().toISOString(),
      rows: parsed,
      pendingImages: rows.reduce((count,row)=>count + pendingImage(row.querySelector('.blogger-avatar')) + pendingImage(row.querySelector('.video-cover-link img')),0),
      diagnostics: {
        strategy: semanticRows.length ? "follower-semantic" : "generic-row",
        markerCount: markers.length,
        candidateCount: rows.length,
        parsedCount: parsed.length
      }
    };
  }


export { collectCurrentPage };

export function imageUrl(element) {
  const image = element?.querySelector?.('img') || element;
  if (!image) return '';
  const source = value => {
    if (!value || !/^(https?:|\/)/i.test(value)) return '';
    try {
      const url = new URL(value, globalThis.location?.href || 'https://dy.feigua.cn/');
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || /(?:^|[\/_.-])(?:placeholder|transparent|blank|loading)(?:[\/_.-]|$)/i.test(url.pathname)) return '';
      return url.href;
    } catch { return ''; }
  };
  // A lazy source is already usable data, even while an offscreen image is not decoded.
  const lazy = ['data-src','data-original','data-lazy-src'].map(name => image.getAttribute?.(name)).map(source).find(Boolean);
  const tiny = image.naturalWidth > 0 && image.naturalWidth <= 2 && image.naturalHeight > 0 && image.naturalHeight <= 2;
  return lazy || (!tiny && [image.currentSrc, image.src, image.getAttribute?.('src')].map(source).find(Boolean)) || '';
}
export function pendingImage(image) {
  // Readiness means a usable URL was extracted, not successful CDN download.
  return imageUrl(image) ? 0 : 1;
}

export function pageFingerprint(page) {
  return JSON.stringify(page.rows.map(row => [core.rowAccountKey(row), row.videoId || row.title]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
export function pagination() {
  const roots = Array.from(document.querySelectorAll('.el-pagination')).filter(isRendered);
  if (roots.length !== 1) return null;
  const next = roots[0].querySelector('button.btn-next');
  if (!next || !isRendered(next)) return null;
  return { next, number: roots[0].querySelector('.el-pager .active')?.textContent?.trim() || '',
    last: next.disabled || next.getAttribute('aria-disabled') === 'true' || next.classList.contains('is-disabled') };
}
export function pageAccessProblem() {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .el-message-box__wrapper, .el-dialog__wrapper, [class*="captcha"], [class*="verify"]')).filter(isRendered);
  const text = dialogs.map(e => e.innerText || '').join(' ');
  if (/验证|访问频繁|操作频繁|登录|权限不足|购买|升级/.test(text)) return '飞瓜页面需要人工处理登录、验证或访问限制';

  if (Array.from(document.querySelectorAll('.el-loading-mask')).some(isRendered)) return 'loading';
  return '';
}

export function pageProblem() {
  return pageAccessProblem() || (browsingSurface() !== 'library' ? '请打开飞瓜视频库后开始' : '');
}
export function browsingSurface() {
  if (/^#\/video\/library\/all(?:[?]|$)/.test(location.hash)) return 'library';
  if (/^#\/video-detail\/index(?:[?]|$)/.test(location.hash)) return 'video';
  if (/^#\/blogger-detail\/index(?:[?]|$)/.test(location.hash)) return 'creator';
  return null;
}
export function collectDetailPage(surface) {
  const visible=selector=>Array.from(document.querySelectorAll(selector)).find(isRendered);
  const author=visible('.blogger-name');
  const title=visible('.video-title-wrapper .el-tooltip')?.textContent?.trim() || '';
  const metrics={};
  for(const col of document.querySelectorAll('.overview-col')) {
    if(!isRendered(col))continue;
    const label=col.querySelector('.v-label')?.textContent?.trim();
    if(label)metrics[label]=col.querySelector('.v-data')?.textContent?.trim() || '';
  }
  // Preserve rendered facts, including currently selected detail sub-tabs.
  const rawText=document.body.innerText.replace(/拖拽到此处完成下载[\s\S]*$/,'').slice(0,80000);
  const profileUrl=surface==='creator'?location.href:author?.href || '';
  const authorName=author?.textContent?.trim() || visible('.blogger-nickname, .nickname')?.textContent?.trim() || '';
  if(!authorName && !title)return {rows:[]};
  const row=core.parseRowText(rawText,{authorName,title:surface==='creator'?authorName:title,profileUrl});
  const params=new URLSearchParams(location.hash.split('?')[1] || '');
  row.videoId=surface==='video'?params.get('awemeId') || '':'';
  const avatar=visible('.blogger-avatar') || visible('a[href*="douyin.com/user/"] img');
  row.avatarUrl=imageUrl(avatar);
  row.douyinProfileUrl=visible('a.blogger-name[href*="douyin.com/user/"]')?.href || '';
  row.uniqueId=rawText.match(/抖音号[：:]?\s*([^\s]+)/)?.[1] || '';
  row.selectedTab=visible('[role="tab"][aria-selected="true"]')?.textContent?.trim() || '';
  row.renderedTables=Array.from(document.querySelectorAll('table')).filter(isRendered).map(table=>table.innerText.slice(0,20000)).slice(0,10);
  const video=visible('a[href*="douyin.com/share/video/"]');
  row.videoUrl=video?.href || '';
  const cover=video?.querySelector('img');
  row.coverUrl=imageUrl(cover);
  row.metrics=metrics;
  row.metrics['发布时间']=rawText.match(/发布时间[：:]\s*([^\n]+)/)?.[1] || '';
  const duration=rawText.match(/视频时长[：:]\s*(?:(\d+)分)?(?:(\d+)秒)?/);
  row.durationSeconds=duration && (duration[1] || duration[2])?Number(duration[1] || 0)*60+Number(duration[2] || 0):null;
  return {pageUrl:location.href,pageTitle:document.title,surface,capturedAt:new Date().toISOString(),pendingImages:pendingImage(avatar)+(cover?pendingImage(cover):0),rows:[row]};
}
