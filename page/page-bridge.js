(function installDouyinPageBridge() {
  "use strict";

  const CHANNEL = "DOUYIN_AUTO_FINDER_PAGE";

  function feedItems() {
    return [...document.querySelectorAll('[data-e2e="feed-item"]')]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter((item) => item.rect.width > 200 && item.rect.height > 200)
      .sort((a, b) => a.rect.top - b.rect.top);
  }

  function activeItem(items = feedItems()) {
    return [...items].sort((a, b) => {
      const aVisible = Math.max(0, Math.min(a.rect.bottom, innerHeight) - Math.max(a.rect.top, 0));
      const bVisible = Math.max(0, Math.min(b.rect.bottom, innerHeight) - Math.max(b.rect.top, 0));
      return bVisible - aVisible || Math.abs((a.rect.top + a.rect.bottom) / 2 - innerHeight / 2) - Math.abs((b.rect.top + b.rect.bottom) / 2 - innerHeight / 2);
    })[0];
  }

  const WORKS_LIST_SELECTORS = [
    '[data-e2e="author-card-list"]',
    '[data-e2e="user-post-list"]',
    '[data-e2e*="author"][data-e2e*="list"]',
    '[data-e2e*="post"][data-e2e*="list"]'
  ];

  function isWorksLabel(value) {
    const text = String(value || "").normalize("NFKC").replace(/\s+/g, "").trim();
    return /^TA(?:的)?作品(?:\(?\d+\)?)?$/i.test(text);
  }

  function visibleArea(element) {
    if (!element?.getBoundingClientRect) return 0;
    const rect = element.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    return width * height;
  }

  function worksTab(scope = activeItem()?.element) {
    const selector = '[role="tab"], [data-e2e*="tab"], button, [tabindex], a, span';
    const candidates = [...document.querySelectorAll(selector)]
      .filter((element) => isWorksLabel(element.getAttribute("aria-label") || element.textContent))
      .map((label) => label.closest('[role="tab"], [data-e2e*="tab"], button, [tabindex], a') || label)
      .filter((element, index, all) => all.indexOf(element) === index)
      .map((element) => ({ element, area: visibleArea(element), inCurrentFeed: Boolean(scope?.contains(element)) }))
      .filter((item) => item.area > 0)
      .sort((a, b) => Number(b.inCurrentFeed) - Number(a.inCurrentFeed) || b.area - a.area);
    return candidates[0]?.element || null;
  }

  function worksList(tab = worksTab(), scope = activeItem()?.element) {
    for (const selector of WORKS_LIST_SELECTORS) {
      const list = scope?.querySelector(selector);
      if (list) return list;
    }
    let root = tab;
    while (root?.parentElement && root !== document.body) {
      const candidates = [...root.querySelectorAll('[role="list"], ul, [class*="work"], [class*="post"]')]
        .filter((element) => element.querySelector('a[href*="/video/"], img[src]'))
        .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
      if (candidates[0]) return candidates[0];
      root = root.parentElement;
    }
    return null;
  }

  function tabSelected(tab) {
    if (!tab) return false;
    const className = typeof tab.className === "string" ? tab.className : "";
    return tab.getAttribute("aria-selected") === "true"
      || tab.getAttribute("data-state") === "active"
      || tab.classList.contains("semi-tabs-tab-active")
      || /(?:^|[-_\s])(active|selected|current)(?:$|[-_\s])/i.test(className)
      || tab.getAttribute("tabindex") === "0";
  }

  function pointForElement(element, target) {
    if (!element || visibleArea(element) <= 0) return null;
    const rect = element.getBoundingClientRect();
    return {
      target,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function commentControl() {
    const current = activeItem()?.element;
    if (!current) return null;
    const selectors = [
      '[data-e2e="feed-comment-icon"]',
      '[data-e2e="comment-icon"]',
      '[data-e2e="video-comment"]',
      '[aria-label*="评论"]',
      '[title*="评论"]'
    ];
    for (const selector of selectors) {
      const element = current.querySelector(selector);
      if (!element) continue;
      return element.closest("button") || element;
    }
    return null;
  }

  function creatorPanelUiState() {
    const scope = activeItem()?.element;
    const tab = worksTab(scope);
    const list = worksList(tab, scope);
    const selected = tabSelected(tab);
    const hasWorks = Boolean(list?.querySelector('a[href*="/video/"], img[src]'));
    return {
      ok: true,
      panelState: {
        present: Boolean(tab),
        selected,
        hasWorks,
        ready: Boolean(tab && list && hasWorks && (selected || tab.getAttribute("role") !== "tab"))
      },
      targets: {
        comment: pointForElement(commentControl(), "comment"),
        works: pointForElement(tab, "works")
      }
    };
  }

  function feedTarget() {
    const current = activeItem()?.element;
    if (!current) return { ok: false, reason: "当前推荐卡片尚未加载" };
    const rect = current.getBoundingClientRect();
    return {
      ok: true,
      target: {
        target: "feed",
        x: Math.round(rect.left + rect.width * 0.35),
        y: Math.round(rect.top + rect.height * 0.5),
        deltaY: Math.max(600, Math.round(rect.height))
      }
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.direction !== "request") return;
    const { id, command, payload = {} } = event.data;
    Promise.resolve().then(async () => {
      if (command === "GET_CREATOR_PANEL_STATE") return creatorPanelUiState();
      if (command === "GET_FEED_TARGET") return feedTarget();
      return { ok: false, reason: `未知页面指令：${command}` };
    }).catch((error) => ({ ok: false, reason: error?.message || String(error) }))
      .then((result) => window.postMessage({ channel: CHANNEL, direction: "response", id, result }, "*"));
  });
})();
