// 同步用的「逐筆合併」：兩台裝置的資料合在一起，不會互相覆蓋
// 規則：
//   - 飲食記錄、常吃清單：以 id 為單位，修改時間（updatedAt）較新的勝出
//   - 刪除：留下刪除標記（tomb），刪除時間比記錄新就刪掉，避免刪掉的又跑回來
//   - 每日身體／備註：以「欄位」為單位，各自比較修改時間（_t）
//   - 目標、個人資料：整組比較修改時間
//   - 看不懂的最上層資料（新版 App 才有的，例如自訂食物庫）：原樣保留，見 mergeExtra()
// 這個檔案只有純函式，不碰畫面或儲存，方便測試。

export const SYNC_VERSION = 3;
const TOMB_KEEP_MS = 400 * 24 * 3600 * 1000;

function ts(x) { return (x && Number(x.updatedAt)) || 0; }

function mergeTomb(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(Number(out[k]) || 0, Number(v) || 0);
  const cutoff = Date.now() - TOMB_KEEP_MS;
  for (const k of Object.keys(out)) if (out[k] < cutoff) delete out[k];
  return out;
}

function alive(item, tombTime) {
  return !(tombTime && tombTime >= ts(item));
}

function mergeLogs(la = {}, lb = {}, tomb) {
  const byId = new Map(); // id -> { date, item }
  const add = (logs) => {
    for (const [date, list] of Object.entries(logs || {})) {
      for (const item of list || []) {
        if (!item || !item.id) continue;
        const cur = byId.get(item.id);
        if (!cur || ts(item) > ts(cur.item)) byId.set(item.id, { date, item });
      }
    }
  };
  add(la);
  add(lb);
  const out = {};
  for (const { date, item } of byId.values()) {
    if (!alive(item, tomb['e:' + item.id])) continue;
    (out[date] || (out[date] = [])).push(item);
  }
  return out;
}

function mergeQuick(qa = [], qb = [], tomb) {
  const map = new Map();
  const order = [];
  for (const q of [...qa, ...qb]) {
    if (!q || !q.id) continue;
    if (!map.has(q.id)) order.push(q.id);
    const cur = map.get(q.id);
    if (!cur || ts(q) > ts(cur)) map.set(q.id, q);
  }
  return order.map(id => map.get(id)).filter(q => alive(q, tomb['q:' + q.id]));
}

function fieldTime(day, f) {
  if (day && day._t && day._t[f] != null) return Number(day._t[f]);
  return day && Object.prototype.hasOwnProperty.call(day, f) ? 0 : -1;
}
function mergeDay(a, b) {
  if (!a) return b;
  if (!b) return a;
  const fields = new Set([
    ...Object.keys(a), ...Object.keys(b),
    ...Object.keys(a._t || {}), ...Object.keys(b._t || {})
  ]);
  fields.delete('_t');
  const out = { _t: {} };
  for (const f of fields) {
    const ta = fieldTime(a, f);
    const tb = fieldTime(b, f);
    const win = tb > ta ? b : a;
    const t = Math.max(ta, tb);
    if (Object.prototype.hasOwnProperty.call(win, f)) out[f] = win[f];
    if (t >= 0) out._t[f] = t;
  }
  return out;
}
function mergeDays(da = {}, db = {}) {
  const out = {};
  for (const d of new Set([...Object.keys(da), ...Object.keys(db)])) out[d] = mergeDay(da[d], db[d]);
  return out;
}

function pickNewer(a, aAt, b, bAt) {
  return (Number(bAt) || 0) > (Number(aAt) || 0) ? [b, bAt] : [a, aAt];
}

// ---- 最上層的「其他資料」 ----
// 舊版 App 不認得新版加的最上層資料，合併時也不能丟掉，否則舊版一同步，雲端上的新資料就消失。
// 新的最上層資料請用下列兩種形狀之一（才能正確合併）：
//   1. 清單：[{ id, updatedAt, ... }]，以 id 合併、較新的勝出；刪除用 tomb['<key>:<id>']
//   2. 物件：{ updatedAt, ... }，整組比較，較新的勝出
// 時間相同或沒有時間的形狀，挑內容字串較大的一邊，讓兩台裝置合併出同樣結果（不會來回互蓋）。
const CORE_KEYS = ['targets', 'targetsAt', 'profile', 'profileAt', 'logs', 'days', 'quickItems', 'tomb'];
// 檔案外框、只存本機的資料，不是同步資料
const NOT_DATA = new Set([...CORE_KEYS, 'app', 'version', 'exportedAt', 'photos', 'meta']);

export function extraKeys(d) {
  if (!d || typeof d !== 'object') return [];
  return Object.keys(d).filter(k => !NOT_DATA.has(k) && d[k] !== undefined);
}
export function pickExtras(d) {
  const out = {};
  for (const k of extraKeys(d)) out[k] = d[k];
  return out;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCollection = (v) => Array.isArray(v) && v.every(x => isObj(x) && x.id != null);

function mergeCollection(key, a, b, tomb) {
  const map = new Map();
  const order = [];
  for (const x of [...a, ...b]) {
    const id = String(x.id);
    if (!map.has(id)) order.push(id);
    const cur = map.get(id);
    if (!cur || ts(x) > ts(cur)) map.set(id, x);
  }
  return order.map(id => map.get(id)).filter(x => alive(x, tomb[key + ':' + x.id]));
}

export function mergeExtra(key, a, b, tomb = {}) {
  if (a === undefined && b === undefined) return undefined;
  if (isCollection(a ?? []) && isCollection(b ?? [])) return mergeCollection(key, a || [], b || [], tomb);
  if (a === undefined) return b;
  if (b === undefined) return a;
  const ta = isObj(a) ? ts(a) : 0;
  const tb = isObj(b) ? ts(b) : 0;
  if (ta !== tb) return tb > ta ? b : a;
  return stableStringify(b) > stableStringify(a) ? b : a;
}

export function mergeExtras(a = {}, b = {}, tomb = {}) {
  const out = {};
  for (const k of new Set([...extraKeys(a), ...extraKeys(b)])) out[k] = mergeExtra(k, a[k], b[k], tomb);
  return out;
}

// 把 state／雲端檔案整理成同步用的形狀（缺的補預設值，其他資料原樣帶著）
export function syncShape(d) {
  return {
    ...pickExtras(d),
    targets: d.targets, targetsAt: Number(d.targetsAt) || 0, profile: d.profile || {}, profileAt: Number(d.profileAt) || 0,
    logs: d.logs || {}, days: d.days || {}, quickItems: Array.isArray(d.quickItems) ? d.quickItems : [], tomb: d.tomb || {}
  };
}

// local / remote 形狀：{ targets, targetsAt, profile, profileAt, logs, days, quickItems, tomb }
export function mergeData(local, remote) {
  if (!remote) return local;
  const tomb = mergeTomb(local.tomb, remote.tomb);
  const [targets, targetsAt] = pickNewer(local.targets, local.targetsAt, remote.targets || local.targets, remote.targetsAt);
  const [profile, profileAt] = pickNewer(local.profile, local.profileAt, remote.profile || local.profile, remote.profileAt);
  return {
    ...mergeExtras(pickExtras(local), pickExtras(remote), tomb),
    targets, targetsAt: Number(targetsAt) || 0,
    profile, profileAt: Number(profileAt) || 0,
    logs: mergeLogs(local.logs, remote.logs, tomb),
    days: mergeDays(local.days, remote.days),
    quickItems: mergeQuick(local.quickItems, remote.quickItems, tomb),
    tomb
  };
}

// 穩定的字串化，用來判斷「合併後有沒有變」
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
