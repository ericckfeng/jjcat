// 同步用的「逐筆合併」：兩台裝置的資料合在一起，不會互相覆蓋
// 規則：
//   - 飲食記錄、常吃清單：以 id 為單位，修改時間（updatedAt）較新的勝出
//   - 刪除：留下刪除標記（tomb），刪除時間比記錄新就刪掉，避免刪掉的又跑回來
//   - 每日身體／備註：以「欄位」為單位，各自比較修改時間（_t）
//   - 目標、個人資料：整組比較修改時間
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

// local / remote 形狀：{ targets, targetsAt, profile, profileAt, logs, days, quickItems, tomb }
export function mergeData(local, remote) {
  if (!remote) return local;
  const tomb = mergeTomb(local.tomb, remote.tomb);
  const [targets, targetsAt] = pickNewer(local.targets, local.targetsAt, remote.targets || local.targets, remote.targetsAt);
  const [profile, profileAt] = pickNewer(local.profile, local.profileAt, remote.profile || local.profile, remote.profileAt);
  return {
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
