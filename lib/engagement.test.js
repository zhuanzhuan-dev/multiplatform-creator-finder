import test from 'node:test';
import assert from 'node:assert/strict';
import { newEngagement, reserveEngagement, engagementLimit, restoreEngagement } from './engagement.js';
import { mergeSettings, validateSettings } from './defaults.js';

test('interactions default off and invalid rates cannot be saved', () => {
  assert.deepEqual(mergeSettings().engagement, { rate:10, like:false, collect:false, follow:false });
  for (const rate of ['', null, -1, 101, 1.5, NaN]) assert.ok(validateSettings(mergeSettings({engagement:{rate}})).some(s=>s.includes('互动配额')));
  assert.deepEqual(validateSettings(mergeSettings({engagement:{rate:0}})),[]);
});
test('every prefix stays within the rate cap; 100 videos allow at most ten of each action', () => {
  const ledger=newEngagement({rate:10,like:true,collect:true,follow:true});
  for(let n=1;n<=100;n++){
    ledger.videos=n;ledger.candidate={videoId:`v${n}`,creatorKey:`c${n}`,loopId:'one'};
    for(const action of ['like','collect','follow']){
      reserveEngagement(ledger,action,`v${n}`,'one');
      assert.ok(ledger.used[action]<=Math.floor(n*.1));
    }
  }
  assert.deepEqual(ledger.used,{like:10,collect:10,follow:10});
});
test('reservations survive restart, forbid duplicate toggles, and follow deduplicates by creator',()=>{
  let ledger=newEngagement({rate:100,like:true,collect:true,follow:true});
  ledger.videos=10;ledger.candidate={videoId:'v',creatorKey:'author',loopId:'one'};
  assert.ok(reserveEngagement(ledger,'like','v','one'));
  assert.ok(reserveEngagement(ledger,'follow','v','one'));
  ledger=JSON.parse(JSON.stringify(ledger));
  assert.equal(reserveEngagement(ledger,'like','v','one'),null);
  ledger.candidate.videoId='next';
  assert.equal(reserveEngagement(ledger,'follow','next','one'),null);
  assert.ok(reserveEngagement(ledger,'like','next','one'));
  assert.equal(reserveEngagement(ledger,'collect','next','stale'),null);
  ledger.candidate.videoId=undefined;assert.equal(reserveEngagement(ledger,'collect',undefined,'one'),null);
  ledger.candidate=null;assert.equal(reserveEngagement(ledger,'collect','next','one'),null);
});
test('zero and disabled operations never reserve; new rounds have no used quota',()=>{
  for(const policy of [{rate:0,like:true},{rate:100,like:false}]){
    const l=newEngagement(policy);l.videos=100;l.candidate={videoId:'v',creatorKey:'c',loopId:'l'};
    assert.equal(reserveEngagement(l,'like','v','l'),null);
  }
  assert.equal(engagementLimit(newEngagement({rate:100})),0);
});

test('upgrading the mouse build preserves quota, historical counts and deduplication',()=>{
  const previous={...newEngagement({like:true}),videos:10,used:{like:1,collect:0,follow:0},confirmed:{like:1,collect:0,follow:0},attempts:{'like:v':'confirmed'},candidate:{videoId:'v',creatorKey:'c',loopId:'l'}};
  delete previous.sent;
  const restored=restoreEngagement(previous);
  assert.deepEqual(restored.used,previous.used);assert.equal(restored.sent.like,1);
  assert.equal('confirmed' in restored,false);assert.equal('confirmed' in previous,true);
  assert.equal(reserveEngagement(restored,'like','v','l'),null);
});
