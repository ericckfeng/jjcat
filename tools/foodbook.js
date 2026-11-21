// AI 建檔小工具：書頁／衛教單張／掃描 PDF → AI 讀數字 → 對照照片校對 → 食物資料庫檔
// 獨立頁面，不碰 App 的 localStorage。進度（頁面、照片、讀出來的品項）存在這台電腦的 IndexedDB「foodbook-tool」。
import { BOOK_SCHEMA, EX_LABEL, bookPrompt, normalizeBookPage, checkBookItem, bookToPack, bookSummary, bookTablePrompt, bookItemsFromTable } from '../js/foodbook.js';
import { buildRequest, callGemini } from '../js/ai.js';
import { packRows, parsePastedTable } from '../js/packs.js';
import { toCsv } from '../js/lookup.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 免費方案每分鐘次數有限：每頁之間至少隔幾秒（測試用 ?gap=0）
const GAP_MS = Number(new URLSearchParams(location.search).get('gap') ?? 4500);
const KEY_STORE = 'foodbook_ai_key';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
const EX_KEYS = ['grain', 'prot', 'veg', 'fruit', 'dairy', 'oil'];

function note(id, tone, text) {
  const el = $(id);
  el.classList.toggle('hidden', !text);
  el.className = el.className.replace(/\b(bg|text)-(sky|rose|emerald|amber)-\d+\b/g, '').trim();
  if (text) el.classList.add(...({ info: ['bg-sky-50', 'text-sky-900'], err: ['bg-rose-50', 'text-rose-800'], ok: ['bg-emerald-50', 'text-emerald-900'], warn: ['bg-amber-50', 'text-amber-900'] }[tone || 'info']));
  el.textContent = text || '';
}
const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------------- 存進度（IndexedDB） ---------------- */
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('foodbook-tool', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('kv'); req.result.createObjectStore('img'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}
async function idb(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const r = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(r && r.result);
    tx.onerror = () => reject(tx.error);
  });
}
const imgGet = (id) => idb('img', 'readonly', s => s.get(id));
const imgPut = (id, v) => idb('img', 'readwrite', s => s.put(v, id));
const imgDel = (id) => idb('img', 'readwrite', s => s.delete(id));

const newProject = () => ({ v: 1, pdf: null, pages: [], items: [], meta: { name: '', org: '', title: '', edition: '', askBy: 'grams' }, filter: 'all' });
let P = newProject();
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { P.updatedAt = Date.now(); idb('kv', 'readwrite', s => s.put(JSON.parse(JSON.stringify(P)), 'project')).catch(() => {}); }, 300);
}

/* ---------------- 照片、PDF ---------------- */
// 長邊縮到 1600、存成 JPEG：AI 讀得清楚，也不會太大
async function fileToImage(file) {
  const bmp = await createImageBitmap(file);
  return canvasJpeg(bmp, bmp.width, bmp.height);
}
function canvasJpeg(src, w, h) {
  const k = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}
let pdfDoc = null;
let pdfjs = null;
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(PDFJS);
  // worker 在別的網域：用同網域的小檔案（blob）去 import，瀏覽器才肯開
  const blob = new Blob([`import '${PDFJS_WORKER}';`], { type: 'text/javascript' });
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(blob), { type: 'module' });
  return pdfjs;
}
async function renderPdfPage(n) {
  const page = await pdfDoc.getPage(n);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 1600 / Math.max(vp1.width, vp1.height));
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return c.toDataURL('image/jpeg', 0.85);
}

$('addPhotoBtn').addEventListener('click', () => $('photoInput').click());
$('photoInput').addEventListener('change', async (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;
  note('addNote', 'info', '加入中…');
  let n = 0;
  for (const f of files) {
    try {
      const page = { id: uid('pg'), kind: 'photo', label: f.name, status: 'todo', category: '', rotation: 0 };
      await imgPut(page.id, await fileToImage(f));
      P.pages.push(page);
      n++;
    } catch (err) { /* 讀不了的照片跳過 */ }
  }
  note('addNote', n ? 'ok' : 'err', n ? '加入 ' + n + ' 頁。' : '照片讀不了，請換一張。');
  save(); render();
});
$('addPdfBtn').addEventListener('click', () => $('pdfInput').click());
$('pdfInput').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  note('addNote', 'info', '讀取 PDF 中…（大的檔案要等一下）');
  try {
    const lib = await loadPdfJs();
    pdfDoc = await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
  } catch (err) {
    note('addNote', 'err', 'PDF 讀不了（要連網載入 PDF 程式）：' + (err && err.message || ''));
    return;
  }
  // 接著做：同一個 PDF（檔名、大小一樣）就接上；換了另一個 PDF，之前加的 PDF 頁面還沒處理的會用新的檔案
  const same = P.pdf && P.pdf.name === f.name && P.pdf.size === f.size;
  P.pdf = { name: f.name, size: f.size, pages: pdfDoc.numPages };
  $('pdfBox').classList.remove('hidden');
  $('pdfInfo').textContent = '「' + f.name + '」共 ' + pdfDoc.numPages + ' 頁。' + (same && P.pages.some(p => p.kind === 'pdf') ? '已經接上，可以繼續辨識。' : '');
  $('pdfFrom').value = 1; $('pdfTo').value = pdfDoc.numPages;
  note('addNote', null, '');
  save(); render();
});
$('pdfAddBtn').addEventListener('click', () => {
  if (!pdfDoc) return;
  const a = Math.max(1, Number($('pdfFrom').value) || 1);
  const b = Math.min(pdfDoc.numPages, Number($('pdfTo').value) || pdfDoc.numPages);
  if (a > b) { note('addNote', 'err', '頁數範圍不對'); return; }
  let n = 0;
  for (let i = a; i <= b; i++) {
    if (P.pages.some(p => p.kind === 'pdf' && p.pdfPage === i)) continue;
    P.pages.push({ id: uid('pg'), kind: 'pdf', pdfPage: i, label: 'PDF 第 ' + i + ' 頁', status: 'todo', category: '', rotation: 0 });
    n++;
  }
  P.pages.sort((x, y) => (x.kind === y.kind && x.kind === 'pdf' ? x.pdfPage - y.pdfPage : 0));
  note('addNote', 'ok', '加入 ' + n + ' 頁' + (n < b - a + 1 ? '（已經加過的不重複）' : '') + '。');
  save(); render();
});

/* ---------------- 頁面清單 ---------------- */
const pageNo = (p) => P.pages.indexOf(p) + 1;
const STATUS = { todo: '還沒辨識', busy: '辨識中…', done: '完成', error: '失敗', skip: '略過' };
const catOptions = (sel) => '<option value="">（一般）</option>' + EX_KEYS.map(k => `<option value="${k}" ${sel === k ? 'selected' : ''}>每樣＝${EX_LABEL[k]} 1 份</option>`).join('');
$('catPick').innerHTML = EX_KEYS.map(k => `<option value="${k}">${EX_LABEL[k]}（每樣 1 份）</option>`).join('') + '<option value="">一般（不自動填份數）</option>';
function renderPages() {
  $('pageRows').innerHTML = P.pages.map((p, i) => {
    const n = P.items.filter(it => it.pageId === p.id && !it.removed).length;
    const st = p.status === 'done' ? (n ? '完成，' + n + ' 樣' : '完成，這頁沒有食物') : p.status === 'error' ? '失敗：' + esc(p.error || '') : STATUS[p.status] || '';
    const label = p.kind === 'photo' ? '第 ' + (photos().indexOf(p) + 1) + ' 張照片・' + p.label : p.label;
    return `<tr><td class="tabular-nums">${i + 1}</td><td>${esc(label)}${p.note ? '<br><span class="text-sm muted">' + esc(p.note) + '</span>' : ''}</td>
      <td><select data-page-cat="${p.id}" class="field py-1 w-auto">${catOptions(p.category)}</select></td>
      <td class="${p.status === 'error' ? 'text-rose-700' : ''}">${st}</td>
      <td class="whitespace-nowrap">${p.kind !== 'paste' && (p.status === 'done' || p.status === 'error') ? `<button type="button" data-page-redo="${p.id}" class="chip-btn">重新辨識</button>` : ''}
        <button type="button" data-page-del="${p.id}" class="chip-btn">刪除</button></td></tr>`;
  }).join('');
}
$('pageRows').addEventListener('change', (e) => {
  const s = e.target.closest('[data-page-cat]');
  const p = s && P.pages.find(x => x.id === s.getAttribute('data-page-cat'));
  if (!p) return;
  p.category = s.value;
  if (p.status === 'done') note('runNote', 'info', '第 ' + pageNo(p) + ' 頁已經辨識過：要套用新的類別請按「重新辨識」。');
  save();
});
$('pageRows').addEventListener('click', async (e) => {
  const redo = e.target.closest('[data-page-redo]');
  const del = e.target.closest('[data-page-del]');
  const id = redo ? redo.getAttribute('data-page-redo') : del ? del.getAttribute('data-page-del') : null;
  const p = P.pages.find(x => x.id === id);
  if (!p || running) return;
  if (redo) { p.status = 'todo'; p.error = ''; }
  if (del) {
    P.pages.splice(P.pages.indexOf(p), 1);
    P.items = P.items.filter(it => it.pageId !== p.id);
    imgDel(p.id).catch(() => {});
  }
  save(); render();
});
$('catApplyBtn').addEventListener('click', () => {
  const a = Number($('catFrom').value), b = Number($('catTo').value);
  if (!(a >= 1 && b >= a)) { note('runNote', 'err', '請填第幾頁到第幾頁（看左邊的「頁」）'); return; }
  let redo = 0;
  P.pages.forEach((p, i) => { if (i + 1 >= a && i + 1 <= b) { p.category = $('catPick').value; if (p.status === 'done') redo++; } });
  note('runNote', 'ok', '已套用。' + (redo ? '其中 ' + redo + ' 頁已經辨識過，要重新辨識才會用新的類別。' : ''));
  save(); render();
});

/* ---------------- AI 辨識 ---------------- */
let running = false;
let stopAsked = false;
$('aiKey').value = (() => { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } })();
$('aiKey').addEventListener('change', () => { try { localStorage.setItem(KEY_STORE, $('aiKey').value.trim()); } catch (e) { /* 無法存 */ } });
const STOP_KINDS = new Set(['key', 'quota', 'referrer', 'forbidden', 'network']);
function aiErrText(e) {
  return ({ key: 'API Key 不對，請檢查第 1 步', quota: '今天的免費次數用完了（或太快），明天再按「繼續」', referrer: '這把 Key 限制了網站，請在 Google AI Studio 允許這個網址', forbidden: 'Key 沒有權限使用 Gemini', network: '連不上網路',
    timeout: 'AI 太久沒回應', busy: 'AI 太忙', model: '找不到 AI 模型', parse: 'AI 回傳的格式看不懂', empty: 'AI 沒有回答（可能被擋下）' }[e && e.kind] || '發生錯誤') + (e && e.detail ? '（' + e.detail + '）' : '');
}
async function processPage(p, key) {
  let img = await imgGet(p.id);
  if (!img && p.kind === 'pdf') {
    if (!pdfDoc) { const err = new Error('pdf'); err.kind = 'pdf'; throw err; }
    img = await renderPdfPage(p.pdfPage);
    await imgPut(p.id, img);
  }
  const request = buildRequest({ prompt: bookPrompt({ category: p.category }), imageDataUrl: img, schema: BOOK_SCHEMA });
  const obj = await callGemini({ key, request, timeoutMs: 90000 });
  const r = normalizeBookPage(obj, { category: p.category });
  p.rotation = r.rotation;
  p.note = r.note;
  P.items = P.items.filter(it => it.pageId !== p.id);
  const cat = p.category ? EX_LABEL[p.category] : '';
  r.items.forEach(it => P.items.push({ ...it, id: uid('it'), pageId: p.id, category: cat, checked: false, removed: false }));
}
$('runBtn').addEventListener('click', async () => {
  const key = $('aiKey').value.trim();
  if (!key) { note('runNote', 'err', '請先在第 1 步貼上 Gemini API Key'); return; }
  try { localStorage.setItem(KEY_STORE, key); } catch (e) { /* 無法存 */ }
  const queue = P.pages.filter(p => p.status === 'todo' || p.status === 'error');
  if (!queue.length) { note('runNote', 'ok', '每一頁都辨識好了，可以往下校對。'); return; }
  running = true; stopAsked = false;
  $('runBtn').classList.add('hidden'); $('stopBtn').classList.remove('hidden');
  let done = 0, last = 0;
  for (const p of queue) {
    if (stopAsked) break;
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    if (stopAsked) break;
    note('runNote', 'info', '辨識中：第 ' + pageNo(p) + ' 頁（這次還剩 ' + (queue.length - done) + ' 頁）');
    p.status = 'busy'; p.error = ''; renderPages();
    last = Date.now();
    try {
      await processPage(p, key);
      p.status = 'done';
      done++;
    } catch (e) {
      p.status = 'error';
      if (e && e.kind === 'pdf') {
        p.status = 'todo';
        note('runNote', 'warn', '第 ' + pageNo(p) + ' 頁在 PDF 裡：請在第 2 步再選一次「' + ((P.pdf && P.pdf.name) || 'PDF') + '」，再按「繼續」。');
        stopAsked = true;
      } else {
        p.error = aiErrText(e);
        if (STOP_KINDS.has(e && e.kind)) { note('runNote', e.kind === 'quota' ? 'warn' : 'err', p.error + '。進度已經存好。'); stopAsked = true; }
      }
    }
    save(); render();
  }
  running = false;
  $('runBtn').classList.remove('hidden'); $('stopBtn').classList.add('hidden');
  const s = bookSummary(P);
  if (!stopAsked || s.todo === 0) note('runNote', s.failed ? 'warn' : 'ok', '這次辨識了 ' + done + ' 頁。' + (s.failed ? s.failed + ' 頁失敗，可以按「繼續」再試。' : '往下對照照片校對。'));
  render();
});
$('stopBtn').addEventListener('click', () => { stopAsked = true; note('runNote', 'info', '這一頁做完就暫停。'); });

/* ---------------- 用自己的 AI（複製提示詞 → 貼回答） ---------------- */
// 頁碼：PDF 的頁碼；只有照片時是照片的順序（第幾張）
const hasPdf = () => P.pages.some(p => p.kind === 'pdf');
const photos = () => P.pages.filter(p => p.kind === 'photo');
function noOf(p) { return p.kind === 'pdf' ? p.pdfPage : p.kind === 'photo' && !hasPdf() ? photos().indexOf(p) + 1 : p.pasteNo; }
function pageForNo(n) {
  if (n == null) return null;
  return P.pages.find(p => p.kind === 'pdf' && p.pdfPage === n) || (!hasPdf() && photos()[n - 1]) || P.pages.find(p => p.kind === 'paste' && p.pasteNo === n) || null;
}
function tablePrompt() {
  const categories = {};
  P.pages.forEach(p => { const n = noOf(p); if (p.category && n) categories[n] = p.category; });
  return bookTablePrompt({ categories });
}
$('promptText').textContent = tablePrompt();
$('copyPromptBtn').addEventListener('click', async () => {
  const text = tablePrompt();
  $('promptText').textContent = text;
  try { await navigator.clipboard.writeText(text); $('copyNote').textContent = '已複製，貼到 AI 的對話框，再附上照片或 PDF。'; }
  catch (e) { $('promptView').open = true; $('copyNote').textContent = '沒辦法自動複製：請在下面的提示詞上全選、複製。'; }
});
function loadPasted(append) {
  let rows = parsePastedTable($('pasteText').value);
  const hasHead = rows.length && rows[0].some(c => /名稱|品項|品名/.test(c));
  // 說了「繼續」之後的回答不會再有欄位名稱那一列：用上一段的
  if (!hasHead && append && P.pasteHead) rows = [P.pasteHead, ...rows];
  else if (hasHead) P.pasteHead = rows[0];
  const groups = bookItemsFromTable(rows);
  if (!groups.length) { note('pasteNote', 'err', '讀不到表格：請把 AI 的整段回答貼上（第一段要有欄位名稱那一列）。'); return; }
  let n = 0, noPhoto = 0;
  const cleared = new Set();
  groups.forEach(({ page, obj }) => {
    let p = pageForNo(page);
    if (!p) {
      // 工具裡沒有這一頁的照片：一樣收進來，校對時沒有照片可以對照
      p = { id: uid('pg'), kind: 'paste', pasteNo: page, label: page ? '第 ' + page + ' 頁（沒有照片）' : '沒寫頁碼的', status: 'done', category: '', rotation: 0 };
      P.pages.push(p);
    }
    if (p.kind === 'paste') noPhoto += obj.items.length;
    if (!append && !cleared.has(p.id)) { P.items = P.items.filter(it => it.pageId !== p.id); cleared.add(p.id); }
    const r = normalizeBookPage(obj, { category: p.category });
    const cat = p.category ? EX_LABEL[p.category] : '';
    r.items.forEach(it => P.items.push({ ...it, id: uid('it'), pageId: p.id, category: cat, checked: false, removed: false }));
    p.status = 'done'; p.error = ''; p.note = p.note || '用自己的 AI 讀的';
    n += r.items.length;
  });
  $('pasteText').value = '';
  note('pasteNote', 'ok', (append ? '接上 ' : '讀入 ') + n + ' 樣。' + (noPhoto ? '其中 ' + noPhoto + ' 樣找不到對應的照片（頁碼對不上，或還沒在第 2 步加入），校對時沒有照片可以對照。' : '往下對照照片校對。'));
  save(); render();
}
$('pasteLoadBtn').addEventListener('click', () => loadPasted(false));
$('pasteAppendBtn').addEventListener('click', () => loadPasted(true));

/* ---------------- 校對 ---------------- */
const NUM_FIELDS = [['weightG', '重量 g'], ['kcal', '熱量 kcal'], ['p', '蛋白質 g'], ['f', '脂肪 g'], ['c', '醣類 g'], ['sugar', '糖 g'], ['na', '鈉 mg'], ['fiber', '纖維 g']];
const imgCache = new Map();
async function pageImg(pageId) {
  if (!imgCache.has(pageId)) imgCache.set(pageId, await imgGet(pageId));
  return imgCache.get(pageId);
}
function flagsHTML(it) {
  return checkBookItem(it).map(f => `<div class="flag-${f.level} rounded-lg px-2 py-1 text-sm">${f.level === 'info' ? 'ℹ' : '⚠'} ${esc(f.msg)}</div>`).join('');
}
function itemHTML(it) {
  const p = P.pages.find(x => x.id === it.pageId);
  const v = (x) => (x == null ? '' : x);
  return `<div class="step space-y-2 ${it.checked ? 'card-ok' : ''}" data-item="${it.id}">
    <div class="flex gap-3">
      <div class="thumb" data-zoom="${it.pageId}"><img data-page-img="${it.pageId}" alt="第 ${p ? pageNo(p) : ''} 頁" style="transform:rotate(${(p && p.rotation) || 0}deg)" /></div>
      <div class="min-w-0 flex-1 space-y-1">
        <div class="text-sm muted">第 ${p ? pageNo(p) : '?'} 頁${it.category ? '・' + esc(it.category) : ''}${it.kcalPerG != null ? '・書上熱量／公克 ' + it.kcalPerG : ''}${it.carbPerG != null ? '・醣類／公克 ' + it.carbPerG : ''}</div>
        <div class="fld"><label>名稱</label><input data-f="name" class="field" value="${esc(it.name)}" /></div>
        <div data-flags class="space-y-1">${flagsHTML(it)}</div>
      </div>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <div class="fld"><label>份量說明</label><input data-f="servingLabel" class="field" value="${esc(it.servingLabel)}" /></div>
      ${NUM_FIELDS.map(([k, l]) => `<div class="fld"><label>${l}</label><input data-f="${k}" type="number" inputmode="decimal" min="0" step="any" class="field tabular-nums" value="${v(it[k])}" /></div>`).join('')}
    </div>
    <div class="grid grid-cols-3 sm:grid-cols-6 gap-2">
      ${EX_KEYS.map(k => `<div class="fld"><label>${EX_LABEL[k]}（份）</label><input data-ex="${k}" type="number" inputmode="decimal" min="0" step="0.5" class="field tabular-nums" value="${v(it.ex && it.ex[k])}" /></div>`).join('')}
    </div>
    <div class="fld"><label>備註（用自己的話，簡短）</label><input data-f="note" class="field" value="${esc(it.note)}" /></div>
    <div class="flex flex-wrap items-center gap-3">
      <label class="flex gap-2 items-center"><input data-f="hasSoup" type="checkbox" ${it.hasSoup ? 'checked' : ''} /> 有湯汁</label>
      <button type="button" data-check class="${it.checked ? 'btn-secondary' : 'btn-primary'} px-4">${it.checked ? '✔ 已校對（按一下取消）' : '校對好了'}</button>
      <button type="button" data-remove class="chip-btn">刪掉這一樣</button>
    </div>
  </div>`;
}
function renderReview() {
  const items = P.items.filter(it => !it.removed);
  const s = bookSummary(P);
  $('reviewSummary').innerHTML = `共 <b>${s.items}</b> 樣，已校對 <b>${s.checked}</b> 樣${s.flagged ? '，<span class="text-amber-700">有提醒 ' + s.flagged + ' 樣</span>' : ''}。`;
  const filters = [['all', '全部'], ['todo', '還沒校對'], ['flag', '有提醒']];
  $('reviewFilter').innerHTML = filters.map(([k, l]) => `<button type="button" data-filter="${k}" class="toggle-btn chip-lg ${P.filter === k ? 'is-active' : ''}">${l}</button>`).join('');
  const shown = items.filter(it => P.filter === 'todo' ? !it.checked : P.filter === 'flag' ? checkBookItem(it).some(f => f.level !== 'info') : true);
  $('itemList').innerHTML = shown.length ? shown.map(itemHTML).join('') : '<p class="muted">沒有要看的。</p>';
  $('itemList').querySelectorAll('[data-page-img]').forEach(async (img) => { img.src = (await pageImg(img.getAttribute('data-page-img'))) || ''; });
}
$('reviewFilter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  P.filter = b.getAttribute('data-filter');
  save(); renderReview();
});
const itemOf = (el) => { const card = el.closest('[data-item]'); return card && P.items.find(it => it.id === card.getAttribute('data-item')); };
$('itemList').addEventListener('input', (e) => {
  const it = itemOf(e.target);
  if (!it) return;
  const f = e.target.getAttribute('data-f');
  const x = e.target.getAttribute('data-ex');
  if (f === 'hasSoup') it.hasSoup = e.target.checked;
  else if (f === 'name' || f === 'servingLabel' || f === 'note') it[f] = e.target.value;
  else if (f) { const n = e.target.value === '' ? null : Number(e.target.value); it[f] = Number.isFinite(n) && n >= 0 ? n : null; }
  else if (x) { it.ex = it.ex || {}; const n = Number(e.target.value); if (n > 0) it.ex[x] = n; else delete it.ex[x]; it.exFromChart = false; }
  e.target.closest('[data-item]').querySelector('[data-flags]').innerHTML = flagsHTML(it);
  save(); renderOut();
});
$('itemList').addEventListener('click', async (e) => {
  const z = e.target.closest('[data-zoom]');
  if (z) { $('zoom').querySelector('img').src = (await pageImg(z.getAttribute('data-zoom'))) || ''; const p = P.pages.find(x => x.id === z.getAttribute('data-zoom')); $('zoom').querySelector('img').style.transform = 'rotate(' + ((p && p.rotation) || 0) + 'deg)'; $('zoom').classList.remove('hidden'); return; }
  const it = itemOf(e.target);
  if (!it) return;
  if (e.target.closest('[data-check]')) {
    if (!it.checked && checkBookItem(it).some(f => f.level === 'error')) { alertCard(e.target, '還沒有熱量，不能算校對好'); return; }
    it.checked = !it.checked;
  } else if (e.target.closest('[data-remove]')) it.removed = true;
  else return;
  save(); render();
});
function alertCard(el, msg) {
  const box = el.closest('[data-item]').querySelector('[data-flags]');
  box.insertAdjacentHTML('afterbegin', `<div class="flag-error rounded-lg px-2 py-1 text-sm">${esc(msg)}</div>`);
}
$('zoom').addEventListener('click', () => $('zoom').classList.add('hidden'));

/* ---------------- 匯出 ---------------- */
const META = [['pkName', 'name'], ['pkOrg', 'org'], ['pkTitle', 'title'], ['pkEdition', 'edition']];
META.forEach(([id, k]) => $(id).addEventListener('input', () => { P.meta[k] = $(id).value; save(); renderOut(); }));
document.querySelectorAll('[data-askby]').forEach(b => b.addEventListener('click', () => { P.meta.askBy = b.getAttribute('data-askby'); save(); renderOut(); }));
$('outForce').addEventListener('change', renderOut);
function renderOut() {
  document.querySelectorAll('[data-askby]').forEach(b => b.classList.toggle('is-active', b.getAttribute('data-askby') === (P.meta.askBy || 'grams')));
  const s = bookSummary(P);
  const noKcal = P.items.filter(it => !it.removed && it.kcal == null).length;
  const unchecked = s.items - s.checked;
  const warn = [unchecked ? '還有 ' + unchecked + ' 樣沒校對。' : '', noKcal ? noKcal + ' 樣沒有熱量，不會匯出。' : ''].filter(Boolean).join('');
  note('outWarn', 'warn', warn);
  $('outForceWrap').classList.toggle('hidden', !unchecked);
}
function buildFile() {
  const s = bookSummary(P);
  if (s.items - s.checked && !$('outForce').checked) { note('outNote', 'err', '還有沒校對的：校對完，或勾「我知道，還是要匯出」。'); return null; }
  const { file, error } = bookToPack(P.items, P.meta);
  if (error) { note('outNote', 'err', error); return null; }
  return file;
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const baseFile = (f) => ('食物資料_' + f.pack.name + (f.pack.edition ? '_' + f.pack.edition : '')).replace(/[\\/:*?"<>|\s]+/g, '_');
$('dlJson').addEventListener('click', () => {
  const f = buildFile();
  if (!f) return;
  download(baseFile(f) + '.json', JSON.stringify(f), 'application/json');
  note('outNote', 'ok', '已下載 ' + f.foods.length + ' 樣。到 App「我的食物」分頁 →「匯入食物資料庫」選這個檔案。進度還留著，之後補頁、修改再下載一次，App 匯入時選「換成新版」。');
});
$('dlCsv').addEventListener('click', () => {
  const f = buildFile();
  if (f) download(baseFile(f) + '.csv', '﻿' + toCsv(packRows(f)), 'text/csv');
});

/* ---------------- 畫面、接著做 ---------------- */
function render() {
  const has = P.pages.length > 0;
  $('stepPages').classList.toggle('hidden', !has);
  $('stepReview').classList.toggle('hidden', !P.items.some(it => !it.removed));
  $('stepOut').classList.toggle('hidden', !P.items.some(it => !it.removed));
  META.forEach(([id, k]) => { if (document.activeElement !== $(id)) $(id).value = P.meta[k] || ''; });
  const s = bookSummary(P);
  $('runBtn').textContent = !s.todo ? '✔ 全部辨識好了' : s.done || s.failed ? '繼續 AI 辨識（還有 ' + s.todo + ' 頁）' : '開始 AI 辨識';
  renderPages();
  renderReview();
  renderOut();
  $('promptText').textContent = tablePrompt();
}
(async () => {
  let saved = null;
  try { saved = await idb('kv', 'readonly', s => s.get('project')); } catch (e) { /* 無法用 IndexedDB */ }
  if (saved && saved.pages && saved.pages.length) {
    const s = bookSummary(saved);
    $('resumeText').textContent = '上次做到：' + s.pages + ' 頁（辨識好 ' + s.done + ' 頁）、' + s.items + ' 樣（校對好 ' + s.checked + ' 樣）' + (saved.meta && saved.meta.name ? '，「' + saved.meta.name + '」' : '') + '。';
    $('resumeBox').classList.remove('hidden');
    $('resumeBtn').onclick = () => {
      P = { ...newProject(), ...saved };
      P.pages.forEach(p => { if (p.status === 'busy') p.status = 'todo'; });
      $('resumeBox').classList.add('hidden');
      if (P.pdf && P.pages.some(p => p.kind === 'pdf' && p.status !== 'done')) {
        note('addNote', 'info', '還有 PDF 的頁面沒辨識：要繼續的話，請再選一次「' + P.pdf.name + '」。');
      }
      render();
    };
  }
  $('resetBtn').onclick = async () => {
    P = newProject();
    imgCache.clear();
    try { await idb('kv', 'readwrite', s => s.clear()); await idb('img', 'readwrite', s => s.clear()); } catch (e) { /* 無法清 */ }
    $('resumeBox').classList.add('hidden');
    render();
  };
  render();
})();
