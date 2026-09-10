import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const bundle=await build({entryPoints:[resolve(root,'content/kuaishou-content.js')],bundle:true,format:'iife',write:false,plugins:[{name:'page-fixture',setup(b){
  b.onLoad({filter:/kuaishou-page\.js$/},()=>({contents:`export const KUAISHOU_ACTIVE='.active';export const readKuaishouVideo=()=>fixture.read();export const readKuaishouProfile=()=>({});export const kuaishouBlocked=()=>false;`,loader:'js'}));
  b.onLoad({filter:/dwell\.js$/},()=>({contents:'export const sampleDwellSeconds=()=>1;',loader:'js'}));
  b.onLoad({filter:/rule-engine\.js$/},()=>({contents:'export const evaluateVideoRules=()=>({matched:true});',loader:'js'}));
}}]});
async function run(autoplay){
  let listener,clock=1000,current=1,clicks=0;
  const observed=[];
  let done;const complete=new Promise(resolve=>done=resolve);
  const context={Date:class extends Date {static now(){return clock;}},location:{pathname:'/new-reco'},
    fixture:{read:()=>({videoId:`video-${current}`,sourcePlatform:'kuaishou'})},
    document:{querySelectorAll:()=>[{click:()=>{clicks++;current++;}}]},
    chrome:{runtime:{onMessage:{addListener:f=>{listener=f;}},sendMessage:async m=>{
      if(m.type==='DRA_WAIT'){clock=Math.max(clock,m.until);if(autoplay && observed.length===0)current=2;}
      if(m.type==='DRA_KUAISHOU_VIDEO'){observed.push(m.observation);if(observed.length===2){done();return {ok:true,continue:false};}return {ok:true,continue:true};}
      if(m.type==='DRA_TICK_ERROR')throw Error(m.error);
      return {ok:true};
    }}}};
  vm.runInNewContext(bundle.outputFiles[0].text,context);
  listener({type:'DRA_START_LOOP',runId:'r',loopId:'l',settings:{},rules:{}},null,()=>{});
  await complete;return {observed,clicks};
}
test('Kuaishou loop saves before advancing and verifies the next video',async()=>{
  const result=await run(false);assert.deepEqual(result.observed.map(v=>v.videoId),['video-1','video-2']);assert.equal(result.clicks,1);
});
test('Kuaishou natural autoplay preserves the observed video and avoids double advance',async()=>{
  const result=await run(true);assert.deepEqual(result.observed.map(v=>v.videoId),['video-1','video-2']);assert.equal(result.clicks,0);
});
