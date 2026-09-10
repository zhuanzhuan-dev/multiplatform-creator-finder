import test from 'node:test';
import assert from 'node:assert/strict';
import { launcherState, toolbarState, aggregateTaskState } from './launcher-state.js';
test('launcher stays visible across tabs regardless of panel or task state',()=>{
 const state={status:'running',stats:{scanned:19}};
 assert.equal(launcherState(state,false).visible,true);
 assert.equal(launcherState(state,true).visible,true);
 assert.equal(launcherState({...state,status:'paused'},false).visible,true);
 assert.equal(launcherState({...state,status:'stopped',endedAt:new Date(10000).toISOString()},false,12000).visible,true);
 assert.equal(launcherState({...state,status:'stopped',endedAt:new Date(10000).toISOString()},false,19000).visible,true);
 assert.equal(launcherState({},false).visible,true);
 assert.match(toolbarState(state).title,/19/);
 assert.equal(toolbarState({status:'stopped'}).text,'');
});

test('launcher lists independent platform counts and omits idle and finished tasks',()=>{
 const tasks=[{route:{platform:'douyin'},status:'running',stats:{scanned:461}},{route:{platform:'kuaishou'},status:'running',stats:{scanned:128}},{route:{platform:'feigua'},status:'paused',stats:{scanned:14}}];
 const result=launcherState(aggregateTaskState(tasks));
 assert.equal(result.runningCount,2);
 assert.deepEqual(result.tasks.map(({name,count,unit,label})=>({name,count,unit,label})),[
  {name:'抖音',count:461,unit:'条',label:'运行中'},
  {name:'快手',count:128,unit:'条',label:'运行中'},
  {name:'飞瓜',count:14,unit:'页',label:'已暂停'}
 ]);
 assert.equal(launcherState(aggregateTaskState(tasks.map(t=>({...t,status:'stopped'})))).tasks.length,0);
 assert.equal(launcherState(aggregateTaskState([])).runningCount,0);
});
