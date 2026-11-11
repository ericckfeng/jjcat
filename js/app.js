import {
  MEAL_KEYS, MEAL_META, MACRO_KEYS, MACRO_META, EX_KEYS, EX_META, EX_DEFAULT_NUTR,
  EST_PARTS, PRESET_FOODS, HUNGER_LABELS, MOOD_OPTIONS, BOWEL_LABELS
} from './nutrition.js';
import { photoDB } from './db.js';
import { REPORT_CSS, buildReportHTML, buildReportText } from './report.js';
import * as cloud from './cloud.js';

const STORAGE_KEY = 'diet_tracker_v2';
const LEGACY_KEY = 'daily_calorie_tracker_v1';
const $ = (id) => document.getElementById(id);

/* ---------------- 工具 ---------------- */
function toDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function todayStr() { return toDateStr(new Date()); }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return toDateStr(d); }
function datesBetween(from, to) {
  const out = [];
  let cur = from;
  while (cur <= to && out.length < 400) { out.push(cur); cur = addDays(cur, 1); }
  return out;
}
function fmtMD(s) { const d = parseDate(s); return (d.getMonth() + 1) + '/' + d.getDate(); }
function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function r1(n) { return Math.round(n * 10) / 10; }
function fmt(n, digits = 0) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return digits ? r1(n).toLocaleString(undefined, { maximumFractionDigits: 1 }) : Math.round(n).toLocaleString();
}
function uid(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function nowTime() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function inferMeal() {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 14) return 'lunch';
  if (h < 17) return 'snack';
  return 'dinner';
}
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

/* ---------------- 營養計算 ---------------- */
function cleanEx(ex) {
  if (!ex || typeof ex !== 'object') return null;
  const out = {};
  EX_KEYS.forEach(k => { const v = num(ex[k]); if (v) out[k] = r1(v); });
  return Object.keys(out).length ? out : null;
}
function scaleNutr(src, mult) {
  const m = (v) => (v === null || v === undefined ? null : r1(v * mult));
  let ex = null;
  if (src.ex) {
    ex = {};
    EX_KEYS.forEach(k => { if (src.ex[k]) ex[k] = src.ex[k] * mult; });
    ex = cleanEx(ex);
  }
  return { kcal: Math.max(0, Math.round((num(src.kcal) || 0) * mult)), p: m(num(src.p)), c: m(num(src.c)), f: m(num(src.f)), ex };
}
function deriveFromEx(ex) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  EX_KEYS.forEach(k => {
    const n = num(ex && ex[k]) || 0;
    const d = EX_DEFAULT_NUTR[k];
    t.kcal += n * d.kcal; t.p += n * d.p; t.c += n * d.c; t.f += n * d.f;
  });
  return { kcal: Math.round(t.kcal), p: r1(t.p), c: r1(t.c), f: r1(t.f) };
}
function dayTotals(date) {
  const list = state.logs[date] || [];
  const t = { kcal: 0, p: 0, c: 0, f: 0, ex: {}, macroItems: 0, exItems: 0, pending: 0, count: list.length, meals: {} };
  EX_KEYS.forEach(k => { t.ex[k] = 0; });
  MEAL_KEYS.forEach(k => { t.meals[k] = 0; });
  list.forEach(it => {
    t.kcal += it.kcal || 0;
    if (t.meals[it.meal] !== undefined) t.meals[it.meal] += it.kcal || 0;
    if (it.p != null || it.c != null || it.f != null) {
      t.macroItems++;
      t.p += it.p || 0; t.c += it.c || 0; t.f += it.f || 0;
    }
    if (it.ex) { t.exItems++; EX_KEYS.forEach(k => { t.ex[k] += it.ex[k] || 0; }); }
    if (it.pending) t.pending++;
  });
  t.p = r1(t.p); t.c = r1(t.c); t.f = r1(t.f);
  EX_KEYS.forEach(k => { t.ex[k] = r1(t.ex[k]); });
  return t;
}

/* ---------------- 狀態與儲存 ---------------- */
const DEFAULT_TARGETS = { kcal: 1800, p: null, c: null, f: null, ex: {}, weight: null };
const state = {
  targets: { ...DEFAULT_TARGETS, ex: {} },
  logs: {},
  days: {},
  quickItems: PRESET_FOODS.map(f => ({ ...f, isFav: false })),
  profile: { name: '' },
  meta: { lastBackup: null, installHintDismissed: false, deviceId: null, cloud: { linked: false, email: '', auto: true, lastBackup: null, knownModified: null, conflict: false } }
};
const ui = {
  date: todayStr(),
  meal: inferMeal(),
  tab: 'log',
  libCat: 'all',
  libQ: '',
  trendRange: 7
};

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    showToast('⚠ 無法儲存，請先下載備份');
  }
}
let persistTimer = null;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persist();
    renderTiles();
  }, 400);
}

function normalizeEntry(raw) {
  return {
    id: String(raw.id || uid('item')),
    name: String(raw.name || '未命名'),
    kcal: Math.max(0, Math.round(num(raw.kcal) || 0)),
    multiplier: num(raw.multiplier) || 1,
    meal: MEAL_KEYS.includes(raw.meal) ? raw.meal : 'snack',
    time: typeof raw.time === 'string' ? raw.time : '',
    pending: Boolean(raw.pending),
    hasPhoto: false,
    p: num(raw.p), c: num(raw.c), f: num(raw.f),
    ex: cleanEx(raw.ex)
  };
}
function normalizeQuick(q) {
  return {
    id: String(q.id || uid('qi')), name: String(q.name), kcal: Math.max(0, Math.round(num(q.kcal) || 0)),
    cat: ['fav', 'breakfast', 'meal', 'drink'].includes(q.cat) ? q.cat : 'fav',
    isFav: Boolean(q.isFav || q.cat === 'fav'),
    p: num(q.p), c: num(q.c), f: num(q.f), ex: cleanEx(q.ex)
  };
}

function applyLoaded(p) {
  if (p.targets) state.targets = { ...DEFAULT_TARGETS, ...p.targets, ex: { ...(p.targets.ex || {}) } };
  if (p.logs && typeof p.logs === 'object') state.logs = p.logs;
  if (p.days && typeof p.days === 'object') state.days = p.days;
  if (Array.isArray(p.quickItems)) state.quickItems = p.quickItems;
  if (p.profile) state.profile = { ...state.profile, ...p.profile };
  if (p.meta) state.meta = { ...state.meta, ...p.meta, cloud: { ...state.meta.cloud, ...(p.meta.cloud || {}) } };
}

// 合併匯入（相容舊版 v1：targetKcal + 照片直接放在記錄裡）
async function mergeImport(data) {
  if (!data || typeof data !== 'object' || (!data.logs && !data.quickItems && !data.days)) {
    throw new Error('檔案格式不符');
  }
  let added = 0;
  let photos = 0;
  if (data.targets && typeof data.targets === 'object') {
    state.targets = { ...DEFAULT_TARGETS, ...data.targets, ex: { ...(data.targets.ex || {}) } };
  } else if (typeof data.targetKcal === 'number' && data.targetKcal >= 800) {
    state.targets.kcal = data.targetKcal;
  }
  if (data.profile && typeof data.profile === 'object') state.profile = { ...state.profile, ...data.profile };
  const photoMap = data.photos && typeof data.photos === 'object' ? data.photos : {};

  if (data.logs && typeof data.logs === 'object') {
    for (const [date, list] of Object.entries(data.logs)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(list)) continue;
      const cur = state.logs[date] || (state.logs[date] = []);
      for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        const it = normalizeEntry(raw);
        if (cur.some(x => x.id === it.id)) continue;
        const dataUrl = raw.photo || photoMap[it.id];
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image')) {
          await savePhoto(it.id, dataUrl);
          it.hasPhoto = true;
          photos++;
        }
        cur.push(it);
        added++;
      }
    }
  }
  if (data.days && typeof data.days === 'object') {
    for (const [date, val] of Object.entries(data.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !val || typeof val !== 'object') continue;
      state.days[date] = { ...(state.days[date] || {}), ...val };
    }
  }
  if (Array.isArray(data.quickItems)) {
    data.quickItems.forEach(q => {
      if (q && q.id && q.name && !state.quickItems.some(x => x.id === q.id)) state.quickItems.push(normalizeQuick(q));
    });
  }
  return { added, photos };
}

async function loadState() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { /* blocked */ }
  if (raw) {
    try { applyLoaded(JSON.parse(raw)); } catch (e) { /* corrupted */ }
    return;
  }
  let legacy = null;
  try { legacy = localStorage.getItem(LEGACY_KEY); } catch (e) { /* blocked */ }
  if (legacy) {
    try { await mergeImport(JSON.parse(legacy)); persist(); } catch (e) { /* ignore */ }
  }
}

/* ---------------- 照片 ---------------- */
const photoCache = new Map();
async function savePhoto(id, dataUrl) { photoCache.set(id, dataUrl); await photoDB.put(id, dataUrl); }
async function getPhoto(id) {
  if (photoCache.has(id)) return photoCache.get(id);
  const v = await photoDB.get(id);
  if (v) photoCache.set(id, v);
  return v;
}
async function deletePhoto(id) { photoCache.delete(id); await photoDB.del(id); }
function hydratePhotos(root) {
  root.querySelectorAll('img[data-photo-id]').forEach(async (img) => {
    const src = await getPhoto(img.getAttribute('data-photo-id'));
    if (src) img.src = src;
  });
}
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const maxDim = 900;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; } else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------- Toast / Confirm / Modal ---------------- */
let toastTimer = null;
let toastActionFn = null;
function showToast(msg, actionLabel, actionFn) {
  $('toastMsg').textContent = msg;
  const btn = $('toastAction');
  if (actionLabel && actionFn) {
    btn.textContent = actionLabel; btn.classList.remove('hidden'); toastActionFn = actionFn;
  } else {
    btn.classList.add('hidden'); toastActionFn = null;
  }
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), actionFn ? 5000 : 2400);
}
$('toastAction').addEventListener('click', () => {
  if (toastActionFn) toastActionFn();
  toastActionFn = null;
  $('toast').classList.add('hidden');
});

let pendingConfirm = null;
let pendingCancel = null;
function openConfirm(title, message, onOk, okLabel = '確定', onCancel = null) {
  if (typeof pendingCancel === 'function') pendingCancel();
  $('confirmTitle').textContent = title;
  $('confirmMessage').textContent = message;
  $('confirmOkBtn').textContent = okLabel;
  pendingConfirm = onOk;
  pendingCancel = onCancel;
  openModal('confirmModal');
}
function confirmAsync(title, message, okLabel) {
  return new Promise(resolve => openConfirm(title, message, () => resolve(true), okLabel, () => resolve(false)));
}
function cancelConfirm() {
  const fn = pendingCancel;
  pendingConfirm = null; pendingCancel = null;
  closeModal('confirmModal');
  if (typeof fn === 'function') fn();
}
$('confirmCancelBtn').addEventListener('click', cancelConfirm);
$('confirmOkBtn').addEventListener('click', () => {
  const fn = pendingConfirm;
  pendingConfirm = null; pendingCancel = null;
  closeModal('confirmModal');
  if (typeof fn === 'function') fn();
});

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
document.addEventListener('click', (e) => {
  const closer = e.target.closest('[data-close]');
  if (closer) { closeModal(closer.getAttribute('data-close')); return; }
  if (e.target.classList && e.target.classList.contains('modal')) {
    if (e.target.id === 'confirmModal') cancelConfirm(); else e.target.classList.add('hidden');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('confirmModal').classList.contains('hidden')) cancelConfirm();
  document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
});

/* ---------------- 營養欄位元件 ---------------- */
const KCAL_FIELD = { add: 'foodKcalInput', edit: 'editLogKcalInput', qi: 'quickItemKcalInput' };
function nutrFieldsHTML(prefix) {
  const inp = (id, ph, step) =>
    `<input id="${id}" type="number" inputmode="decimal" min="0" step="${step}" placeholder="${ph}" class="field px-2 py-1.5 min-h-[38px] text-center tabular-nums bg-white" />`;
  return `
    <div class="space-y-2 pt-1">
      <div class="grid grid-cols-3 gap-1.5">
        ${MACRO_KEYS.map(k => `<label class="block"><span class="block text-[0.625rem] text-stone-500 mb-0.5">${MACRO_META[k].label} (g)</span>${inp(prefix + '-' + k, 'g', '0.1')}</label>`).join('')}
      </div>
      <div class="flex items-center justify-between pt-1">
        <span class="text-[0.6875rem] font-semibold text-stone-600">六大類份數</span>
        <button type="button" data-derive="${prefix}" class="derive-btn text-[0.6875rem] font-semibold text-emerald-700 hover:underline">依份數推算熱量／營養素</button>
      </div>
      <div class="grid grid-cols-3 gap-1.5">
        ${EX_KEYS.map(k => `<label class="block"><span class="block text-[0.625rem] text-stone-500 mb-0.5">${EX_META[k].emoji} ${EX_META[k].short}</span>${inp(prefix + '-ex-' + k, '份', '0.5')}</label>`).join('')}
      </div>
    </div>`;
}
function readNutrFields(prefix) {
  const o = {};
  MACRO_KEYS.forEach(k => { o[k] = num($(prefix + '-' + k).value); });
  const ex = {};
  EX_KEYS.forEach(k => { ex[k] = num($(prefix + '-ex-' + k).value); });
  o.ex = cleanEx(ex);
  return o;
}
function writeNutrFields(prefix, src) {
  MACRO_KEYS.forEach(k => { $(prefix + '-' + k).value = src && src[k] != null ? src[k] : ''; });
  EX_KEYS.forEach(k => { $(prefix + '-ex-' + k).value = src && src.ex && src.ex[k] ? src.ex[k] : ''; });
}
$('addNutrFields').innerHTML = nutrFieldsHTML('add');
$('editNutrFields').innerHTML = nutrFieldsHTML('edit');
$('qiNutrFields').innerHTML = nutrFieldsHTML('qi');
$('tgtExFields').innerHTML = EX_KEYS.map(k =>
  `<label class="block"><span class="block text-[0.625rem] text-stone-500 mb-0.5">${EX_META[k].emoji} ${EX_META[k].short}</span><input id="tgt-ex-${k}" type="number" inputmode="decimal" min="0" step="0.5" placeholder="份" class="field px-2 py-1.5 min-h-[38px] text-center tabular-nums" /></label>`
).join('');

document.addEventListener('click', (e) => {
  const b = e.target.closest('.derive-btn');
  if (!b) return;
  const prefix = b.getAttribute('data-derive');
  const n = readNutrFields(prefix);
  if (!n.ex) { showToast('請先填六大類份數'); return; }
  const d = deriveFromEx(n.ex);
  const filled = [];
  const kEl = $(KCAL_FIELD[prefix]);
  if (!kEl.value) { kEl.value = d.kcal; filled.push('熱量'); }
  MACRO_KEYS.forEach(k => {
    const el = $(prefix + '-' + k);
    if (!el.value) { el.value = d[k]; filled.push(MACRO_META[k].label); }
  });
  showToast(filled.length ? '已推算' + filled.join('、') + '（豆魚蛋肉以中脂、乳品以低脂計）' : '欄位都已有數值，沒有覆蓋');
});

/* ---------------- 新增／刪除記錄 ---------------- */
async function addEntry({ name, nutr, mult = 1, meal, photo = null, pending = false, saveFav = false }) {
  const s = scaleNutr(nutr, mult);
  const it = {
    id: uid('item'), name: name.trim(), kcal: s.kcal, multiplier: mult, meal, time: nowTime(),
    pending: Boolean(pending), hasPhoto: Boolean(photo), p: s.p, c: s.c, f: s.f, ex: s.ex
  };
  if (photo) await savePhoto(it.id, photo);
  (state.logs[ui.date] || (state.logs[ui.date] = [])).push(it);
  if (saveFav && (num(nutr.kcal) || 0) > 0 && !state.quickItems.some(q => q.name === it.name)) {
    state.quickItems.unshift({
      id: uid('qi'), name: it.name, kcal: Math.round(nutr.kcal), cat: 'fav', isFav: true,
      p: num(nutr.p), c: num(nutr.c), f: num(nutr.f), ex: cleanEx(nutr.ex)
    });
  }
  persist();
  renderAll();
  showToast('已加入「' + it.name + '」(' + it.kcal + ' kcal)');
}
function addFromQuick(q) {
  addEntry({ name: q.name, nutr: q, mult: 1, meal: ui.meal });
}

async function deleteEntry(id) {
  const list = state.logs[ui.date] || [];
  const idx = list.findIndex(i => i.id === id);
  if (idx === -1) return;
  const [item] = list.splice(idx, 1);
  const date = ui.date;
  const photo = item.hasPhoto ? await getPhoto(item.id) : null;
  if (item.hasPhoto) await deletePhoto(item.id);
  persist();
  renderAll();
  showToast('已刪除「' + item.name + '」', '復原', async () => {
    if (photo) await savePhoto(item.id, photo);
    (state.logs[date] || (state.logs[date] = [])).splice(idx, 0, item);
    persist();
    renderAll();
  });
}

/* ---------------- Render：今日 ---------------- */
function renderSummary() {
  const t = dayTotals(ui.date);
  const target = state.targets.kcal > 0 ? state.targets.kcal : 1800;
  const remaining = target - t.kcal;
  const pct = Math.round(t.kcal / target * 100);
  const clamped = Math.min(100, Math.max(0, pct));
  $('summaryDateLabel').textContent = ui.date === todayStr() ? '今日' : fmtMD(ui.date) + ' ';
  $('totalConsumed').textContent = t.kcal.toLocaleString();
  $('summaryTarget').textContent = target.toLocaleString();
  $('headerTargetVal').textContent = target.toLocaleString();
  $('datePicker').value = ui.date;
  const dd = parseDate(ui.date);
  $('dateLabel').textContent = (dd.getMonth() + 1) + '月' + dd.getDate() + '日（' + '日一二三四五六'[dd.getDay()] + '）';

  const remEl = $('remainingText');
  const ring = $('progressRing');
  const C = 263.89;
  ring.style.strokeDashoffset = String(C - C * clamped / 100);
  if (remaining >= 0) {
    remEl.textContent = '還可以攝取 ' + remaining.toLocaleString() + ' kcal';
    const warn = pct >= 85;
    remEl.className = 'text-sm font-medium ' + (warn ? 'text-amber-600' : 'text-emerald-700');
    ring.setAttribute('stroke', warn ? '#d97706' : '#059669');
  } else {
    remEl.textContent = '已超出目標 ' + Math.abs(remaining).toLocaleString() + ' kcal';
    remEl.className = 'text-sm font-medium text-rose-600';
    ring.setAttribute('stroke', '#e11d48');
  }
  $('progressPctText').textContent = pct + '%';
  MEAL_KEYS.forEach(k => { $('mealSum-' + k).textContent = t.meals[k].toLocaleString(); });

  const tg = state.targets;
  const hasMacroT = MACRO_KEYS.some(k => tg[k]);
  const hasExT = EX_KEYS.some(k => tg.ex && tg.ex[k]);
  let html = '';
  if (hasMacroT || t.macroItems) {
    html += '<div class="grid grid-cols-3 gap-2">' +
      MACRO_KEYS.map(k => meterHTML(MACRO_META[k].label, t[k], tg[k], 'g', MACRO_META[k].bar)).join('') + '</div>';
  }
  if (hasExT || t.exItems) {
    html += '<div class="grid grid-cols-3 sm:grid-cols-6 gap-2">' +
      EX_KEYS.map(k => meterHTML(EX_META[k].emoji + ' ' + EX_META[k].short, t.ex[k], tg.ex && tg.ex[k], '份', 'bg-emerald-500')).join('') + '</div>';
  }
  if (!html) {
    html = '<p class="text-[0.6875rem] text-stone-400">提示：在右上「目標」填入營養師給的三大營養素／六大類份數，這裡會顯示每日進度。</p>';
  }
  if (t.macroItems && t.macroItems < t.count) {
    html += `<p class="text-[0.6875rem] text-stone-400">營養素只計入有填的 ${t.macroItems}/${t.count} 筆</p>`;
  }
  if (t.pending) {
    html += `<p class="text-[0.6875rem] font-semibold text-amber-700">⚠ 有 ${t.pending} 筆「暫估待修」，記得對照照片修正</p>`;
  }
  $('summaryNutr').innerHTML = html;
}
function meterHTML(label, val, target, unit, bar) {
  const v = r1(val || 0);
  const pct = target ? Math.min(100, v / target * 100) : 0;
  const over = target && v > target * 1.1;
  return `<div class="bg-stone-50 rounded-xl p-2">
    <div class="text-[0.6875rem] text-stone-500 leading-tight">${label}</div>
    <div class="text-xs font-bold tabular-nums ${over ? 'text-rose-600' : 'text-stone-800'}">${fmt(v, 1)}${target ? `<span class="font-normal text-stone-400"> / ${fmt(target, 1)}</span>` : ''}<span class="font-normal text-stone-400 text-[0.625rem]"> ${unit}</span></div>
    ${target ? `<div class="mt-1 h-1.5 rounded-full bg-stone-200 overflow-hidden"><div class="h-full rounded-full ${over ? 'bg-rose-500' : bar}" style="width:${pct}%"></div></div>` : ''}
  </div>`;
}

function renderMealSelector() {
  document.querySelectorAll('.meal-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.getAttribute('data-meal') === ui.meal);
  });
  $('libraryMealSelect').value = ui.meal;
  $('libraryMealLabel').textContent = MEAL_META[ui.meal].label;
}

let pickCat = 'all';
function renderQuickStrip() {
  if (!$('scr-quick').classList.contains('hidden')) renderQuickPick();
}
function renderQuickPick() {
  document.querySelectorAll('#quickPickCats .cat-chip').forEach(btn => btn.classList.toggle('is-active', btn.getAttribute('data-cat') === pickCat));
  const q = $('quickPickSearch').value.trim().toLowerCase();
  const isFav = (i) => i.isFav || i.cat === 'fav';
  const list = [...state.quickItems.filter(isFav), ...state.quickItems.filter(i => !isFav(i))].filter(item => {
    const matchCat = pickCat === 'all' || (pickCat === 'fav' && isFav(item)) || item.cat === pickCat;
    return matchCat && (!q || item.name.toLowerCase().includes(q));
  });
  if (!list.length) {
    $('quickPickList').innerHTML = `<div class="rounded-2xl border border-dashed border-stone-300 p-6 text-center text-base text-stone-500">找不到「${esc(q)}」<br><span class="text-sm">可以改用「自己輸入」記錄</span></div>`;
    return;
  }
  $('quickPickList').innerHTML = list.map(item =>
    `<button type="button" data-qid="${esc(item.id)}" class="pick-row">
      <span class="min-w-0 flex-1 text-left"><span class="block text-lg font-semibold text-stone-900 leading-snug">${esc(item.name)}</span>
      <span class="block text-base text-emerald-700 font-bold tabular-nums">${item.kcal} kcal${isFav(item) ? ' <span class="text-sm font-semibold text-amber-700">・常用</span>' : ''}</span></span>
      <span class="pick-add">＋ 加入</span>
    </button>`).join('');
}
$('quickPickSearch').addEventListener('input', renderQuickPick);
$('quickPickCats').addEventListener('click', (e) => {
  const b = e.target.closest('.cat-chip');
  if (!b) return;
  pickCat = b.getAttribute('data-cat');
  renderQuickPick();
});
$('quickPickList').addEventListener('click', (e) => {
  const row = e.target.closest('[data-qid]');
  if (!row) return;
  const q = state.quickItems.find(x => x.id === row.getAttribute('data-qid'));
  if (!q) return;
  addFromQuick(q);
  row.classList.add('pick-done');
  row.querySelector('.pick-add').textContent = '✓ 已加入';
  setTimeout(() => { row.classList.remove('pick-done'); row.querySelector('.pick-add').textContent = '＋ 加入'; }, 1500);
});
$('quickPickManage').addEventListener('click', () => { closeAllScreens(); switchTab('library'); });

/* ---------------- 全螢幕輸入頁 ---------------- */
const screenStack = [];
function openScreen(id) {
  const el = $(id);
  if (!el) return;
  if (screenStack.includes(id)) return;
  el.classList.remove('hidden');
  screenStack.push(id);
  history.pushState({ screen: id }, '');
  document.body.style.overflow = 'hidden';
  el.querySelector('.scr-body').scrollTop = 0;
  renderMealSelector();
  renderDayPanel();
  if (id === 'scr-quick') { $('quickPickSearch').value = ''; renderQuickPick(); }
  if (id === 'scr-est') renderEst();
  if (id === 'scr-weight') renderWeightHint();
  if (id === 'scr-water') renderWaterBig();
  if (id === 'scr-photo') resetPhotoQuick();
}
function hideTopScreen() {
  const id = screenStack.pop();
  if (id) $(id).classList.add('hidden');
  if (!screenStack.length) document.body.style.overflow = '';
}
function closeScreen() { if (screenStack.length) history.back(); }
function closeAllScreens() { while (screenStack.length) { hideTopScreen(); history.back(); } }
window.addEventListener('popstate', () => { if (screenStack.length) hideTopScreen(); });
document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-screen]');
  if (opener) { openScreen(opener.getAttribute('data-screen')); return; }
  const back = e.target.closest('[data-back]');
  if (back) {
    if (back.hasAttribute('data-saved')) { persist(); showToast('已儲存 ✓'); }
    closeScreen();
  }
});

function renderTiles() {
  const d = getDay(ui.date, false);
  $('tileWeight').textContent = d.weight != null ? d.weight + ' 公斤' : '還沒量';
  $('tileWater').textContent = (d.water || 0) + ' ml' + (d.water ? '（約 ' + r1(d.water / 250) + ' 杯）' : '');
  $('tileExercise').textContent = d.exercise || d.exMin ? (d.exercise || '運動') + (d.exMin ? ' ' + d.exMin + ' 分' : '') : '還沒記';
  const bits = [];
  if (d.mood != null) bits.push(MOOD_OPTIONS[d.mood]);
  if (d.question) bits.push('有問題要問');
  else if (d.note) bits.push('有備註');
  $('tileNote').textContent = bits.length ? bits.join(' ') : '想問營養師也寫這';
}
function renderWeightHint() {
  let last = null;
  Object.keys(state.days).filter(k => k < ui.date && state.days[k].weight != null).sort().forEach(k => { last = k; });
  $('lastWeightHint').textContent = last ? '上次：' + state.days[last].weight + ' 公斤（' + fmtMD(last) + '）' : '';
}
function renderWaterBig() {
  const w = num(getDay(ui.date, false).water) || 0;
  $('waterBig').textContent = w.toLocaleString();
  $('waterCups').textContent = w ? '約 ' + r1(w / 250) + ' 杯' : '還沒喝';
}
$('dayWater').addEventListener('input', renderWaterBig);
$('exercisePresets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ex-preset]');
  if (!b) return;
  $('dayExercise').value = b.getAttribute('data-ex-preset');
  setDayField('exercise', $('dayExercise').value);
  renderExercisePresets();
});
$('exMinPresets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-exmin]');
  if (!b) return;
  $('dayExMin').value = b.getAttribute('data-exmin');
  setDayField('exMin', Number(b.getAttribute('data-exmin')));
  renderExercisePresets();
});
function renderExercisePresets() {
  const d = getDay(ui.date, false);
  document.querySelectorAll('[data-ex-preset]').forEach(b => b.classList.toggle('is-active', d.exercise === b.getAttribute('data-ex-preset')));
  document.querySelectorAll('[data-exmin]').forEach(b => b.classList.toggle('is-active', String(d.exMin) === b.getAttribute('data-exmin')));
}
$('dayExercise').addEventListener('input', () => setTimeout(renderExercisePresets, 0));
$('dayExMin').addEventListener('input', () => setTimeout(renderExercisePresets, 0));

/* 拍照記 */
let photoQuickDraft = null;
function resetPhotoQuick() {
  photoQuickDraft = null;
  $('photoQuickName').value = '';
  $('photoQuickKcal').value = '';
  $('photoQuickPreviewWrap').classList.add('hidden');
  $('photoQuickShoot').classList.remove('hidden');
}
$('photoQuickShoot').addEventListener('click', () => $('photoQuickInput').click());
$('photoQuickRetake').addEventListener('click', () => $('photoQuickInput').click());
$('photoQuickInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    photoQuickDraft = await compressImage(file);
    $('photoQuickPreview').src = photoQuickDraft;
    $('photoQuickPreviewWrap').classList.remove('hidden');
    $('photoQuickShoot').classList.add('hidden');
  } catch (err) { showToast('照片讀取失敗'); }
});
$('photoQuickSave').addEventListener('click', async () => {
  const name = $('photoQuickName').value.trim();
  const kcal = num($('photoQuickKcal').value);
  if (!photoQuickDraft && !name && kcal == null) { showToast('請先拍照，或寫下吃了什麼'); return; }
  await addEntry({
    name: name || MEAL_META[ui.meal].label + '拍照待查', nutr: { kcal: kcal || 0 }, meal: ui.meal,
    photo: photoQuickDraft, pending: kcal == null
  });
  resetPhotoQuick();
  closeScreen();
});

function nutrLine(it) {
  const parts = [];
  if (it.p != null || it.c != null || it.f != null) {
    parts.push(MACRO_KEYS.map(k => MACRO_META[k].short + fmt(it[k] || 0, 1)).join(' '));
  }
  if (it.ex) parts.push(EX_KEYS.filter(k => it.ex[k]).map(k => EX_META[k].short + fmt(it.ex[k], 1)).join(' '));
  return parts.join('・');
}

function renderLogs() {
  const container = $('mealLogContainer');
  const list = state.logs[ui.date] || [];
  if (!list.length) {
    container.innerHTML = `<div class="bg-white rounded-2xl border border-dashed border-stone-300 p-8 text-center space-y-2">
      <p class="text-base font-medium text-stone-600">這天還沒有記錄</p>
      <p class="text-sm text-stone-400">點上面的「常吃的」「拍照記」開始</p></div>`;
    return;
  }
  let html = '';
  MEAL_KEYS.forEach(mealKey => {
    const items = list.filter(i => i.meal === mealKey).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    if (!items.length) return;
    const sub = items.reduce((s, i) => s + i.kcal, 0);
    const meta = MEAL_META[mealKey];
    html += `<div class="bg-white rounded-2xl border border-stone-200 overflow-hidden">
      <div class="px-4 py-2.5 bg-stone-50/80 border-b border-stone-100 flex items-center justify-between">
        <span class="px-2.5 py-0.5 rounded-md text-sm font-bold ${meta.badge}">${meta.label}</span>
        <span class="text-sm font-bold text-stone-700 tabular-nums">${sub.toLocaleString()} kcal</span>
      </div><ul class="divide-y divide-stone-100">`;
    items.forEach(item => {
      const mult = item.multiplier && item.multiplier !== 1 ? ' × ' + item.multiplier + '份' : '';
      const pending = item.pending ? '<span class="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[0.625rem] font-bold">暫估待修</span>' : '';
      const thumb = item.hasPhoto
        ? `<button type="button" data-view-photo="${esc(item.id)}" class="view-photo-btn relative shrink-0" title="放大照片">
             <img data-photo-id="${esc(item.id)}" alt="餐點照片" class="w-14 h-14 rounded-xl object-cover border border-stone-200 bg-stone-100" />
           </button>`
        : '';
      const nl = nutrLine(item);
      html += `<li class="px-4 py-3 flex items-start gap-3">${thumb}
        <div class="min-w-0 flex-1">
          <div class="text-base font-semibold text-stone-900 leading-snug break-words">${esc(item.name)}${pending}</div>
          <div class="text-sm text-stone-500 leading-snug">${esc(item.time || '')}${esc(mult)}${nl ? '・' + esc(nl) : ''}</div>
        </div>
        <div class="shrink-0 flex flex-col items-end gap-1">
          <span class="text-lg font-bold text-stone-900 tabular-nums leading-none mt-0.5">${item.kcal.toLocaleString()} <span class="text-xs font-normal text-stone-500">kcal</span></span>
          <div class="flex items-center gap-1">
            <button type="button" data-edit-id="${esc(item.id)}" class="edit-entry-btn p-2.5 rounded-xl text-stone-500 bg-stone-50 hover:text-emerald-700 hover:bg-emerald-50" aria-label="修改">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
            </button>
            <button type="button" data-del-id="${esc(item.id)}" class="del-entry-btn p-2.5 rounded-xl text-stone-500 bg-stone-50 hover:text-rose-600 hover:bg-rose-50" aria-label="刪除">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
          </div>
        </div></li>`;
    });
    html += '</ul></div>';
  });
  container.innerHTML = html;
  hydratePhotos(container);
}

/* ---------------- Render：身體與備註 ---------------- */
function getDay(date, create) {
  if (!state.days[date] && create) state.days[date] = {};
  return state.days[date] || {};
}
function toggleGroupHTML(map, field, extraClass = '') {
  return Object.entries(map).map(([v, label]) =>
    `<button type="button" data-field="${field}" data-val="${v}" class="toggle-btn ${extraClass}">${label}</button>`).join('');
}
$('hungerGroup').innerHTML = toggleGroupHTML(HUNGER_LABELS, 'hunger');
$('moodGroup').innerHTML = toggleGroupHTML(MOOD_OPTIONS, 'mood', 'mood');
$('bowelGroup').innerHTML = toggleGroupHTML(BOWEL_LABELS, 'bowel');

function renderDayPanel() {
  const d = getDay(ui.date, false);
  document.querySelectorAll('[data-day-num]').forEach(el => {
    const v = d[el.getAttribute('data-day-num')];
    el.value = v == null ? '' : v;
  });
  document.querySelectorAll('[data-day-text]').forEach(el => {
    el.value = d[el.getAttribute('data-day-text')] || '';
  });
  document.querySelectorAll('.toggle-btn[data-field]').forEach(btn => {
    const f = btn.getAttribute('data-field');
    btn.classList.toggle('is-active', d[f] != null && String(d[f]) === btn.getAttribute('data-val'));
  });
}
function setDayField(field, value) {
  setTimeout(renderTiles, 0);
  const d = getDay(ui.date, true);
  if (value === null || value === '' || value === undefined) delete d[field]; else d[field] = value;
  if (!Object.keys(d).length) delete state.days[ui.date];
  persistSoon();
}
document.querySelectorAll('[data-day-num]').forEach(el => {
  el.addEventListener('input', () => setDayField(el.getAttribute('data-day-num'), num(el.value)));
});
document.querySelectorAll('[data-day-text]').forEach(el => {
  el.addEventListener('input', () => setDayField(el.getAttribute('data-day-text'), el.value.trim() ? el.value : null));
});
['hungerGroup', 'moodGroup', 'bowelGroup'].forEach(gid => {
  $(gid).addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    const f = btn.getAttribute('data-field');
    const v = Number(btn.getAttribute('data-val'));
    const cur = getDay(ui.date, false)[f];
    setDayField(f, cur === v ? null : v);
    renderDayPanel();
  });
});
document.querySelectorAll('.water-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const cur = num($('dayWater').value) || 0;
    const v = Math.max(0, Math.min(8000, cur + Number(btn.getAttribute('data-water-add'))));
    $('dayWater').value = v || '';
    setDayField('water', v || null);
    renderWaterBig();
  });
});

/* ---------------- Render：快選 ---------------- */
function renderLibrary() {
  document.querySelectorAll('.cat-chip').forEach(btn => btn.classList.toggle('is-active', btn.getAttribute('data-cat') === ui.libCat));
  const q = ui.libQ.trim().toLowerCase();
  const filtered = state.quickItems.filter(item => {
    const matchCat = ui.libCat === 'all' || (ui.libCat === 'fav' && (item.isFav || item.cat === 'fav')) || item.cat === ui.libCat;
    return matchCat && (!q || item.name.toLowerCase().includes(q));
  });
  const grid = $('libraryGrid');
  if (!filtered.length) {
    const kw = encodeURIComponent((ui.libQ.trim() || '台灣外食') + ' 熱量 大卡');
    grid.innerHTML = `<div class="col-span-full py-6 px-4 rounded-xl bg-stone-50 border border-dashed border-stone-300 text-center space-y-2.5">
      <p class="text-xs text-stone-500">清單中找不到「${esc(ui.libQ.trim())}」</p>
      <div class="flex flex-wrap items-center justify-center gap-2">
        <a href="https://www.google.com/search?q=${kw}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-lg bg-white border border-stone-200 text-xs font-semibold text-emerald-700">🔍 Google 查熱量 ↗</a>
        <a href="https://consumer.fda.gov.tw/Food/TFND.aspx?nodeID=178" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-lg bg-white border border-stone-200 text-xs font-semibold text-stone-700">🏛️ 食藥署資料庫 ↗</a>
      </div></div>`;
    return;
  }
  grid.innerHTML = filtered.map(item => {
    const fav = (item.isFav || item.cat === 'fav') ? '<span class="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[0.625rem] font-semibold">常用</span>' : '';
    const nl = nutrLine(item);
    return `<div class="flex items-center justify-between gap-1.5 p-3 rounded-xl border border-stone-200 hover:border-emerald-400 bg-stone-50/50 transition">
      <button type="button" data-qid="${esc(item.id)}" class="quick-add-btn flex-1 text-left min-w-0">
        <div class="text-sm font-semibold text-stone-800 truncate">${esc(item.name)}${fav}</div>
        <div class="text-xs text-emerald-700 font-bold tabular-nums">${item.kcal} kcal <span class="font-normal text-stone-400">${nl ? '・' + esc(nl) : '・點擊加入'}</span></div>
      </button>
      <div class="flex items-center gap-0.5 shrink-0">
        <button type="button" data-edit-qi="${esc(item.id)}" class="edit-qi-btn p-1.5 rounded-lg text-stone-400 hover:text-emerald-700 hover:bg-emerald-50" aria-label="修改">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
        </button>
        <button type="button" data-del-qi="${esc(item.id)}" class="del-qi-btn p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50" aria-label="刪除">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
        </button>
      </div></div>`;
  }).join('');
}

/* ---------------- Render：趨勢 ---------------- */
let kcalChart = null;
let weightChart = null;
function rangeStats(dates) {
  const totals = dates.map(dayTotals);
  const logged = totals.filter(t => t.count > 0);
  const macroDays = totals.filter(t => t.macroItems > 0);
  const exDays = totals.filter(t => t.exItems > 0);
  const avg = (arr, fn) => (arr.length ? arr.reduce((s, x) => s + fn(x), 0) / arr.length : null);
  const weights = dates.map(d => ({ d, w: num((state.days[d] || {}).weight) })).filter(x => x.w != null);
  const waters = dates.map(d => num((state.days[d] || {}).water)).filter(v => v != null);
  const exMins = dates.map(d => num((state.days[d] || {}).exMin) || 0);
  const target = state.targets.kcal;
  return {
    totals,
    loggedDays: logged.length,
    avgKcal: avg(logged, t => t.kcal),
    overDays: logged.filter(t => t.kcal > target).length,
    avgMacro: Object.fromEntries(MACRO_KEYS.map(k => [k, avg(macroDays, t => t[k])])),
    macroDays: macroDays.length,
    avgEx: Object.fromEntries(EX_KEYS.map(k => [k, avg(exDays, t => t.ex[k])])),
    exDays: exDays.length,
    weights,
    avgWater: waters.length ? waters.reduce((a, b) => a + b, 0) / waters.length : null,
    exMinTotal: exMins.reduce((a, b) => a + b, 0),
    pending: totals.reduce((s, t) => s + t.pending, 0)
  };
}
function statTile(label, value, sub = '') {
  return `<div class="bg-stone-50 rounded-xl p-2.5"><div class="text-[0.6875rem] text-stone-500">${label}</div><div class="text-base font-bold text-stone-900 tabular-nums">${value}</div>${sub ? `<div class="text-[0.625rem] text-stone-400">${sub}</div>` : ''}</div>`;
}
function renderTrends() {
  document.querySelectorAll('.range-btn').forEach(b => b.classList.toggle('is-active', Number(b.getAttribute('data-range')) === ui.trendRange));
  const n = ui.trendRange;
  const from = addDays(ui.date, -(n - 1));
  const dates = datesBetween(from, ui.date);
  $('trendRangeLabel').textContent = fmtMD(from) + ' – ' + fmtMD(ui.date);
  const s = rangeStats(dates);
  const target = state.targets.kcal;

  const w0 = s.weights[0];
  const w1 = s.weights[s.weights.length - 1];
  const wDelta = s.weights.length > 1 ? r1(w1.w - w0.w) : null;
  $('trendStats').innerHTML = [
    statTile('平均攝取', s.avgKcal != null ? fmt(s.avgKcal) + ' kcal' : '–', '目標 ' + fmt(target)),
    statTile('記錄天數', s.loggedDays + ' / ' + n, '超標 ' + s.overDays + ' 天'),
    statTile('體重變化', wDelta != null ? (wDelta > 0 ? '+' : '') + wDelta + ' kg' : (w1 ? w1.w + ' kg' : '–'), w1 ? '最新 ' + w1.w + ' kg' : ''),
    statTile('平均喝水', s.avgWater != null ? fmt(s.avgWater) + ' ml' : '–', '運動共 ' + s.exMinTotal + ' 分')
  ].join('');

  if (typeof Chart !== 'undefined') {
    const labels = dates.map(fmtMD);
    const values = s.totals.map(t => t.kcal);
    if (kcalChart) kcalChart.destroy();
    kcalChart = new Chart($('trendChart').getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '每日攝取 (kcal)', data: values, backgroundColor: values.map(v => v > target ? '#f43f5e' : '#059669'), borderRadius: 5, barPercentage: 0.6 },
          { label: '目標', data: Array(dates.length).fill(target), type: 'line', borderColor: '#78716c', borderDash: [5, 5], borderWidth: 2, pointRadius: 0, fill: false }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { y: { beginAtZero: true, grid: { color: '#f5f5f4' } }, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } } }
      }
    });

    const hasW = s.weights.length > 0;
    $('weightEmpty').classList.toggle('hidden', hasW);
    $('weightChartWrap').classList.toggle('hidden', !hasW);
    if (weightChart) { weightChart.destroy(); weightChart = null; }
    if (hasW) {
      const wData = dates.map(d => num((state.days[d] || {}).weight));
      const ds = [{ label: '體重 (kg)', data: wData, borderColor: '#0ea5e9', backgroundColor: '#0ea5e9', spanGaps: true, tension: 0.25, pointRadius: 3 }];
      if (state.targets.weight) ds.push({ label: '目標體重', data: Array(dates.length).fill(state.targets.weight), borderColor: '#a8a29e', borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5 });
      weightChart = new Chart($('weightChart').getContext('2d'), {
        type: 'line',
        data: { labels, datasets: ds },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: ds.length > 1, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
          scales: { y: { grace: '5%', grid: { color: '#f5f5f4' } }, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } } }
        }
      });
    }
  }

  const tg = state.targets;
  let nh = '';
  if (s.macroDays) {
    const kc = MACRO_KEYS.reduce((sum, k) => sum + (s.avgMacro[k] || 0) * MACRO_META[k].kcalPerG, 0);
    nh += `<div><div class="text-[0.6875rem] text-stone-500 mb-1.5">三大營養素（${s.macroDays} 天有填）</div><div class="grid grid-cols-3 gap-2">` +
      MACRO_KEYS.map(k => meterHTML(MACRO_META[k].label + (kc ? ' ' + Math.round((s.avgMacro[k] || 0) * MACRO_META[k].kcalPerG / kc * 100) + '%' : ''), s.avgMacro[k], tg[k], 'g', MACRO_META[k].bar)).join('') + '</div></div>';
  }
  if (s.exDays) {
    nh += `<div><div class="text-[0.6875rem] text-stone-500 mb-1.5">六大類份數（${s.exDays} 天有填）</div><div class="grid grid-cols-3 sm:grid-cols-6 gap-2">` +
      EX_KEYS.map(k => meterHTML(EX_META[k].emoji + ' ' + EX_META[k].short, s.avgEx[k], tg.ex && tg.ex[k], '份', 'bg-emerald-500')).join('') + '</div></div>';
  }
  if (!nh) nh = '<p class="text-xs text-stone-400">這段期間還沒有填營養素或六大類份數。用「份量估算」或在記錄時展開「營養素／六大類份數」就會出現在這裡。</p>';
  if (s.pending) nh += `<p class="text-[0.6875rem] font-semibold text-amber-700">⚠ 這段期間有 ${s.pending} 筆暫估待修</p>`;
  $('trendNutr').innerHTML = nh;
}

/* ---------------- 分頁與總渲染 ---------------- */
function switchTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  $('tab-' + tab).classList.remove('hidden');
  document.querySelectorAll('.nav-tab, .mobile-nav-tab').forEach(btn => btn.classList.toggle('is-active', btn.getAttribute('data-tab') === tab));
  $('dateBar').classList.toggle('hidden', tab === 'report');
  if (tab === 'trends') renderTrends();
  if (tab === 'report') { renderBackupInfo(); renderCloud(); }
  window.scrollTo({ top: 0 });
}
function renderBanners() {
  const show = !isStandalone() && !state.meta.installHintDismissed;
  $('installBanner').classList.toggle('hidden', !show);
  const hasData = Object.values(state.logs).some(l => l && l.length);
  const c = state.meta.cloud;
  const banner = $('backupBanner');
  if (cloud.isConfigured() && c.linked) {
    const stale = !c.lastBackup || Date.now() - c.lastBackup > 24 * 3600000;
    const show = hasData && !cloudBusy && (c.conflict || (stale && !(c.auto && cloud.getToken())));
    banner.classList.toggle('hidden', !show);
    banner.dataset.mode = c.conflict ? 'goto' : 'cloud';
    $('goBackupBtn').textContent = c.conflict ? '去確認' : '☁️ 備份';
    $('backupBannerText').textContent = c.conflict
      ? '雲端有另一台裝置的備份，為了不覆蓋它，這支手機暫停自動備份。'
      : (c.lastBackup ? '超過一天沒有備份到雲端了。' : '還沒有備份到 Google 雲端。');
    return;
  }
  const last = state.meta.lastBackup;
  const daysSince = last ? Math.floor((Date.now() - last) / 86400000) : null;
  const needBackup = hasData && (daysSince === null ? Object.keys(state.logs).length >= 3 : daysSince >= 7);
  banner.classList.toggle('hidden', !needBackup);
  banner.dataset.mode = 'goto';
  $('goBackupBtn').textContent = '去備份';
  if (needBackup) {
    const tip = cloud.isConfigured() ? '可以連結 Google 雲端自動備份。' : '建議定期下載備份。';
    $('backupBannerText').textContent = daysSince === null
      ? '資料只存在這支手機，' + tip
      : '已經 ' + daysSince + ' 天沒備份了，' + tip;
  }
}
function renderAll() {
  renderSummary();
  renderMealSelector();
  renderQuickStrip();
  renderLogs();
  renderDayPanel();
  renderTiles();
  renderExercisePresets();
  renderLibrary();
  renderBanners();
  if (ui.tab === 'trends') renderTrends();
}

/* ---------------- 事件：導覽／日期 ---------------- */
document.querySelectorAll('.nav-tab, .mobile-nav-tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab'))));
$('prevDayBtn').addEventListener('click', () => { ui.date = addDays(ui.date, -1); renderAll(); });
$('nextDayBtn').addEventListener('click', () => { ui.date = addDays(ui.date, 1); renderAll(); });
$('todayBtn').addEventListener('click', () => { ui.date = todayStr(); renderAll(); });
$('datePicker').addEventListener('click', (e) => { try { e.target.showPicker(); } catch (err) { /* 不支援時用原生行為 */ } });
$('datePicker').addEventListener('change', (e) => { if (e.target.value) { ui.date = e.target.value; renderAll(); } });
document.querySelectorAll('.meal-picker').forEach(el => {
  el.innerHTML = MEAL_KEYS.map(k => `<button type="button" data-meal="${k}" class="meal-btn">${MEAL_META[k].label}</button>`).join('');
});
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.meal-btn');
  if (!btn) return;
  ui.meal = btn.getAttribute('data-meal');
  renderMealSelector();
});
$('portionGroup').addEventListener('click', (e) => {
  const b = e.target.closest('[data-portion]');
  if (!b) return;
  $('portionSelect').value = b.getAttribute('data-portion');
  document.querySelectorAll('#portionGroup [data-portion]').forEach(x => x.classList.toggle('is-active', x === b));
});
$('libraryMealSelect').addEventListener('change', (e) => { ui.meal = e.target.value; renderMealSelector(); });
$('dismissInstallBtn').addEventListener('click', () => { state.meta.installHintDismissed = true; persist(); renderBanners(); });
$('goBackupBtn').addEventListener('click', () => {
  if ($('backupBanner').dataset.mode === 'cloud') { cloudRun('backup'); return; }
  goToCloudSection();
});
function goToCloudSection() {
  switchTab('report');
  const target = cloud.isConfigured() ? $('cloudSection') : $('backupSection');
  setTimeout(() => target.scrollIntoView({ behavior: 'smooth' }), 50);
}

/* ---------------- 事件：新增表單 ---------------- */
$('kcalStepperGroup').addEventListener('click', (e) => {
  const btn = e.target.closest('.kcal-step-btn');
  if (!btn) return;
  const el = $('foodKcalInput');
  el.value = Math.min(5000, (Number(el.value) || 0) + Number(btn.getAttribute('data-kcal-add')));
});
$('kcalResetStepBtn').addEventListener('click', () => { $('foodKcalInput').value = ''; });

let draftPhoto = null;
function updateDraftPhotoUI() {
  $('photoDraftPreviewWrap').classList.toggle('hidden', !draftPhoto);
  $('clearPhotoDraftBtn').classList.toggle('hidden', !draftPhoto);
  if (draftPhoto) $('photoDraftPreviewImg').src = draftPhoto;
}
$('triggerPhotoBtn').addEventListener('click', () => $('foodPhotoInput').click());
$('foodPhotoInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    draftPhoto = await compressImage(file);
    updateDraftPhotoUI();
    showToast('已附上照片');
  } catch (err) { showToast('照片讀取失敗'); }
});
$('clearPhotoDraftBtn').addEventListener('click', () => { draftPhoto = null; updateDraftPhotoUI(); });

$('addFoodForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const kcalRaw = $('foodKcalInput').value.trim();
  const hasKcal = kcalRaw !== '';
  const kcal = hasKcal ? Number(kcalRaw) : 0;
  const pendingChecked = $('pendingVerifyCheck').checked;
  const nutr = readNutrFields('add');
  if (!hasKcal && !draftPhoto && !pendingChecked) {
    showToast('請輸入熱量，或先拍照／勾選「暫估待修」');
    return;
  }
  if (!Number.isFinite(kcal) || kcal < 0) return;
  const rawName = $('foodNameInput').value.trim();
  const mealLabel = MEAL_META[ui.meal].label;
  const name = rawName || (draftPhoto ? mealLabel + '拍照待查' : mealLabel + '快記');
  await addEntry({
    name, nutr: { kcal, ...nutr }, mult: Number($('portionSelect').value) || 1, meal: ui.meal,
    photo: draftPhoto, pending: pendingChecked || (!hasKcal && Boolean(draftPhoto)), saveFav: $('saveFavCheck').checked
  });
  $('addFoodForm').reset();
  $('portionSelect').value = '1';
  document.querySelectorAll('#portionGroup [data-portion]').forEach(x => x.classList.toggle('is-active', x.getAttribute('data-portion') === '1'));
  writeNutrFields('add', null);
  $('addNutrDetails').open = false;
  draftPhoto = null;
  updateDraftPhotoUI();
  closeScreen();
});

/* ---------------- 事件：明細（看照片／修改／刪除） ---------------- */
let editPhoto = { src: null, changed: false };
let lightboxItemId = null;
function updateEditPhotoUI() {
  const has = Boolean(editPhoto.src);
  $('editLogPhotoImg').classList.toggle('hidden', !has);
  $('removeEditPhotoBtn').classList.toggle('hidden', !has);
  $('editLogNoPhotoHint').classList.toggle('hidden', has);
  if (has) $('editLogPhotoImg').src = editPhoto.src;
}
let editingId = null;
async function openEditModal(id) {
  const item = (state.logs[ui.date] || []).find(i => i.id === id);
  if (!item) return;
  editingId = id;
  $('editLogNameInput').value = item.name;
  $('editLogKcalInput').value = item.kcal;
  $('editLogMealSelect').value = item.meal;
  $('editLogTimeInput').value = item.time || '';
  $('editLogPendingCheck').checked = Boolean(item.pending);
  writeNutrFields('edit', item);
  editPhoto = { src: item.hasPhoto ? await getPhoto(item.id) : null, changed: false };
  updateEditPhotoUI();
  openModal('editLogModal');
}
$('triggerEditPhotoBtn').addEventListener('click', () => $('editLogPhotoInput').click());
$('editLogPhotoInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try { editPhoto = { src: await compressImage(file), changed: true }; updateEditPhotoUI(); } catch (err) { showToast('照片讀取失敗'); }
});
$('removeEditPhotoBtn').addEventListener('click', () => { editPhoto = { src: null, changed: true }; updateEditPhotoUI(); });
$('editLogForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const list = state.logs[ui.date] || [];
  const idx = list.findIndex(i => i.id === editingId);
  const name = $('editLogNameInput').value.trim();
  const kcal = Math.round(Number($('editLogKcalInput').value));
  if (idx === -1 || !name || !Number.isFinite(kcal) || kcal < 0) return;
  const n = readNutrFields('edit');
  const item = list[idx];
  if (editPhoto.changed) {
    if (editPhoto.src) await savePhoto(item.id, editPhoto.src); else await deletePhoto(item.id);
  }
  list[idx] = {
    ...item, name, kcal, meal: $('editLogMealSelect').value, time: $('editLogTimeInput').value || item.time,
    pending: $('editLogPendingCheck').checked, p: n.p, c: n.c, f: n.f, ex: n.ex,
    hasPhoto: editPhoto.changed ? Boolean(editPhoto.src) : item.hasPhoto
  };
  persist();
  renderAll();
  closeModal('editLogModal');
  showToast('已更新記錄');
});

$('mealLogContainer').addEventListener('click', async (e) => {
  const view = e.target.closest('.view-photo-btn');
  if (view) {
    const item = (state.logs[ui.date] || []).find(i => i.id === view.getAttribute('data-view-photo'));
    if (!item) return;
    lightboxItemId = item.id;
    $('lightboxFoodTitle').textContent = item.name + (item.pending ? '（暫估待修）' : '');
    $('lightboxFoodSub').textContent = MEAL_META[item.meal].label + '・目前 ' + item.kcal + ' kcal';
    $('lightboxImg').src = (await getPhoto(item.id)) || '';
    openModal('photoLightboxModal');
    return;
  }
  const edit = e.target.closest('.edit-entry-btn');
  if (edit) { openEditModal(edit.getAttribute('data-edit-id')); return; }
  const del = e.target.closest('.del-entry-btn');
  if (del) deleteEntry(del.getAttribute('data-del-id'));
});
$('lightboxEditEntryBtn').addEventListener('click', () => {
  closeModal('photoLightboxModal');
  if (lightboxItemId) openEditModal(lightboxItemId);
});

$('copyYesterdayBtn').addEventListener('click', () => {
  const prev = state.logs[addDays(ui.date, -1)] || [];
  if (!prev.length) { showToast('前一天沒有記錄'); return; }
  const cur = state.logs[ui.date] || (state.logs[ui.date] = []);
  prev.forEach(item => cur.push({ ...item, id: uid('item'), hasPhoto: false }));
  persist();
  renderAll();
  showToast('已複製前一天 ' + prev.length + ' 筆（不含照片）');
});
$('clearDayBtn').addEventListener('click', () => {
  const list = state.logs[ui.date] || [];
  if (!list.length) { showToast('本日沒有記錄'); return; }
  openConfirm('清空本日記錄', '確定要刪除 ' + ui.date + ' 的 ' + list.length + ' 筆飲食記錄嗎？（身體數據與備註會保留）', async () => {
    for (const it of list) if (it.hasPhoto) await deletePhoto(it.id);
    delete state.logs[ui.date];
    persist();
    renderAll();
    showToast('已清空本日記錄');
  }, '刪除');
});

/* ---------------- 事件：快選 ---------------- */
$('librarySearchInput').addEventListener('input', (e) => { ui.libQ = e.target.value; renderLibrary(); });
$('libraryFilterChips').addEventListener('click', (e) => {
  const btn = e.target.closest('.cat-chip');
  if (!btn) return;
  ui.libCat = btn.getAttribute('data-cat');
  renderLibrary();
});
function openQuickItemModal(item) {
  $('quickItemModalTitle').textContent = item ? '修改快選食物' : '新增快選食物';
  $('quickItemEditId').value = item ? item.id : '';
  $('quickItemNameInput').value = item ? item.name : '';
  $('quickItemKcalInput').value = item ? item.kcal : '';
  $('quickItemCatSelect').value = item ? (item.cat || 'fav') : (ui.libCat === 'all' ? 'fav' : ui.libCat);
  writeNutrFields('qi', item);
  openModal('quickItemModal');
}
$('addQuickItemBtn').addEventListener('click', () => openQuickItemModal(null));
$('quickItemForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('quickItemEditId').value;
  const name = $('quickItemNameInput').value.trim();
  const kcal = Math.round(Number($('quickItemKcalInput').value));
  const cat = $('quickItemCatSelect').value;
  if (!name || !Number.isFinite(kcal) || kcal <= 0) return;
  const n = readNutrFields('qi');
  const data = { name, kcal, cat, p: n.p, c: n.c, f: n.f, ex: n.ex };
  if (id) {
    const idx = state.quickItems.findIndex(q => q.id === id);
    if (idx !== -1) state.quickItems[idx] = { ...state.quickItems[idx], ...data, isFav: cat === 'fav' || state.quickItems[idx].isFav };
  } else {
    state.quickItems.unshift({ id: uid('qi'), ...data, isFav: cat === 'fav' });
  }
  persist();
  renderLibrary();
  renderQuickStrip();
  closeModal('quickItemModal');
  showToast((id ? '已更新' : '已新增') + '「' + name + '」');
});
$('resetQuickItemsBtn').addEventListener('click', () => {
  openConfirm('恢復預設快選', '會把快選清單恢復成預設的 ' + PRESET_FOODS.length + ' 項，你自己新增的快選會被移除（不影響已記錄的飲食）。', () => {
    state.quickItems = PRESET_FOODS.map(f => ({ ...f, isFav: false }));
    persist();
    renderLibrary();
    renderQuickStrip();
    showToast('已恢復預設快選');
  });
});
$('libraryGrid').addEventListener('click', (e) => {
  const edit = e.target.closest('.edit-qi-btn');
  if (edit) { const it = state.quickItems.find(q => q.id === edit.getAttribute('data-edit-qi')); if (it) openQuickItemModal(it); return; }
  const del = e.target.closest('.del-qi-btn');
  if (del) {
    const id = del.getAttribute('data-del-qi');
    const idx = state.quickItems.findIndex(q => q.id === id);
    if (idx === -1) return;
    const [removed] = state.quickItems.splice(idx, 1);
    persist(); renderLibrary(); renderQuickStrip();
    showToast('已刪除「' + removed.name + '」', '復原', () => {
      state.quickItems.splice(idx, 0, removed);
      persist(); renderLibrary(); renderQuickStrip();
    });
    return;
  }
  const add = e.target.closest('.quick-add-btn');
  if (add) { const it = state.quickItems.find(q => q.id === add.getAttribute('data-qid')); if (it) addFromQuick(it); }
});

/* ---------------- 事件：目標設定 ---------------- */
$('openTargetBtn').addEventListener('click', () => {
  const t = state.targets;
  $('tgt-kcal').value = t.kcal;
  MACRO_KEYS.forEach(k => { $('tgt-' + k).value = t[k] ?? ''; });
  EX_KEYS.forEach(k => { $('tgt-ex-' + k).value = (t.ex && t.ex[k]) ?? ''; });
  $('tgt-weight').value = t.weight ?? '';
  $('profileName').value = state.profile.name || '';
  openModal('targetModal');
});
document.querySelectorAll('.preset-btn').forEach(btn => btn.addEventListener('click', () => { $('tgt-kcal').value = btn.getAttribute('data-preset'); }));
$('deriveTargetBtn').addEventListener('click', () => {
  const ex = {};
  EX_KEYS.forEach(k => { ex[k] = num($('tgt-ex-' + k).value); });
  if (!cleanEx(ex)) { showToast('請先填六大類份數'); return; }
  const d = deriveFromEx(ex);
  $('tgt-kcal').value = d.kcal;
  MACRO_KEYS.forEach(k => { $('tgt-' + k).value = d[k]; });
  showToast('已依份數試算：' + d.kcal + ' kcal（可再依營養師建議調整）');
});
$('saveTargetBtn').addEventListener('click', () => {
  const kcal = Number($('tgt-kcal').value);
  if (!Number.isFinite(kcal) || kcal < 800 || kcal > 6000) { showToast('熱量目標請填 800–6000'); return; }
  const ex = {};
  EX_KEYS.forEach(k => { const v = num($('tgt-ex-' + k).value); if (v) ex[k] = v; });
  state.targets = {
    kcal: Math.round(kcal),
    p: num($('tgt-p').value), c: num($('tgt-c').value), f: num($('tgt-f').value),
    ex, weight: num($('tgt-weight').value)
  };
  state.profile.name = $('profileName').value.trim();
  persist();
  renderAll();
  closeModal('targetModal');
  showToast('已更新目標');
});
$('openSourceBtn').addEventListener('click', () => openModal('sourceModal'));

/* ---------------- 份量估算器 ---------------- */
let estCounts = {};
$('estButtonsGrid').innerHTML = EST_PARTS.map(p =>
  `<button type="button" data-est="${p.id}" class="est-part-btn p-3 rounded-2xl border border-stone-200 hover:border-emerald-500 active:bg-emerald-100 bg-white text-left transition min-h-[76px]">
    <div class="text-base font-bold text-stone-900">${p.title}</div>
    <div class="text-sm text-stone-500 leading-snug">${p.sub}</div>
    <div class="text-sm text-emerald-700 font-bold">+${p.kcal} kcal</div>
  </button>`).join('');
function estTotals() {
  const t = { kcal: 0, p: 0, c: 0, f: 0, ex: {} };
  EST_PARTS.forEach(part => {
    const n = estCounts[part.id] || 0;
    if (!n) return;
    t.kcal += part.kcal * n; t.p += part.p * n; t.c += part.c * n; t.f += part.f * n;
    Object.entries(part.ex).forEach(([k, v]) => { t.ex[k] = (t.ex[k] || 0) + v * n; });
  });
  t.p = r1(t.p); t.c = r1(t.c); t.f = r1(t.f); t.ex = cleanEx(t.ex);
  return t;
}
function renderEst() {
  const picked = EST_PARTS.filter(p => estCounts[p.id]);
  $('estPicked').innerHTML = picked.length
    ? picked.map(p => `<button type="button" data-est-remove="${p.id}" class="px-3 py-1.5 rounded-full bg-white border border-emerald-200 hover:border-rose-300">${p.title.replace(/^\S+\s/, '')} ×${estCounts[p.id]} <span class="text-rose-500">−</span></button>`).join('')
    : '尚未點選';
  const t = estTotals();
  $('estTotalVal').textContent = t.kcal;
  $('estMacroText').textContent = t.kcal ? `蛋白質 ${t.p}g・碳水 ${t.c}g・脂肪 ${t.f}g` : '';
}
$('estButtonsGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('.est-part-btn');
  if (!btn) return;
  const id = btn.getAttribute('data-est');
  estCounts[id] = (estCounts[id] || 0) + 1;
  renderEst();
});
$('estPicked').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-est-remove]');
  if (!btn) return;
  const id = btn.getAttribute('data-est-remove');
  estCounts[id] = Math.max(0, (estCounts[id] || 0) - 1);
  if (!estCounts[id]) delete estCounts[id];
  renderEst();
});
$('resetEstPartsBtn').addEventListener('click', () => { estCounts = {}; renderEst(); });
$('extGoogleSearchBtn').addEventListener('click', () => {
  const q = $('extSearchInput').value.trim() || '台灣外食';
  window.open('https://www.google.com/search?q=' + encodeURIComponent(q + ' 熱量 大卡'), '_blank', 'noopener,noreferrer');
});
$('applyEstimateBtn').addEventListener('click', async () => {
  const t = estTotals();
  if (!t.kcal) { showToast('請先按上面的份量按鈕'); return; }
  let name = $('estName').value.trim();
  if (!name) {
    const names = EST_PARTS.filter(p => estCounts[p.id]).map(p => p.title.replace(/^\S+\s/, '') + (estCounts[p.id] > 1 ? '×' + estCounts[p.id] : ''));
    name = '自選組合（' + names.slice(0, 3).join('、') + (names.length > 3 ? '…' : '') + '）';
  }
  await addEntry({ name, nutr: t, meal: ui.meal });
  estCounts = {};
  $('estName').value = '';
  renderEst();
  closeScreen();
});

/* ---------------- 報告 ---------------- */
let lastReport = null;
function setReportRange(days) {
  $('rptTo').value = ui.date;
  $('rptFrom').value = addDays(ui.date, -(days - 1));
}
$('rptQuickRange').addEventListener('click', (e) => {
  const b = e.target.closest('[data-days]');
  if (b) setReportRange(Number(b.getAttribute('data-days')));
});
function reportContext() {
  return { state, dayTotals, rangeStats, datesBetween, esc, fmt, r1, num, fmtMD, parseDate, getPhoto };
}
$('genReportBtn').addEventListener('click', async () => {
  let from = $('rptFrom').value;
  let to = $('rptTo').value;
  if (!from || !to) { showToast('請選擇期間'); return; }
  if (from > to) [from, to] = [to, from];
  if (datesBetween(from, to).length > 92) { showToast('期間最多 92 天'); return; }
  const btn = $('genReportBtn');
  btn.disabled = true;
  btn.textContent = '產生中…';
  try {
    const opts = { from, to, withDetails: $('rptDetails').checked, withPhotos: $('rptPhotos').checked };
    const html = await buildReportHTML(reportContext(), opts);
    lastReport = { ...opts, html, text: buildReportText(reportContext(), opts) };
    $('reportArea').innerHTML = html;
    $('reportArea').classList.remove('hidden');
    $('reportActions').classList.remove('hidden');
    $('reportPrintHint').classList.remove('hidden');
    $('reportActions').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showToast('產生報告失敗：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '產生報告';
  }
});
$('printReportBtn').addEventListener('click', () => window.print());
$('shareReportFileBtn').addEventListener('click', async () => {
  if (!lastReport) return;
  const title = '飲食記錄報告 ' + lastReport.from + '_' + lastReport.to;
  const doc = `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;padding:16px;background:#fff;max-width:900px;margin:0 auto}${REPORT_CSS}</style></head><body>${lastReport.html}</body></html>`;
  const fileName = title.replace(/\s/g, '_') + '.html';
  const file = new File([doc], fileName, { type: 'text/html' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  downloadBlob(fileName, doc, 'text/html');
  showToast('已下載報告檔，可用 LINE 傳給營養師');
});
$('shareReportTextBtn').addEventListener('click', async () => {
  if (!lastReport) return;
  const text = lastReport.text;
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  try { await navigator.clipboard.writeText(text); showToast('已複製文字摘要，貼到 LINE 即可'); } catch (e) { showToast('無法複製，請改用列印／存 PDF'); }
});
// 列印前確保報告已產生並顯示
window.addEventListener('beforeprint', () => {
  if (ui.tab !== 'report' || !lastReport) return;
  $('reportArea').classList.remove('hidden');
});

/* ---------------- 備份 / 匯出 ---------------- */
function downloadBlob(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function renderBackupInfo() {
  const last = state.meta.lastBackup;
  $('lastBackupText').textContent = last ? '上次備份：' + new Date(last).toLocaleString('zh-TW', { hour12: false }) : '尚未備份過';
  if (!$('rptFrom').value) setReportRange(7);
}
function photoIdList() {
  const ids = [];
  Object.values(state.logs).forEach(list => (list || []).forEach(it => { if (it.hasPhoto) ids.push(it.id); }));
  return ids;
}
function buildPayload() {
  return { app: 'diet-tracker', version: 2, exportedAt: new Date().toISOString(), targets: state.targets, profile: state.profile, logs: state.logs, days: state.days, quickItems: state.quickItems };
}
function hasLocalData() {
  return Object.values(state.logs).some(l => l && l.length) || Object.keys(state.days).length > 0;
}
$('exportJsonBtn').addEventListener('click', async () => {
  const photos = await photoDB.getMany(photoIdList());
  const payload = { ...buildPayload(), photos };
  const fileName = '飲控備份_' + todayStr() + '.json';
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const file = new File([blob], fileName, { type: 'application/json' });
  let done = false;
  try {
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: fileName });
      done = true;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  if (!done) downloadBlob(fileName, blob);
  state.meta.lastBackup = Date.now();
  persist();
  renderBackupInfo();
  renderBanners();
  showToast('已產生備份（' + Object.keys(photos).length + ' 張照片）');
});
$('importJsonBtn').addEventListener('click', () => $('importJsonInput').click());
$('importJsonInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (err) { showToast('檔案無法讀取，請確認是 JSON 備份檔'); return; }
  openConfirm('匯入備份', '會把「' + file.name + '」合併到目前資料，相同的記錄不會重複；目標設定會改成備份檔裡的設定。', async () => {
    try {
      const r = await mergeImport(data);
      persist();
      renderAll();
      showToast('匯入完成：新增 ' + r.added + ' 筆記錄、' + r.photos + ' 張照片');
    } catch (err) {
      showToast('匯入失敗：' + err.message);
    }
  }, '匯入');
});
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCSV(rows) { return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'); }
$('exportCsvBtn').addEventListener('click', () => {
  const rows = [['日期', '時間', '餐別', '食物', '份數', '熱量(kcal)', '蛋白質(g)', '碳水(g)', '脂肪(g)', ...EX_KEYS.map(k => EX_META[k].short + '(份)'), '暫估待修', '有照片']];
  Object.keys(state.logs).sort().forEach(date => {
    (state.logs[date] || []).slice().sort((a, b) => MEAL_KEYS.indexOf(a.meal) - MEAL_KEYS.indexOf(b.meal) || (a.time || '').localeCompare(b.time || '')).forEach(it => {
      rows.push([date, it.time, MEAL_META[it.meal].label, it.name, it.multiplier || 1, it.kcal, it.p, it.c, it.f, ...EX_KEYS.map(k => (it.ex && it.ex[k]) || ''), it.pending ? '是' : '', it.hasPhoto ? '是' : '']);
    });
  });
  downloadBlob('飲食明細_' + todayStr() + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
  showToast('已匯出飲食明細 CSV');
});
$('exportDaysCsvBtn').addEventListener('click', () => {
  const dates = Array.from(new Set([...Object.keys(state.logs), ...Object.keys(state.days)])).sort();
  const rows = [['日期', '總熱量', '蛋白質(g)', '碳水(g)', '脂肪(g)', ...EX_KEYS.map(k => EX_META[k].short + '(份)'), '體重(kg)', '腰圍(cm)', '喝水(ml)', '運動', '運動分鐘', '飢餓感(1-5)', '心情(1-5)', '排便', '備註', '想問營養師']];
  dates.forEach(date => {
    const t = dayTotals(date);
    const d = state.days[date] || {};
    rows.push([date, t.kcal, t.macroItems ? t.p : '', t.macroItems ? t.c : '', t.macroItems ? t.f : '', ...EX_KEYS.map(k => (t.exItems ? t.ex[k] : '')),
      d.weight, d.waist, d.water, d.exercise, d.exMin, d.hunger, d.mood, d.bowel != null ? BOWEL_LABELS[d.bowel] : '', d.note, d.question]);
  });
  downloadBlob('每日身體與備註_' + todayStr() + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
  showToast('已匯出每日 CSV');
});


/* ---------------- Google 雲端備份 ---------------- */
let cloudBusy = false;
function fmtTime(ms) { return new Date(ms).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function setCloudStatus(msg, tone = 'ok') {
  const el = $('cloudStatus');
  if (!msg) { el.classList.add('hidden'); return; }
  const tones = { ok: 'bg-emerald-50 text-emerald-800', busy: 'bg-stone-100 text-stone-700', warn: 'bg-amber-50 text-amber-800', err: 'bg-rose-50 text-rose-700' };
  el.className = 'text-xs font-medium rounded-xl px-3 py-2 ' + (tones[tone] || tones.ok);
  el.textContent = msg;
}
function renderCloud() {
  const sec = $('cloudSection');
  if (!cloud.isConfigured()) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  const c = state.meta.cloud;
  $('cloudInAppWarn').classList.toggle('hidden', !cloud.isBlockedInAppBrowser());
  $('cloudSignedOut').classList.toggle('hidden', c.linked);
  $('cloudSignedIn').classList.toggle('hidden', !c.linked);
  $('cloudEmail').textContent = c.email || 'Google 帳號';
  $('cloudLastText').textContent = c.lastBackup ? '上次雲端備份：' + fmtTime(c.lastBackup) : '還沒有備份到雲端';
  $('cloudAutoCheck').checked = c.auto !== false;
  ['cloudConnectBtn', 'cloudRestoreNewBtn', 'cloudBackupBtn', 'cloudRestoreBtn', 'cloudDisconnectBtn'].forEach(id => { $(id).disabled = cloudBusy; });
  $('cloudBackupBtn').textContent = cloudBusy ? '處理中…' : '立即備份';
}

function startSignIn(action) {
  // 避免授權後馬上又失效時無限跳轉
  const last = Number(sessionStorage.getItem('diet_reauth_at') || 0);
  if (Date.now() - last < 30000) {
    setCloudStatus('Google 登入沒有成功，請稍後再試一次', 'err');
    return;
  }
  try { sessionStorage.setItem('diet_reauth_at', String(Date.now())); } catch (e) { /* ignore */ }
  setCloudStatus('前往 Google 登入…', 'busy');
  cloud.signIn(action, state.meta.cloud.email);
}

async function cloudRun(action, { auto = false } = {}) {
  if (cloudBusy || !cloud.isConfigured()) return;
  if (cloud.isBlockedInAppBrowser()) {
    if (!auto) { goToCloudSection(); showToast('請改用 Safari／Chrome 開啟後再登入 Google'); }
    return;
  }
  if (!cloud.getToken()) {
    if (!auto) startSignIn(action);
    return;
  }
  cloudBusy = true;
  renderCloud();
  renderBanners();
  try {
    const c = state.meta.cloud;
    if (!c.linked || !c.email) {
      const u = await cloud.getUser();
      c.email = u.emailAddress || '';
      c.linked = true;
      persist();
    }
    if (action === 'connect') await cloudAfterConnect();
    else if (action === 'backup') await cloudBackup(auto);
    else if (action === 'restore') await cloudRestore();
    try { sessionStorage.removeItem('diet_reauth_at'); } catch (e) { /* ignore */ }
  } catch (err) {
    if (err && err.auth) {
      if (auto) setCloudStatus('Google 登入已過期，按「立即備份」重新登入', 'warn');
      else { cloudBusy = false; startSignIn(action); }
    } else {
      setCloudStatus((err && err.message) || '雲端備份失敗', 'err');
      if (!auto) showToast('雲端備份失敗，請稍後再試');
    }
  } finally {
    cloudBusy = false;
    renderCloud();
    renderBanners();
    renderBackupInfo();
  }
}

async function cloudAfterConnect() {
  setCloudStatus('檢查雲端備份…', 'busy');
  const info = await cloud.getInfo();
  const c = state.meta.cloud;
  if (!info.exists) {
    if (hasLocalData()) await cloudBackup(false);
    else setCloudStatus('✓ 已連結。開始記錄後會自動備份到雲端', 'ok');
    return;
  }
  if (info.deviceId === state.meta.deviceId) { await cloudBackup(false); return; }
  if (!hasLocalData()) {
    const ok = await confirmAsync('找到雲端備份', `雲端有 ${fmtTime(info.savedAt)} 的備份（${info.entries} 筆記錄、${info.photos} 張照片），要還原到這支手機嗎？`, '還原');
    if (ok) await cloudRestore(info);
    else setCloudStatus('✓ 已連結。雲端已有備份，需要時按「從雲端還原」', 'ok');
    return;
  }
  c.conflict = true;
  persist();
  setCloudStatus(`雲端已有另一台裝置 ${fmtTime(info.savedAt)} 的備份（${info.entries} 筆）。要用雲端的資料就按「從雲端還原」（會合併）；要以這支手機為主就按「立即備份」覆蓋。`, 'warn');
}

async function cloudBackup(auto) {
  const c = state.meta.cloud;
  setCloudStatus('檢查雲端備份…', 'busy');
  const info = await cloud.getInfo();
  const otherDevice = info.exists && info.deviceId !== state.meta.deviceId && info.modifiedTime !== c.knownModified;
  if (otherDevice) {
    if (auto) {
      c.conflict = true;
      persist();
      setCloudStatus('雲端有另一台裝置的備份，沒有自動覆蓋。請按「從雲端還原」或「立即備份」決定要保留哪一邊。', 'warn');
      return;
    }
    const ok = await confirmAsync('覆蓋雲端備份？', `雲端的備份來自另一台裝置（${fmtTime(info.savedAt)}，${info.entries} 筆記錄）。確定要用這支手機的資料覆蓋嗎？想保留雲端資料的話，請先按「從雲端還原」。`, '覆蓋');
    if (!ok) { setCloudStatus('已取消備份', 'warn'); return; }
  }
  const r = await cloud.backup({
    data: buildPayload(), photoIds: photoIdList(), getPhoto, deviceId: state.meta.deviceId,
    onProgress: (m) => setCloudStatus(m, 'busy')
  });
  c.lastBackup = r.savedAt;
  c.knownModified = r.modifiedTime;
  c.conflict = false;
  state.meta.lastBackup = r.savedAt;
  persist();
  setCloudStatus(`✓ ${auto ? '已自動' : '已'}備份 ${r.entries} 筆記錄${r.uploadedPhotos ? '，新上傳 ' + r.uploadedPhotos + ' 張照片' : ''}（${fmtTime(r.savedAt)}）`, 'ok');
  if (!auto) showToast('已備份到 Google 雲端');
}

async function cloudRestore(knownInfo) {
  setCloudStatus('檢查雲端備份…', 'busy');
  const info = knownInfo || await cloud.getInfo();
  if (!info.exists) { setCloudStatus('雲端還沒有備份', 'warn'); return; }
  if (!knownInfo && hasLocalData()) {
    const ok = await confirmAsync('從雲端還原', `雲端備份：${fmtTime(info.savedAt)}，${info.entries} 筆記錄、${info.photos} 張照片。會合併到這支手機現有的資料（相同的記錄不會重複）。`, '還原');
    if (!ok) { setCloudStatus('已取消還原', 'warn'); return; }
  }
  const r = await cloud.restore({ onProgress: (m) => setCloudStatus(m, 'busy') });
  const res = await mergeImport({ ...r.data, photos: r.photos });
  const c = state.meta.cloud;
  c.knownModified = r.info.modifiedTime;
  c.lastBackup = c.lastBackup || r.info.savedAt;
  c.conflict = false;
  persist();
  renderAll();
  setCloudStatus(`✓ 已從雲端還原：新增 ${res.added} 筆記錄、${res.photos} 張照片`, 'ok');
  showToast('已從雲端還原');
}

function maybeAutoBackup() {
  const c = state.meta.cloud;
  if (!cloud.isConfigured() || !c.linked || c.auto === false || c.conflict || cloudBusy) return;
  if (!hasLocalData() || !cloud.getToken()) return;
  if (c.lastBackup && Date.now() - c.lastBackup < 20 * 3600000) return;
  cloudRun('backup', { auto: true });
}

$('cloudConnectBtn').addEventListener('click', () => cloudRun('connect'));
$('cloudRestoreNewBtn').addEventListener('click', () => cloudRun('restore'));
$('cloudBackupBtn').addEventListener('click', () => cloudRun('backup'));
$('cloudRestoreBtn').addEventListener('click', () => cloudRun('restore'));
$('cloudAutoCheck').addEventListener('change', (e) => { state.meta.cloud.auto = e.target.checked; persist(); renderBanners(); });
$('cloudDisconnectBtn').addEventListener('click', () => {
  openConfirm('中斷 Google 連結', '這支手機會停止備份到雲端。雲端硬碟裡已經備份的檔案不會刪除，之後重新連結就能繼續使用。', async () => {
    await cloud.revoke();
    cloud.resetCache();
    state.meta.cloud = { linked: false, email: '', auto: true, lastBackup: null, knownModified: null, conflict: false };
    persist();
    setCloudStatus('');
    renderCloud();
    renderBanners();
    showToast('已中斷 Google 連結');
  }, '中斷連結');
});

/* ---------------- 字體大小 ---------------- */
const FONT_SIZES = { m: { px: 16, label: '標準' }, l: { px: 18, label: '大' }, xl: { px: 20, label: '特大' } };
function applyFontSize() {
  const key = FONT_SIZES[state.meta.fontSize] ? state.meta.fontSize : 'l';
  document.documentElement.style.fontSize = FONT_SIZES[key].px + 'px';
  $('fontSizeLabel').textContent = FONT_SIZES[key].label;
  if (kcalChart || weightChart) { if (ui.tab === 'trends') renderTrends(); }
}
$('fontSizeBtn').addEventListener('click', () => {
  const order = ['m', 'l', 'xl'];
  const cur = FONT_SIZES[state.meta.fontSize] ? state.meta.fontSize : 'l';
  state.meta.fontSize = order[(order.indexOf(cur) + 1) % order.length];
  persist();
  applyFontSize();
  showToast('字體：' + FONT_SIZES[state.meta.fontSize].label);
});

/* ---------------- 啟動 ---------------- */
document.querySelectorAll('.range-btn').forEach(b => b.addEventListener('click', () => { ui.trendRange = Number(b.getAttribute('data-range')); renderTrends(); }));

(async function init() {
  await loadState();
  if (!state.meta.deviceId) { state.meta.deviceId = uid('dev'); persist(); }
  applyFontSize();
  renderAll();
  switchTab('log');
  const redirect = cloud.isConfigured() ? cloud.consumeRedirect() : null;
  if (redirect) {
    goToCloudSection();
    if (redirect.error) setCloudStatus(redirect.error, 'err');
    else cloudRun(redirect.action);
  } else {
    maybeAutoBackup();
  }
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch (e) { /* ignore */ }
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  // 跨日後回到 App 時自動跳到今天
  let lastToday = todayStr();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    maybeAutoBackup();
    const now = todayStr();
    if (now !== lastToday) {
      if (ui.date === lastToday) ui.date = now;
      lastToday = now;
      ui.meal = inferMeal();
      renderAll();
    }
  });
})();

// 方便除錯
window.__dietApp = { state, ui, dayTotals };
