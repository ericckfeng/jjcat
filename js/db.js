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

// 共用資料庫（管理者發佈、App 自動下載更新）：只存在這台，不進同步檔（換裝置時再下載一次）
// 和照片分開一個資料庫，不動照片的資料庫版本
const SHARED_DB = 'diet-tracker-shared';
let sharedPromise = null;
function openShared() {
  if (!sharedPromise) {
    sharedPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
      const req = indexedDB.open(SHARED_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('packs');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(err => {
      sharedPromise = Promise.reject(err);
      throw err;
    });
  }
  return sharedPromise;
}
async function runShared(mode, fn) {
  const db = await openShared();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('packs', mode);
    const req = fn(tx.objectStore('packs'));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const sharedMemory = new Map();
export const sharedDB = {
  async get(key) {
    try { return (await runShared('readonly', s => s.get(key))) || null; }
    catch (e) { return sharedMemory.get(key) || null; }
  },
  async put(key, pack) {
    try { await runShared('readwrite', s => s.put(pack, key)); }
    catch (e) { sharedMemory.set(key, pack); }
  },
  async del(key) {
    sharedMemory.delete(key);
    try { await runShared('readwrite', s => s.delete(key)); } catch (e) { /* ignore */ }
  }
};
