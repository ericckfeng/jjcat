// 食物資料庫整理工具：試算表 → 資料庫檔（js/packs.js 的格式）
// 獨立頁面，不碰 App 的 localStorage；兩邊靠檔案交接。
import { PACK_FIELDS, FIELD_LABEL, guessMapping, rowsToFoods, findDuplicates, mergeExact, buildPack, packRows, tfdaOverlap, packPrompt, parsePastedTable, appendPasted } from '../js/packs.js';
import { parseCsv, toCsv } from '../js/lookup.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const st = {
  fileName: '', sheets: null,   // xlsx：{ 名稱: rows }
  head: [], rows: [], mapping: [],
  askBy: 'serving', drop: new Set(),   // drop：使用者決定拿掉的（「可能重複」裡的）食物 id
  file: null
};

function note(id, tone, text) {
  const el = $(id);
  el.classList.toggle('hidden', !text);
  el.className = el.className.replace(/\b(bg|text)-(sky|rose|emerald|amber)-\d+\b/g, '').trim();
  if (text) el.classList.add(...({ info: ['bg-sky-50', 'text-sky-900'], err: ['bg-rose-50', 'text-rose-800'], ok: ['bg-emerald-50', 'text-emerald-900'] }[tone]));
  el.textContent = text || '';
}

// 衛福部資料：用來提示「這一樣衛福部資料庫也有」（載入失敗就不提示）
let tfda = null;
fetch('../tfda_foods.json').then(r => (r.ok ? r.json() : null)).then(d => { tfda = d && d.foods; if (st.rows.length) update(); }).catch(() => {});

/* ---------------- 存進度 ---------------- */
// 整理到一半關掉頁面，下次打開可以接著做。存在這台電腦的瀏覽器（和 App 的資料分開）
const SAVE_KEY = 'foodpack_tool_v1';
const META_IDS = ['pkName', 'pkOrg', 'pkEdition', 'pkUrl', 'pkNote'];
function saveProgress() {
  if (!st.rows.length) return;
  const data = { fileName: st.fileName, head: st.head, rows: st.rows, mapping: st.mapping, askBy: st.askBy, drop: [...st.drop],
    meta: Object.fromEntries(META_IDS.map(id => [id, $(id).value])), savedAt: Date.now() };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); $('saveNote').textContent = '已自動存進度（' + new Date().toLocaleTimeString('zh-TW', { hour12: false }) + '）'; }
  catch (e) { $('saveNote').textContent = '表格太大，沒辦法存進度；關掉頁面前記得先下載。'; }
}
function readProgress() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; }
}
function clearProgress() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 無法存取 */ } }
const saved = readProgress();
if (saved && saved.rows && saved.rows.length) {
  $('resumeText').textContent = '上次整理到一半：「' + (saved.meta && saved.meta.pkName || saved.fileName || '表格') + '」，' + saved.rows.length + ' 列（' + new Date(saved.savedAt).toLocaleString('zh-TW', { hour12: false }) + '）。';
  $('resumeBox').classList.remove('hidden');
}
$('resumeBtn').addEventListener('click', () => {
  const s = readProgress();
  $('resumeBox').classList.add('hidden');
  if (!s) return;
  Object.assign(st, { fileName: s.fileName || '', head: s.head, rows: s.rows, mapping: s.mapping, askBy: s.askBy || 'serving', drop: new Set(s.drop || []), sheets: null });
  META_IDS.forEach(id => { $(id).value = (s.meta && s.meta[id]) || ''; });
  note('loadNote', 'ok', '接著上次的：' + st.rows.length + ' 列、' + st.head.length + ' 欄。');
  ['stepMap', 'stepInfo', 'stepCheck', 'stepOut'].forEach(id => $(id).classList.remove('hidden'));
  renderMap();
  update();
});
$('resumeDiscardBtn').addEventListener('click', () => { clearProgress(); $('resumeBox').classList.add('hidden'); });

/* ---------------- 1. 讀入 ---------------- */
function sheetRows(ws) {
  // raw: false → 拿到儲存格顯示的文字（數字照表上的樣子），defval 讓空白格也佔位
  return window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false })
    .map(r => r.map(c => String(c).trim()));
}
function useRows(all, name, { keepMeta = false } = {}) {
  const rows = all.filter(r => r.some(c => c !== ''));
  if (rows.length < 2) { note('loadNote', 'err', '「' + name + '」沒有資料（第一列是欄位名稱，之後一列一樣食物）'); return; }
  st.head = rows[0];
  st.rows = rows.slice(1);
  if (!keepMeta || st.mapping.length !== st.head.length) st.mapping = guessMapping(st.head);   // 接在後面：保留改過的欄位對照
  if (!keepMeta) st.drop = new Set();
  // 有「店家」欄的通常是外食表：問幾份；有「每份克數」沒有店家的：問幾克
  if (!keepMeta) st.askBy = st.mapping.includes('brand') || !st.mapping.includes('servingG') ? 'serving' : 'grams';
  if (!keepMeta) {
    META_IDS.forEach(id => { $(id).value = ''; });   // 新的表：資訊重填
    $('pkName').value = name.replace(/\.(xlsx|xls|csv|tsv|txt)$/i, '').replace(/_/g, ' ');
  }
  $('resumeBox').classList.add('hidden');
  note('loadNote', 'ok', '讀到 ' + st.rows.length + ' 列、' + st.head.length + ' 欄。');
  ['stepMap', 'stepInfo', 'stepCheck', 'stepOut'].forEach(id => $(id).classList.remove('hidden'));
  renderMap();
  update();
}
function loadWorkbook(buf, name) {
  if (!window.XLSX) { note('loadNote', 'err', 'Excel 讀取元件沒有載入（要連網）。可以在 Excel 另存成 CSV 再選。'); return; }
  const wb = window.XLSX.read(buf, { type: 'array' });
  st.sheets = Object.fromEntries(wb.SheetNames.map(n => [n, sheetRows(wb.Sheets[n])]));
  const names = wb.SheetNames.filter(n => st.sheets[n].length > 1);
  $('sheetPickWrap').classList.toggle('hidden', names.length < 2);
  $('sheetPick').innerHTML = names.map(n => `<option>${esc(n)}</option>`).join('');
  if (!names.length) { note('loadNote', 'err', '檔案裡沒有資料'); return; }
  useRows(st.sheets[names[0]], name);
}
function loadText(text, name) {
  st.sheets = null;
  $('sheetPickWrap').classList.add('hidden');
  useRows(parseCsv(text), name);
}
// 沒有 BOM 的 CSV 可能是 Big5（舊版 Excel 存的）：UTF-8 解不開就改用 Big5
function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('big5').decode(buf); }
}
$('fileInput').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  st.fileName = f.name;
  const buf = new Uint8Array(await f.arrayBuffer());
  try {
    if (/\.(xlsx|xls)$/i.test(f.name)) loadWorkbook(buf, f.name);
    else loadText(decodeText(buf), f.name);
  } catch (err) { note('loadNote', 'err', '讀不了這個檔案：' + err.message); }
});
$('sheetPick').addEventListener('change', () => useRows(st.sheets[$('sheetPick').value], st.fileName));
$('sheetUrlBtn').addEventListener('click', async () => {
  const url = $('sheetUrl').value.trim();
  const m = url.match(/\/spreadsheets\/d\/([\w-]+)/);
  if (!m) { note('loadNote', 'err', '看不出是 Google 試算表的連結（網址裡要有 /spreadsheets/d/…）'); return; }
  const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1] || '0';
  note('loadNote', 'info', '讀取中…');
  const tries = [
    `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&gid=${gid}`
  ];
  for (const u of tries) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const text = await r.text();
      if (/^\s*</.test(text)) continue;   // 拿到登入頁：沒有開放檢視
      loadText(text, 'Google 試算表');
      return;
    } catch (e) { /* 試下一個 */ }
  }
  note('loadNote', 'err', '讀不到。請確認試算表「共用」設成「知道連結的任何人都能檢視」；還是不行的話，用「檔案 → 下載 → Microsoft Excel」再選檔案。');
});

// 用自己的 AI 整理：複製提示詞 → 把回答貼回來
let pastedRows = null;
$('promptText').textContent = packPrompt();
async function copyText(text, noteId, viewId) {
  try { await navigator.clipboard.writeText(text); $(noteId).textContent = '已複製，貼到 AI 的對話框。'; }
  catch (e) { $(viewId).open = true; $(noteId).textContent = '沒辦法自動複製：請在下面的提示詞上全選、複製。'; }
}
$('copyPromptBtn').addEventListener('click', () => copyText(packPrompt(), 'copyNote', 'promptView'));
function loadPasted(append) {
  const rows = parsePastedTable($('pasteText').value);
  if (rows.length < (append && pastedRows ? 1 : 2)) { note('loadNote', 'err', '讀不到表格：請把 AI 的整段回答貼上（要有欄位名稱那一列）。'); return; }
  const before = append && pastedRows ? pastedRows.length - 1 : 0;
  pastedRows = append ? appendPasted(pastedRows, rows) : rows;
  st.fileName = 'AI 整理的表';
  st.sheets = null;
  $('sheetPickWrap').classList.add('hidden');
  useRows(pastedRows, 'AI 整理的表', { keepMeta: append });
  $('pasteText').value = '';
  if (append) note('loadNote', 'ok', '接上 ' + (pastedRows.length - 1 - before) + ' 列，共 ' + (pastedRows.length - 1) + ' 列。');
}
$('pasteLoadBtn').addEventListener('click', () => loadPasted(false));
$('pasteAppendBtn').addEventListener('click', () => loadPasted(true));

/* ---------------- 2. 欄位對照 ---------------- */
function renderMap() {
  const opts = [['', '（不用）'], ...PACK_FIELDS.map(([k, l]) => [k, l])];
  $('mapRows').innerHTML = st.head.map((h, i) => `<tr>
    <td>${esc(h)}</td><td class="muted">${esc((st.rows[0] || [])[i])}</td>
    <td><select data-map="${i}" class="field py-1">${opts.map(([k, l]) => `<option value="${k}" ${st.mapping[i] === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td>
  </tr>`).join('');
}
$('mapRows').addEventListener('change', (e) => {
  const s = e.target.closest('[data-map]');
  if (!s) return;
  const i = Number(s.getAttribute('data-map'));
  // 同一個欄位只能對一欄：把別的對到這個的改成不用
  if (s.value) st.mapping = st.mapping.map((k, j) => (j !== i && k === s.value ? '' : k));
  st.mapping[i] = s.value;
  renderMap();
  update();
});

/* ---------------- 3. 資訊 ---------------- */
document.querySelectorAll('[data-askby]').forEach(b => b.addEventListener('click', () => { st.askBy = b.getAttribute('data-askby'); update(); }));
['pkName', 'pkOrg', 'pkEdition', 'pkUrl', 'pkNote'].forEach(id => $(id).addEventListener('input', update));

/* ---------------- 4、5. 檢查、預覽 ---------------- */
const who = (f) => (f.brand ? f.brand + '：' : '') + f.name + '（第 ' + f.row + ' 列）';
function update() {
  document.querySelectorAll('[data-askby]').forEach(b => b.classList.toggle('is-active', b.getAttribute('data-askby') === st.askBy));
  if (!st.mapping.includes('name') || !st.mapping.includes('kcal')) {
    $('checkSummary').innerHTML = '<p class="rounded-2xl bg-rose-50 text-rose-800 p-3">請在上面把「名稱」和「熱量(kcal)」各對到一欄。</p>';
    $('checkBody').innerHTML = '';
    $('previewRows').innerHTML = '';
    st.file = null;
    return;
  }
  const { foods: all, problems } = rowsToFoods(st.rows, st.mapping, { askBy: st.askBy });
  const dup = findDuplicates(all);
  const { foods: merged, dropped } = mergeExact(all);
  const foods = merged.filter(f => !st.drop.has(f.id));
  const skipped = problems.filter(p => p.level === 'skip');
  const check = problems.filter(p => p.level === 'check');
  const blank = problems.filter(p => p.level === 'blank');
  $('checkSummary').innerHTML = `收 <b>${foods.length}</b> 樣` +
    (dropped.length ? `、合併重複 ${dropped.length} 樣` : '') + (st.drop.size ? `、拿掉 ${st.drop.size} 樣` : '') +
    (skipped.length ? `、<span class="text-rose-700">不收 ${skipped.length} 列</span>` : '') +
    (check.length ? `、<span class="text-amber-700">要確認 ${check.length} 樣</span>` : '') + '。';
  const sec = (title, body, open = false) => `<details class="rounded-xl border border-stone-200" ${open ? 'open' : ''}><summary class="px-3 py-2 font-semibold cursor-pointer">${title}</summary><div class="p-3 space-y-1 text-base">${body}</div></details>`;
  const parts = [];
  if (check.length) parts.push(sec(`⚠ 數字要確認（${check.length}）`, '<p class="muted text-sm">熱量和蛋白質×4＋碳水×4＋脂肪×9 差很多，可能抄錯。照原表收進去，請回原表確認後再做一次。</p>' + check.map(p => `<div>第 ${p.row} 列：${esc(p.msg)}</div>`).join(''), true));
  if (dup.sameNumbers.length) {
    parts.push(sec(`可能重複：同一家、數字完全一樣（${dup.sameNumbers.length} 組）`, '<p class="muted text-sm">名稱不同但熱量、三大營養素都一樣，可能是複製時沒改到。勾選要拿掉的。</p>' +
      dup.sameNumbers.map(g => '<div class="rounded-lg bg-stone-50 p-2">' + g.map(f => `<label class="flex gap-2 items-center"><input type="checkbox" data-drop="${esc(f.id)}" ${st.drop.has(f.id) ? 'checked' : ''}/> 拿掉 ${esc(who(f))}</label>`).join('') + '</div>').join(''), true));
  }
  if (dropped.length) parts.push(sec(`已合併：同一家、同一個名稱（${dropped.length}）`, '<p class="muted text-sm">名稱寫法只差空白、全形半形也算同一樣。留下資料比較完整的那一列。</p>' + dup.exact.map(g => '<div>' + g.map(f => esc(who(f))).join(' ＝ ') + '</div>').join('')));
  if (skipped.length) parts.push(sec(`不收（${skipped.length}）`, skipped.map(p => `<div>第 ${p.row} 列：${esc(p.msg)}</div>`).join('')));
  if (blank.length) parts.push(sec(`看不懂的數字，當成空白（${blank.length}）`, blank.map(p => `<div>第 ${p.row} 列：${esc(FIELD_LABEL[p.field])}「${esc(p.value)}」</div>`).join('')));
  if (dup.crossBrand.length) parts.push(sec(`不同店的同一個品項（${dup.crossBrand.length} 組，不合併）`, '<p class="muted text-sm">各家數字不同，不會平均。App 查食物時收成一列，點進去選哪一家、哪一種。</p>' +
    dup.crossBrand.map(g => `<div><b>${esc(g[0].base)}</b>：${esc([...new Set(g.map(f => f.brand || '（沒填店家）'))].join('、'))}</div>`).join('')));
  const overlap = tfda ? tfdaOverlap(merged, tfda) : [];
  if (overlap.length) {
    parts.push(sec(`衛福部資料庫也有（${overlap.length}）`, '<p class="muted text-sm">App 查食物時，衛福部資料庫本來就有這些（每 100 g 的數字）。表裡的是一份的數字，留著記的時候比較方便；不想重複出現就勾掉。</p>' +
      overlap.map(({ food: f, tfda: t }) => `<label class="flex gap-2 items-start"><input type="checkbox" class="mt-1.5" data-drop="${esc(f.id)}" ${st.drop.has(f.id) ? 'checked' : ''}/> <span>拿掉 ${esc(who(f))}<span class="muted">　衛福部：${esc(t.name)}</span></span></label>`).join('')));
  }
  $('checkBody').innerHTML = parts.join('');

  const meta = { name: $('pkName').value, org: $('pkOrg').value, edition: $('pkEdition').value, url: $('pkUrl').value, note: $('pkNote').value, askBy: st.askBy };
  const built = buildPack(meta, foods);
  st.file = built.file || null;
  note('outNote', built.error ? 'err' : null, built.error || '');
  const num = (v) => (v == null ? '' : v);
  $('previewRows').innerHTML = foods.slice(0, 50).map(f => {
    const per = f.perServing || {};
    const g = f.serving && f.serving.g;
    const p = f.perServing ? per : Object.fromEntries(Object.entries(f.per100g).map(([k, v]) => [k, g ? Math.round(v * g) / 100 : v]));
    const s = f.serving || {};
    return `<tr><td>${esc(f.brand)}</td><td>${esc(f.base)}</td><td>${esc(f.variant)}</td>
      <td>${esc([s.label, s.g ? s.g + ' g' : '', s.ml ? s.ml + ' ml' : ''].filter(Boolean).join(' ') || (f.per100g ? '100 g' : ''))}${f.per100g ? '<br><span class="muted text-xs">問幾克</span>' : ''}</td>
      <td class="n">${num(p.kcal)}</td><td class="n">${num(p.p)}</td><td class="n">${num(p.f)}</td><td class="n">${num(p.c)}</td><td class="n">${num(p.sugar)}</td><td class="n">${num(p.na)}</td></tr>`;
  }).join('');
  $('previewMore').textContent = foods.length > 50 ? '只列前 50 樣，共 ' + foods.length + ' 樣。' : '';
  saveProgress();
}
$('checkBody').addEventListener('change', (e) => {
  const c = e.target.closest('[data-drop]');
  if (!c) return;
  if (c.checked) st.drop.add(c.getAttribute('data-drop')); else st.drop.delete(c.getAttribute('data-drop'));
  update();
});

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// 檔名加上來源方便人看；App 讀的是內容
const baseFile = () => ('食物資料_' + st.file.pack.name + (st.file.pack.edition ? '_' + st.file.pack.edition : '')).replace(/[\\/:*?"<>|\s]+/g, '_');
$('dlJson').addEventListener('click', () => {
  if (!st.file) return;
  download(baseFile() + '.json', JSON.stringify(st.file), 'application/json');
  note('outNote', 'ok', '已下載。到 App「我的食物」分頁 →「匯入食物資料庫」選這個檔案。進度還留著，要修改可以直接改完再下載一次。');
});
$('dlCsv').addEventListener('click', () => {
  if (!st.file) return;
  download(baseFile() + '.csv', '﻿' + toCsv(packRows(st.file)), 'text/csv');
});
