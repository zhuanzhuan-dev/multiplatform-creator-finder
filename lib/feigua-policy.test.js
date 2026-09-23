import test from 'node:test';
import assert from 'node:assert/strict';
import { feiguaPolicy, feiguaDelayMs, feiguaNextPageWaitMs } from './feigua-policy.js';
import { canResumeRun } from './run-limits.js';
test('default policy migrates video-count settings and bounds random delay',()=>{
 assert.equal(feiguaPolicy({feiguaTarget:{maxItems:1000}}).maxPages,50);
 assert.equal(feiguaDelayMs({},()=>0),4000);assert.equal(feiguaDelayMs({},()=>1),6000);
 assert.equal(feiguaDelayMs({feiguaDelay:{minSeconds:10,maxSeconds:20}},()=>0.5),15000);
});
test('Feigua rest is resumable regardless of video count',()=>{
 assert.equal(canResumeRun({route:{platform:'feigua'},status:'paused',runId:'r',startedAt:'2026-09-10',runTarget:{mode:'pages',maxPages:50},stats:{scanned:2000},restUntil:Date.now()+10800000}),true);
});
test('next-page wait only fills the page interval and the final detail-request gap',()=>{
 assert.equal(feiguaNextPageWaitMs({pageStartedAt:1000,now:2500,delayMs:4000}),2500);
 assert.equal(feiguaNextPageWaitMs({pageStartedAt:1000,lastDetailRequestFinishedAt:9000,now:9300,delayMs:4000}),700);
 assert.equal(feiguaNextPageWaitMs({pageStartedAt:1000,lastDetailRequestFinishedAt:9000,now:10100,delayMs:4000}),0);
 assert.equal(feiguaNextPageWaitMs({pageStartedAt:12000,lastDetailRequestFinishedAt:12000,now:1000,delayMs:4000}),4000);
});
