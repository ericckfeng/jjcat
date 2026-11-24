// 待查（純函式，有單元測試）
// 現場找不到對應的食物時：拍照＋用手比大小（拳頭／手掌／大拇指 × 幾分之幾）＋數量，先記成「待查」。
// 選了類別就用手掌法先給一個粗估（標「估」），讓當天合計不是空的；之後再一筆一筆改，
// 或匯出「待查表」（CSV＋照片）給 AI／營養師填，再匯入回填。
// 記錄上存 lookup: { ref, amt, n, cat }，熱量是這一筆全部（大小 × 數量）的總量。

const r1 = (v) => Math.round(v * 10) / 10;

// 手的大小換成「幾個拳頭」：拳頭≈1 碗（240 ml）、手掌（含厚度）≈ 100 g 肉、大拇指≈1 湯匙
export const HAND_REFS = [
  { id: 'fist', label: '拳頭', icon: '✊', hint: '約 1 碗', fist: 1 },
  { id: 'palm', label: '手掌', icon: '✋', hint: '含厚度', fist: 0.4 },
  { id: 'thumb', label: '大拇指', icon: '👍', hint: '約 1 湯匙', fist: 0.0625 }
];
export const AMOUNTS = [
  { v: 0.25, t: '1/4' }, { v: 1 / 3, t: '1/3' }, { v: 0.5, t: '1/2' }, { v: 2 / 3, t: '2/3' },
  { v: 0.75, t: '3/4' }, { v: 1, t: '1' }, { v: 1.5, t: '1.5' }, { v: 2, t: '2' }
];

// 粗估用：每「1 個拳頭」的熱量與營養素（依衛福部代換表：全穀 1 份 70、中脂肉 1 份 75、蔬菜 1 份 25、水果 1 份 60、油脂 1 份 45）
// 肉的手掌 = 0.4 拳頭 = 3 份；油的大拇指 = 1/16 拳頭 = 1 份
export const LOOKUP_CATS = [
  { id: 'grain', label: '飯麵・包子糕點', icon: '🍚', kcal: 280, p: 8, c: 60, f: 0, ex: { grain: 4 } },
  { id: 'prot', label: '肉魚蛋豆', icon: '🍖', kcal: 562, p: 52, c: 0, f: 37, ex: { prot: 7.5 } },
  { id: 'fried', label: '炸物・酥皮・肥肉', icon: '🍤', kcal: 540, p: 12, c: 45, f: 35 },
  { id: 'veg', label: '蔬菜', icon: '🥬', kcal: 72, p: 2, c: 10, f: 2.5, ex: { veg: 2, oil: 0.5 } },
  { id: 'fruit', label: '水果', icon: '🍎', kcal: 60, p: 0, c: 15, f: 0, ex: { fruit: 1 } },
  { id: 'sweet', label: '甜點・甜飲', icon: '🍰', kcal: 250, p: 3, c: 40, f: 9 },
  { id: 'oil', label: '油・醬・堅果', icon: '🥜', kcal: 720, p: 0, c: 0, f: 80, ex: { oil: 16 } }
];

export const handRef = (id) => HAND_REFS.find(r => r.id === id) || null;
export const lookupCat = (id) => LOOKUP_CATS.find(c => c.id === id) || null;

// 合理的大小（幾個）與數量；不合理的回傳 null
export function cleanAmount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 20 ? Math.round(n * 1000) / 1000 : null;
}

// 0.333 → 「1/3」；其他照數字寫
export function amountText(v) {
  const hit = AMOUNTS.find(a => Math.abs(a.v - v) < 0.01);
  return hit ? hit.t : String(r1(v));
}

// 「拳頭 1/2 × 2」
export function sizeText(lk) {
  if (!lk) return '';
  const ref = handRef(lk.ref);
  const parts = [];
  if (ref && lk.amt) parts.push(ref.label + ' ' + amountText(lk.amt));
  if (lk.n && lk.n !== 1) parts.push('× ' + amountText(lk.n));
  return parts.join(' ');
}

// 手掌法粗估：要有類別、手的大小、幾個；回傳這一筆全部的 { kcal, p, c, f, ex }
export function estimateLookup(lk) {
  const cat = lk && lookupCat(lk.cat);
  const ref = lk && handRef(lk.ref);
  const amt = lk && cleanAmount(lk.amt);
  const n = lk && lk.n != null ? cleanAmount(lk.n) : 1;
  if (!cat || !ref || !amt || !n) return null;
  const m = ref.fist * amt * n;
  const ex = {};
  Object.entries(cat.ex || {}).forEach(([k, v]) => { const x = r1(v * m); if (x > 0) ex[k] = x; });
  return { kcal: Math.round(cat.kcal * m), p: r1(cat.p * m), c: r1(cat.c * m), f: r1(cat.f * m), ex: Object.keys(ex).length ? ex : null };
}

/* ---------- 待查表（CSV） ---------- */
// 前面幾欄是給人和 AI 看的，最後幾欄是要填的；匯入時只看「編號」和要填的欄
export const CSV_HEAD = ['編號', '日期', '餐別', '名稱', '大小', '類別', '目前粗估(大卡)', '照片', '查到的名稱', '熱量(大卡)', '蛋白質(克)', '脂肪(克)', '碳水(克)', '備註'];

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(rows) {
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}

// rows: [{ id, date, meal, name, lookup, kcal, pending, photos: [檔名] }]
export function buildLookupCsv(rows) {
  const body = rows.map(r => [
    r.id, r.date, r.meal, r.name, sizeText(r.lookup), (lookupCat(r.lookup && r.lookup.cat) || {}).label || '',
    r.kcal || '', (r.photos || []).join(' '), '', '', '', '', '', ''
  ]);
  return '﻿' + toCsv([CSV_HEAD, ...body]);   // 開頭加 BOM，Excel 才不會亂碼
}

// 標準 CSV（含引號、換行）；也接受 AI 回傳時包在 ``` 裡的
export function parseCsv(text) {
  let s = String(text || '').replace(/^﻿/, '');
  const fence = s.match(/```(?:csv)?\s*\n([\s\S]*?)```/i);
  if (fence) s = fence[1];
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ''));
}

// 填好的待查表 → [{ id, name?, kcal, p?, f?, c? }]；只收「編號」和「熱量」都有的列
// 欄名用「包含」來找，AI 改了一點欄名（例如「熱量（大卡）」「蛋白質 g」）也認得
export function readFilledCsv(text) {
  const rows = parseCsv(text);
  const headAt = rows.findIndex(r => r.some(c => c.includes('編號')));
  if (headAt < 0) return { items: [], error: '找不到「編號」這一欄，請用 App 匯出的待查表填寫' };
  const head = rows[headAt];
  const col = (...keys) => head.findIndex(h => keys.some(k => h.includes(k)));
  const ci = { id: col('編號'), name: col('查到的名稱'), kcal: head.findIndex(h => h.includes('熱量') && !h.includes('粗估')), p: col('蛋白質'), f: col('脂肪'), c: col('碳水') };
  if (ci.kcal < 0) return { items: [], error: '找不到「熱量」這一欄' };
  const numOf = (v) => {
    const s = String(v || '').replace(/[^\d.]/g, '');
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && n <= 20000 ? n : null;
  };
  const items = [];
  rows.slice(headAt + 1).forEach(r => {
    const id = (r[ci.id] || '').trim();
    const kcal = numOf(r[ci.kcal]);
    if (!id || kcal == null) return;
    const it = { id, kcal: Math.round(kcal) };
    const name = ci.name >= 0 ? (r[ci.name] || '').trim() : '';
    if (name) it.name = name;
    ['p', 'f', 'c'].forEach(k => { if (ci[k] >= 0) { const v = numOf(r[ci[k]]); if (v != null) it[k] = r1(v); } });
    items.push(it);
  });
  return { items, error: items.length ? '' : '表格裡沒有填好熱量的列' };
}

// 回填的一列 → 存成我的食物的表單（myfoods.js 的 customFoodFromForm 吃的格式）。
// 一份＝這一筆吃的量（份量寫「拳頭 1/2 × 2」這種，下次吃一樣多就選 1 份）。
// 沒有「查到的名稱」不存：記錄的名字多半是「午餐拍照待查」，存進去之後認不出是什麼
export function lookupMyFoodForm(row, lk) {
  const name = String((row && row.name) || '').trim();
  if (!name || !(row.kcal >= 0)) return null;
  const form = { name, servingG: '', servingLabel: sizeText(lk) || '1 份', kcal: row.kcal, p: '', f: '', c: '', ex: {} };
  ['p', 'f', 'c'].forEach(k => { if (row[k] != null) form[k] = row[k]; });
  return form;
}

// 給 AI 的說明：連同待查表和照片一起貼給 ChatGPT／Gemini
export const AI_LOOKUP_PROMPT = [
  '附件是我的飲食「待查表」（CSV）和照片，照片檔名開頭就是表格的「編號」。',
  '請依照片、名稱、大小和類別，估算每一列「這一筆全部」的熱量和營養素。',
  '大小是用手比的：拳頭約 1 碗（240 ml）、手掌是手掌大小和厚度（約 100 克肉）、大拇指約 1 湯匙；「× 2」是 2 個。',
  '請填「查到的名稱、熱量(大卡)、蛋白質(克)、脂肪(克)、碳水(克)」，可以在「備註」寫你的依據；其他欄位（尤其是編號）不要改。',
  '最後把整份表格用 CSV 格式回給我（包含第一列標題），不要加其他說明。'
].join('\n');
