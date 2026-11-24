// 外食點餐小幫手（純函式，有單元測試）
// 在某一家店，這一餐還能吃多少大卡 → 從匯入的食物資料庫排出 3 組點法：
//   主餐 ＋（配餐）＋（飲料），合計不超過這一餐的建議；蛋白質多、糖少的排前面；
//   三組的主餐不一樣，才有得選。醬料、糖包這類不單獨推薦。
// 全部在手機上算，不用網路、不用 AI。

const ROLE_RULES = [
  ['sauce', /醬|調味|糖包|糖漿|奶精|奶油球|沾料|佐料|加料/],
  ['drink', /[大中小]杯|無糖|微糖|半糖|少糖|正常糖|飲|茶|咖啡|拿鐵|奶昔|可樂|汽水|果汁|豆漿|牛奶|鮮奶|冰沙|氣泡|啤酒|水$/],
  ['main', /主餐|主食|正餐|套餐|飯|麵|粥|堡|便當|披薩|比薩|三明治|潛艇|捲餅|吐司|貝果|義大利|焗|丼|餃|拉麵|烏龍|河粉|米粉/]
];
// 分類欄（例如「主餐」「奶茶」「醬料」）先看，看不出來再看名稱
export function roleOf(food) {
  for (const text of [food.category, food.base || food.name, food.name]) {
    if (!text) continue;
    for (const [role, re] of ROLE_RULES) if (re.test(text)) return role;
  }
  return 'side';
}

// 一份的營養素：以份計的用 perServing；以克計的要有每份克數
export function portionOf(food) {
  if (food.perServing && food.perServing.kcal != null) return { amount: 1, byServing: true, n: food.perServing };
  const g = food.serving && food.serving.g;
  if (food.per100g && food.per100g.kcal != null && g > 0) {
    const n = {};
    Object.entries(food.per100g).forEach(([k, v]) => { n[k] = v * g / 100; });
    return { amount: g, byServing: false, n };
  }
  return null;
}

// 資料庫 → 店家清單：[{ brand, count }]，品項多的在前
export function brandsOf(packs) {
  const count = new Map();
  (packs || []).forEach(pk => (pk.foods || []).forEach(f => {
    if (!f.brand || !portionOf(f)) return;
    count.set(f.brand, (count.get(f.brand) || 0) + 1);
  }));
  return [...count].map(([brand, n]) => ({ brand, count: n })).sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand, 'zh-Hant'));
}

// 這一餐的建議熱量：一天的目標照餐別分（早 25%、午 35%、晚 35%、點心 10%），不超過今天還剩的
export const MEAL_SHARE = { breakfast: 0.25, lunch: 0.35, dinner: 0.35, snack: 0.1 };
export function mealBudget({ target, eaten, meal }) {
  const t = Number(target) || 0;
  const left = Math.max(0, t - (Number(eaten) || 0));
  const share = Math.round(t * (MEAL_SHARE[meal] || 0.35));
  return { budget: Math.round(Math.min(share, left) / 10) * 10, left: Math.round(left), share };
}

const r1 = (x) => Math.round(x * 10) / 10;
// 合計；每一樣都沒有這個營養素的資料就是 null（畫面不顯示，不要寫成 0 克讓人誤會）
function total(items) {
  const t = {};
  ['kcal', 'p', 'c', 'f', 'sugar', 'na'].forEach(k => {
    const vals = items.map(({ n }) => n[k]).filter(v => v != null && v !== '');
    t[k] = vals.length || k === 'kcal' ? vals.reduce((a, v) => a + (Number(v) || 0), 0) : null;
  });
  t.kcal = Math.round(t.kcal);
  if (t.na != null) t.na = Math.round(t.na);
  ['p', 'c', 'f', 'sugar'].forEach(k => { if (t[k] != null) t[k] = r1(t[k]); });
  return t;
}
// 分數：蛋白質越多越好、糖越少越好、熱量用到建議的七、八成最好（太少會餓，等一下又想吃）
function score(t, budget) {
  const use = budget > 0 ? t.kcal / budget : 0;
  return (t.p || 0) * 1.5 - (t.sugar || 0) * 0.8 + (use >= 0.6 ? 20 : use * 30);
}

// foods：同一家店的食物（資料庫裡的原樣物件）。回傳最多 n 組：
// [{ items: [{ food, amount, byServing, role }], total: { kcal, p, c, f, sugar, na }, notes: [] }]
export function suggestMeals(foods, budget, { n = 3, top = 15 } = {}) {
  const units = (foods || []).map(food => {
    const pt = portionOf(food);
    return pt && { food, ...pt, role: roleOf(food) };
  }).filter(u => u && u.role !== 'sauce' && u.n.kcal <= budget);
  const pick = (role) => units.filter(u => u.role === role)
    .sort((a, b) => score(total([b]), budget) - score(total([a]), budget)).slice(0, top);
  const mains = pick('main'), sides = pick('side'), drinks = pick('drink');
  const combos = [];
  const tryAdd = (items) => {
    const t = total(items);
    // 外食多半會點飲料：配無糖、沒熱量的飲料加一點分，讓它排在只點主餐的前面
    const zeroDrink = items.some(u => u.role === 'drink' && (Number(u.n.kcal) || 0) <= 10);
    // 沒有主餐的店（飲料店、點心店）是額外吃的：熱量、糖越少越好
    const s = mains.length ? score(t, budget) + (zeroDrink ? 2 : 0) : (t.p || 0) - (t.sugar || 0) * 0.8 - t.kcal / 50;
    // 有主餐的店，0 大卡的（只有無糖茶）不算一餐；飲料店的無糖茶正是最好的選擇
    if (t.kcal <= budget && (t.kcal > 0 || !mains.length)) combos.push({ items, total: t, s });
  };
  if (mains.length) {
    mains.forEach(m => {
      tryAdd([m]);
      sides.forEach(s => tryAdd([m, s]));
      drinks.forEach(d => { tryAdd([m, d]); sides.forEach(s => tryAdd([m, s, d])); });
    });
  } else {
    // 看不出主餐（例如飲料店、點心店）：一樣，或一樣點心配一杯飲料（不會建議兩杯飲料）
    sides.forEach(a => { tryAdd([a]); drinks.forEach(d => tryAdd([a, d])); });
    drinks.forEach(d => tryAdd([d]));
  }
  combos.sort((a, b) => b.s - a.s);
  // 三組的第一樣（主餐）不同，才有得選；先挑配餐也不重複的，不夠再放寬（飲料可以重複，無糖茶本來就適合每一組）
  const chosen = [];
  const mainsUsed = new Set();
  const sidesUsed = new Set();
  for (const strict of [true, false]) {
    for (const c of combos) {
      if (chosen.length >= n) break;
      if (chosen.includes(c) || mainsUsed.has(c.items[0].food)) continue;
      const others = c.items.slice(1).filter(u => u.role !== 'drink').map(u => u.food);
      if (strict && others.some(f => sidesUsed.has(f))) continue;
      chosen.push(c);
      mainsUsed.add(c.items[0].food);
      others.forEach(f => sidesUsed.add(f));
    }
  }
  return chosen.sort((a, b) => b.s - a.s)
    .map(c => ({ items: c.items.map(({ food, amount, byServing, role }) => ({ food, amount, byServing, role })), total: c.total, notes: notesOf(c.total, c.items) }));
}

function notesOf(t, items) {
  const notes = [];
  if (t.p >= 25) notes.push('蛋白質 ' + t.p + ' 克，比較有飽足感');
  const drink = items.find(u => u.role === 'drink');
  if (drink && (Number(drink.n.kcal) || 0) <= 10) notes.push('飲料幾乎沒有熱量');
  if (t.sugar >= 25) notes.push('糖 ' + t.sugar + ' 克，偏多');
  if (t.na >= 1500) notes.push('鈉 ' + t.na + ' 毫克，偏鹹，其他餐清淡一點');
  return notes;
}
