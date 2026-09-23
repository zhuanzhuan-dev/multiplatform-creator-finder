import { installFeiguaBrowsing } from './feigua-browse.js';
import { cancelFeiguaIdentities, installFeiguaApiCache, requestFeiguaIdentities } from './feigua-api-cache.js';
import { collectCurrentPage, pageFingerprint, pagination, pageProblem, revealList } from './feigua-page.js';

import { FEIGUA_IMAGE_GRACE_MS, FEIGUA_PAGE_WAIT_MS, FEIGUA_ROW_STABLE_MS, feiguaDelayMs } from '../lib/feigua-policy.js';

function pageStabilityKey(page, pager) {
  return JSON.stringify([
    pager?.number || page.pageNumber || '',
    page.rows.map(row => [row.authorName, row.videoId || row.title, row.likes, row.metrics, row.followerCount])
  ]);
}

let current = null;
function active(run) { return current === run && !run.canceled; }
async function send(run, type, data = {}) {
  if (!active(run)) throw new Error('任务已暂停');
  const response = await chrome.runtime.sendMessage({ type, runId: run.runId, loopId: run.loopId, ...data });
  if (!active(run)) throw new Error('任务已暂停');
  if (response?.ok === false) throw new Error(response.error || '任务已暂停');
  return response;
}
async function wait(run, milliseconds = 750) {
  await send(run, 'DRA_WAIT', { until: Date.now() + milliseconds });
}
async function readStablePage(run, previous = null) {
  const deadline = Date.now() + FEIGUA_PAGE_WAIT_MS;
  let identityStarted = 0;
  const pageUrl = location.href;
  let stable = '';
  let stableSince = 0;
  let lastPage = null;
  while (active(run) && (Date.now() < deadline || identityStarted && Date.now() - identityStarted < 120_000)) {
    if (location.href !== pageUrl) throw new Error('飞瓜页面已切换，请检查当前页面后继续');
    const problem = pageProblem();
    if (problem && problem !== 'loading') throw new Error(problem);
    revealList();
    const page = collectCurrentPage();
    const pendingImages = page.pendingImages || 0;
    page.fingerprint = pageFingerprint(page);
    lastPage = page;
    const pager = pagination();
    const changed = !previous || page.fingerprint !== previous.fingerprint && (!previous.number || pager?.number !== previous.number);
    const completeRows = !page.diagnostics || page.diagnostics.candidateCount === page.diagnostics.parsedCount;
    if (!problem && page.rows.length && changed && completeRows) {
      const content = pageStabilityKey(page, pager);
      if (stable !== content) {
        stable = content;
        stableSince = Date.now();
      }
      const rowsSettled = Date.now() - stableSince >= FEIGUA_ROW_STABLE_MS;
      const imagesReady = !pendingImages || Date.now() - stableSince >= FEIGUA_IMAGE_GRACE_MS;
      if (rowsSettled && imagesReady) {
        const identity = requestFeiguaIdentities(page.rows);
        if (identity.phase === 'blocked') throw Error(identity.error || '飞瓜身份补数已暂停');
        if (identity.phase === 'done') {
          page.rows = collectCurrentPage().rows;
          return page;
        }
        identityStarted ||= Date.now();
      }
    } else {
      stable = '';
      stableSince = 0;
    }
    await wait(run);
  }
  if (identityStarted) throw Error('飞瓜身份补数等待超过 120 秒，采集已暂停');
  const error = new Error('等待 30 秒后列表仍未更新或稳定，尝试翻下一页；本次未计为采集成功');
  error.code = 'FEIGUA_PAGE_TIMEOUT';
  error.page = lastPage;
  throw error;
}
async function loop(run) {
  try {
    let previous = null;
    while (active(run)) {
      await send(run, 'DRA_PROGRESS', { phase: 'read' });
      let page = null;
      let timedOut = false;
      try {
        page = await readStablePage(run, previous);
      } catch (error) {
        if (error.code !== 'FEIGUA_PAGE_TIMEOUT') throw error;
        timedOut = true;
        page = error.page;
        await send(run, 'DRA_FEIGUA_PAGE_TIMEOUT', {
          pageUrl: location.href,
          pageNumber: pagination()?.number || page?.pageNumber || '',
          reason: error.message
        });
      }
      if (!timedOut) {
        await send(run, 'DRA_PROGRESS', { phase: 'submit' });
        const result = await send(run, 'DRA_FEIGUA_PAGE', { page: {...page, last: pagination()?.last === true} });
        if (!result?.continue) { run.canceled = true; return; }
      }
      const pager = pagination();
      if (!pager) throw new Error('未识别到可用的飞瓜分页控件，无法点击下一页，请检查页面后继续');
      if (pager.last) {
        if (pageProblem() === 'loading') throw new Error('飞瓜仍在加载且下一页按钮不可用，请检查页面后继续');
        await send(run, 'DRA_FEIGUA_COMPLETE');
        run.canceled = true;
        return;
      }
      await send(run, 'DRA_PROGRESS', { phase: 'transition' });
      await wait(run, feiguaDelayMs(run.settings));
      const problem = pageProblem();
      if (problem && problem !== 'loading') throw new Error(problem);
      const nextPager = pagination();
      if (!nextPager) throw new Error('未识别到可用的飞瓜分页控件，无法点击下一页，请检查页面后继续');
      // A site-driven refresh is read as a new page; trusted user takeover cancels the run separately.
      if (nextPager.number !== pager.number || !timedOut && (problem === 'loading' || pageFingerprint(collectCurrentPage()) !== page.fingerprint)) {
        previous = null;
        continue;
      }
      if (nextPager.last) {
        if (problem === 'loading') throw new Error('飞瓜仍在加载且下一页按钮不可用，请检查页面后继续');
        await send(run, 'DRA_FEIGUA_COMPLETE');
        run.canceled = true;
        return;
      }
      if (!active(run)) return;
      previous = { fingerprint: page?.fingerprint || '', number: nextPager.number };
      nextPager.next.scrollIntoView({ block: 'center' });
      nextPager.next.click();
      await send(run, 'DRA_PROGRESS', { phase: 'idle', transitionOk: true });
    }
  } catch (error) {
    if (active(run)) {
      if (typeof window !== 'undefined') cancelFeiguaIdentities();
      await chrome.runtime.sendMessage({ type: 'DRA_PAGE_BLOCKED', runId: run.runId, loopId: run.loopId, reason: error.message || String(error) }).catch(() => undefined);
      run.canceled = true;
    }
  }
}
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'DRA_LOOP_STATUS') {
    reply({ ok: true, running: Boolean(current && active(current)), runId: current?.runId, loopId: current?.loopId, url: location.href, visibilityState: document.visibilityState, hasFocus: document.hasFocus() });
  } else if (message?.type === 'DRA_STOP_LOOP') {
    if (current && (!message.loopId || message.loopId === current.loopId)) { current.canceled = true; if (typeof window !== 'undefined') cancelFeiguaIdentities(); }
    reply({ ok: true });
  } else if (message?.type === 'DRA_START_LOOP') {
    if (current?.loopId === message.loopId && active(current)) { reply({ ok: true }); return false; }
    if (current) current.canceled = true;
    current = { runId: message.runId, loopId: message.loopId, canceled: false, settings: message.settings || {} };
    void loop(current);
    reply({ ok: true });
  }
  return false;
});

if (typeof window !== 'undefined') installFeiguaApiCache();
if (typeof MutationObserver !== 'undefined' && document.body) installFeiguaBrowsing({
  isRunning:()=>Boolean(current && active(current)),
  cancelAutomatic:()=>{if(current)current.canceled=true;}
});
