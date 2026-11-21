// 我的食物 customFoods（純函式，有單元測試）
// 使用者照包裝標示（或營養師給的表）建的食物，取代原本的「常吃的」。
// 兩種形狀（和 tfda_foods.json、之後的機構資料庫一樣）：
//   以克計：知道一份幾克 → 存 per100g（＋exPer100g），選到時問幾克，預填 serving.g
//   以份計：只知道「一份」→ 存 perServing（＋exPerServing），選到時問幾份
// 空白＝不知道，不存成 0。
import { normalize, expandQuery } from './foods.js';

export const CF_NUTR = ['kcal', 'p', 'f', 'c', 'sugar', 'na', 'fiber'];
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const isPerServing = (food) => Boolean(food && !food.per100g && food.perServing);

// 新增／修改頁的表單（一份的數字）→ 存起來的食物
// form: { name, servingG, servingLabel, kcal, p, f, c, sugar, na, fiber, ex: { grain, ... } }
export function customFoodFromForm(form, { id, now }) {
  const name = String(form.name || '').trim();
  if (!name) return { error: '請填食物名稱' };
  const kcal = numOrNull(form.kcal);
  if (kcal == null) return { error: '請填一份的熱量' };
  const gRaw = form.servingG === '' || form.servingG == null ? null : Number(form.servingG);
  if (gRaw != null && !(gRaw > 0 && gRaw <= 5000)) return { error: '一份的克數要在 1～5000 之間' };
  const g = gRaw;
  const per = {};
  CF_NUTR.forEach(k => { const v = numOrNull(form[k]); if (v != null) per[k] = v; });
  const ex = {};
  Object.entries(form.ex || {}).forEach(([k, v]) => { const n = numOrNull(v); if (n) ex[k] = n; });
  const food = { id, name, updatedAt: now };
  const serving = {};
  const label = String(form.servingLabel || '').trim();
  if (label) serving.label = label;
  if (g) {
    serving.g = g;
    food.per100g = {};
    Object.entries(per).forEach(([k, v]) => { food.per100g[k] = r2(v * 100 / g); });
    if (Object.keys(ex).length) {
      food.exPer100g = {};
      Object.entries(ex).forEach(([k, v]) => { food.exPer100g[k] = r2(v * 100 / g); });
    }
  } else {
    food.perServing = per;
    if (Object.keys(ex).length) food.exPerServing = ex;
  }
  if (Object.keys(serving).length) food.serving = serving;
  ['aliases', 'category', 'barcode', 'source', 'note'].forEach(k => { if (form[k] != null && form[k] !== '') food[k] = form[k]; });
  return { food };
}

// 存起來的食物 → 表單（一份的數字），修改時用
export function formFromCustomFood(food) {
  const form = { name: food.name || '', servingG: '', servingLabel: (food.serving && food.serving.label) || '', ex: {} };
  const g = food.serving && food.serving.g;
  if (food.per100g && g) {
    form.servingG = g;
    CF_NUTR.forEach(k => { const v = food.per100g[k]; form[k] = v == null ? '' : (k === 'kcal' || k === 'na' ? Math.round(v * g / 100) : r1(v * g / 100)); });
    Object.entries(food.exPer100g || {}).forEach(([k, v]) => { form.ex[k] = r1(v * g / 100); });
  } else if (food.per100g) {
    // 只有每 100 g（例如之後從資料庫複製來的）：當成一份 100 g
    form.servingG = 100;
    CF_NUTR.forEach(k => { const v = food.per100g[k]; form[k] = v == null ? '' : v; });
    Object.assign(form.ex, food.exPer100g || {});
  } else {
    const per = food.perServing || {};
    CF_NUTR.forEach(k => { form[k] = per[k] == null ? '' : per[k]; });
    Object.assign(form.ex, food.exPerServing || {});
  }
  return form;
}

// 以份計的食物吃了幾份 → 這一筆的營養素
export function servingNutrients(food, servings) {
  const n = Number(servings);
  const per = (food && food.perServing) || {};
  const val = (k, digits) => (per[k] == null ? null : digits === 0 ? Math.round(per[k] * n) : r1(per[k] * n));
  const ex = {};
  Object.entries((food && food.exPerServing) || {}).forEach(([k, v]) => { const x = r1(v * n); if (x > 0) ex[k] = x; });
  return { kcal: val('kcal', 0) ?? 0, p: val('p'), f: val('f'), c: val('c'), sugar: val('sugar'), na: val('na', 0), fiber: val('fiber'), ex: Object.keys(ex).length ? ex : null };
}

// 一份的熱量（列表顯示用）
export function servingKcal(food) {
  if (isPerServing(food)) return Math.round(food.perServing.kcal || 0);
  const g = (food.serving && food.serving.g) || 100;
  return Math.round(((food.per100g && food.per100g.kcal) || 0) * g / 100);
}
// 「1 包 35 g」「1 碗」「100 g」
export function servingText(food) {
  const s = food.serving || {};
  if (isPerServing(food)) return (s.label || '1 份') + (s.g ? '（' + s.g + ' g）' : '');
  const g = s.g || 100;
  return (s.label ? s.label + ' ' : '') + g + ' g';
}

// 搜尋我的食物：名稱或別名包含關鍵字（或同義詞）。資料少，不需要 TFDA 那套合併取樣
export function searchMine(foods, query) {
  const terms = expandQuery(query).map(t => t.term);
  if (!terms.length) return [];
  return (foods || []).filter(f => {
    const names = [f.name, ...(Array.isArray(f.aliases) ? f.aliases : [])].map(normalize);
    return terms.some(t => names.some(n => n.includes(t)));
  });
}

// 最常記的排前面（看記錄裡的 customFoodId），一樣多就看最近記的、再看名稱
export function sortByUse(foods, logs) {
  const count = new Map();
  const last = new Map();
  Object.entries(logs || {}).forEach(([date, list]) => (list || []).forEach(it => {
    if (!it || !it.customFoodId) return;
    count.set(it.customFoodId, (count.get(it.customFoodId) || 0) + 1);
    if (!last.has(it.customFoodId) || last.get(it.customFoodId) < date) last.set(it.customFoodId, date);
  }));
  return [...(foods || [])].sort((a, b) =>
    (count.get(b.id) || 0) - (count.get(a.id) || 0)
    || String(last.get(b.id) || '').localeCompare(String(last.get(a.id) || ''))
    || (b.updatedAt || 0) - (a.updatedAt || 0));
}

// 「自己輸入」順便存成我的食物：有照營養標示算（label＋grams）就存以克計，不然存以份計（一份＝這次填的數字）
// nutr：一份的 { kcal, p, c, f, ex }；mult：吃了幾份
export function formFromManual({ name, nutr, label, grams, mult = 1 }) {
  const form = { name, servingG: '', servingLabel: '', kcal: nutr.kcal, p: nutr.p, f: nutr.f, c: nutr.c, ex: { ...(nutr.ex || {}) } };
  if (label && label.g > 0 && grams > 0) {
    const g = r1(grams / (mult || 1));   // 一份＝這次一份吃的克數
    const m = g / label.g;
    Object.assign(form, { servingG: g, kcal: Math.round(label.kcal * m) });
    ['p', 'f', 'c'].forEach(k => { form[k] = label[k] == null ? '' : r1(label[k] * m); });
  }
  ['p', 'f', 'c'].forEach(k => { if (form[k] == null) form[k] = ''; });
  return form;
}
