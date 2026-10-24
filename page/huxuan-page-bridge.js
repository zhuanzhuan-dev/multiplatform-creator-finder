import { HUXUAN_CHANNEL as channel, HUXUAN_SEARCH_PATH, huxuanContext, huxuanQueryKey, projectHuxuanResponse } from '../lib/huxuan-api.js';

(function install() {
  const originalFetch = window.fetch.bind(window);
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalHeader = XMLHttpRequest.prototype.setRequestHeader;
  const requests = new WeakMap();
  let seed = null, controller = null;
  const reply = (requestId, result) => window.postMessage({channel, direction:'response', requestId, ...result}, location.origin);
  function capture(url, body, headers = {}) {
    const context = huxuanContext(location.href);
    try {
      if (!context || new URL(url, location.href).origin !== location.origin || new URL(url, location.href).pathname !== HUXUAN_SEARCH_PATH) return;
      const data = typeof body === 'string' ? JSON.parse(body) : null;
      if (!data || data.platform !== 1 || !Number.isInteger(data.page?.no) || !Number.isInteger(data.page?.size) || data.page.size < 1 || data.page.size > 100) return;
      const safeHeaders = {'content-type':'application/json', account_id:context.accountId};
      for (const key of ['session_id','login_role']) if (typeof headers[key] === 'string') safeHeaders[key] = headers[key];
      seed = {body:data, headers:safeHeaders, context, queryKey:huxuanQueryKey(data, context.accountId)};
    } catch { /* Unrelated or non-JSON requests do not define a list query. */ }
  }
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    requests.set(this, {url:String(url), headers:{}});
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    const request = requests.get(this);
    if (request) request.headers[String(name).toLowerCase()] = String(value);
    return originalHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const request = requests.get(this);
    if (request) capture(request.url, body, request.headers);
    return originalSend.call(this, body);
  };
  window.fetch = function(input, options) {
    if (typeof input === 'string' || input instanceof URL) capture(String(input), options?.body, Object.fromEntries(new Headers(options?.headers)));
    return originalFetch(input, options);
  };
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel || event.data.direction !== 'request') return;
    const {requestId, action, pageNumber, queryKey} = event.data;
    if (typeof requestId !== 'string') return;
    if (action === 'cancel') { controller?.abort(); return; }
    if (!huxuanContext(location.href) || !seed || huxuanContext(location.href).accountId !== seed.context.accountId) { reply(requestId, {ok:false,error:'请在互选视频号创作者广场完成一次搜索，再开始采集'}); return; }
    if (action === 'status') { reply(requestId, {ok:true,queryKey:seed.queryKey,pageNumber:seed.body.page.no}); return; }
    if (action !== 'page' || !Number.isInteger(pageNumber) || pageNumber < 1 || queryKey !== seed.queryKey) { reply(requestId,{ok:false,error:'互选筛选条件或账号已变化，请结束本轮后重新开始'}); return; }
    const current = seed;
    controller?.abort(); controller = new AbortController();
    const signal = controller.signal;
    const timer = setTimeout(() => controller?.signal === signal && controller.abort(), 25000);
    try {
      const response = await originalFetch(HUXUAN_SEARCH_PATH, {method:'POST',credentials:'same-origin',headers:current.headers,body:JSON.stringify({...current.body,page:{...current.body.page,no:pageNumber}}),signal});
      if (!response.ok) throw Error(`互选接口 HTTP ${response.status}`);
      const payload = await response.json();
      if (seed?.queryKey !== queryKey || !huxuanContext(location.href) || huxuanContext(location.href).accountId !== current.context.accountId) throw Error('互选筛选条件或账号已变化，请结束本轮后重新开始');
      reply(requestId,{ok:true,page:{...projectHuxuanResponse(payload,{pageNumber,pageSize:current.body.page.size,...current.context}),queryKey}});
    } catch (error) { reply(requestId,{ok:false,error:error.name === 'AbortError' ? '互选请求已取消或超时，请检查登录状态后继续' : error.message}); }
    finally { clearTimeout(timer); }
  });
})();
