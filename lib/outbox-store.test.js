import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {loadOutbox, readOutbox, writeOutboxChanges} from './outbox-store.js';

function setup(legacy = [], failCleanup = false) {
  globalThis.indexedDB = new IDBFactory();
  const saved = {draOutbox:legacy};
  globalThis.chrome = {storage:{local:{remove:async key => {
    if (failCleanup) throw Error('cleanup interrupted');
    delete saved[key];
  }, set:async () => { throw Error('queue must not rewrite Chrome local storage'); }}}};
  return saved;
}
const item = (id, status = 'pending', extra = {}) => ({id, status, payload:{record_id:id, feed_index:1}, ...extra});

test('migrates once, cleans acknowledgements and preserves failed and unresolved records', async () => {
  const legacy = [item('accepted','written'), item('duplicate','duplicate'), item('waiting','pending',{transitionPending:true}), item('failed','write-error',{retryAt:Date.now()+60000}), item('rejected','dead'), item('test','dry-run')];
  const saved = setup(legacy, true);
  assert.deepEqual((await loadOutbox(legacy)).map(v => v.id), ['waiting','failed','rejected','test']);
  await writeOutboxChanges([], ['waiting']);
  assert.deepEqual((await loadOutbox(legacy)).map(v => v.id), ['failed','rejected','test']);
  assert.ok(saved.draOutbox, 'an interrupted cleanup cannot reimport deleted queue records');
});

test('invalid or aborted migration retains the legacy copy and permits a complete retry', async () => {
  const legacy = [item('first'), {status:'pending'}], saved = setup(legacy);
  await assert.rejects(loadOutbox(legacy), /格式异常/);
  assert.equal((await readOutbox()).length, 0);
  assert.equal(saved.draOutbox, legacy);
  assert.deepEqual((await loadOutbox([item('first'), item('second')])).map(v => v.id), ['first','second']);
  assert.equal(saved.draOutbox, undefined);
});

test('incremental updates and deletions preserve unrelated records, order and concurrent inserts', async () => {
  setup(); await loadOutbox();
  await writeOutboxChanges(Array.from({length:1000}, (_,i) => item(`record-${i}`)));
  await Promise.all([writeOutboxChanges([item('new-a')]), writeOutboxChanges([item('new-b')])]);
  await writeOutboxChanges([item('record-500','write-error',{attempts:1})], ['record-0']);
  const rows = await readOutbox();
  assert.equal(rows.length, 1001);
  assert.equal(rows[0].id, 'record-1');
  assert.equal(rows.find(v => v.id === 'record-500').attempts, 1);
  assert.deepEqual(rows.slice(-2).map(v => v.id), ['new-a','new-b']);
});

test('an aborted update keeps both the deleted record and its previous retry state', async () => {
  setup(); await loadOutbox([item('old')]);
  await assert.rejects(writeOutboxChanges([item('new'), item('bad','pending',{payload:{notCloneable(){}}})], ['old']));
  assert.deepEqual((await readOutbox()).map(v => v.id), ['old']);
  await writeOutboxChanges([item('new')], ['old']);
  assert.deepEqual((await readOutbox()).map(v => v.id), ['new']);
});
