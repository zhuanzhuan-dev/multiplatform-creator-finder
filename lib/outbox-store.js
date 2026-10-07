const DB_NAME = 'dra-upload-queue';
const LEGACY_KEY = 'draOutbox';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const records = request.result.createObjectStore('records', {keyPath:'id'});
      records.createIndex('sequence', 'sequence');
      request.result.createObjectStore('meta');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['records', 'meta'], mode);
    let result, cause;
    const fail = error => { cause = error; tx.abort(); };
    const on = (request, consume) => {
      request.onsuccess = () => { try { consume(request.result); } catch (error) { fail(error); } };
    };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(cause || tx.error || Error('上传队列保存失败，已有记录保留，请检查磁盘空间后重试')); };
    try { operation(tx, value => { result = value; }, on); } catch (error) { fail(error); }
  });
}

export async function loadOutbox(legacy = []) {
  await transaction('readwrite', (tx, _done, on) => {
    const meta = tx.objectStore('meta'), records = tx.objectStore('records');
    on(meta.get('legacyMigrated'), migrated => {
      if (migrated) return;
      let sequence = 0;
      for (const item of legacy) {
        if (!item || typeof item.id !== 'string' || !item.id) throw Error('旧上传队列格式异常，原始记录已保留');
        if (['written', 'duplicate'].includes(item.status)) continue;
        records.put({...item, sequence:++sequence});
      }
      meta.put(sequence, 'sequence');
      meta.put(true, 'legacyMigrated');
    });
  });
  // The committed marker prevents resurrection if Chrome interrupts this cleanup.
  await chrome.storage.local.remove(LEGACY_KEY).catch(() => {});
  return readOutbox();
}

export function readOutbox() {
  return transaction('readonly', (tx, done, on) => {
    on(tx.objectStore('records').index('sequence').getAll(), done);
  });
}

export function writeOutboxChanges(entries, deletedIds = []) {
  if (!entries.length && !deletedIds.length) return Promise.resolve();
  return transaction('readwrite', (tx, _done, on) => {
    const records = tx.objectStore('records'), meta = tx.objectStore('meta');
    for (const id of deletedIds) records.delete(id);
    on(meta.get('sequence'), saved => {
      let sequence = saved || 0, offset = 0;
      function next() {
        if (offset === entries.length) { meta.put(sequence, 'sequence'); return; }
        const item = entries[offset++];
        on(records.get(item.id), previous => {
          records.put({...item, sequence:previous?.sequence ?? ++sequence});
          next();
        });
      }
      next();
    });
  });
}
