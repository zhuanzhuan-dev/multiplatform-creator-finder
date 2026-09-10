import test from 'node:test';
import assert from 'node:assert/strict';
import { feiguaPolicy, feiguaDelayMs } from './feigua-policy.js';
import { canResumeRun } from './run-limits.js';
test('default policy migrates video-count settings and bounds random delay',()=>{
 assert.equal(feiguaPolicy({feiguaTarget:{maxItems:1000}}).maxPages,50);
 assert.equal(feiguaDelayMs({},()=>0),4000);assert.equal(feiguaDelayMs({},()=>1),6000);
 assert.equal(feiguaDelayMs({feiguaDelay:{minSeconds:10,maxSeconds:20}},()=>0.5),15000);
});
test('Feigua rest is resumable regardless of video count',()=>{
 assert.equal(canResumeRun({route:{platform:'feigua'},status:'paused',runId:'r',startedAt:'2026-09-10',runTarget:{mode:'pages',maxPages:50},stats:{scanned:2000},restUntil:Date.now()+10800000}),true);
});
