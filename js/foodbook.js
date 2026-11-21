// AI 建檔小工具（tools/foodbook.html）的純函式（有單元測試）
// 拍書頁、衛教單張、營養師給的表格（或掃描的 PDF 一頁一頁）→ AI 讀出每一樣食物 → 逐筆對照照片校對 → 匯出第 4 步的資料庫檔。
// 書上的菜餚照片不存進資料庫（著作權，只記數字）。書上印的「熱量／公克」「醣類／公克」不存，拿來驗算。
import { rowsToFoods, buildPack } from './packs.js';

const EX_KEYS = ['grain', 'prot', 'veg', 'fruit', 'dairy', 'oil'];
export const EX_LABEL = { grain: '全穀雜糧', prot: '豆魚蛋肉', veg: '蔬菜', fruit: '水果', dairy: '乳品', oil: '油脂與堅果種子' };
const r1 = (v) => Math.round(v * 10) / 10;
const half = (v) => Math.round(v * 2) / 2;
const numOr = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };

/* ---------------- 提示詞與回傳格式 ---------------- */
const EX_SCHEMA = {
  type: 'OBJECT',
  properties: { grain: { type: 'NUMBER' }, protein: { type: 'NUMBER' }, vegetable: { type: 'NUMBER' }, fruit: { type: 'NUMBER' }, dairy: { type: 'NUMBER' }, oil: { type: 'NUMBER' } }
};
export const BOOK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    rotation: { type: 'INTEGER' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' }, weight_g: { type: 'NUMBER' }, serving_label: { type: 'STRING' },
          kcal: { type: 'NUMBER' }, protein: { type: 'NUMBER' }, fat: { type: 'NUMBER' }, carbs: { type: 'NUMBER' },
          sugar: { type: 'NUMBER' }, sodium_mg: { type: 'NUMBER' }, fiber: { type: 'NUMBER' },
          exchanges: EX_SCHEMA, exchanges_from_chart: { type: 'BOOLEAN' },
          printed_kcal_per_g: { type: 'NUMBER' }, printed_carbs_per_g: { type: 'NUMBER' },
          has_soup: { type: 'BOOLEAN' }, note: { type: 'STRING' }
        },
        required: ['name']
      }
    },
    page_note: { type: 'STRING' }
  },
  required: ['items']
};

// category：這一章是哪一類（每樣的重量＝這一類 1 份），沒有就是 ''
export function bookPrompt({ category = '' } = {}) {
  return [
    '你是台灣營養師的助理。這是一頁食物營養書、衛教單張或營養師的表格（可能是橫拍或倒過來的）。請把頁面上每一樣食物（或菜餚）的數字讀出來，一樣一筆。',
    'rotation：照片要順時針轉幾度才是正的（0、90、180、270）。',
    'name：頁面上的名稱，用繁體中文。serving_label：份量說明（例如「1 碗」「3 顆」），沒有就留空。weight_g：一份的重量（公克），頁面上沒印就不要填。',
    'kcal 熱量（大卡）、protein 蛋白質、fat 脂肪、carbs 醣類或碳水化合物、sugar 糖、fiber 膳食纖維（公克），sodium_mg 鈉（毫克）：只填頁面上印的數字，**沒印的不要估、不要填**。',
    'exchanges：六大類份數（全穀雜糧 grain、豆魚蛋肉 protein、蔬菜 vegetable、水果 fruit、乳品 dairy、油脂與堅果種子 oil）。頁面有印數字就照填；只有長條圖、沒有數字時，從圖估讀到 0.5 份，並把 exchanges_from_chart 設成 true。沒有份數就不要填。',
    '頁面上印的「熱量／公克」「醣類／公克」這類換算值，照原數字填在 printed_kcal_per_g、printed_carbs_per_g，不要自己計算。',
    'has_soup：這道菜有湯汁（例如湯麵、湯品、燴飯）就填 true。',
    'note：用你自己的話寫一句簡短備註（例如主要食材，或「約等於 9 分滿的飯」），不要照抄書上的長段文字；不需要就留空。',
    '不要描述菜餚的照片。頁面上沒有食物數字（例如目錄、說明頁）就回傳空的 items，page_note 說明這一頁是什麼。',
    category ? '這一章每一樣的重量就是「' + EX_LABEL[category] + '」1 份。' : ''
  ].filter(Boolean).join('\n');
}

/* ---------------- 整理回傳的資料 ---------------- */
// AI 回傳 → { rotation, items, note }。items 是工具內部的形狀：
//   { name, weightG, servingLabel, kcal, p, f, c, sugar, na, fiber, ex, exFromChart, kcalPerG, carbPerG, hasSoup, note }
export function normalizeBookPage(obj, { category = '' } = {}) {
  const rot = Number(obj && obj.rotation);
  const rotation = [0, 90, 180, 270].includes(rot) ? rot : 0;
  const items = ((obj && Array.isArray(obj.items)) ? obj.items : []).map(it => {
    const name = String((it && it.name) || '').trim().slice(0, 60);
    if (!name) return null;
    const w = numOr(it.weight_g);
    const e = it.exchanges || {};
    const raw = { grain: e.grain, prot: e.protein, veg: e.vegetable, fruit: e.fruit, dairy: e.dairy, oil: e.oil };
    const fromChart = Boolean(it.exchanges_from_chart);
    const ex = {};
    EX_KEYS.forEach(k => { const v = numOr(raw[k]); if (v > 0 && v < 30) ex[k] = fromChart ? half(v) : r1(v); });
    if (category) ex[category] = 1;   // 依章節定份數
    const m = (v) => { const n = numOr(v); return n == null ? null : r1(n); };
    const kcal = numOr(it.kcal);
    return {
      name, weightG: w > 0 && w <= 5000 ? r1(w) : null, servingLabel: String(it.serving_label || '').trim().slice(0, 20),
      kcal: kcal == null ? null : Math.round(kcal), p: m(it.protein), f: m(it.fat), c: m(it.carbs), sugar: m(it.sugar),
      na: numOr(it.sodium_mg) == null ? null : Math.round(numOr(it.sodium_mg)), fiber: m(it.fiber),
      ex, exFromChart: fromChart && !category, kcalPerG: numOr(it.printed_kcal_per_g), carbPerG: numOr(it.printed_carbs_per_g),
      hasSoup: Boolean(it.has_soup), note: String(it.note || '').trim().slice(0, 60)
    };
  }).filter(Boolean);
  return { rotation, items: items.slice(0, 40), note: String((obj && obj.page_note) || '').trim().slice(0, 200) };
}

/* ---------------- 檢查 ---------------- */
// 回傳 [{ level: 'error'|'warn'|'info', msg }]。error 的不能匯出（沒有熱量）
const RATIO_TOL = 0.08;
export function checkBookItem(it) {
  const out = [];
  if (it.kcal == null) out.push({ level: 'error', msg: '沒有熱量，不能匯出：請照頁面填，或刪掉這一樣' });
  const ratio = (val, printed, label) => {
    if (val == null || printed == null || !(printed > 0) || !(it.weightG > 0)) return;
    const got = val / it.weightG;
    if (Math.abs(got - printed) / printed <= RATIO_TOL) return;
    const txt = label + '÷重量＝' + (Math.round(got * 100) / 100) + '，書上印 ' + printed;
    out.push(it.hasSoup
      ? { level: 'info', msg: txt + '：有湯汁，對不上是正常的（書上的每公克是扣掉湯汁算的）' }
      : { level: 'warn', msg: txt + '：有湯汁，或可能讀錯，請對照頁面' });
  };
  ratio(it.kcal, it.kcalPerG, '熱量');
  ratio(it.c, it.carbPerG, '醣類');
  if (it.kcal >= 50 && it.p != null && it.f != null && it.c != null) {
    const est = 4 * it.p + 4 * it.c + 9 * it.f;
    if (Math.abs(est - it.kcal) / it.kcal > 0.25) out.push({ level: 'warn', msg: '熱量 ' + it.kcal + '，用三大營養素算是 ' + Math.round(est) + '：可能讀錯一個數字' });
  }
  if (it.exFromChart) out.push({ level: 'warn', msg: '份數是從長條圖估讀的，請校對' });
  return out;
}

/* ---------------- 匯出 ---------------- */
// 校對好的品項 → 資料庫檔（和整理工具同一種格式）。沿用 packs.js 的表格換算，以克計／以份計的規則一樣
const MAP = ['name', 'category', 'servingG', 'serving', 'kcal', 'p', 'f', 'c', 'sugar', 'na', 'fiber', ...EX_KEYS, 'note', 'source'];
export function bookToPack(items, meta, { now = Date.now() } = {}) {
  const usable = (items || []).filter(it => !it.removed && it.kcal != null);
  const source = [meta.name, meta.edition].filter(Boolean).join(' ');
  const rows = usable.map(it => [it.name, it.category || '', it.weightG ?? '', it.servingLabel || '', it.kcal, it.p ?? '', it.f ?? '', it.c ?? '', it.sugar ?? '', it.na ?? '', it.fiber ?? '',
    ...EX_KEYS.map(k => (it.ex && it.ex[k]) || ''), it.note || '', source]);
  const { foods } = rowsToFoods(rows, MAP, { askBy: meta.askBy === 'serving' ? 'serving' : 'grams' });
  // 同一本書同名的（例如不同頁的同一道菜）：id 一樣，後面的蓋掉前面的
  const byId = new Map();
  foods.forEach(f => { delete f.row; byId.set(f.id, f); });
  return buildPack(meta, [...byId.values()], { now });
}

// 進度摘要：{ pages, done, failed, todo, items, checked, flagged }
export function bookSummary(project) {
  const pages = (project && project.pages) || [];
  const items = ((project && project.items) || []).filter(it => !it.removed);
  return {
    pages: pages.length,
    done: pages.filter(p => p.status === 'done').length,
    failed: pages.filter(p => p.status === 'error').length,
    todo: pages.filter(p => p.status === 'todo' || p.status === 'error').length,
    items: items.length,
    checked: items.filter(it => it.checked).length,
    flagged: items.filter(it => checkBookItem(it).some(f => f.level !== 'info')).length
  };
}

/* ---------------- 用自己的 AI 整理（複製提示詞 → 貼回答） ---------------- */
export const BOOK_TABLE_HEAD = ['頁碼', '名稱', '份量說明', '重量(g)', '熱量(kcal)', '蛋白質(g)', '脂肪(g)', '醣類(g)', '糖(g)', '鈉(mg)', '膳食纖維(g)',
  '全穀雜糧(份)', '豆魚蛋肉(份)', '蔬菜(份)', '水果(份)', '乳品(份)', '油脂與堅果種子(份)', '書上熱量每公克', '書上醣類每公克', '有湯汁', '份數從圖估讀', '備註'];
// categories：{ 頁碼: 'grain', ... } 依章節定份數的頁
export function bookTablePrompt({ categories = {} } = {}) {
  const cats = Object.entries(categories).filter(([, c]) => c);
  return [
    '我會給你食物營養書的頁面、衛教單張或營養師的表格（照片或 PDF）。請把每一頁上每一樣食物（或菜餚）的數字讀出來，整理成一張表，給「飲控隨身記」App 匯入用。',
    '',
    '輸出規則：',
    '1. 只輸出一個 CSV，放在 ```csv 程式碼區塊裡，不要其他說明文字。第一列是欄位名稱，之後一列一樣食物。',
    '2. 欄位固定是這些，順序不要改：',
    BOOK_TABLE_HEAD.join(','),
    '3. 頁碼：這一樣在第幾頁（PDF 的頁碼；照片就是我給你的第幾張，從 1 開始）。',
    '4. 只填頁面上印的數字，只寫數字、不加單位。沒印的留空白，不要自己估、不要填 0。重量是一份的重量（公克），份量說明寫「1 碗」「3 顆」這類說法。',
    '5. 六大類份數：頁面有印數字就照填；只有長條圖、沒有數字時，從圖估讀到 0.5 份，並在「份數從圖估讀」填「是」。',
    '6. 頁面上印的「熱量／公克」「醣類／公克」照原數字填在「書上熱量每公克」「書上醣類每公克」，不要自己計算。',
    '7. 這道菜有湯汁（湯麵、湯品、燴飯等）在「有湯汁」填「是」。',
    '8. 備註用你自己的話寫一句簡短說明（例如主要食材），不要照抄書上的長段文字。不要描述菜餚照片。',
    '9. 目錄、說明這類沒有食物數字的頁面跳過。欄位內容有逗號的，整格用雙引號包起來。',
    '10. 資料很多、一次寫不完時，每次最多 60 列，寫完後在程式碼區塊外面說「還有，請說繼續」；我說「繼續」時接著寫，不要重複欄位名稱那一列。',
    ...(cats.length ? ['', '依章節定份數：' + cats.map(([p, c]) => '第 ' + p + ' 頁每一樣的重量就是「' + EX_LABEL[c] + '」1 份').join('；') + '。'] : [])
  ].join('\n');
}

// 貼上的表格（packs.js 的 parsePastedTable 的結果）→ [{ page: 頁碼或 null, obj: 和 AI 回傳一樣形狀的 { items } }]
// 之後每一頁照 normalizeBookPage 整理（章節類別、長條圖取到 0.5 都一樣）
const BOOK_COLS = [
  ['page', ['頁碼', '第幾頁']], ['printed_kcal_per_g', ['書上熱量', '熱量每公克', '熱量/公克', '熱量／公克']], ['printed_carbs_per_g', ['書上醣類', '醣類每公克', '醣類/公克', '醣類／公克']],
  ['exchanges_from_chart', ['從圖估讀', '長條圖']], ['has_soup', ['湯汁']], ['name', ['名稱', '品項', '品名', '菜名']], ['serving_label', ['份量說明', '份量']],
  ['weight_g', ['重量', '克數']], ['kcal', ['熱量']], ['protein', ['蛋白質']], ['fat', ['脂肪']], ['carbs', ['醣類', '碳水']], ['sugar', ['糖']],
  ['sodium_mg', ['鈉']], ['fiber', ['纖維']], ['ex_grain', ['全穀', '主食']], ['ex_protein', ['豆魚蛋肉', '肉類']], ['ex_vegetable', ['蔬菜']],
  ['ex_fruit', ['水果']], ['ex_dairy', ['乳品', '奶類']], ['ex_oil', ['油脂與堅果', '油脂類', '油脂(份)']], ['note', ['備註']]
];
const yes = (v) => /^(是|有|y|yes|true|1|✓|✔|v)$/i.test(String(v || '').trim());
const cellNum = (v) => { const s = String(v == null ? '' : v).replace(/,/g, '').trim(); if (!s) return null; const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : null; };
export function bookItemsFromTable(rows) {
  if (!rows || rows.length < 2) return [];
  const used = new Set();
  const idx = {};
  rows[0].forEach((h, i) => {
    const t = String(h || '').replace(/\s/g, '');
    for (const [key, words] of BOOK_COLS) {
      if (used.has(key)) continue;
      if (key === 'sugar' && /醣/.test(t)) continue;
      if (words.some(w => t.includes(w))) { used.add(key); idx[key] = i; return; }
    }
  });
  if (idx.name == null) return [];
  const get = (r, k) => (idx[k] == null ? '' : r[idx[k]]);
  const byPage = new Map();
  rows.slice(1).forEach(r => {
    const name = String(get(r, 'name') || '').trim();
    if (!name) return;
    const p = cellNum(get(r, 'page'));
    const page = p >= 1 ? Math.round(p) : null;
    const it = { name, serving_label: String(get(r, 'serving_label') || '').trim(), note: String(get(r, 'note') || '').trim(),
      has_soup: yes(get(r, 'has_soup')), exchanges_from_chart: yes(get(r, 'exchanges_from_chart')), exchanges: {} };
    ['weight_g', 'kcal', 'protein', 'fat', 'carbs', 'sugar', 'sodium_mg', 'fiber', 'printed_kcal_per_g', 'printed_carbs_per_g'].forEach(k => { const n = cellNum(get(r, k)); if (n != null) it[k] = n; });
    ['grain', 'protein', 'vegetable', 'fruit', 'dairy', 'oil'].forEach(k => { const n = cellNum(get(r, 'ex_' + k)); if (n != null) it.exchanges[k] = n; });
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push(it);
  });
  return [...byPage.entries()].map(([page, items]) => ({ page, obj: { rotation: 0, items } }));
}
