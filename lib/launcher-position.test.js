import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLauncherPosition, launcherCoordinates, launcherPositionFromPoint, LAUNCHER_SIZE } from './launcher-position.js';
test('preserves the existing vertical setting when migrating to XY',()=>{
 assert.deepEqual(normalizeLauncherPosition(.4),{x:1,y:.4});
 assert.deepEqual(normalizeLauncherPosition(),{x:1,y:.65});
 assert.deepEqual(normalizeLauncherPosition({x:-2,y:4}),{x:0,y:1});
});
test('drag moves both axes and clamps within viewport',()=>{
 const p=launcherPositionFromPoint(108,208,1000,800);
 assert.deepEqual(launcherCoordinates(p,1000,800),{left:108,top:208});
 const edge=launcherCoordinates(launcherPositionFromPoint(2000,-100,1000,800),1000,800);
 assert.equal(edge.left,1000-LAUNCHER_SIZE-8);assert.equal(edge.top,8);
});
test('resize keeps saved position inside the smaller viewport',()=>{
 const p=launcherCoordinates({x:1,y:1},320,200);
 assert.equal(p.left+LAUNCHER_SIZE,312);assert.equal(p.top+LAUNCHER_SIZE,192);
});

test('compact drag roundtrips and clamps using actual button size',()=>{
 const p=launcherPositionFromPoint(120,230,1000,800,28);
 assert.deepEqual(launcherCoordinates(p,1000,800,28),{left:120,top:230});
 assert.deepEqual(launcherCoordinates({x:1,y:1},320,200,28),{left:284,top:164});
});
