import { installFeiguaBrowsing } from './feigua-browse.js';
import { collectCurrentPage, pageFingerprint, pagination, pageProblem } from './feigua-page.js';

import { feiguaDelayMs } from '../lib/feigua-policy.js';

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
  const deadline = Date.now() + 60000;
  const pageUrl = location.href;
  let stable = '';
  let stableSince = 0;
  let pendingImages = 0;
  while (active(run) && Date.now() < deadline) {
    if (location.href !== pageUrl) throw new Error('飞瓜页面已切换，请检查当前页面后继续');
    const problem = pageProblem();
    if (problem && problem !== 'loading') throw new Error(problem);
    const page = collectCurrentPage();
    pendingImages = page.pendingImages || 0;
    page.fingerprint = pageFingerprint(page);
    const pager = pagination();
    const changed = !previous || page.fingerprint !== previous.fingerprint && (!previous.number || pager?.number !== previous.number);
    const completeRows = !page.diagnostics || page.diagnostics.candidateCount === page.diagnostics.parsedCount;
    if (!problem && !pendingImages && page.rows.length && changed && completeRows) {
      const content = JSON.stringify([pager?.number, page.rows]);
      if (stable === content && Date.now() - stableSince >= 1500) return page;
      if (stable !== content) { stable = content; stableSince = Date.now(); }
    } else { stable = ''; stableSince = 0; }
    await wait(run);
  }
  throw new Error(pendingImages ? `等待 60 秒后仍有 ${pendingImages} 个头像或封面地址未就绪，已暂停；请检查页面后继续` : previous ? '等待 60 秒后飞瓜列表仍未更新或稳定，已暂停，请检查页面后继续' : '等待 60 秒后仍未读到完整稳定的飞瓜视频列表，请检查加载或登录后继续');
}
async function loop(run) {
  try {
    let page = null;
    while (active(run)) {
      await send(run, 'DRA_PROGRESS', { phase: 'read' });
      page ||= await readStablePage(run);
      await send(run, 'DRA_PROGRESS', { phase: 'submit' });
      const result = await send(run, 'DRA_FEIGUA_PAGE', { page: {...page, last: pagination()?.last === true} });
      if (!result?.continue) { run.canceled = true; return; }
      const pager = pagination();
      if (!pager) throw new Error('未识别到唯一的飞瓜分页控件，已保存本页并暂停');
      if (pager.last) {
        await send(run, 'DRA_FEIGUA_COMPLETE');
        run.canceled = true;
        return;
      }
      await send(run, 'DRA_PROGRESS', { phase: 'transition' });
      // Allow the user to pause between pages; use the worker clock in background tabs.
      await wait(run, feiguaDelayMs(run.settings));
      const problem = pageProblem();
      if (problem) throw new Error('飞瓜页面状态发生变化，请检查后继续');
      const check = collectCurrentPage();
      if (pageFingerprint(check) !== page.fingerprint) throw new Error('采集后列表被改变，请检查筛选条件后继续');
      if (!active(run)) return;
      pager.next.scrollIntoView({ block: 'center' });
      pager.next.click();
      page = await readStablePage(run, { fingerprint: page.fingerprint, number: pager.number });
      await send(run, 'DRA_PROGRESS', { phase: 'idle', transitionOk: true });
    }
  } catch (error) {
    if (active(run)) {
      await chrome.runtime.sendMessage({ type: 'DRA_PAGE_BLOCKED', runId: run.runId, loopId: run.loopId, reason: error.message || String(error) }).catch(() => undefined);
      run.canceled = true;
    }
  }
}
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'DRA_LOOP_STATUS') {
    reply({ ok: true, running: Boolean(current && active(current)), runId: current?.runId, loopId: current?.loopId, url: location.href, visibilityState: document.visibilityState, hasFocus: document.hasFocus() });
  } else if (message?.type === 'DRA_STOP_LOOP') {
    if (current && (!message.loopId || message.loopId === current.loopId)) current.canceled = true;
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

if (typeof MutationObserver !== 'undefined' && document.body) installFeiguaBrowsing({
  isRunning:()=>Boolean(current && active(current)),
  cancelAutomatic:()=>{if(current)current.canceled=true;}
});
