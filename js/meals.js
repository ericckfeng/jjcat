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
    delete copy.morePhotos;   // 第 2、3 張照片也不複製
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

/* ---------------- 這一餐還差什麼（對照營養師給的每餐份數） ---------------- */

const MEAL_EX_KEYS = ['grain', 'prot', 'veg', 'fruit', 'dairy', 'oil'];
// 多吃要提醒的只有這三類；蔬菜多吃沒關係，水果、乳品這餐沒排也不算「多」
const OVER_KEYS = ['grain', 'prot', 'oil'];
const OK_TOLERANCE = 0.3;   // 份數以 0.5 為單位，差不到 0.3 份算剛好

// entries：這一餐的記錄；target：這一餐的份數 { grain, prot, ... }
// 回傳 null（這餐沒設目標）或
//   { have, target, short: [{ k, need }], over: [{ k, extra }], unknown, done }
//   unknown：這餐沒有份數的記錄筆數（算不進來）
export function mealGap(entries, target) {
  const t = {};
  MEAL_EX_KEYS.forEach(k => { const v = Number(target && target[k]) || 0; if (v > 0) t[k] = v; });
  if (!Object.keys(t).length) return null;
  const have = {};
  MEAL_EX_KEYS.forEach(k => { have[k] = 0; });
  let unknown = 0;
  (entries || []).forEach(e => {
    if (!e.ex || !Object.values(e.ex).some(v => Number(v) > 0)) { unknown++; return; }
    MEAL_EX_KEYS.forEach(k => { have[k] += Number(e.ex[k]) || 0; });
  });
  MEAL_EX_KEYS.forEach(k => { have[k] = r1(have[k]); });
  const short = Object.keys(t).filter(k => t[k] - have[k] >= OK_TOLERANCE).map(k => ({ k, need: r1(t[k] - have[k]) }));
  const over = OVER_KEYS.filter(k => t[k] != null && have[k] - t[k] >= 0.5).map(k => ({ k, extra: r1(have[k] - t[k]) }));
  return { have, target: t, short, over, unknown, done: !short.length };
}

// 把每日份數平均分到早／午／晚三餐（以 0.5 份為單位，加起來等於每日份數；多的先給午餐、再給晚餐）
export function splitDaily(total) {
  const units = Math.round((Number(total) || 0) * 2);
  if (units <= 0) return [0, 0, 0];
  const base = Math.floor(units / 3);
  const rem = units - base * 3;
  return [base, base + (rem >= 1 ? 1 : 0), base + (rem >= 2 ? 1 : 0)].map(u => u / 2);
}

// 國健署食物代換表的生活份量（給長輩看得懂的說法）
export const EX_LIFE = {
  grain: '1 份約 1/4 碗飯', prot: '1 份約一顆蛋', veg: '1 份約半碗煮熟的青菜',
  fruit: '1 份約一個拳頭大', dairy: '1 份約一杯 240 ml 鮮奶', oil: '1 份約 1 茶匙油'
};
const EX_NAME = { grain: '全穀雜糧', prot: '豆魚蛋肉', veg: '蔬菜', fruit: '水果', dairy: '乳品', oil: '油脂' };
// mealGap 的結果 → { short, over, unknown } 三句話（沒有就是空字串）
export function gapMessage(gap, mealLabel) {
  if (!gap) return null;
  const short = gap.short.length
    ? mealLabel + '還可以加：' + gap.short.map(s => `${EX_NAME[s.k]} ${s.need} 份（${EX_LIFE[s.k]}）`).join('、')
    : mealLabel + '的份數都夠了 👍';
  const over = gap.over.length ? gap.over.map(o => `${EX_NAME[o.k]}多了 ${o.extra} 份`).join('、') + '，下一餐清淡一點就好' : '';
  const unknown = gap.unknown ? `有 ${gap.unknown} 筆沒有份數，沒算進來` : '';
  return { short, over, unknown };
}

/* ---------------- 夜間進食（只記錄給營養師看，不提示使用者、不和減熱量掛鉤） ---------------- */
// 晚上 10 點到早上 7 點之間吃的；早餐不算（清晨吃早餐很正常）；補記的不算（時間是記錄的時間，不是吃的時間）
export const NIGHT_FROM = '22:00';
export const NIGHT_TO = '07:00';
export function inNightWindow(time) {
  const t = String(time || '');
  if (!/^\d{2}:\d{2}$/.test(t)) return false;
  return t >= NIGHT_FROM || t < NIGHT_TO;
}
export function isNightEntry(e) {
  return Boolean(e) && e.meal !== 'breakfast' && !e.backfill && inNightWindow(e.time);
}
// 記錄時要不要問「是現在吃的嗎？」：晚上 10 點到清晨 5 點記的（任何一餐）
export function shouldAskWhen(time) {
  const t = String(time || '');
  return /^\d{2}:\d{2}$/.test(t) && (t >= NIGHT_FROM || t < '05:00');
}
// 「大約幾點吃的？」的快捷時間
export const MEAL_TIME_CHIPS = {
  breakfast: ['06:30', '07:00', '07:30', '08:00', '08:30', '09:00'],
  lunch: ['11:30', '12:00', '12:30', '13:00', '13:30', '14:00'],
  dinner: ['17:30', '18:00', '18:30', '19:00', '19:30', '20:00'],
  snack: ['15:00', '16:00', '19:00', '20:00', '21:00', '22:00']
};
// 選了吃的時間後：過了午夜才記、選的時間比記錄的時間晚 → 是前一天吃的
//   回傳 { time, dayShift }（dayShift：-1＝搬到前一天，0＝同一天）
export function eatenAt(savedTime, picked) {
  const s = String(savedTime || ''), p = String(picked || '');
  return { time: p, dayShift: s < '05:00' && p > s ? -1 : 0 };
}
// 一段期間的夜間進食：{ days, entries, kcal, byDate: { 日期: kcal } }
export function nightSummary(logs, dates) {
  const byDate = {};
  let entries = 0, kcal = 0;
  (dates || []).forEach(d => {
    const night = ((logs && logs[d]) || []).filter(isNightEntry);
    if (!night.length) return;
    const k = night.reduce((s, e) => s + (Number(e.kcal) || 0), 0);
    byDate[d] = k; entries += night.length; kcal += k;
  });
  return { days: Object.keys(byDate).length, entries, kcal: Math.round(kcal), byDate };
}

// 修改記錄時改份量：這筆是「幾克」「幾份」（食物以份計）還是「×幾份」（自己輸入的）
//   回傳 { field, unit: 'g'|'serving', amount }
export function entryPortion(item) {
  const pos = (v) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0;
  if (pos(item && item.servings)) return { field: 'servings', unit: 'serving', amount: pos(item.servings) };
  if (pos(item && item.grams)) return { field: 'grams', unit: 'g', amount: pos(item.grams) };
  return { field: 'multiplier', unit: 'serving', amount: pos(item && item.multiplier) || 1 };
}

// 份量從 from 改成 to：熱量、三大營養素、六大類、纖維照比例換算（沒有值的維持沒有）
export function scaleEntry(nutr, from, to) {
  const k = Number(to) / Number(from);
  const out = { kcal: 0, p: null, c: null, f: null, ex: null };
  if (!(k > 0) || !Number.isFinite(k)) return { ...out, ...nutr };
  out.kcal = Math.round((Number(nutr.kcal) || 0) * k);
  ['p', 'c', 'f', 'fiber'].forEach(x => { if (nutr[x] != null && nutr[x] !== '') out[x] = r1(Number(nutr[x]) * k); });
  if (nutr.ex) {
    EX_KEYS.forEach(x => {
      const v = r1((Number(nutr.ex[x]) || 0) * k);
      if (v > 0) { out.ex = out.ex || {}; out.ex[x] = v; }
    });
  }
  return out;
}

// 名稱後面的份量跟著改：「雞胸肉 150g」→「雞胸肉 200g」、「茶葉蛋 1 份」→「茶葉蛋 2 份」
// （multiplier 的名稱本來就不帶數量，不動）
export function renamePortion(name, field, amount) {
  const n = String(name || '');
  const a = r1(Number(amount));
  if (field === 'grams') return n.replace(/(\s)\d+(?:\.\d+)?g(（熟重）)?$/, (m, sp, ck) => sp + a + 'g' + (ck || ''));
  if (field === 'servings') return n.replace(/(\s)\d+(?:\.\d+)? 份$/, (m, sp) => sp + a + ' 份');
  return n;
}
