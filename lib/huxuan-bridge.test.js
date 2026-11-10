import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { HUXUAN_CHANNEL, HUXUAN_SEARCH_PATH } from './huxuan-api.js';

const bundle=await build({entryPoints:[new URL('../page/huxuan-page-bridge.js',import.meta.url).pathname],bundle:true,format:'iife',write:false,platform:'browser'});
function bridge() {
 const listeners=[],replies=[],requests=[];
 let payload={ret:0,data:{total_num:60,item:[{appid:'sphFixtureOne',nickname:'接口验收',fans_num_level:'50万+',short_video_price:'200000',contact_info:{phone:'business-contact',access_token:'private'}}]}};
 const location={origin:'https://huxuan.qq.com',href:'https://huxuan.qq.com/trade/selection/83740018/selection_list?type=finder-trade'};
 class XHR {open(){}setRequestHeader(){}send(){}}
 const window={fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>payload};},addEventListener:(_,fn)=>listeners.push(fn),postMessage:message=>replies.push(message)};
 vm.runInNewContext(bundle.outputFiles[0].text,{window,location,XMLHttpRequest:XHR,URL,URLSearchParams,Headers,AbortController,setTimeout,clearTimeout});
 const seed=(body={platform:1,page:{no:1,size:30},keyword:'美食',sort:{field:'price',order:'asc'}})=>{
  const xhr=new XHR();xhr.open('POST',HUXUAN_SEARCH_PATH);xhr.setRequestHeader('session_id','page-memory-session');xhr.send(JSON.stringify(body));
 };
 const send=async(action,extra={})=>{
  await listeners[0]({source:window,origin:location.origin,data:{channel:HUXUAN_CHANNEL,direction:'request',requestId:'test',action,...extra}});
  return replies.at(-1);
 };
 return {seed,send,requests,location,replies,setPayload:value=>{payload=value;}};
}
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
test('changed filters/page size/account reject stale pagination before another fetch',async()=>{
 const b=bridge();b.seed();const status=await b.send('status');
 b.seed({platform:1,page:{no:1,size:60},keyword:'美食'});
 assert.equal((await b.send('page',{queryKey:status.queryKey,pageNumber:2})).ok,false);
 assert.equal(b.requests.length,0);
 b.location.href=b.location.href.replace('83740018','12345678');
 assert.equal((await b.send('status')).ok,false);
 assert.equal(b.requests.length,0);
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
