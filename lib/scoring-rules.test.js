import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRules } from './defaults.js';
import { scoreCreator, validateRules } from './rule-engine.js';
import { decideKuaishou } from './kuaishou-task.js';

const profile = { followers: 200000, averageLikes: 5000, kuaishouId: 'fixture', authorName: '美食' };
const observation = { contentType: 'video', durationSeconds: 120, likes: 5000, caption: '美食' };
const categories = [{ name: '美食', score: 20 }];
const score = rules => scoreCreator({ profile, observation, categories, rules });

test('legacy preferred likes migrate into visible scoring and grading, and affect decisions', () => {
  const before = mergeRules();
  assert.equal(score(before).level, 'S');
  assert.equal(score(before).score, 50);
  const migrated = mergeRules({ hard: { preferredVideoLikes: 6000 } });
  assert.equal(migrated.hard.preferredVideoLikes, undefined);
  assert.equal(migrated.scoring.likes[1].min, 6000);
  assert.equal(score(migrated).level, 'A');
  assert.equal(score(migrated).score, 40);
  assert.equal(decideKuaishou(observation, profile, migrated).score.level, 'A');
  assert.deepEqual(mergeRules(JSON.parse(JSON.stringify(migrated))), migrated);
});

test('custom scoring uses max matching band, honors zero, unlimited ranges and empty lists', () => {
  const rules = mergeRules();
  rules.scoring.likes = [{ min: 0, points: 7 }, { min: 5000, points: 13 }];
  rules.scoring.followers = [{ min: 0, max: null, points: 17 }];
  assert.equal(score(rules).score, 50);
  rules.scoring.likes[1].points = 0;
  assert.equal(score(rules).score, 44);
  rules.scoring.likes = [];
  rules.scoring.followers = [];
  assert.equal(score(mergeRules(rules)).score, 20);
});

test('level controls set boundaries, priority, enabled state and category requirement', () => {
  const rules = mergeRules();
  const s = rules.scoring.levels.S;
  s.minFollowers = 200000; s.maxFollowers = 200000; s.minAverageLikes = 5000;
  assert.equal(score(rules).level, 'S');
  s.minAverageLikes = 5001;
  assert.equal(score(rules).level, 'A');
  rules.scoring.levels.A.enabled = false;
  assert.equal(score(rules).level, 'B');
  s.minAverageLikes = 0; s.maxFollowers = null;
  assert.equal(scoreCreator({profile,rules}).level, 'B');
  s.requireCategory = false;
  assert.equal(scoreCreator({profile,rules}).level, 'S');
  s.enabled = false;
  assert.equal(score(rules).level, 'B');
});

test('missing average likes uses observed likes instead of treating null as zero', () => {
  assert.equal(scoreCreator({profile:{...profile, averageLikes:null},observation,categories,rules:mergeRules()}).level, 'S');
});

test('invalid scoring is rejected; nullable bounds and zero thresholds are accepted', () => {
  for (const mutate of [
    rules => { rules.scoring.likes[0].min = ''; },
    rules => { rules.scoring.followers[0].max = 5; },
    rules => { rules.scoring.likes[0].points = 101; },
    rules => { rules.scoring.levels.S.minAverageLikes = -1; },
    rules => { rules.scoring.levels.A.maxFollowers = 2; },
    rules => { rules.scoring.levels.S.requireCategory = 'false'; }
  ]) {
    const rules = mergeRules(); mutate(rules);
    assert.ok(validateRules(rules).length);
  }
  const rules = mergeRules({hard:{preferredVideoLikes:0}});
  rules.scoring.followers[0].max = null;
  rules.scoring.levels.S.maxFollowers = null;
  assert.deepEqual(validateRules(rules), []);
});
