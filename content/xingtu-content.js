import { installXingtuBrowsing } from './xingtu-browse.js';
import { collectCurrentPage, pageFingerprint, pagination, pageProblem } from './xingtu-page.js';
import { xingtuDelayMs } from '../lib/xingtu-policy.js';

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
    if (location.href !== pageUrl) throw new Error('星图页面已切换，请检查当前页面后继续');
    const problem = pageProblem();
    if (problem && problem !== 'loading') throw new Error(problem);
    const page = collectCurrentPage();
    pendingImages = page.pendingImages || 0;
    page.fingerprint = pageFingerprint(page);
    const pager = pagination();
    const changed = !previous || page.fingerprint !== previous.fingerprint && (!previous.number || pager?.number !== previous.number);
    const completeRows = page.rows.length > 0;
    if (!problem && !pendingImages && completeRows && changed) {
      const content = JSON.stringify([pager?.number, page.rows]);
      if (stable === content && Date.now() - stableSince >= 1500) return page;
      if (stable !== content) { stable = content; stableSince = Date.now(); }
    } else { stable = ''; stableSince = 0; }
    await wait(run);
  }
  throw new Error(pendingImages ? `等待 60 秒后仍有 ${pendingImages} 个头像地址未就绪，已暂停；请检查页面后继续` : previous ? '等待 60 秒后星图列表仍未更新或稳定，已暂停，请检查页面后继续' : '等待 60 秒后仍未读到完整稳定的星图达人列表，请检查加载或登录后继续');
}
async function loop(run) {
  try {
    let page = null;
    while (active(run)) {
      await send(run, 'DRA_PROGRESS', { phase: 'read' });
      page ||= await readStablePage(run);
      await send(run, 'DRA_PROGRESS', { phase: 'submit' });
      const result = await send(run, 'DRA_XINGTU_PAGE', { page: {...page, last: pagination()?.last === true} });
      if (!result?.continue) { run.canceled = true; return; }
      const pager = pagination();
      if (!pager) throw new Error('未识别到唯一的星图分页控件，已保存本页并暂停');
      if (pager.last) {
        await send(run, 'DRA_XINGTU_COMPLETE');
        run.canceled = true;
        return;
      }
      await send(run, 'DRA_PROGRESS', { phase: 'transition' });
      await wait(run, xingtuDelayMs(run.settings));
      const problem = pageProblem();
      if (problem) throw new Error('星图页面状态发生变化，请检查后继续');
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

if (typeof MutationObserver !== 'undefined' && document.body) installXingtuBrowsing({
  isRunning:()=>Boolean(current && active(current)),
  cancelAutomatic:()=>{if(current)current.canceled=true;}
});
