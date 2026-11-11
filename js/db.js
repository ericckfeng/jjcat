// 照片存在 IndexedDB（容量比 localStorage 大很多），不可用時退回記憶體
const DB_NAME = 'diet-tracker';
const STORE = 'photos';
const memory = new Map();
let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(err => {
      dbPromise = Promise.reject(err);
      throw err;
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const photoDB = {
  async get(id) {
    try { return (await run('readonly', s => s.get(id))) || null; }
    catch (e) { return memory.get(id) || null; }
  },
  async put(id, dataUrl) {
    try { await run('readwrite', s => s.put(dataUrl, id)); }
    catch (e) { memory.set(id, dataUrl); }
  },
  async del(id) {
    memory.delete(id);
    try { await run('readwrite', s => s.delete(id)); } catch (e) { /* ignore */ }
  },
  async getMany(ids) {
    const out = {};
    for (const id of ids) {
      const v = await this.get(id);
      if (v) out[id] = v;
    }
    return out;
  }
};
