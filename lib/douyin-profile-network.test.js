import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfileNetworkCapture} from './douyin-profile-network.js';

function fixture(){
 let listener,body,fail=false;const commands=[];
 const api={onEvent:{addListener:fn=>{listener=fn;}},sendCommand:async(source,method,params)=>{commands.push({source,method,params});if(fail)throw Error('body released');return body;}};
 const capture=createProfileNetworkCapture(api);
 const event=(tabId,method,params)=>listener({tabId},method,params);
 const uid='MS4wLjABAAAAprofile';
 const response=async(tabId,id,patch={})=>{
   await event(tabId,'Network.requestWillBeSent',{requestId:id,request:{url:`https://www-hj.douyin.com/aweme/v1/web/user/profile/other/?sec_user_id=${uid}`,method:'GET',...patch.request}});
   await event(tabId,'Network.responseReceived',{requestId:id,response:{status:patch.status || 200}});
   await event(tabId,'Network.loadingFinished',{requestId:id});
 };
 return {capture,commands,uid,response,setBody:value=>{body=value;},fail:()=>{fail=true;}};
}

test('captured response is scoped to its tab and supports encoded public IP facts',async()=>{
 const f=fixture();await f.capture.enable(1);await f.capture.enable(2);
 f.setBody({body:Buffer.from(JSON.stringify({status_code:0,user:{sec_uid:f.uid,ip_location:'IP属地：上海',city:'重庆'}})).toString('base64'),base64Encoded:true});
 await f.response(1,'public-profile');
 assert.equal(f.capture.read(1,f.uid).ipLocation,'上海');assert.equal(f.capture.read(2,f.uid),null);
 assert.deepEqual(f.commands.map(command=>command.method),['Network.enable','Network.enable','Network.getResponseBody']);
 f.capture.clear(1);assert.equal(f.capture.read(1,f.uid),null);
});

test('unmatched identity, failed or unavailable responses cannot supply an IP fact',async()=>{
 const f=fixture();await f.capture.enable(1);
 f.setBody({body:JSON.stringify({status_code:0,user:{sec_uid:'MS4wOther',ip_location:'IP属地：错误',city:'重庆'}})});
 await f.response(1,'wrong');assert.equal(f.capture.read(1,f.uid),null);
 f.setBody({body:JSON.stringify({status_code:0,user:{sec_uid:f.uid,ip_location:'IP属地：北京'}})});
 await f.response(1,'failed',{status:403});assert.equal(f.capture.read(1,f.uid),null);
 await f.response(1,'post',{request:{method:'POST'}});assert.equal(f.capture.read(1,f.uid),null);
 f.fail();await f.response(1,'released');assert.equal(f.capture.read(1,f.uid),null);
});
