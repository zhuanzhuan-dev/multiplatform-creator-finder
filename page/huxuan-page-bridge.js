import { HUXUAN_CHANNEL as channel, HUXUAN_SEARCH_PATH, huxuanContext, huxuanQueryKey, projectHuxuanResponse, huxuanProfileRequest, assertHuxuanSuccess, huxuanBusinessData } from '../lib/huxuan-api.js';

(function install() {
  const originalFetch = window.fetch.bind(window);
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalHeader = XMLHttpRequest.prototype.setRequestHeader;
  const requests = new WeakMap();
  let seed = null, pageSeed = null;
  const controllers = new Set();
  const reply = (requestId, result) => window.postMessage({channel, direction:'response', requestId, ...result}, location.origin);
  function capture(url, body, headers = {}) {
    const context = huxuanContext(location.href);
    try {
      if (!context || new URL(url, location.href).origin !== location.origin || new URL(url, location.href).pathname !== HUXUAN_SEARCH_PATH) return;
      const data = typeof body === 'string' ? JSON.parse(body) : null;
      if (!data || data.platform !== 1 || !Number.isInteger(data.page?.no) || !Number.isInteger(data.page?.size) || data.page.size < 1 || data.page.size > 100) return;
      // Homepage recommendations share this endpoint with the market search.
      if (typeof data.keyword === 'string' && data.keyword.startsWith('item_recommend:')) return;
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
    const {requestId, action, pageNumber, queryKey, authorId, dataset, pageIndex, beginDate, endDate} = event.data;
    if (typeof requestId !== 'string') return;
    if (action === 'cancel') { for (const controller of controllers) controller.abort(); return; }
    if (!huxuanContext(location.href) || !seed || action !== 'profile' && huxuanContext(location.href).accountId !== seed.context.accountId) { reply(requestId, {ok:false,error:'请在互选视频号创作者广场完成一次搜索，再开始采集'}); return; }
    if (action === 'status') { pageSeed = seed; reply(requestId, {ok:true,profileConcurrency:true,queryKey:seed.queryKey,pageNumber:seed.body.page.no}); return; }
    if (!['page','profile'].includes(action) || action === 'page' && (!Number.isInteger(pageNumber) || pageNumber < 1)) { reply(requestId,{ok:false,error:'互选页面请求参数无效'}); return; }
    // Finish a saved roster with its original request source; new list pages
    // use the latest website search without ending the collection run.
    const current = action === 'profile' ? pageSeed || seed : seed;
    const nextPage = queryKey === current.queryKey ? pageNumber : current.body.page.no;
    if (action === 'page') pageSeed = current;
    const controller = new AbortController();
    controllers.add(controller);
    const signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const spec = action === 'page' ? {path:HUXUAN_SEARCH_PATH,body:{...current.body,page:{...current.body.page,no:nextPage}}} : huxuanProfileRequest(authorId,dataset,{pageIndex,beginDate,endDate});
      const url = spec.path + (spec.params ? '?'+new URLSearchParams(spec.params) : '');
      const response = await originalFetch(url, {method:spec.body?'POST':'GET',credentials:'same-origin',headers:current.headers,...(spec.body?{body:JSON.stringify(spec.body)}:{}),signal});
      if (!response.ok) throw Error(`互选接口 HTTP ${response.status}`);
      const payload = await response.json();
      assertHuxuanSuccess(payload);
      if (action === 'page') reply(requestId,{ok:true,page:{...projectHuxuanResponse(payload,{pageNumber:nextPage,pageSize:current.body.page.size,...current.context}),queryKey:current.queryKey}});
      else {
        if (dataset === 'detail' && payload.data?.item?.appid !== authorId) throw Error('互选详情响应与当前达人身份不一致');
        if (dataset.startsWith('videos:') && (!Array.isArray(payload.data?.video_list) || !Number.isInteger(payload.data?.total_cnt) || payload.data.total_cnt < 0)) throw Error('互选作品响应缺少列表或总数');
        reply(requestId,{ok:true,capture:{dataset,authorId,pageIndex:pageIndex??null,beginDate:beginDate??null,endDate:endDate??null,endpoint:spec.path,status:payload.data==null?'empty':'available',capturedAt:new Date().toISOString(),data:huxuanBusinessData(payload.data)}});
      }
    } catch (error) { reply(requestId,{ok:false,unavailable:action==='profile' && error.unavailable===true,error:error.name === 'AbortError' ? '互选请求已取消或超时，请检查登录状态后继续' : error.message}); }
    finally { clearTimeout(timer); controllers.delete(controller); }
  });
})();
