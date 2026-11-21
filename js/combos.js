// 套餐 combos（純函式，有單元測試）
// 購物車「存成套餐」；記的時候選套餐 → 整組放進購物車 → 可以改克數、拿掉 → 記到某餐（和查食物同一套流程）。
// 形狀：{ id: 'cb_xxxx', name, items: [Item], updatedAt }
//   Item：{ foodId | customFoodId, snapshot, grams, weighed }
//     grams：記的時候填的數字（以份計的食物是「幾份」，和記錄的 grams／servings 一樣）
//     weighed：'asis' 或 'cooked'（秤的是熟重）
//     snapshot：存的時候那樣食物的資料（和食物同形狀，只留算營養要用的欄位）。
//       TFDA 刪掉的品項、刪掉的我的食物、AI 估的品項（沒有 id），套餐都還能用。
// 選套餐時：資料庫／我的食物裡還找得到就用現在的數字（使用者改過我的食物會跟著改），找不到才用 snapshot。
import { normalize, expandQuery, nutrientsFor, cookConversion } from './foods.js';
import { isPerServing, servingNutrients } from './myfoods.js';
import { sumNutr } from './meals.js';

const SNAP_KEYS = ['id', 'name', 'category', 'state', 'note', 'per100g', 'exPer100g', 'perServing', 'exPerServing', 'serving', 'ai'];

export function snapshotOf(food) {
  const s = {};
  SNAP_KEYS.forEach(k => { if (food && food[k] != null) s[k] = JSON.parse(JSON.stringify(food[k])); });
  return s;
}

// 購物車 [{ food, grams, weighed }] → 套餐。mine：這樣食物是不是我的食物（app.js 判斷）
export function comboFromCart(cart, { id, name, now, mine = () => false }) {
  const n = String(name || '').trim();
  if (!n) return { error: '請幫套餐取個名字' };
  const items = (cart || []).filter(c => c && c.food && Number(c.grams) > 0).map(c => {
    const it = { snapshot: snapshotOf(c.food), grams: Number(c.grams), weighed: c.weighed === 'cooked' ? 'cooked' : 'asis' };
    if (c.food.id && mine(c.food)) it.customFoodId = c.food.id;
    else if (c.food.id && !c.food.ai) it.foodId = c.food.id;
    return it;
  });
  if (!items.length) return { error: '購物車裡沒有東西' };
  return { combo: { id, name: n, items, updatedAt: now } };
}

// 套餐裡的每一樣 → 要放進購物車的 { food, grams, weighed, fromSnapshot }
// tfda：TFDA 食物清單（還沒載入就給 null，一律用 snapshot）；mine：我的食物清單
export function resolveCombo(combo, { tfda = null, mine = [] } = {}) {
  const byTfda = tfda ? new Map(tfda.map(f => [f.id, f])) : null;
  const byMine = new Map((mine || []).map(f => [f.id, f]));
  return ((combo && combo.items) || []).filter(it => it && Number(it.grams) > 0).map(it => {
    let food = null;
    if (it.customFoodId) food = byMine.get(it.customFoodId) || null;
    else if (it.foodId && byTfda) food = byTfda.get(it.foodId) || null;
    const snap = { ...(it.snapshot || {}) };
    if (!snap.name) snap.name = '（沒有名稱）';
    if (!snap.per100g && !snap.perServing) snap.per100g = {};
    // 用 snapshot 記下來的記錄：TFDA 的照樣帶 foodId；刪掉的我的食物不再連到它
    if (it.foodId) snap.id = it.foodId; else delete snap.id;
    // 我的食物從「以份計」改成「以克計」（或反過來）時，填的數字意思不同了：也用 snapshot
    if (food && isPerServing(food) !== isPerServing(snap)) food = null;
    const fromSnapshot = !food;
    if (!food) food = snap;
    const weighed = it.weighed === 'cooked' && cookConversion(food) ? 'cooked' : 'asis';
    return { food, grams: Number(it.grams), weighed, fromSnapshot };
  });
}

// 一樣的營養素（和購物車同一套算法）
export function itemNutr(food, grams, weighed = 'asis') {
  return isPerServing(food) ? servingNutrients(food, grams) : nutrientsFor(food, grams, weighed);
}

// 套餐合計（列表顯示用，只看 snapshot，不需要載入資料庫）
export function comboTotals(combo) {
  return sumNutr(((combo && combo.items) || []).map(it => itemNutr(it.snapshot || {}, Number(it.grams) || 0, it.weighed)));
}

// 「雞胸肉、地瓜、燙青菜」（太長就「…等 5 樣」）
export function comboSummary(combo, max = 3) {
  const names = ((combo && combo.items) || []).map(it => (it.snapshot && it.snapshot.name) || '');
  const shown = names.slice(0, max).join('、');
  return names.length > max ? shown + '…等 ' + names.length + ' 樣' : shown;
}

// 搜尋：套餐名稱或裡面任何一樣食物的名稱
export function searchCombos(combos, query) {
  const terms = expandQuery(query).map(t => t.term);
  if (!terms.length) return [];
  return (combos || []).filter(c => {
    const names = [c.name, ...((c.items || []).map(it => it.snapshot && it.snapshot.name))].filter(Boolean).map(normalize);
    return terms.some(t => names.some(n => n.includes(t)));
  });
}

// 最近用的排前面：看記錄上的 comboId（記的時候會帶），一樣就看修改時間
export function sortCombos(combos, logs) {
  const last = new Map();
  Object.entries(logs || {}).forEach(([date, list]) => (list || []).forEach(it => {
    if (it && it.comboId && (!last.has(it.comboId) || last.get(it.comboId) < date)) last.set(it.comboId, date);
  }));
  return [...(combos || [])].sort((a, b) =>
    String(last.get(b.id) || '').localeCompare(String(last.get(a.id) || ''))
    || (b.updatedAt || 0) - (a.updatedAt || 0));
}
