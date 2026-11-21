// 條碼（純函式，有單元測試）
// 查的順序：我的食物（同條碼）→ 食物資料庫（有條碼欄的）→ Open Food Facts（只送條碼號碼）→ 都查不到：照包裝填，存成我的食物並記下條碼。
// 掃描（拍照解條碼）在 app.js：有 BarcodeDetector（Android Chrome）就用，沒有（iPhone、iPad）才從 CDN 載入 ZXing。

// 留下數字；太短、太長的不是商品條碼
export function normalizeBarcode(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 14 ? d : '';
}

// GTIN 檢查碼（EAN-8、UPC-A、EAN-13、GTIN-14）：最後一位是檢查碼，用來發現打錯一個數字
export function checkDigitOk(code) {
  const d = normalizeBarcode(code);
  if (![8, 12, 13, 14].includes(d.length)) return false;
  const nums = [...d].map(Number);
  const check = nums.pop();
  let sum = 0;
  nums.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

// UPC-A（12 碼）和前面補 0 的 EAN-13 是同一個商品
const canon = (code) => { const d = normalizeBarcode(code); return d.replace(/^0+(?=\d{8})/, ''); };
export const sameBarcode = (a, b) => Boolean(canon(a)) && canon(a) === canon(b);

// 我的食物、食物資料庫裡有這個條碼的 → { food, pack }（pack：在哪個資料庫，我的食物是 null）
export function findByBarcode(code, { mine = [], packs = [] } = {}) {
  for (const f of mine || []) if (f && f.barcode && sameBarcode(f.barcode, code)) return { food: f, pack: null };
  for (const p of packs || []) for (const f of p.foods || []) if (f && f.barcode && sameBarcode(f.barcode, code)) return { food: f, pack: p };
  return null;
}

/* ---------------- Open Food Facts ---------------- */
export const OFF_FIELDS = 'code,product_name,product_name_zh,product_name_zh-TW,generic_name,brands,quantity,serving_size,serving_quantity,nutriments,nutrition_data_per';
export const offUrl = (code) => 'https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(normalizeBarcode(code)) + '.json?fields=' + OFF_FIELDS;

const r1 = (v) => Math.round(v * 10) / 10;
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };

// Open Food Facts 的回應 → 我的食物新增頁的表單（一份的數字），或 null（沒這個商品）
//   有熱量：{ form, hasNutrition: true }；有商品但沒營養資料：{ form（只有名稱、條碼）, hasNutrition: false }
// 一份：有 serving_quantity（每份幾克）就用一份，不然當一份 100 g（標示多半是每 100 g／100 ml）
export function offToForm(json, code) {
  const p = json && Number(json.status) === 1 && json.product;
  if (!p) return null;
  const nameRaw = String(p['product_name_zh-TW'] || p.product_name_zh || p.product_name || p.generic_name || '').trim();
  const brand = String(p.brands || '').split(',')[0].trim();
  const name = (brand && !nameRaw.includes(brand) ? brand + ' ' : '') + nameRaw || brand || '條碼 ' + normalizeBarcode(code);
  const form = { name: name.trim(), servingG: '', servingLabel: '', kcal: '', p: '', f: '', c: '', sugar: '', na: '', fiber: '', ex: {}, barcode: normalizeBarcode(code), source: 'off' };
  const n = p.nutriments || {};
  let kcal = num(n['energy-kcal_100g']);
  if (kcal == null && num(n.energy_100g) != null) kcal = num(n.energy_100g) / 4.184;   // 只有 kJ
  if (kcal == null) return { form, hasNutrition: false };
  const sq = num(p.serving_quantity);
  const g = sq > 0 && sq <= 5000 ? sq : 100;
  const m = g / 100;
  form.servingG = g;
  if (sq > 0 && p.serving_size) form.servingLabel = String(p.serving_size).trim().slice(0, 20);
  form.kcal = Math.round(kcal * m);
  [['p', 'proteins_100g'], ['f', 'fat_100g'], ['c', 'carbohydrates_100g'], ['sugar', 'sugars_100g'], ['fiber', 'fiber_100g']].forEach(([k, src]) => {
    const v = num(n[src]);
    if (v != null) form[k] = r1(v * m);
  });
  // 鈉：Open Food Facts 存公克（只有鹽的話，鹽 ÷ 2.5＝鈉）
  const na = num(n.sodium_100g) ?? (num(n.salt_100g) != null ? num(n.salt_100g) / 2.5 : null);
  if (na != null) form.na = Math.round(na * 1000 * m);
  return { form, hasNutrition: true };
}
