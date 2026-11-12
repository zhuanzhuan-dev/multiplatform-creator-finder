import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { HUXUAN_CHANNEL, HUXUAN_SEARCH_PATH, huxuanProfileRequest } from './huxuan-api.js';
import { collectHuxuanProfiles } from './huxuan-capture.js';

const bundle=await build({entryPoints:[new URL('../page/huxuan-page-bridge.js',import.meta.url).pathname],bundle:true,format:'iife',write:false,platform:'browser'});
function bridge() {
 const listeners=[],replies=[],requests=[];
 let httpStatus=200,payload={ret:0,data:{total_num:60,item:[{appid:'sphFixtureOne',nickname:'接口验收',fans_num_level:'50万+',short_video_price:'200000',contact_info:{phone:'business-contact',access_token:'private'}}]}};
 const location={origin:'https://huxuan.qq.com',href:'https://huxuan.qq.com/trade/selection/83740018/selection_list?type=finder-trade'};
 class XHR {open(){}setRequestHeader(){}send(){}}
 const window={fetch:async(url,options)=>{requests.push({url,options});return {ok:httpStatus>=200 && httpStatus<300,status:httpStatus,json:async()=>payload};},addEventListener:(_,fn)=>listeners.push(fn),postMessage:message=>replies.push(message)};
 vm.runInNewContext(bundle.outputFiles[0].text,{window,location,XMLHttpRequest:XHR,URL,URLSearchParams,Headers,AbortController,setTimeout,clearTimeout});
 const seed=(body={platform:1,page:{no:1,size:30},keyword:'美食',sort:{field:'price',order:'asc'}})=>{
  const xhr=new XHR();xhr.open('POST',HUXUAN_SEARCH_PATH);xhr.setRequestHeader('session_id','page-memory-session');xhr.send(JSON.stringify(body));
 };
 const send=async(action,extra={})=>{
  await listeners[0]({source:window,origin:location.origin,data:{channel:HUXUAN_CHANNEL,direction:'request',requestId:'test',action,...extra}});
  return replies.at(-1);
 };
 return {seed,send,requests,location,replies,setPayload:value=>{payload=value;},setHttpStatus:value=>{httpStatus=value;}};
}
test('pagination preserves the complete website search body, including nested and unknown filter fields',async()=>{
 const b=bridge();
 const body={platform:1,page:{no:1,size:30},keyword:'美食',sort:{field:'price',order:'asc'},filters:{category:['生活'],followers:{min:10000,max:500000},region:{cities:['北京']},price:{max:10000}},future_filter:{selected:true}};
 b.seed(body);const status=await b.send('status');
 assert.equal((await b.send('page',{queryKey:status.queryKey,pageNumber:5})).ok,true);
 assert.deepEqual(JSON.parse(b.requests[0].options.body),{...body,page:{...body.page,no:5}});
});
test('homepage recommendations cannot replace the selected market filters',async()=>{
 const b=bridge();b.seed();const context=await b.send('status');
 b.seed(huxuanProfileRequest('sphFixtureOne','recommendations').body);
 assert.equal((await b.send('status')).queryKey,context.queryKey);
 assert.equal((await b.send('page',{queryKey:context.queryKey,pageNumber:2})).ok,true);
 assert.equal(JSON.parse(b.requests[0].options.body).keyword,'美食');
});
for(const status of [403,429])test(`HTTP ${status} stops homepage collection and preserves the original error`,async()=>{
 const b=bridge();b.seed();const context=await b.send('status');b.setHttpStatus(status);
 await assert.rejects(collectHuxuanProfiles({rows:[{authorId:'sphFixtureOne',authorName:'样例'}],checkpoint:{completed:{'sphFixtureOne:list:':{status:'available'}}},request:(authorId,dataset)=>b.send('profile',{authorId,dataset,queryKey:context.queryKey}),save:async()=>assert.fail('an HTTP rejection must not be saved as an unavailable column'),progress:async()=>{},wait:async()=>{},active:()=>true}),new RegExp(`HTTP ${status}`));
 assert.equal(b.requests.length,1,'stop before requesting the next column');
});
test('page bridge reuses exact filters and same-origin login, preserves business contacts and excludes credentials',async()=>{
 const b=bridge();b.seed();
 const status=await b.send('status');assert.equal(status.ok,true);
 assert.equal(JSON.stringify(status).includes('page-memory-session'),false);
 const result=await b.send('page',{queryKey:status.queryKey,pageNumber:2});
 assert.equal(result.ok,true);
 assert.equal(result.page.rows[0].shortPrice,2000);
 assert.equal(result.page.rows[0].listFields.contact_info.phone,'business-contact');
 assert.equal(JSON.stringify(result).includes('private'),false);
 const request=b.requests[0];
 assert.equal(request.url,HUXUAN_SEARCH_PATH);
 assert.equal(request.options.credentials,'same-origin');
 assert.deepEqual(JSON.parse(request.options.body),{platform:1,page:{no:2,size:30},keyword:'美食',sort:{field:'price',order:'asc'}});
 assert.equal(request.options.headers.session_id,'page-memory-session');
 assert.equal(request.options.headers.cookie,undefined);
});
test('changed filters, page size and advertising account continue with the latest search',async()=>{
 const b=bridge();b.seed();const status=await b.send('status');
 b.seed({platform:1,page:{no:3,size:60},keyword:'运动'});
 const changed=await b.send('page',{queryKey:status.queryKey,pageNumber:2});
 assert.equal(changed.ok,true);
 assert.equal(changed.page.pageNumber,3);
 assert.equal(JSON.parse(b.requests.at(-1).options.body).keyword,'运动');
 assert.notEqual(changed.page.queryKey,status.queryKey);
 b.location.href=b.location.href.replace('83740018','12345678');
 assert.equal((await b.send('status')).ok,false);
 b.seed();
 const account=await b.send('page',{queryKey:changed.page.queryKey,pageNumber:4});
 assert.equal(account.ok,true);
 assert.equal(account.page.pageNumber,1);
 assert.equal(b.requests.at(-1).options.headers.account_id,'12345678');
 assert.match(account.page.rows[0].profileUrl,/12345678/);
});
test('a saved page keeps its request source while newer filters are adopted by the next page',async()=>{
 const b=bridge();b.seed();const status=await b.send('status');
 await b.send('page',{queryKey:status.queryKey,pageNumber:1});
 b.location.href=b.location.href.replace('83740018','12345678');b.seed();
 b.setPayload({ret:0,data:{item:{appid:'sphFixtureOne'}}});
 const detail=await b.send('profile',{queryKey:status.queryKey,authorId:'sphFixtureOne',dataset:'detail'});
 assert.equal(detail.ok,true);
 assert.equal(b.requests.at(-1).options.headers.account_id,'83740018');
});
test('expired authentication remains an actionable error rather than an empty final page',async()=>{
 const b=bridge();b.seed();const status=await b.send('status');
 b.setPayload({ret:100005,msg:'未登录'});
 const result=await b.send('page',{queryKey:status.queryKey,pageNumber:1});
 assert.equal(result.ok,false);assert.match(result.error,/未登录/);assert.equal(result.page,undefined);
});
test('homepage endpoints keep identity, audience values and GET parameters; permission denial is distinct from login failure',async()=>{
 const b=bridge();b.seed();const status=await b.send('status');
 b.setPayload({ret:0,data:{item:{appid:'sphFixtureOne',nickname:'接口验收'},user_profile:{age:[{name:'30-39',value:0.2}]},viewer_profile:{gender:[]},access_token:'page-only'}});
 const args={queryKey:status.queryKey,authorId:'sphFixtureOne',dataset:'detail'};
 const result=await b.send('profile',args);
 assert.equal(result.ok,true);assert.equal(result.capture.data.user_profile.age[0].value,0.2);
 assert.equal(result.capture.data.access_token,undefined);
 assert.match(b.requests.at(-1).url,/detail\?appid=sphFixtureOne&inner_from=selection_list/);
 assert.equal(b.requests.at(-1).options.method,'GET');
 b.setPayload({ret:0,data:{item:{appid:'sphDifferentAuthor'}}});
 assert.equal((await b.send('profile',args)).ok,false);
 b.setPayload({ret:123,msg:'权限不足'});
 assert.equal((await b.send('profile',{...args,dataset:'insight'})).unavailable,true);
 b.setPayload({ret:100005,msg:'未登录'});
 assert.equal((await b.send('profile',args)).unavailable,false);
});

test('parallel profile requests have independent signals and cancel stops every pending request',async()=>{
 const listeners=[],signals=[],responses=[];
 const location={origin:'https://huxuan.qq.com',href:'https://huxuan.qq.com/trade/selection/12345678/selection_list?type=finder-trade'};
 class XHR {open(){}setRequestHeader(){}send(){}}
 const window={addEventListener:(_,fn)=>listeners.push(fn),postMessage:m=>responses.push(m),fetch:(_url,options)=>new Promise((_resolve,reject)=>{
  signals.push(options.signal);options.signal.addEventListener('abort',()=>{const error=Error('cancelled');error.name='AbortError';reject(error);});
 })};
 vm.runInNewContext(bundle.outputFiles[0].text,{window,location,XMLHttpRequest:XHR,URL,URLSearchParams,Headers,AbortController,setTimeout,clearTimeout});
 const xhr=new XHR();xhr.open('POST',HUXUAN_SEARCH_PATH);xhr.send(JSON.stringify({platform:1,page:{no:1,size:30}}));
 const send=(action,requestId,dataset)=>listeners[0]({source:window,origin:location.origin,data:{channel:HUXUAN_CHANNEL,direction:'request',requestId,action,dataset,authorId:'sphFixtureOne'}});
 await send('status','status');assert.equal(responses.at(-1).profileConcurrency,true);
 const first=send('profile','one','score'),second=send('profile','two','persona');
 assert.equal(signals.length,2);assert.ok(signals.every(signal=>!signal.aborted));
 await send('cancel','cancel');await Promise.all([first,second]);
 assert.ok(signals.every(signal=>signal.aborted));
 assert.equal(responses.filter(r=>r.ok===false).length,2);
});
