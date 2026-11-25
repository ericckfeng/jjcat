// 食物資料庫 foodPacks（純函式，有單元測試）
// 使用者／營養師自己整理的表（例如連鎖店外食營養表、醫院的份量表），各自一個資料庫，不併進 TFDA。
// 整理工具（tools/foodpack.html）把試算表變成資料庫檔，App「匯入食物資料庫」讀進來（同步到自己的其他裝置）。
//
// 資料庫檔：{ app: 'diet-tracker-foods', version: 1, exportedAt, pack: Pack 的資訊, foods: [PackFood] }
// App 裡：最上層 foodPacks: [{ id, name, org, edition, url, note, askBy, foods, updatedAt }]
// PackFood（和我的食物同形狀，多了店家、品項主體、規格）：
//   { id: 'pf_xxxx', name, base, variant, brand?, category?, aliases?, note?, source?,
//     serving: { label?, g?, ml? }, perServing | per100g: { kcal, p, f, c, sugar, na, fiber, sfa, tfa }, exPerServing | exPer100g }
//   sfa＝飽和脂肪 g、tfa＝反式脂肪 g：先存起來，App 還不顯示。空白＝不知道，不是 0。
import { normalize, expandQuery } from './foods.js';

export const PACK_APP = 'diet-tracker-foods';
export const PACK_VERSION = 1;
export const PACK_NUTR = ['kcal', 'p', 'f', 'c', 'sugar', 'na', 'fiber', 'sfa', 'tfa'];
const EX_KEYS = ['grain', 'prot', 'veg', 'fruit', 'dairy', 'oil'];
const r2 = (v) => Math.round(v * 100) / 100;

// 32 位元 FNV-1a → 短 id（同一家店同一個品名，每次整理出來的 id 都一樣，換新版資料庫時記錄連得回去）
export function hashId(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/* ---------------- 欄位對照 ---------------- */
// 依序比對：比較特定的放前面（「飽和脂肪」要先於「脂肪」、「膳食纖維」先於其他）
// 每個欄位：[key, label, 欄名包含這些字就算, 欄名包含這些字就不算]
export const PACK_FIELDS = [
  ['name', '名稱', ['品項名稱', '食物名稱', '品名', '名稱', '品項', '餐點名稱', '菜名'], ['別名']],
  ['brand', '店家／品牌', ['提供者', '店家', '餐廳', '品牌', '廠商', '店名']],
  ['category', '分類', ['餐點分類', '分類', '類別']],
  ['basis', '計量方式', ['計量方式']],
  ['servingG', '每份克數', ['每份克數', '克數', '重量']],
  ['serving', '份量說明', ['份量規格', '份量說明', '份量', '規格', '單位']],
  ['sfa', '飽和脂肪(g)', ['飽和脂肪']],
  ['tfa', '反式脂肪(g)', ['反式脂肪']],
  ['fiber', '膳食纖維(g)', ['膳食纖維', '纖維']],
  ['kcal', '熱量(kcal)', ['熱量', '卡路里', '大卡']],
  ['p', '蛋白質(g)', ['蛋白質']],
  ['f', '脂肪(g)', ['脂肪', '油脂量'], ['油脂與堅果', '油脂類']],
  ['c', '碳水(g)', ['碳水', '醣類', '總碳水']],
  ['sugar', '糖(g)', ['糖'], ['醣']],
  ['na', '鈉(mg)', ['鈉']],
  ['grain', '全穀雜糧(份)', ['全穀雜糧', '主食類', '全穀']],
  ['prot', '豆魚蛋肉(份)', ['豆魚蛋肉', '魚肉豆蛋', '肉類']],
  ['veg', '蔬菜(份)', ['蔬菜']],
  ['fruit', '水果(份)', ['水果']],
  ['dairy', '乳品(份)', ['乳品', '奶類']],
  ['oil', '油脂與堅果種子(份)', ['油脂與堅果', '油脂類']],
  ['aliases', '別名', ['別名']],
  ['barcode', '條碼', ['條碼']],
  ['note', '備註', ['備註', '說明'], ['來源']],
  ['source', '資料來源', ['資料來源', '來源']],
  ['edition', '版本', ['版本', '年份']],
  ['url', '出處', ['出處', '網址']],
  ['page', '頁碼', ['頁碼', '第幾頁']]
];
export const FIELD_LABEL = Object.fromEntries(PACK_FIELDS.map(([k, l]) => [k, l]));

// 欄名 → 欄位 key（對不上是 ''）。headers：第一列。回傳和 headers 一樣長的陣列
export function guessMapping(headers) {
  const used = new Set();
  return (headers || []).map(h => {
    const raw = normalize(h);
    const core = raw.replace(/[(（][^)）]*[)）]/g, '');   // 去掉「(kcal)」「(份)」這類單位
    for (const [key, , inc, exc = []] of PACK_FIELDS) {
      if (used.has(key)) continue;
      if (exc.some(x => raw.includes(normalize(x)))) continue;
      if (inc.some(x => core.includes(normalize(x)) || raw.includes(normalize(x)))) { used.add(key); return key; }
    }
    return '';
  });
}

/* ---------------- 份量、名稱 ---------------- */
// 「1份 (102g)」「3顆 (約45g)」「1杯 (L/660ml)」「每100g」→ { label, g?, ml? }
export function parseServing(text) {
  const s = String(text || '').trim();
  const out = {};
  const g = s.match(/(\d+(?:\.\d+)?)\s*(?:g|公克|克)(?![a-z])/i);
  const ml = s.match(/(\d+(?:\.\d+)?)\s*(?:ml|毫升|c\.?c\.?)/i);
  if (g) out.g = Number(g[1]);
  if (ml) out.ml = Number(ml[1]);
  // 括號裡只有重量（「(約45g)」）就從說明拿掉；其他（「(L/660ml)」）保留
  let label = s.replace(/[(（]\s*約?\s*\d+(?:\.\d+)?\s*(?:g|公克|克)\s*[)）]/i, '').trim();
  if (/^每\s*\d+(?:\.\d+)?\s*(?:g|公克|克)$/i.test(label)) label = '';
  if (label) out.label = label;
  return out;
}

// 「珍珠奶茶(大杯/正常糖)」→ { base: '珍珠奶茶', variant: '大杯/正常糖' }。查食物時同一個 base 收成一列
export function splitVariant(name) {
  const s = String(name || '').trim();
  const m = s.match(/^(.+?)\s*[(（]([^()（）]+)[)）]\s*$/);
  return m ? { base: m[1].trim(), variant: m[2].trim() } : { base: s, variant: '' };
}

/* ---------------- 表格 → 食物 ---------------- */
function cleanText(v) {
  const s = String(v == null ? '' : v).trim();
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;   // 匯出時為了避免 Excel 公式加的 '
}
// 數字欄：空白、「-」「—」「N/A」＝不知道（null）；看不懂的回傳 NaN
function cellNum(v) {
  const s = String(v == null ? '' : v).trim().replace(/,/g, '');
  if (!s || /^[-—–]+$/.test(s) || /^(n\/?a|無|未提供|不明)$/i.test(s)) return null;
  const n = Number(s.replace(/^約\s*/, '').replace(/\s*(kcal|大卡|g|mg|公克|毫克|份)$/i, ''));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

// rows：不含第一列（欄名）的資料列；mapping：guessMapping 的結果（可被使用者改過）
// opts.askBy：'serving'（記的時候問幾份，外食用）或 'grams'（有每份克數就問幾克，食材份量表用）
// 回傳 { foods, problems: [{ row, field, value, msg, level: 'skip'|'blank'|'check' }] }
//   row 是試算表上的列號（第一列是欄名，所以資料從第 2 列開始）
export function rowsToFoods(rows, mapping, { askBy = 'serving' } = {}) {
  const foods = [];
  const problems = [];
  const idx = {};
  (mapping || []).forEach((k, i) => { if (k && idx[k] == null) idx[k] = i; });
  const get = (r, k) => (idx[k] == null ? '' : r[idx[k]]);
  (rows || []).forEach((r, i) => {
    const row = i + 2;
    if (!r || r.every(c => String(c == null ? '' : c).trim() === '')) return;
    const name = cleanText(get(r, 'name'));
    if (!name) { problems.push({ row, field: 'name', value: '', msg: '沒有名稱，這列不收', level: 'skip' }); return; }
    const per = {};
    for (const k of PACK_NUTR) {
      const n = cellNum(get(r, k));
      if (Number.isNaN(n)) problems.push({ row, field: k, value: String(get(r, k)), msg: FIELD_LABEL[k] + '不是數字，當成空白', level: 'blank' });
      else if (n != null) per[k] = n;
    }
    if (per.kcal == null) { problems.push({ row, field: 'kcal', value: String(get(r, 'kcal')), msg: '「' + name + '」沒有熱量，這列不收', level: 'skip' }); return; }
    const ex = {};
    for (const k of EX_KEYS) {
      const n = cellNum(get(r, k));
      if (Number.isNaN(n)) problems.push({ row, field: k, value: String(get(r, k)), msg: FIELD_LABEL[k] + '不是數字，當成空白', level: 'blank' });
      else if (n) ex[k] = n;
    }
    // 熱量和三大營養素對不起來（差 25% 以上）：可能抄錯，請人確認（不改數字）
    if (per.p != null && per.f != null && per.c != null && per.kcal >= 50) {
      const est = 4 * per.p + 4 * per.c + 9 * per.f;
      if (Math.abs(est - per.kcal) / per.kcal > 0.25) {
        problems.push({ row, field: 'kcal', value: String(per.kcal), msg: '「' + name + '」熱量 ' + per.kcal + '，用三大營養素算是 ' + Math.round(est) + '，請確認', level: 'check' });
      }
    }
    const brand = cleanText(get(r, 'brand'));
    const serving = parseServing(cleanText(get(r, 'serving')));
    const gCol = cellNum(get(r, 'servingG'));
    if (gCol > 0) serving.g = gCol;
    const basis = cleanText(get(r, 'basis'));
    const { base, variant } = splitVariant(name);
    const food = { id: 'pf_' + hashId(normalize(brand) + '|' + normalize(name)), name, base };
    if (variant) food.variant = variant;
    if (brand) food.brand = brand;
    // 以 100 g 計：計量方式寫「每100g」，或份量就是「每100g」
    const per100 = /100\s*g/i.test(basis) || (/^每\s*100\s*(g|公克|克)$/i.test(cleanText(get(r, 'serving'))));
    const byGrams = per100 || (askBy === 'grams' && serving.g > 0);
    if (per100) {
      food.per100g = per;
      if (Object.keys(ex).length) food.exPer100g = ex;
      if (!(serving.g > 0) || serving.g === 100) delete serving.g;
    } else if (byGrams) {
      food.per100g = {};
      Object.entries(per).forEach(([k, v]) => { food.per100g[k] = r2(v * 100 / serving.g); });
      if (Object.keys(ex).length) {
        food.exPer100g = {};
        Object.entries(ex).forEach(([k, v]) => { food.exPer100g[k] = r2(v * 100 / serving.g); });
      }
    } else {
      food.perServing = per;
      if (Object.keys(ex).length) food.exPerServing = ex;
    }
    if (Object.keys(serving).length) food.serving = serving;
    const category = cleanText(get(r, 'category'));
    if (category) food.category = category;
    const aliases = cleanText(get(r, 'aliases')).split(/[、,，;；]/).map(s => s.trim()).filter(Boolean);
    if (aliases.length) food.aliases = aliases;
    ['note', 'source', 'barcode'].forEach(k => { const v = cleanText(get(r, k)); if (v) food[k] = v; });
    food.row = row;   // 整理工具顯示用，buildPack 會拿掉
    foods.push(food);
  });
  return { foods, problems };
}

/* ---------------- 重複、類似 ---------------- */
const filled = (f) => Object.keys(f.perServing || f.per100g || {}).length + Object.keys(f.exPerServing || f.exPer100g || {}).length;
const nutrKey = (f) => { const p = f.perServing || f.per100g || {}; return ['kcal', 'p', 'f', 'c'].map(k => p[k] ?? '').join('|'); };

// 找出要整理的：
//   exact：同一家店、同一個名稱（寫法不同也算，例如全形半形、空白）→ 一定要合併（id 一樣）
//   sameNumbers：同一家店、名稱不同但熱量和三大營養素完全一樣 → 可能重複，讓人決定
//   crossBrand：不同店同一個品項（base 一樣）→ 不合併（各家數字不同），App 查食物時收成一列
export function findDuplicates(foods) {
  const byId = new Map();
  const byNums = new Map();
  const byBase = new Map();
  (foods || []).forEach(f => {
    (byId.get(f.id) || byId.set(f.id, []).get(f.id)).push(f);
    const p = f.perServing || f.per100g || {};
    if (p.kcal > 0 && p.p != null && p.f != null && p.c != null) {
      const k = normalize(f.brand) + '#' + nutrKey(f) + '#' + (f.per100g ? 'g' : 's');
      (byNums.get(k) || byNums.set(k, []).get(k)).push(f);
    }
    const b = normalize(f.base);
    (byBase.get(b) || byBase.set(b, []).get(b)).push(f);
  });
  const exact = [...byId.values()].filter(g => g.length > 1);
  const sameNumbers = [...byNums.values()].filter(g => new Set(g.map(f => f.id)).size > 1);
  const crossBrand = [...byBase.values()].filter(g => new Set(g.map(f => normalize(f.brand))).size > 1);
  return { exact, sameNumbers, crossBrand };
}

// 合併完全重複的：留資料最完整的那筆；一樣完整就留後面的（通常是後來補的）
export function mergeExact(foods) {
  const keep = new Map();
  const dropped = [];
  (foods || []).forEach(f => {
    const cur = keep.get(f.id);
    if (!cur) { keep.set(f.id, f); return; }
    if (filled(f) >= filled(cur)) { dropped.push(cur); keep.set(f.id, f); } else dropped.push(f);
  });
  const kept = new Set(keep.values());
  return { foods: (foods || []).filter(f => kept.has(f)), dropped };
}

/* ---------------- 資料庫檔 ---------------- */
// meta：{ name, org, title, edition, url, note, askBy }
export function packIdFor(meta) {
  return 'pk_' + hashId(normalize(meta.name) + '|' + normalize(meta.org));
}
export function buildPack(meta, foods, { now = Date.now() } = {}) {
  const name = String(meta.name || '').trim();
  if (!name) return { error: '請幫資料庫取個名字' };
  if (!foods || !foods.length) return { error: '沒有可以收的食物' };
  const pack = { id: packIdFor({ ...meta, name }), name };
  ['org', 'title', 'edition', 'url', 'note'].forEach(k => { const v = String(meta[k] || '').trim(); if (v) pack[k] = v; });
  pack.askBy = meta.askBy === 'grams' ? 'grams' : 'serving';
  const clean = foods.map(f => { const c = { ...f }; delete c.row; return c; });
  return { file: { app: PACK_APP, version: PACK_VERSION, exportedAt: new Date(now).toISOString(), pack, foods: clean } };
}

// 讀資料庫檔（App 匯入時）。回傳 { pack: App 存的形狀 } 或 { error }
export function packFromFile(data, { now = Date.now() } = {}) {
  if (!data || data.app !== PACK_APP) return { error: '這不是食物資料庫檔' };
  if (Number(data.version) > PACK_VERSION) return { error: '這個資料庫檔是較新版的整理工具做的，請先更新 App' };
  const p = data.pack || {};
  if (!p.id || !p.name) return { error: '資料庫檔缺少名稱' };
  const foods = (Array.isArray(data.foods) ? data.foods : []).filter(f => f && f.id && f.name && (f.per100g || f.perServing));
  if (!foods.length) return { error: '資料庫檔裡沒有食物' };
  return { pack: { ...p, foods, updatedAt: now } };
}

/* ---------------- 標準 CSV（給人看、給營養師） ---------------- */
export const PACK_CSV_HEAD = ['名稱', '別名', '分類', '店家', '計量方式', '每份克數', '份量說明', '熱量(kcal)', '蛋白質(g)', '脂肪(g)', '飽和脂肪(g)', '反式脂肪(g)', '碳水(g)', '糖(g)', '鈉(mg)', '膳食纖維(g)',
  '全穀雜糧(份)', '豆魚蛋肉(份)', '蔬菜(份)', '水果(份)', '乳品(份)', '油脂與堅果種子(份)', '條碼', '備註', '資料來源', '版本', '出處'];
const safeCell = (v) => { if (typeof v === 'number') return v; const s = v == null ? '' : String(v); return /^[=+\-@]/.test(s) ? "'" + s : s; };
// 回傳二維陣列（第一列是欄名），用 toCsv 存檔
export function packRows(file) {
  const pack = (file && file.pack) || {};
  return [PACK_CSV_HEAD, ...((file && file.foods) || []).map(f => {
    const s = f.serving || {};
    let per, ex, basis, g = s.g ?? '';
    if (f.perServing) { per = f.perServing; ex = f.exPerServing || {}; basis = '每份'; }
    else if (s.g > 0) {   // 以克計、有一份幾克：換回一份的數字（範本規定「照一整份填」）
      per = {}; ex = {};
      Object.entries(f.per100g).forEach(([k, v]) => { per[k] = r2(v * s.g / 100); });
      Object.entries(f.exPer100g || {}).forEach(([k, v]) => { ex[k] = r2(v * s.g / 100); });
      basis = '每份';
    } else { per = f.per100g; ex = f.exPer100g || {}; basis = '每100g'; g = ''; }
    const num = (k) => (per[k] == null ? '' : per[k]);
    return [f.name, (f.aliases || []).join('、'), f.category, f.brand, basis, g, s.label || (s.ml ? s.ml + 'ml' : ''),
      num('kcal'), num('p'), num('f'), num('sfa'), num('tfa'), num('c'), num('sugar'), num('na'), num('fiber'),
      ...EX_KEYS.map(k => ex[k] ?? ''), f.barcode, f.note, f.source || pack.name, pack.edition, pack.url].map(safeCell);
  })];
}

/* ---------------- App：查食物 ---------------- */
// 在所有（或指定的）資料庫裡找：名稱、品項主體、別名、店家、分類。回傳 [{ food, pack, score }]，分數高的在前
export function searchPacks(packs, query, { packId = null, limit = 200 } = {}) {
  const terms = expandQuery(query).map(t => t.term);
  if (!terms.length) return [];
  const hits = [];
  (packs || []).forEach(pack => {
    if (packId && pack.id !== packId) return;
    (pack.foods || []).forEach(food => {
      const name = normalize(food.name), base = normalize(food.base || food.name);
      const brand = normalize(food.brand);
      let s = 0;
      for (const t of terms) {
        if (base === t) s = Math.max(s, 100);
        else if (base.endsWith(t)) s = Math.max(s, 80);
        else if (base.startsWith(t)) s = Math.max(s, 70);
        else if (name.includes(t)) s = Math.max(s, 55);
        else if ((food.aliases || []).some(a => normalize(a).includes(t))) s = Math.max(s, 50);
        else if (brand && (brand.includes(t) || t.includes(brand))) s = Math.max(s, 45);
        else if (normalize(food.category).includes(t)) s = Math.max(s, 30);
      }
      if (s) hits.push({ food, pack, score: s });
    });
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

// 同一個品項（base 一樣）收成一組：[{ key, base, hits, brands }]，順序照第一次出現（分數高的在前）
export function groupHits(hits) {
  const groups = new Map();
  (hits || []).forEach(h => {
    const key = normalize(h.food.base || h.food.name);
    if (!groups.has(key)) groups.set(key, { key, base: h.food.base || h.food.name, hits: [], brands: [] });
    const g = groups.get(key);
    g.hits.push(h);
    const b = h.food.brand || '';
    if (!g.brands.includes(b)) g.brands.push(b);
  });
  return [...groups.values()];
}

/* ---------------- 分享我的食物 ---------------- */
// 我的食物 → 分享檔：和資料庫檔同一種格式，只是沒有 pack（App 匯入時加進「我的食物」，不是另一個資料庫）
const FOOD_KEYS = ['name', 'aliases', 'category', 'brand', 'note', 'source', 'barcode', 'serving', 'per100g', 'exPer100g', 'perServing', 'exPerServing'];
const NUTR_KEYS = ['serving', 'per100g', 'exPer100g', 'perServing', 'exPerServing'];
export function myFoodsFile(foods, { now = Date.now() } = {}) {
  const out = (foods || []).map(f => {
    const c = { id: f.id };
    FOOD_KEYS.forEach(k => { if (f[k] != null) c[k] = f[k]; });
    return c;
  });
  return { app: PACK_APP, version: PACK_VERSION, exportedAt: new Date(now).toISOString(), foods: out };
}
// 資料庫（App 裡存的形狀）→ 資料庫檔（分享給別人）
export function packToFile(pack, { now = Date.now() } = {}) {
  const meta = { ...pack };
  delete meta.foods; delete meta.updatedAt;
  return { app: PACK_APP, version: PACK_VERSION, exportedAt: new Date(now).toISOString(), pack: meta, foods: pack.foods || [] };
}
export const isMyFoodsFile = (data) => Boolean(data && data.app === PACK_APP && !data.pack && Array.isArray(data.foods));

// 別人分享的我的食物要怎麼加進來（以名稱比對，寫法差空白、全形半形也算同名）
//   add：新的（給新 id）；update：同名但數字不同（使用者同意才更新，留原本的 id）；same：同名、數字一樣，不用動
export function planMyFoodsImport(local, incoming, { makeId, now = Date.now() } = {}) {
  const byName = new Map((local || []).map(f => [normalize(f.name), f]));
  const nums = (f) => JSON.stringify(NUTR_KEYS.map(k => f[k] ?? null));
  const plan = { add: [], update: [], same: 0 };
  const seen = new Set();
  (incoming || []).forEach(f => {
    if (!f || !String(f.name || '').trim() || !(f.per100g || f.perServing)) return;
    const key = normalize(f.name);
    if (seen.has(key)) return;   // 檔案裡自己重複的只收第一筆
    seen.add(key);
    const clean = {};
    FOOD_KEYS.forEach(k => { if (f[k] != null) clean[k] = f[k]; });
    clean.name = String(clean.name).trim();
    const old = byName.get(key);
    if (!old) { plan.add.push({ ...clean, id: makeId('cf'), updatedAt: now }); return; }
    if (nums(old) === nums(clean)) { plan.same++; return; }
    const food = { ...old, updatedAt: now };
    NUTR_KEYS.forEach(k => { delete food[k]; if (clean[k] != null) food[k] = clean[k]; });
    plan.update.push({ old, food });
  });
  return plan;
}

/* ---------------- 和衛福部資料重複 ---------------- */
// 沒有店家（或來源寫衛福部／TFDA）的品項，名稱和衛福部資料庫的品名或俗名一樣：查食物時會出現兩次，整理時可以拿掉
const TFDA_WORDS = /TFDA|衛福部|衛生福利部|食藥署/i;
export function tfdaOverlap(foods, tfda) {
  const names = new Map();
  (tfda || []).forEach(t => [t.name, ...(t.aliases || [])].forEach(n => { const k = normalize(n); if (k && !names.has(k)) names.set(k, t); }));
  const out = [];
  (foods || []).forEach(f => {
    if (f.brand && !TFDA_WORDS.test(f.brand + ' ' + (f.source || ''))) return;
    const t = names.get(normalize(f.name)) || names.get(normalize(f.base));
    if (t) out.push({ food: f, tfda: t });
  });
  return out;
}

/* ---------------- 用自己的 AI 整理（複製提示詞 → 貼回答） ---------------- */
// ChatGPT、Claude、Gemini 等聊天 App 都可以：不用 API Key、不受 API 額度限制。回答照標準 CSV 範本，工具照一般流程檢查。
export function packPrompt() {
  return [
    '請把我給你的資料（照片、截圖、PDF、網頁或表格）整理成一張食物營養表，給「飲控隨身記」App 匯入用。',
    '',
    '輸出規則：',
    '1. 只輸出一個 CSV，放在 ```csv 程式碼區塊裡，不要其他說明文字。第一列是欄位名稱，之後一列一樣食物。',
    '2. 欄位固定是這些，順序不要改：',
    PACK_CSV_HEAD.join(','),
    '3. 數字照資料上印的填，只寫數字、不加單位。資料上沒有的欄位留空白，不要自己估、不要填 0（真的是 0 才填 0）。',
    '4. 計量方式：資料是「一份」的數字填「每份」，並在每份克數填一份幾克（不知道就留空）；資料是每 100 公克的填「每100g」。份量說明寫「1 碗」「1 杯 (大杯)」這類說法。',
    '5. 有店家或品牌的（例如連鎖店菜單）填在「店家」；同一品項有大小杯、甜度等不同規格的，寫在名稱最後的括號裡，例如「珍珠奶茶(大杯/無糖)」，一種規格一列。',
    '6. 六大類份數（全穀雜糧、豆魚蛋肉、蔬菜、水果、乳品、油脂與堅果種子）資料上有才填。',
    '7. 資料來源寫資料的出處（例如「某某店官方營養標示」）；備註用你自己的話簡短寫，不要照抄長段文字。',
    '8. 欄位內容有逗號的，整格用雙引號包起來。',
    '9. 資料很多、一次寫不完時，每次最多 80 列，寫完後在程式碼區塊外面說「還有，請說繼續」；我說「繼續」時接著寫，不要重複欄位名稱那一列。'
  ].join('\n');
}

// 貼上的文字 → 二維陣列。接受：```csv 區塊、Markdown 表格（| a | b |）、Excel 複製的（Tab 分隔）、一般 CSV；
// AI 在表格前後多寫的說明會略過（從含「名稱」或「品項」的那一列開始，沒有就從第一列）
export function parsePastedTable(text) {
  let s = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const fences = [...s.matchAll(/```[a-zA-Z]*\s*\n([\s\S]*?)```/g)].map(m => m[1]);
  if (fences.length) s = fences.join('\n');
  const lines = s.split('\n');
  const isPipe = (l) => /^\s*\|.*\|\s*$/.test(l);
  let rows;
  if (lines.filter(isPipe).length >= 2) {
    rows = lines.filter(isPipe).filter(l => !/^\s*\|?\s*:?-{3,}/.test(l))
      .map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
  } else if (lines.some(l => l.includes('\t'))) {
    rows = lines.filter(l => l.trim()).map(l => l.split('\t').map(c => c.trim().replace(/^"(.*)"$/, '$1')));
  } else {
    rows = csvRows(s);
  }
  rows = rows.filter(r => r.some(c => c !== ''));
  const h = rows.findIndex(r => r.some(c => /名稱|品項|品名/.test(c)));
  return h > 0 ? rows.slice(h) : rows;
}
// RFC 4180 CSV（只用逗號分隔；引號裡的逗號、換行照留）
function csvRows(s) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}
// 接在後面再貼一段：第二段開頭如果又有欄位名稱那一列，拿掉
export function appendPasted(prev, next) {
  if (!prev || !prev.length) return next;
  const same = next.length && next[0].join('|') === prev[0].join('|');
  return [...prev, ...(same ? next.slice(1) : next)];
}

/* ---------------- 自己加到資料庫的食物 ---------------- */
// 資料庫匯入後原樣不動；自己加的、改過的存在「我的食物」（customFoods），多標：
//   packId：屬於哪個資料庫；brand：哪一家店；replaces：改的是資料庫原本的哪一樣（原本的藏起來）
//   base、variant：和資料庫一樣拆好（查食物「同一個品項收成一組」用）
// 我的食物一樣一樣同步，手機和 iPad 各自加的都會留著；資料庫刪掉了，自己加的會回到我的食物

// 畫面用的資料庫：原本的（拿掉被改過的）＋自己加的。自己加的是 customFoods 裡的同一個物件（修改、記錄都照我的食物）
export function packsWithMine(packs, mine) {
  const byPack = new Map();
  (mine || []).forEach(f => { if (f && f.packId) (byPack.get(f.packId) || byPack.set(f.packId, []).get(f.packId)).push(f); });
  return (packs || []).map(p => {
    const adds = byPack.get(p.id);
    if (!adds) return p;
    const hidden = new Set(adds.map(f => f.replaces).filter(Boolean));
    return { ...p, foods: [...(p.foods || []).filter(f => !hidden.has(f.id)), ...adds] };
  });
}
// 我的食物清單要列的：沒有歸到資料庫的（資料庫已經刪掉的也算回來）
export function looseMine(mine, packs) {
  const ids = new Set((packs || []).map(p => p.id));
  return (mine || []).filter(f => f && !(f.packId && ids.has(f.packId)));
}
// 歸到資料庫時要加的欄位（名稱拆成品項＋規格）；brand 空白＝不改原本的店家
export function packFields(food, { packId, brand }) {
  const { base, variant } = splitVariant(food.name);
  const out = { packId, base, variant: variant || null };
  const b = String(brand == null ? '' : brand).trim();
  out.brand = b || food.brand || null;
  return out;
}
// 分享資料庫：原本的＋自己加的，合成一個檔案（給別人，或拿回整理工具繼續改）
//   改過的用原本那一樣的 id：別人換成新版時，取代原本那一樣
export function packFileWithMine(pack, mine, { now = Date.now() } = {}) {
  const [view] = packsWithMine([pack], mine);
  const foods = (view.foods || []).map(f => {
    if (!f.packId) return f;
    const c = { id: f.replaces || f.id };
    [...FOOD_KEYS, 'base', 'variant'].forEach(k => { if (f[k] != null && f[k] !== '') c[k] = f[k]; });
    return c;
  });
  return packToFile({ ...pack, foods }, { now });
}

/* ---------------- 共用資料庫（管理者發佈，App 自動更新） ---------------- */
// 管理者的試算表（tools/invite/Code.gs）回傳發佈中的清單 [{ key: 雲端檔案 id, version: 檔案更新時間 }]；
// 這台記著 meta.shared.files = { key: { version, id, name, n } }。回傳要下載的 key、要拿掉的 key
export function sharedPlan(files, list) {
  const have = files || {};
  const live = new Map((list || []).filter(x => x && x.key).map(x => [String(x.key), Number(x.version) || 0]));
  const fetch = [...live].filter(([k, v]) => !have[k] || Number(have[k].version) !== v).map(([k]) => k);
  const drop = Object.keys(have).filter(k => !live.has(k));
  return { fetch, drop };
}
// 畫面用的資料庫清單：共用的在前面；自己匯入的和共用的是同一份（同一個 id）時用共用的（會自動更新）
export function withShared(shared, own) {
  const ids = new Set((shared || []).map(p => p.id));
  return [...(shared || []), ...(own || []).filter(p => !ids.has(p.id))];
}
