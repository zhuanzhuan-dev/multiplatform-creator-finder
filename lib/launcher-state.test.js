import test from 'node:test';
import assert from 'node:assert/strict';
import { launcherState, toolbarState } from './launcher-state.js';
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
