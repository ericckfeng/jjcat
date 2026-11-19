// 一整餐的計算：購物車合計、複製某天某一餐
// 這個檔案只有純函式，不碰畫面或儲存，方便測試。

const EX_KEYS = ['grain', 'prot', 'veg', 'fruit', 'dairy', 'oil'];
const r1 = (v) => Math.round(v * 10) / 10;

// 合計多個品項的熱量、三大營養素、六大類份數。
// 營養素：只要有一個品項有值就加總（沒有值的當 0），全部都沒有才是 null。
export function sumNutr(items) {
  const t = { kcal: 0, p: null, c: null, f: null, ex: null };
  (items || []).forEach(it => {
    t.kcal += Number(it.kcal) || 0;
    ['p', 'c', 'f'].forEach(k => { if (it[k] != null) t[k] = (t[k] || 0) + (Number(it[k]) || 0); });
    if (it.ex) {
      EX_KEYS.forEach(k => {
        const v = Number(it.ex[k]) || 0;
        if (v) { t.ex = t.ex || {}; t.ex[k] = (t.ex[k] || 0) + v; }
      });
    }
  });
  t.kcal = Math.round(t.kcal);
  ['p', 'c', 'f'].forEach(k => { if (t[k] != null) t[k] = r1(t[k]); });
  if (t.ex) EX_KEYS.forEach(k => { if (t.ex[k]) t.ex[k] = r1(t.ex[k]); });
  return t;
}

// 複製飲食記錄到另一天：新的 id、新的修改時間、不帶照片。
// 原本同一組（groupId）的品項，複製後仍是同一組，但用新的 groupId。
//   opts.makeId(prefix) 產生 id；opts.at 修改時間（毫秒）；opts.meal 指定餐別（選填）
export function copyEntries(items, { makeId, at, meal } = {}) {
  const groups = new Map();
  return (items || []).map(it => {
    const copy = { ...it, id: makeId('item'), hasPhoto: false, updatedAt: at };
    delete copy.photoKey;
    if (meal) copy.meal = meal;
    if (it.groupId) {
      if (!groups.has(it.groupId)) groups.set(it.groupId, makeId('grp'));
      copy.groupId = groups.get(it.groupId);
    }
    return copy;
  });
}

// 某天某一餐的記錄（依時間排序）
export function mealEntries(logs, date, meal) {
  return ((logs && logs[date]) || [])
    .filter(it => it.meal === meal)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
}
