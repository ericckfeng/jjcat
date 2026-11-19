import {
  MEAL_KEYS, MEAL_META, MACRO_KEYS, MACRO_META, EX_KEYS, EX_META, EX_DEFAULT_NUTR,
  EST_PARTS, PRESET_FOODS, HUNGER_LABELS, MOOD_OPTIONS, BOWEL_LABELS
} from './nutrition.js';
import { photoDB } from './db.js';
import { REPORT_CSS, buildReportHTML, buildReportText, periodSummary } from './report.js';
import { buildWeekly, lastWeek, weeklyText } from './highlights.js';
import * as cloud from './cloud.js';
import { mergeData, mergeExtras, pickExtras, syncShape, stableStringify, SYNC_VERSION } from './sync.js';
import { MEASURES, MEASURE_META, rollingAverage, weightAvgChange, muscleChange, sumLimbs, calcSmi, smiLow, latestSmi, SMI_CUTOFF, calcBmi, bmiCategory, healthyWeightRange, waistRisk, waistHipRatio, bmiScalePct, SLEEP_QUALITY, sleepQualityLabel, sleepMinutes, fmtDuration, daySleep } from './body.js';
import { mascotSVG, buildMascotMessages } from './mascot.js';
import { searchFoods, nutrientsFor, cookConversion, baseGrams, GRAM_PRESETS } from './foods.js';
import { sumNutr, copyEntries, mealEntries, mealGap, splitDaily, gapMessage } from './meals.js';
import { buildInsights } from './insights.js';
import { ACTIVITY, GOALS, PROTEIN, ageFrom, calcBmr, calcTargets, waterGoal, recalcHint, latestInbodyBmr, katchBmr, latestBodyComp, targetWeightFromBodyFat, BODY_FAT_LIMIT } from './targets.js';
import { calorieBank, bankMacros } from './bank.js';
import { callGemini, buildRequest, mealPrompt, LABEL_PROMPT, MEAL_SCHEMA, LABEL_SCHEMA, PING_REQUEST, normalizeMeal, aiItemToFood, normalizeLabel } from './ai.js';

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
  targetsAt: 0,
  profileAt: 0,
  tomb: {},
  meta: { lastBackup: null, installHintDismissed: false, deviceId: null, cloud: { linked: false, email: '', auto: true, lastBackup: null, knownModified: null, dirty: false, needAuth: false } }
};
const ui = {
  date: todayStr(),
  meal: inferMeal(),
  tab: 'log',
  libCat: 'all',
  libQ: '',
  trendRange: 7,
  bodyMetric: 'weight'
};

// 只存在這支手機（設定、狀態），不需要同步
function persistLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    showToast('⚠ 無法儲存，請先下載備份');
  }
}
// 資料有變：存起來並安排同步
function persist() {
  state.meta.cloud.dirty = true;
  persistLocal();
  scheduleSync();
}
const now = () => Date.now();
function touch(obj) { obj.updatedAt = now(); return obj; }
function tombstone(key) { state.tomb[key] = now(); }
let persistTimer = null;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persist();
    renderTiles();
    renderMascot();
  }, 400);
}

// 匯入時保留看不懂的欄位（新版 App 加的，例如 grams、foodId），只去掉 v1 的照片與舊欄位
const LEGACY_ONLY = ['photo', 'baseKcal'];
function extraFields(raw) {
  const out = { ...raw };
  LEGACY_ONLY.forEach(k => delete out[k]);
  return out;
}
function normalizeEntry(raw) {
  return {
    ...extraFields(raw),
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
    ...extraFields(q),
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
  if (p.tomb && typeof p.tomb === 'object') state.tomb = p.tomb;
  state.targetsAt = Number(p.targetsAt) || 0;
  state.profileAt = Number(p.profileAt) || 0;
  Object.assign(state, pickExtras(p)); // 新版才有的資料（舊版也要原樣保留）
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
    state.targetsAt = now();
  } else if (typeof data.targetKcal === 'number' && data.targetKcal >= 800) {
    state.targets.kcal = data.targetKcal;
    state.targetsAt = now();
  }
  if (data.profile && typeof data.profile === 'object') { state.profile = { ...state.profile, ...data.profile }; state.profileAt = now(); }
  const photoMap = data.photos && typeof data.photos === 'object' ? data.photos : {};

  if (data.logs && typeof data.logs === 'object') {
    for (const [date, list] of Object.entries(data.logs)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(list)) continue;
      const cur = state.logs[date] || (state.logs[date] = []);
      for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        const it = normalizeEntry(raw);
        if (cur.some(x => x.id === it.id)) continue;
        it.updatedAt = num(raw.updatedAt) || now();
        if (raw.photoKey) it.photoKey = String(raw.photoKey);
        delete state.tomb['e:' + it.id];
        const dataUrl = raw.photo || photoMap[it.id];
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image')) {
          await savePhoto(it.id, dataUrl);
          setLocalPhotoKey(it.id, it.photoKey || it.id);
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
      const merged = { ...(state.days[date] || {}), ...val };
      merged._t = { ...((state.days[date] || {})._t || {}) };
      Object.keys(val).forEach(k => { if (k !== '_t') merged._t[k] = now(); });
      state.days[date] = merged;
    }
  }
  if (Array.isArray(data.quickItems)) {
    data.quickItems.forEach(q => {
      if (q && q.id && q.name && !state.quickItems.some(x => x.id === q.id)) state.quickItems.push(normalizeQuick(q));
    });
  }
  // 新版才有的資料：照同步規則合併（只認本 App 的備份檔，最早的 v1 檔沒有這類資料）
  if (data.app === 'diet-tracker') Object.assign(state, mergeExtras(pickExtras(state), pickExtras(data), state.tomb));
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
function compressImage(file, maxDim = 900) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
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
function showToast(msg, actionLabel, actionFn, ms) {
  $('toastMsg').textContent = msg;
  const btn = $('toastAction');
  if (actionLabel && actionFn) {
    btn.textContent = actionLabel; btn.classList.remove('hidden'); toastActionFn = actionFn;
  } else {
    btn.classList.add('hidden'); toastActionFn = null;
  }
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), ms || (actionFn ? 5000 : 2400));
}
$('toastAction').addEventListener('click', () => {
  if (toastActionFn) toastActionFn();
  toastActionFn = null;
  $('toast').classList.add('hidden');
});

let pendingConfirm = null;
let pendingCancel = null;
function openConfirm(title, message, onOk, okLabel = '確定', onCancel = null, cancelLabel = '取消') {
  if (typeof pendingCancel === 'function') pendingCancel();
  $('confirmTitle').textContent = title;
  $('confirmMessage').textContent = message;
  $('confirmOkBtn').textContent = okLabel;
  $('confirmCancelBtn').textContent = cancelLabel;
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
// step 一律用 any：份數、公克都可能有小數（例如自動算出的 0.7 份），
// 設成 0.5／0.1 的話，瀏覽器會擋下表單，連改名稱都存不了。
function nutrFieldsHTML(prefix) {
  const inp = (id, ph, step) =>
    `<input id="${id}" type="number" inputmode="decimal" min="0" step="${step}" placeholder="${ph}" class="field px-2 py-1.5 min-h-[38px] text-center tabular-nums bg-white" />`;
  return `
    <div class="space-y-2 pt-1">
      <div class="grid grid-cols-3 gap-1.5">
        ${MACRO_KEYS.map(k => `<label class="block"><span class="block text-[0.625rem] text-stone-500 mb-0.5">${MACRO_META[k].label} (g)</span>${inp(prefix + '-' + k, 'g', 'any')}</label>`).join('')}
      </div>
      <div class="flex items-center justify-between pt-1">
        <span class="text-[0.6875rem] font-semibold text-stone-600">六大類份數</span>
        <button type="button" data-derive="${prefix}" class="derive-btn text-[0.6875rem] font-semibold text-emerald-700 hover:underline">依份數推算熱量／營養素</button>
      </div>
      <div class="grid grid-cols-3 gap-1.5">
        ${EX_KEYS.map(k => `<label class="block"><span class="block text-[0.625rem] text-stone-500 mb-0.5">${EX_META[k].emoji} ${EX_META[k].short}</span>${inp(prefix + '-ex-' + k, '份', 'any')}</label>`).join('')}
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
  `<label class="block"><span class="block text-[0.625rem] text-stone-500 mb-0.5">${EX_META[k].emoji} ${EX_META[k].short}</span><input id="tgt-ex-${k}" type="number" inputmode="decimal" min="0" step="any" placeholder="份" class="field px-2 py-1.5 min-h-[38px] text-center tabular-nums" /></label>`
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
async function addEntry({ name, nutr, mult = 1, meal, photo = null, pending = false, saveFav = false, extra = null }) {
  const s = scaleNutr(nutr, mult);
  const it = {
    id: uid('item'), name: name.trim(), kcal: s.kcal, multiplier: mult, meal, time: nowTime(),
    pending: Boolean(pending), hasPhoto: Boolean(photo), p: s.p, c: s.c, f: s.f, ex: s.ex, updatedAt: now(),
    ...(extra || {})
  };
  if (photo) await savePhoto(it.id, photo);
  (state.logs[ui.date] || (state.logs[ui.date] = [])).push(it);
  if (saveFav && (num(nutr.kcal) || 0) > 0 && !state.quickItems.some(q => q.name === it.name)) {
    state.quickItems.unshift({
      id: uid('qi'), name: it.name, kcal: Math.round(nutr.kcal), cat: 'fav', isFav: true,
      p: num(nutr.p), c: num(nutr.c), f: num(nutr.f), ex: cleanEx(nutr.ex), updatedAt: now()
    });
  }
  persist();
  renderAll();
  const hint = gapHint(it.meal);
  showToast('已加入「' + it.name + '」(' + it.kcal + ' kcal)' + hint, null, null, hint ? 6000 : 0);
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
  tombstone('e:' + item.id);
  persist();
  renderAll();
  showToast('已刪除「' + item.name + '」', '復原', async () => {
    if (photo) await savePhoto(item.id, photo);
    delete state.tomb['e:' + item.id];
    touch(item);
    (state.logs[date] || (state.logs[date] = [])).splice(idx, 0, item);
    persist();
    renderAll();
  });
}

/* ---------------- Render：今日 ---------------- */
// 熱量銀行（targets.bank 開啟才有）：這天的建議熱量與本週進度
function bankFor(date) {
  if (!state.targets.bank) return null;
  const pr = state.profile;
  const cw = currentWeight();
  const inbody = latestInbodyBmr(state.days, date);
  const comp = latestBodyComp(state.days, date);
  const bmr = (inbody && inbody.value) || (comp && katchBmr(comp.ffm)) || calcBmr({ sex: pr.sex, weight: cw && cw.w, height: pr.height, age: ageFrom(pr.birthYear) });
  return calorieBank({ base: state.targets.kcal > 0 ? state.targets.kcal : 1800, date, dayKcal: dayTotals, bmr });
}
function renderBank(bank, todayKcal) {
  $('bankBox').classList.toggle('hidden', !bank);
  if (!bank) return;
  const used = bank.usedBefore + todayKcal;
  const isToday = ui.date === todayStr();
  $('bankWeek').textContent = '已吃 ' + used.toLocaleString() + ' / ' + bank.budget.toLocaleString() + ' kcal';
  $('bankBar').style.width = Math.min(100, Math.round(used / bank.budget * 100)) + '%';
  const day = isToday ? '今天' : '這天';
  const bal = bank.balance;
  let msg;
  if (bank.daysLeft === 7) msg = '這週剛開始，' + day + '照平常的量吃就好。';
  else if (Math.abs(bal) < 50) msg = '這週到目前都剛剛好，' + day + '照平常的量吃就好 👍';
  else if (bal < 0) msg = '這週前幾天多吃了 ' + (-bal).toLocaleString() + ' kcal，平均分到剩下的 ' + bank.daysLeft + ' 天，' + day + '建議吃 ' + bank.todayTarget.toLocaleString() + ' kcal。';
  else msg = '這週前幾天少吃了 ' + bal.toLocaleString() + ' kcal，' + day + '可以吃到 ' + bank.todayTarget.toLocaleString() + ' kcal。';
  if (bank.floored) msg += '為了安全，一天不會低於 ' + bank.todayTarget.toLocaleString() + ' kcal，多走路、多活動也有幫助。';
  if (bank.capped) msg += '少吃的不用一次補回來，一天最多多 300 kcal。';
  $('bankText').textContent = msg;
}
function renderSummary() {
  const t = dayTotals(ui.date);
  const bank = bankFor(ui.date);
  renderBank(bank, t.kcal);
  const target = bank ? bank.todayTarget : state.targets.kcal > 0 ? state.targets.kcal : 1800;
  const remaining = target - t.kcal;
  const pct = Math.round(t.kcal / target * 100);
  const clamped = Math.min(100, Math.max(0, pct));
  $('summaryDateLabel').textContent = ui.date === todayStr() ? '今日' : fmtMD(ui.date) + ' ';
  $('totalConsumed').textContent = t.kcal.toLocaleString();
  $('summaryTarget').textContent = target.toLocaleString();
  $('headerTargetVal').textContent = (state.targets.kcal > 0 ? state.targets.kcal : 1800).toLocaleString();
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

  // 熱量銀行調整過今天的熱量時，營養素目標跟著調（蛋白質不變）
  const tg = bank ? { ...state.targets, ...bankMacros(state.targets, bank.todayTarget) } : state.targets;
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
    $('quickPickList').innerHTML = `<div class="rounded-2xl border border-dashed border-stone-300 p-6 text-center text-base text-stone-500 space-y-3">
      <div>找不到「${esc(q)}」</div>
      ${q ? `<button type="button" data-food-query="${esc($('quickPickSearch').value.trim())}" class="btn-secondary w-full">🔍 到食物資料庫查「${esc($('quickPickSearch').value.trim())}」</button>` : ''}
      <div class="text-sm">或改用「自己輸入」記錄</div></div>`;
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

/* ---------------- 查食物・秤克數（衛福部食品營養成分資料庫） ---------------- */
let foodDB = null;      // { source, foods }
let foodDBLoading = null;
function loadFoodDB() {
  if (foodDB) return Promise.resolve(foodDB);
  if (!foodDBLoading) {
    foodDBLoading = fetch('tfda_foods.json')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => { foodDB = d; return d; })
      .catch(err => { foodDBLoading = null; throw err; });
  }
  return foodDBLoading;
}
function foodRowHTML(food) {
  const kcal = Math.round(food.per100g.kcal);
  return `<button type="button" data-food-id="${esc(food.id)}" class="pick-row">
    <span class="min-w-0 flex-1 text-left"><span class="block text-lg font-semibold text-stone-900 leading-snug break-words">${esc(food.name)}</span>
    ${food.note ? `<span class="block text-sm text-stone-500 break-words">${esc(food.note)}</span>` : ''}
    <span class="block text-base text-emerald-700 font-bold tabular-nums">每 100 g　${kcal} kcal</span></span>
    <span class="pick-add">選擇 ›</span>
  </button>`;
}
async function renderFoodResults() {
  const box = $('foodResults');
  const q = $('foodSearch').value.trim();
  if (!foodDB) {
    box.innerHTML = '<div class="text-base text-stone-500 py-2">載入食物資料中…</div>';
    try { await loadFoodDB(); } catch (e) {
      box.innerHTML = '<div class="rounded-2xl bg-rose-50 text-rose-800 p-4 text-base">食物資料載入失敗。請確認有連上網路再試一次（連網開過一次之後，離線也能查）。</div>';
      return;
    }
    if ($('foodSearch').value.trim() !== q) return; // 載入期間又打了字，交給下一次
  }
  $('foodSource').textContent = '資料來源：衛生福利部食品藥物管理署「食品營養成分資料庫」（' + foodDB.source.version + '）。數值為每 100 公克可食部分。';
  if (!q) {
    box.innerHTML = '<div class="text-base text-stone-500 leading-relaxed py-2">輸入食物名稱就會列出來。<br>這裡是生鮮食材和常見食品；便當、小吃請用「常吃的」或「自己輸入」。</div>';
    return;
  }
  const results = searchFoods(foodDB.foods, q, { limit: 30, now: new Date() });
  if (!results.length) {
    box.innerHTML = `<div class="rounded-2xl border border-dashed border-stone-300 p-6 text-center text-base text-stone-500 space-y-3">
      <div>資料庫裡找不到「${esc(q)}」</div>
      <div class="text-sm">換個說法試試（例如「雞胸」「甘藷」），<br>或用「自己輸入」記錄。</div>
      <button type="button" data-screen="scr-manual" class="btn-secondary w-full">✏️ 自己輸入</button></div>`;
    return;
  }
  box.innerHTML = results.map(r => foodRowHTML(r.food)).join('');
}
$('foodSearch').addEventListener('input', renderFoodResults);
$('foodResults').addEventListener('click', (e) => {
  const row = e.target.closest('[data-food-id]');
  if (!row || !foodDB) return;
  const food = foodDB.foods.find(f => f.id === row.getAttribute('data-food-id'));
  if (food) openGrams(food);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-food-query]');
  if (!b) return;
  // 疊在目前的畫面上打開（「完成」會回到原本的畫面）
  openScreen('scr-food');
  $('foodSearch').value = b.getAttribute('data-food-query');
  renderFoodResults();
});

const gramsDraft = { food: null, weighed: 'asis', cartKey: null };
// cartKey：修改購物車裡的某一樣時才有
function openGrams(food, cartItem = null) {
  gramsDraft.food = food;
  gramsDraft.weighed = cartItem ? cartItem.weighed : 'asis';
  gramsDraft.cartKey = cartItem ? cartItem.key : null;
  $('gramsInput').value = cartItem ? String(cartItem.grams) : '100';
  openScreen('scr-grams');
}
function gramsValue() {
  const g = Number($('gramsInput').value);
  return Number.isFinite(g) && g > 0 && g <= 5000 ? Math.round(g * 10) / 10 : 0;
}
function renderGrams() {
  const food = gramsDraft.food;
  if (!food) return;
  const conv = cookConversion(food);
  $('gramsFoodName').textContent = food.name;
  $('gramsFoodNote').textContent = [food.note, '每 100 g ' + Math.round(food.per100g.kcal) + ' kcal'].filter(Boolean).join('・');
  $('gramsCookWrap').classList.toggle('hidden', !conv);
  if (conv) {
    const rice = conv.factor > 1;
    $('gramsRawBtn').textContent = rice ? '生米' : '生的';
    $('gramsCookedBtn').textContent = rice ? '煮好的飯' : '煮熟的';
    $('gramsRawBtn').classList.toggle('is-active', gramsDraft.weighed !== 'cooked');
    $('gramsCookedBtn').classList.toggle('is-active', gramsDraft.weighed === 'cooked');
  }
  $('gramsPresets').innerHTML = [
    ...GRAM_PRESETS.map(p => `<button type="button" data-grams-set="${p.g}" class="chip-btn chip-lg">${p.label} ${p.g}g</button>`),
    '<button type="button" data-grams-add="10" class="chip-btn chip-lg">+10g</button>',
    '<button type="button" data-grams-add="-10" class="chip-btn chip-lg">−10g</button>'
  ].join('');
  $('gramsSaveBtn').textContent = gramsDraft.cartKey ? '改好了' : '加入這一餐';
  const g = gramsValue();
  const box = $('gramsResult');
  if (!g) { box.innerHTML = '<div class="text-base text-stone-500">請輸入公克數</div>'; $('gramsSaveBtn').disabled = true; return; }
  $('gramsSaveBtn').disabled = false;
  const n = nutrientsFor(food, g, gramsDraft.weighed);
  const cooked = conv && gramsDraft.weighed === 'cooked';
  const macro = (k, label) => `<div class="bg-stone-50 rounded-xl p-2 text-center"><div class="text-sm text-stone-500">${label}</div><div class="text-lg font-bold text-stone-800 tabular-nums">${n[k] == null ? '—' : n[k] + ' g'}</div></div>`;
  const ex = n.ex ? Object.entries(n.ex).map(([k, v]) => `${EX_META[k].emoji} ${EX_META[k].short} ${v} 份`).join('、') : '';
  box.innerHTML = `
    <div class="text-center"><span class="text-4xl font-bold text-emerald-700 tabular-nums">${n.kcal}</span> <span class="text-lg text-stone-600">kcal</span></div>
    ${cooked ? `<div class="text-sm text-stone-500 text-center">熟重 ${g} g ≈ ${conv.factor > 1 ? '生米' : '生重'} ${Math.round(baseGrams(food, g, 'cooked'))} g（${esc(conv.label)}）</div>` : ''}
    <div class="grid grid-cols-3 gap-2">${macro('p', '蛋白質')}${macro('f', '脂肪')}${macro('c', '碳水')}</div>
    <div class="text-base text-stone-700">${ex ? '六大類：' + ex : '<span class="text-stone-500">這類食物無法換算六大類份數</span>'}</div>`;
}
$('gramsInput').addEventListener('input', renderGrams);
$('scr-grams').addEventListener('click', (e) => {
  const set = e.target.closest('[data-grams-set]');
  const add = e.target.closest('[data-grams-add]');
  const w = e.target.closest('[data-weighed]');
  if (set) $('gramsInput').value = set.getAttribute('data-grams-set');
  else if (add) $('gramsInput').value = String(Math.max(0, (gramsValue() || 0) + Number(add.getAttribute('data-grams-add'))));
  else if (w) gramsDraft.weighed = w.getAttribute('data-weighed');
  else return;
  renderGrams();
});
// 購物車：連續選好幾樣，一次記到同一餐。每一樣各存一筆記錄，用 groupId 標成同一組。
// 只放在記憶體；離開查食物頁時還有東西，會問要不要記。
let foodCart = [];   // [{ key, food, grams, weighed, entry }]
function cartEntryFor(food, g, weighed) {
  const cooked = Boolean(cookConversion(food)) && weighed === 'cooked';
  const n = nutrientsFor(food, g, cooked ? 'cooked' : 'asis');
  const entry = {
    name: food.name + ' ' + g + 'g' + (cooked ? '（熟重）' : ''),
    kcal: n.kcal, p: n.p, c: n.c, f: n.f, ex: n.ex, grams: g
  };
  if (food.id) entry.foodId = food.id;
  if (food.ai) entry.ai = food.ai;   // AI 估算的（'photo' 拍照／'text' 用說的）
  if (cooked) entry.weighed = 'cooked';
  return { weighed: cooked ? 'cooked' : 'asis', entry };
}
function macroText(t) {
  return MACRO_KEYS.filter(k => t[k] != null).map(k => MACRO_META[k].label + ' ' + fmt(t[k], 1) + 'g').join('・');
}
function renderFoodCart() {
  const box = $('foodCart');
  const has = foodCart.length > 0;
  box.classList.toggle('hidden', !has);
  $('foodDoneBtn').classList.toggle('hidden', has);
  $('foodCartSaveBtn').classList.toggle('hidden', !has);
  if (!has) { box.innerHTML = ''; return; }
  const t = sumNutr(foodCart.map(c => c.entry));
  box.innerHTML = `<div class="text-base font-bold text-emerald-900">這一餐已選 ${foodCart.length} 樣</div>
    <ul class="space-y-2">${foodCart.map(c => `<li class="flex items-center gap-2 bg-white rounded-xl border border-emerald-100 p-2">
      <span class="min-w-0 flex-1"><span class="block text-base font-semibold text-stone-900 leading-snug break-words">${esc(c.entry.name)}</span>
      <span class="block text-sm text-emerald-700 font-bold tabular-nums">${c.entry.kcal} kcal</span></span>
      <button type="button" data-cart-edit="${c.key}" class="chip-btn chip-lg shrink-0">改</button>
      <button type="button" data-cart-del="${c.key}" class="chip-btn chip-lg shrink-0" aria-label="拿掉">✕</button>
    </li>`).join('')}</ul>
    <div class="text-base text-stone-800"><span class="font-bold tabular-nums">合計 ${t.kcal} kcal</span>${macroText(t) ? '<br><span class="text-sm text-stone-600">' + esc(macroText(t)) + '</span>' : ''}</div>`;
  $('foodCartSaveBtn').textContent = '記到' + MEAL_META[ui.meal].label + '（' + foodCart.length + ' 樣）';
}
$('foodCart').addEventListener('click', (e) => {
  const ed = e.target.closest('[data-cart-edit]');
  const del = e.target.closest('[data-cart-del]');
  if (ed) {
    const c = foodCart.find(x => x.key === ed.getAttribute('data-cart-edit'));
    if (c) openGrams(c.food, c);
  } else if (del) {
    foodCart = foodCart.filter(x => x.key !== del.getAttribute('data-cart-del'));
    renderFoodCart();
  }
});
$('gramsSaveBtn').addEventListener('click', () => {
  const food = gramsDraft.food;
  const g = gramsValue();
  if (!food || !g) { showToast('請輸入公克數'); return; }
  const { weighed, entry } = cartEntryFor(food, g, gramsDraft.weighed);
  const editing = foodCart.find(x => x.key === gramsDraft.cartKey);
  if (editing) Object.assign(editing, { grams: g, weighed, entry });
  else foodCart.push({ key: uid('c'), food, grams: g, weighed, entry });
  closeScreen(); // 回到搜尋頁，可以接著選下一樣
  $('foodSearch').value = '';
  renderFoodResults();
  renderFoodCart();
  if (!editing) showToast('已加入「' + entry.name + '」，可以再選下一樣');
});
function saveFoodCart() {
  if (!foodCart.length) return;
  const meal = ui.meal;
  const date = ui.date;
  const groupId = foodCart.length > 1 ? uid('grp') : null;
  const time = nowTime();
  const photos = [];
  const added = foodCart.map(c => {
    const it = {
      id: uid('item'), multiplier: 1, meal, time, pending: false, hasPhoto: Boolean(c.photo),
      ...c.entry, ex: cleanEx(c.entry.ex), updatedAt: now()
    };
    if (groupId) it.groupId = groupId;
    if (c.photo) photos.push([it.id, c.photo]);
    return it;
  });
  foodCart = [];
  photos.forEach(([id, photo]) => savePhoto(id, photo));
  (state.logs[date] || (state.logs[date] = [])).push(...added);
  persist();
  renderAll();
  renderFoodCart();
  const total = sumNutr(added).kcal;
  const hint = gapHint(meal);
  showToast('已記到' + MEAL_META[meal].label + '：' + added.length + ' 樣、' + total + ' kcal' + hint, '復原', () => {
    const ids = new Set(added.map(a => a.id));
    state.logs[date] = (state.logs[date] || []).filter(it => !ids.has(it.id));
    added.forEach(a => tombstone('e:' + a.id));
    persist();
    renderAll();
  }, hint ? 8000 : 0);
}
$('foodCartSaveBtn').addEventListener('click', () => {
  saveFoodCart();
  closeScreen();
});
// 還有沒記的就離開查食物頁（返回鍵、‹ 返回）：問一下，不要默默丟掉
function askUnsavedCart() {
  if (!foodCart.length) return;
  const label = MEAL_META[ui.meal].label;
  openConfirm('還有 ' + foodCart.length + ' 樣還沒記', foodCart.map(c => c.entry.name).join('、') + '。要記到' + label + '嗎？',
    saveFoodCart, '記到' + label, () => { foodCart = []; renderFoodCart(); }, '不要了');
}

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
  if (id === 'scr-food') { $('foodSearch').value = ''; renderFoodResults(); renderFoodCart(); }
  if (id === 'scr-grams') renderGrams();
  if (id === 'scr-est') renderEst();
  if (id === 'scr-weight') { renderWeightHint(); document.querySelectorAll('[data-limb]').forEach(x => { x.value = ''; }); }
  if (id === 'scr-water') renderWaterBig();
  if (id === 'scr-calc') { initCalc(); renderCalc(); }
  if (id === 'scr-mealex') renderMealEx();
  if (id === 'scr-weekly') renderWeekly();
  if (id === 'scr-ai') resetAi();
  if (id === 'scr-manual') setBox('aiLabelNote', null, '');
  if (id === 'scr-aikey') renderAiKey();
  if (id === 'scr-sleep') renderSleepScreen();
  if (id === 'scr-photo') resetPhotoQuick();
}
function hideTopScreen() {
  const id = screenStack.pop();
  if (id) $(id).classList.add('hidden');
  if (!screenStack.length) document.body.style.overflow = '';
  if (id === 'scr-food') askUnsavedCart();
}
function closeScreen() { if (screenStack.length) history.back(); }
function closeAllScreens() { while (screenStack.length) { hideTopScreen(); history.back(); } }
window.addEventListener('popstate', () => { if (screenStack.length) hideTopScreen(); });
document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-screen]');
  if (opener) { openScreen(opener.getAttribute('data-screen')); return; }
  const back = e.target.closest('[data-back]');
  if (back) {
    if (back.hasAttribute('data-saved')) { clearTimeout(persistTimer); persist(); showToast('已儲存 ✓'); }
    closeScreen();
  }
});

function renderTiles() {
  const d = getDay(ui.date, false);
  const ts = daySleep(d);
  const parts = [];
  if (ts.night) parts.push('昨晚 ' + fmtDuration(ts.night) + (ts.quality ? '・' + sleepQualityLabel(ts.quality) : ''));
  if (ts.nap) parts.push('補眠 ' + fmtDuration(ts.nap));
  $('tileSleep').textContent = parts.length ? parts.join('　') : '記一下昨晚睡多久';
  const b = calcBmi(d.weight, state.profile.height);
  $('tileWeight').textContent = d.weight != null ? d.weight + ' 公斤' + (b ? '・BMI ' + b : '') : '還沒量';
  const wg = dayWaterGoal(ui.date);
  $('tileWater').textContent = wg
    ? (d.water || 0) + ' / ' + wg + ' ml' + ((d.water || 0) >= wg ? ' ✓' : '')
    : (d.water || 0) + ' ml' + (d.water ? '（約 ' + r1(d.water / 250) + ' 杯）' : '');
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
  if ($('profHeight') !== document.activeElement) $('profHeight').value = state.profile.height || '';
  document.querySelectorAll('#sexGroup [data-sex]').forEach(b => b.classList.toggle('is-active', state.profile.sex === b.getAttribute('data-sex')));
  renderBmiCard();
}
// 四肢骨骼肌指數 SMI（肌少症篩檢）
function renderSmi() {
  const asm = num(getDay(ui.date, false).asm);
  const h = state.profile.height;
  const smi = calcSmi(asm, h);
  const sex = state.profile.sex;
  let msg = '';
  if (asm && !h) msg = '填上身高，就會算四肢骨骼肌指數（SMI）。';
  else if (smi != null) {
    const low = smiLow(smi, sex);
    msg = '四肢骨骼肌指數 SMI ' + smi + ' kg/m²'
      + (low == null ? '（選了性別就會判斷）'
        : low ? '：比參考值（' + (sex === 'm' ? '男性' : '女性') + ' ' + SMI_CUTOFF[sex].toFixed(1) + '）低，肌肉偏少。減重前請先和營養師、醫師討論，蛋白質要吃夠。'
          : '：在參考值（' + (sex === 'm' ? '男性' : '女性') + ' ' + SMI_CUTOFF[sex].toFixed(1) + '）以上 👍');
  }
  $('smiText').textContent = msg;
  $('smiText').classList.toggle('hidden', !msg);
}
document.querySelectorAll('[data-limb]').forEach(el => el.addEventListener('input', () => {
  const sum = sumLimbs([...document.querySelectorAll('[data-limb]')].map(x => x.value));
  if (sum == null) return;
  $('dayAsm').value = sum;
  setDayField('asm', sum);
  renderSmi();
}));
$('dayAsm').addEventListener('input', () => setTimeout(renderSmi, 0));
function renderBmiCard() {
  renderSmi();
  const d = getDay(ui.date, false);
  const h = state.profile.height;
  const b = calcBmi(d.weight, h);
  const card = $('bmiCard');
  if (!h) {
    card.innerHTML = '<div class="rounded-2xl bg-sky-50 border border-sky-200 p-3 text-base text-sky-900">填上身高，就會幫你算 BMI 👆</div>';
  } else if (b == null) {
    const r = healthyWeightRange(h);
    card.innerHTML = `<div class="rounded-2xl bg-white border border-stone-200 p-3 text-base text-stone-600">輸入體重後會顯示 BMI。<br><span class="text-sm">身高 ${h} 公分的健康體重：${r.min}–${r.max} 公斤</span></div>`;
  } else {
    const cat = bmiCategory(b);
    const r = healthyWeightRange(h);
    card.innerHTML = `<div class="rounded-2xl bg-white border border-stone-200 p-4 space-y-2">
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-base text-stone-600">BMI</span>
        <span><span class="text-4xl font-bold tabular-nums" style="color:${cat.color}">${b}</span>
        <span class="ml-1.5 px-2.5 py-1 rounded-full text-base font-bold text-white" style="background:${cat.color}">${cat.label}</span></span>
      </div>
      <div class="bmi-scale"><span class="bmi-marker" style="left:${bmiScalePct(b)}%"></span></div>
      <div class="relative h-4 text-xs text-stone-500 tabular-nums">${[[17.5, '18.5'], [45, '24'], [60, '27']].map(([p, t]) => `<span class="absolute -translate-x-1/2" style="left:${p}%">${t}</span>`).join('')}</div>
      <p class="text-sm text-stone-600">健康體重：<b>${r.min}–${r.max} 公斤</b>（BMI 18.5–24）</p>
    </div>`;
  }
  const wr = waistRisk(num(d.waist), state.profile.sex);
  const wt = $('waistRiskText');
  if (wr) {
    wt.textContent = wr.high ? `⚠ 腰圍 ≥ ${wr.limit} 公分，屬於腹部肥胖，要多留意` : `✓ 腰圍在標準內（小於 ${wr.limit} 公分）`;
    wt.className = 'text-sm mt-1.5 font-semibold ' + (wr.high ? 'text-amber-700' : 'text-emerald-700');
  } else {
    wt.textContent = d.waist && !state.profile.sex ? '選了性別，就能判斷腰圍是否超標' : '';
    wt.className = 'text-sm mt-1.5 text-stone-500';
  }
  const whr = waistHipRatio(num(d.waist), num(d.hip), state.profile.sex);
  $('whrText').textContent = whr ? `腰臀比 ${whr.ratio}` + (whr.limit ? (whr.high ? `（偏高，標準 ≤ ${whr.limit}）` : `（標準內，≤ ${whr.limit}）`) : '') : '';
}
$('profHeight').addEventListener('input', () => {
  const h = num($('profHeight').value);
  state.profile.height = h && h >= 100 && h <= 230 ? h : null;
  state.profileAt = now();
  persistSoon();
  renderBmiCard();
});
$('sexGroup').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sex]');
  if (!b) return;
  const v = b.getAttribute('data-sex');
  state.profile.sex = state.profile.sex === v ? null : v;
  state.profileAt = now();
  persistSoon();
  renderWeightHint();
});
['dayWeight', 'dayWaist'].forEach(id => $(id).addEventListener('input', () => setTimeout(renderBmiCard, 0)));
document.querySelectorAll('#moreMeasures [data-day-num]').forEach(el => el.addEventListener('input', () => setTimeout(renderBmiCard, 0)));
// 這天的喝水目標（有設目標才有；有運動會加碼）
function dayWaterGoal(date) { return waterGoal(state.targets.water, getDay(date, false).exMin); }
function renderWaterBig() {
  const w = num(getDay(ui.date, false).water) || 0;
  const goal = dayWaterGoal(ui.date);
  $('waterBig').textContent = w.toLocaleString();
  const extra = goal && goal > state.targets.water ? '（含運動 +' + (goal - state.targets.water) + '）' : '';
  $('waterCups').textContent = (w ? '約 ' + r1(w / 250) + ' 杯' : '還沒喝')
    + (goal ? '・目標 ' + goal.toLocaleString() + ' ml' + extra + (w >= goal ? ' ✓ 達成了' : '，還差 ' + (goal - w).toLocaleString() + ' ml') : '');
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

// 「和昨天一樣」：這天還沒記、前一天有記的餐別，各一個大按鈕
function copyMealHTML(list) {
  const prev = addDays(ui.date, -1);
  const word = ui.date === todayStr() ? '昨天' : '前一天';
  const btns = MEAL_KEYS.filter(m => !list.some(i => i.meal === m)).map(m => {
    const items = mealEntries(state.logs, prev, m);
    if (!items.length) return '';
    const names = items.map(i => i.name).join('、');
    return `<button type="button" data-copy-meal="${m}" class="pick-row">
      <span class="min-w-0 flex-1 text-left"><span class="block text-lg font-semibold text-stone-900">和${word}一樣的${MEAL_META[m].label}</span>
      <span class="block text-sm text-stone-500 break-words line-clamp-2">${esc(names)}</span>
      <span class="block text-base text-emerald-700 font-bold tabular-nums">${items.length} 樣・${sumNutr(items).kcal} kcal</span></span>
      <span class="pick-add">記一樣的</span></button>`;
  }).join('');
  return btns ? `<div id="copyMealBox" class="space-y-2"><div class="sec-title px-1">吃的和${word}一樣？</div>${btns}</div>` : '';
}
function copyMeal(meal) {
  const prev = addDays(ui.date, -1);
  const date = ui.date;
  const added = copyEntries(mealEntries(state.logs, prev, meal), { makeId: uid, at: now() });
  if (!added.length) return;
  (state.logs[date] || (state.logs[date] = [])).push(...added);
  persist();
  renderAll();
  showToast('已記' + MEAL_META[meal].label + '：' + added.length + ' 樣、' + sumNutr(added).kcal + ' kcal（不含照片）', '復原', () => {
    const ids = new Set(added.map(a => a.id));
    state.logs[date] = (state.logs[date] || []).filter(it => !ids.has(it.id));
    added.forEach(a => tombstone('e:' + a.id));
    persist();
    renderAll();
  });
}
$('mealLogContainer').addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy-meal]');
  if (b) copyMeal(b.getAttribute('data-copy-meal'));
});

function renderLogs() {
  const container = $('mealLogContainer');
  const list = state.logs[ui.date] || [];
  if (!list.length) {
    container.innerHTML = `<div class="bg-white rounded-2xl border border-dashed border-stone-300 p-8 text-center space-y-2">
      <p class="text-base font-medium text-stone-600">這天還沒有記錄</p>
      <p class="text-sm text-stone-400">點上面的「常吃的」「拍照記」開始</p></div>` + copyMealHTML(list);
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
      </div>${mealGapHTML(mealKey)}<ul class="divide-y divide-stone-100">`;
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
  container.innerHTML = html + copyMealHTML(list);
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
    if (el === document.activeElement) return;
    const v = d[el.getAttribute('data-day-num')];
    el.value = v == null ? '' : v;
  });
  document.querySelectorAll('[data-day-text]').forEach(el => {
    if (el === document.activeElement) return;
    el.value = d[el.getAttribute('data-day-text')] || '';
  });
  document.querySelectorAll('.toggle-btn[data-field]').forEach(btn => {
    const f = btn.getAttribute('data-field');
    btn.classList.toggle('is-active', d[f] != null && String(d[f]) === btn.getAttribute('data-val'));
  });
}
function setDayField(field, value, date = ui.date) {
  setTimeout(() => { renderTiles(); renderMascot(); }, 0);
  const d = getDay(date, true);
  if (value === null || value === '' || value === undefined) delete d[field]; else d[field] = value;
  (d._t || (d._t = {}))[field] = now();
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

  const w1 = s.weights[s.weights.length - 1];
  // 體重變化看 7 天平均的變化，不受某一天水腫影響
  const wc = weightAvgChange(state.days, dates);
  const wDelta = wc ? wc.delta : null;
  $('trendStats').innerHTML = [
    statTile('平均攝取', s.avgKcal != null ? fmt(s.avgKcal) + ' kcal' : '–', '目標 ' + fmt(target)),
    statTile('記錄天數', s.loggedDays + ' / ' + n, '超標 ' + s.overDays + ' 天'),
    statTile('體重變化（平均）', wDelta != null ? (wDelta > 0 ? '+' : '') + wDelta + ' kg' : (w1 ? w1.w + ' kg' : '–'), w1 ? '最新 ' + w1.w + ' kg' : ''),
    statTile('平均喝水', s.avgWater != null ? fmt(s.avgWater) + ' ml' : '–', '運動共 ' + s.exMinTotal + ' 分')
  ].join('');

  // 身體數據、睡眠的文字摘要不靠 Chart.js；圖表函式自己會檢查 Chart 在不在
  const labels = dates.map(fmtMD);
  renderBodyChart(dates, labels);
  renderSleepChart(dates, labels);
  if (typeof Chart !== 'undefined') {
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

let sleepChart = null;
function renderSleepChart(dates, labels) {
  const rows = dates.map(d => daySleep(state.days[d] || {}));
  const has = rows.some(r => r.total > 0);
  $('sleepEmpty').classList.toggle('hidden', has);
  $('sleepChartWrap').classList.toggle('hidden', !has);
  if (sleepChart) { sleepChart.destroy(); sleepChart = null; }
  const withSleep = rows.filter(r => r.total > 0);
  const qs = rows.filter(r => r.quality != null);
  const avg = withSleep.length ? withSleep.reduce((a, r) => a + r.total, 0) / withSleep.length : null;
  const short = withSleep.filter(r => r.total < 360).length;
  const napTotal = rows.reduce((a, r) => a + r.nap, 0);
  $('sleepStats').innerHTML = has ? [
    statTile('平均睡眠', avg != null ? r1(avg / 60) + ' 小時' : '–', withSleep.length + ' 天有記錄'),
    statTile('平均品質', qs.length ? sleepQualityLabel(Math.round(qs.reduce((a, r) => a + r.quality, 0) / qs.length)) : '–', qs.length ? '1–5 分：' + r1(qs.reduce((a, r) => a + r.quality, 0) / qs.length) : ''),
    statTile('睡不到 6 小時', short + ' 天', ''),
    statTile('補眠合計', napTotal ? fmtDuration(napTotal) : '–', '')
  ].join('') : '';
  // 睡眠和當天飲食的關係（今天還沒吃完不算；各組至少 2 天才顯示）
  const good = [];
  const bad = [];
  dates.forEach((d, i) => {
    const r = rows[i];
    if (!r.night || d >= todayStr()) return;
    const t = dayTotals(d);
    if (!t.count) return;
    if (r.night >= 420) good.push(t.kcal); else if (r.night < 360) bad.push(t.kcal);
  });
  const mean = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  let insight = '';
  if (good.length >= 2 && bad.length >= 2) {
    const g = mean(good);
    const b = mean(bad);
    insight = `💡 前一晚睡滿 7 小時的日子，平均吃 <b>${g.toLocaleString()}</b> kcal；睡不到 6 小時的日子，平均吃 <b>${b.toLocaleString()}</b> kcal` +
      (b - g >= 100 ? `，多了 ${(b - g).toLocaleString()} kcal。睡飽真的有幫助！` : '。');
  } else if (has) {
    insight = '💡 多記幾天，這裡會比較「睡飽」和「沒睡飽」的那天各吃了多少。';
  }
  $('sleepInsight').innerHTML = insight;
  if (!has || typeof Chart === 'undefined') return;
  sleepChart = new Chart($('sleepChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '夜間睡眠', data: rows.map(r => r.night ? r1(r.night / 60) : null), backgroundColor: '#6366f1', borderRadius: 4, stack: 's', barPercentage: 0.6 },
        { label: '補眠', data: rows.map(r => r.nap ? r1(r.nap / 60) : null), backgroundColor: '#c4b5fd', borderRadius: 4, stack: 's', barPercentage: 0.6 },
        { label: '7 小時', data: Array(dates.length).fill(7), type: 'line', borderColor: '#a8a29e', borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: { y: { stacked: true, beginAtZero: true, suggestedMax: 10, title: { display: true, text: '小時' }, grid: { color: '#f5f5f4' } }, x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } } }
    }
  });
}

function metricSeries(dates, key) {
  if (key === 'bmi') return dates.map(d => calcBmi(num((state.days[d] || {}).weight), state.profile.height));
  return dates.map(d => num((state.days[d] || {})[key]));
}
function renderBodyChart(dates, labels) {
  const options = [{ key: 'weight', label: '體重' }];
  if (state.profile.height) options.push({ key: 'bmi', label: 'BMI' });
  MEASURES.slice(1).forEach(m => { if (metricSeries(dates, m.key).some(v => v != null)) options.push({ key: m.key, label: m.label }); });
  if (!options.some(o => o.key === ui.bodyMetric)) ui.bodyMetric = 'weight';
  $('bodyMetricGroup').innerHTML = options.length > 1
    ? options.map(o => `<button type="button" data-metric="${o.key}" class="range-btn ${o.key === ui.bodyMetric ? 'is-active' : ''}">${o.label}</button>`).join('')
    : '';
  const key = ui.bodyMetric;
  const meta = key === 'bmi' ? { label: 'BMI', unit: '' } : MEASURE_META[key];
  const data = metricSeries(dates, key);
  const pts = data.filter(v => v != null);
  const has = pts.length > 0;
  // 體重：每天的點之外，加 7 天平均線（每天會因水分、鹽分上下跳，看平均比較準）
  const avg = key === 'weight' ? rollingAverage(state.days, 'weight', dates) : null;
  const avgPts = avg ? avg.filter(v => v != null) : [];
  $('weightEmpty').classList.toggle('hidden', has);
  $('weightChartWrap').classList.toggle('hidden', !has);
  $('weightAvgNote').classList.toggle('hidden', !(has && avg));
  const signed = (d) => (d > 0 ? '+' : '') + r1(d);
  $('bodyMetricSummary').textContent = !has ? ''
    : avg
      ? '最新 ' + pts[pts.length - 1] + ' kg・7 天平均 ' + avgPts[avgPts.length - 1] + ' kg' + (avgPts.length > 1 ? '（期間 ' + signed(avgPts[avgPts.length - 1] - avgPts[0]) + '）' : '')
      : '最新 ' + pts[pts.length - 1] + (meta.unit ? ' ' + meta.unit : '') + (pts.length > 1 ? '・期間 ' + signed(pts[pts.length - 1] - pts[0]) : '');
  if (weightChart) { weightChart.destroy(); weightChart = null; }
  if (!has || typeof Chart === 'undefined') return;
  const ds = avg
    ? [
        { label: '7 天平均', data: avg, borderColor: '#0369a1', backgroundColor: '#0369a1', spanGaps: true, tension: 0.3, pointRadius: 0, borderWidth: 3 },
        { label: '每天體重', data, borderColor: '#bae6fd', backgroundColor: '#0ea5e9', spanGaps: true, tension: 0.25, pointRadius: 3.5, borderWidth: 1 }
      ]
    : [{ label: meta.label + (meta.unit ? '（' + meta.unit + '）' : ''), data, borderColor: '#0ea5e9', backgroundColor: '#0ea5e9', spanGaps: true, tension: 0.25, pointRadius: 3 }];
  const line = (label, v, color) => ds.push({ label, data: Array(dates.length).fill(v), borderColor: color, borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5 });
  if (key === 'weight' && state.targets.weight) line('目標體重', state.targets.weight, '#a8a29e');
  if (key === 'bmi') { line('健康上限 24', 24, '#f59e0b'); line('過輕 18.5', 18.5, '#7dd3fc'); }
  if (key === 'waist' && waistRisk(1, state.profile.sex)) line('腹部肥胖標準', waistRisk(1, state.profile.sex).limit, '#f59e0b');
  weightChart = new Chart($('weightChart').getContext('2d'), {
    type: 'line',
    data: { labels, datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: ds.length > 1, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: { y: { grace: '8%', grid: { color: '#f5f5f4' } }, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } } }
    }
  });
}
$('bodyMetricGroup').addEventListener('click', (e) => {
  const b = e.target.closest('[data-metric]');
  if (!b) return;
  ui.bodyMetric = b.getAttribute('data-metric');
  renderTrends();
});

/* ---------------- 睡眠 ---------------- */
$('sleepQGroup').innerHTML = Object.entries(SLEEP_QUALITY).map(([v, t]) => {
  const [emo, label] = t.split('|');
  return `<button type="button" data-sleepq="${v}" class="toggle-btn flex flex-col items-center gap-0.5 py-2"><span class="text-2xl leading-none">${emo}</span><span class="text-xs">${label}</span></button>`;
}).join('');
// 昨晚的睡眠記在起床那天（就是目前選的日期），才能和這天吃多少直接比較
function nightDate() { return ui.date; }
function lastSleepPattern(before) {
  const k = Object.keys(state.days).filter(x => x < before && state.days[x].sleepBed && state.days[x].sleepWake).sort().pop();
  return k ? { bed: state.days[k].sleepBed, wake: state.days[k].sleepWake } : null;
}
function renderSleepScreen() {
  const nd = nightDate();
  const night = getDay(nd, false);
  const wd = (s) => fmtMD(s) + '（' + '日一二三四五六'[parseDate(s).getDay()] + '）';
  $('sleepNightLabel').textContent = wd(addDays(nd, -1)) + ' 晚上 → ' + wd(nd) + ' 早上・記在起床這天 ' + fmtMD(nd);
  if ($('sleepBed') !== document.activeElement) $('sleepBed').value = night.sleepBed || '';
  if ($('sleepWake') !== document.activeElement) $('sleepWake').value = night.sleepWake || '';
  const min = num(night.sleepMin);
  $('sleepDur').textContent = min ? fmtDuration(min) : '–';
  const hint = $('sleepHint');
  if (!min) { hint.textContent = '填上床和起床時間，會自動算出時數'; hint.className = 'text-sm mt-1 text-stone-500'; }
  else if (min > 16 * 60) { hint.textContent = '時間好像不太對，確認一下上床／起床時間'; hint.className = 'text-sm mt-1 font-semibold text-rose-600'; }
  else if (min >= 420 && min <= 540) { hint.textContent = '✓ 睡眠充足（建議 7–9 小時）'; hint.className = 'text-sm mt-1 font-semibold text-emerald-700'; }
  else if (min < 360) { hint.textContent = '睡得比較少，今晚早點休息喔'; hint.className = 'text-sm mt-1 font-semibold text-amber-700'; }
  else { hint.textContent = '建議每晚睡 7–9 小時'; hint.className = 'text-sm mt-1 text-stone-500'; }
  document.querySelectorAll('#sleepQGroup [data-sleepq]').forEach(b => b.classList.toggle('is-active', String(night.sleepQ) === b.getAttribute('data-sleepq')));
  $('sleepClearBtn').classList.toggle('hidden', !(night.sleepBed || night.sleepWake || night.sleepQ != null));
  const pat = lastSleepPattern(nd);
  const same = $('sleepSameBtn');
  same.classList.toggle('hidden', !pat || Boolean(night.sleepBed || night.sleepWake));
  if (pat) same.textContent = '跟上次一樣：' + pat.bed + ' 睡、' + pat.wake + ' 起床';
  // 補眠
  const d = getDay(ui.date, false);
  const naps = d.naps || [];
  $('napDateLabel').textContent = '記在 ' + wd(ui.date) + '，可以加好幾次';
  $('napList').innerHTML = naps.length
    ? naps.map(n => `<div class="flex items-center justify-between rounded-xl bg-white border border-stone-200 px-3 py-2">
        <span class="text-base font-semibold text-stone-800">💤 ${fmtDuration(n.min)}</span>
        <button type="button" data-nap-del="${esc(n.id)}" class="px-3 py-1.5 rounded-lg text-sm text-rose-600 hover:bg-rose-50">刪除</button></div>`).join('')
    : '<div class="text-sm text-stone-400">今天還沒有補眠記錄</div>';
  const ts = daySleep(d);
  $('sleepTotalLine').innerHTML = ts.total
    ? fmtMD(ui.date) + ' 共睡 <b>' + fmtDuration(ts.total) + '</b>' + (ts.night && ts.nap ? '（昨晚 ' + fmtDuration(ts.night) + '＋補眠 ' + fmtDuration(ts.nap) + '）' : '')
    : '昨晚的睡眠記在起床這天，補眠也記在當天，兩個加起來就是這天的總睡眠。';
  $('sleepTotalLine').classList.toggle('hidden', false);
}
function saveNightTimes() {
  const nd = nightDate();
  const bed = $('sleepBed').value;
  const wake = $('sleepWake').value;
  setDayField('sleepBed', bed || null, nd);
  setDayField('sleepWake', wake || null, nd);
  setDayField('sleepMin', sleepMinutes(bed, wake), nd);
  renderSleepScreen();
}
['sleepBed', 'sleepWake'].forEach(id => {
  $(id).addEventListener('change', saveNightTimes);
  $(id).addEventListener('blur', saveNightTimes);
});
$('sleepSameBtn').addEventListener('click', () => {
  const pat = lastSleepPattern(nightDate());
  if (!pat) return;
  $('sleepBed').value = pat.bed;
  $('sleepWake').value = pat.wake;
  saveNightTimes();
});
$('sleepQGroup').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sleepq]');
  if (!b) return;
  const v = Number(b.getAttribute('data-sleepq'));
  const cur = getDay(nightDate(), false).sleepQ;
  setDayField('sleepQ', cur === v ? null : v, nightDate());
  renderSleepScreen();
});
$('sleepClearBtn').addEventListener('click', () => {
  const nd = nightDate();
  ['sleepBed', 'sleepWake', 'sleepMin', 'sleepQ'].forEach(f => setDayField(f, null, nd));
  $('sleepBed').value = '';
  $('sleepWake').value = '';
  renderSleepScreen();
});
function addNap(min) {
  if (!min || min <= 0 || min > 600) { showToast('請輸入 1–600 分鐘'); return; }
  const naps = [...(getDay(ui.date, false).naps || []), { id: uid('nap'), min: Math.round(min) }];
  setDayField('naps', naps);
  renderSleepScreen();
  showToast('已加入補眠 ' + fmtDuration(min));
}
document.querySelectorAll('[data-nap]').forEach(b => b.addEventListener('click', () => addNap(Number(b.getAttribute('data-nap')))));
$('napAddBtn').addEventListener('click', () => { addNap(num($('napCustom').value)); $('napCustom').value = ''; });
$('napList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-nap-del]');
  if (!b) return;
  const naps = (getDay(ui.date, false).naps || []).filter(n => n.id !== b.getAttribute('data-nap-del'));
  setDayField('naps', naps.length ? naps : null);
  renderSleepScreen();
});

/* ---------------- 小芽 ---------------- */
let mascotIdx = 0;
let mascotMsgs = [];
function computeStreak(date) {
  const has = (d) => (state.logs[d] || []).length > 0;
  const todayLogged = has(date);
  let d = todayLogged ? date : addDays(date, -1);
  let n = 0;
  while (has(d) && n < 2000) { n++; d = addDays(d, -1); }
  return { n, todayLogged };
}
function weightInfo(date) {
  const keys = Object.keys(state.days).filter(k => k <= date && num(state.days[k].weight) != null).sort();
  if (!keys.length) return null;
  const last = keys[keys.length - 1];
  if (last < addDays(date, -45)) return null;
  const weekRef = keys.filter(k => k <= addDays(date, -7)).pop() || (keys.length > 1 && keys[0] >= addDays(date, -7) ? keys[0] : null);
  return {
    now: num(state.days[last].weight),
    week: weekRef && weekRef !== last ? num(state.days[weekRef].weight) : null,
    first: num(state.days[keys[0]].weight),
    measuredToday: last === date
  };
}
// 跨模組提醒要的資料：這天、前一天、前兩天
function insightDay(date) {
  const d = getDay(date, false);
  const t = dayTotals(date);
  return {
    weight: num(d.weight), bowel: d.bowel == null ? null : Number(d.bowel), water: num(d.water),
    kcal: t.kcal, count: t.count, veg: t.ex.veg, exItems: t.exItems
  };
}
function dayInsights(date) {
  return buildInsights({
    isToday: date === todayStr(), targetKcal: state.targets.kcal,
    d: [0, -1, -2].map(n => insightDay(addDays(date, n))),
    lastNightMin: daySleep(getDay(date, false)).night || null,
    recalcKg: date === todayStr() ? recalcHint(state.targets.calc, rollingAverage(state.days, 'weight', [date])[0]) : null,
    muscle: (() => { const m = muscleChange(state.days, date); return m && m.to >= addDays(date, -14) ? m : null; })()
  }).sort((a, b) => b.pri - a.pri);
}
// 小芽關掉時，提醒改用首頁的小卡片列出來（沒有提醒就不顯示）
function renderTips(insights) {
  $('tipsCard').classList.toggle('hidden', !insights.length);
  if (!insights.length) return;
  $('tipsTitle').textContent = ui.date === todayStr() ? '今天的小提醒' : fmtMD(ui.date) + ' 的小提醒';
  $('tipsList').innerHTML = insights.map(m => `<li>${esc(m.text)}</li>`).join('');
}
/* ---------------- AI 辨識（使用者自己的 Gemini API Key，預設關閉） ---------------- */
const aiKey = () => (state.meta.ai && state.meta.ai.key) || '';
const AI_ERRORS = {
  key: 'API Key 不對或已經失效，請到「報告」頁的「AI 辨識」重新設定。',
  quota: '免費額度暫時用完了（或太頻繁），請過一會兒再試。',
  referrer: '這把 Key 限制了可以使用的網站，請確認有加上 https://ericckfeng.github.io/*',
  forbidden: 'Google 拒絕了這個請求，請確認這把 Key 是 Gemini API 用的。',
  network: '連不上網路，請確認網路後再試一次。'
};
const aiErrorText = (e) => AI_ERRORS[e && e.kind] || 'AI 這次沒有回答好，請再試一次。';
function setBox(id, tone, text) {
  const el = $(id);
  el.classList.toggle('hidden', !text);
  el.className = el.className.replace(/\b(bg|text)-(sky|rose|emerald|amber)-\d+\b/g, '').trim();
  if (text) el.classList.add(...({ info: ['bg-sky-50', 'text-sky-900'], err: ['bg-rose-50', 'text-rose-800'], ok: ['bg-emerald-50', 'text-emerald-900'] }[tone]));
  el.textContent = text || '';
}
function renderAiUi() {
  const on = Boolean(aiKey());
  $('aiTile').classList.toggle('hidden', !on);
  $('aiLabelWrap').classList.toggle('hidden', !on);
  $('aiStatusText').textContent = on
    ? '已開啟：首頁有「AI 幫我認」，自己輸入可以拍營養標示。Key 只存在這支手機。'
    : '用自己的免費 Google API Key：拍一餐或說一句話，AI 拆成一樣一樣記；拍營養標示自動填數字。預設關閉。';
  $('aiSetupBtn').textContent = on ? 'AI 辨識設定' : '設定 AI 辨識';
}

// 設定頁
function renderAiKey() {
  const on = Boolean(aiKey());
  $('aiKeyOn').classList.toggle('hidden', !on);
  $('aiKeyInput').value = '';
  $('aiKeySaveBtn').textContent = on ? '換一把 Key' : '測試並開啟';
  setBox('aiKeyStatus', null, '');
}
$('aiKeySaveBtn').addEventListener('click', async () => {
  const key = $('aiKeyInput').value.trim();
  if (!key) { setBox('aiKeyStatus', 'err', '請先貼上 API Key'); return; }
  const btn = $('aiKeySaveBtn');
  btn.disabled = true; btn.textContent = '測試中…';
  try {
    await callGemini({ key, request: PING_REQUEST });
    state.meta.ai = { key, at: now() };
    persistLocal();
    renderAll();
    renderAiKey();
    setBox('aiKeyStatus', 'ok', '成功！AI 辨識已開啟。首頁多了「AI 幫我認」。');
  } catch (e) {
    setBox('aiKeyStatus', 'err', e.kind === 'key' ? '這把 Key 不能用，請確認有完整複製（通常是 AIza 開頭）。' : aiErrorText(e));
  } finally {
    btn.disabled = false;
    if (!aiKey()) btn.textContent = '測試並開啟';
  }
});
$('aiOffBtn').addEventListener('click', () => {
  delete state.meta.ai;
  persistLocal();
  renderAll();
  renderAiKey();
  showToast('已關閉 AI，這支手機上的 Key 已刪除');
});

// AI 幫我認：拍照或一句話 → 品項清單 → 勾選 → 放進購物車
const aiDraft = { photo: null, items: null, checked: new Set(), source: null };
function resetAi() {
  aiDraft.photo = null; aiDraft.items = null; aiDraft.checked = new Set();
  $('aiText').value = '';
  $('aiPhotoInput').value = '';
  renderAiPhoto();
  renderAiResults();
  setBox('aiStatus', null, '');
}
function renderAiPhoto() {
  $('aiPhotoWrap').classList.toggle('hidden', !aiDraft.photo);
  $('aiPhotoBtn').classList.toggle('hidden', Boolean(aiDraft.photo));
  if (aiDraft.photo) $('aiPhotoPreview').src = aiDraft.photo;
}
function clearAiResults() { if (aiDraft.items) { aiDraft.items = null; renderAiResults(); setBox('aiStatus', null, ''); } }
function renderAiResults() {
  const items = aiDraft.items;
  const has = Boolean(items && items.length);
  $('aiGoBtn').classList.toggle('hidden', has);
  $('aiAddBtn').classList.toggle('hidden', !has);
  if (!items) { $('aiResults').innerHTML = ''; return; }
  $('aiResults').innerHTML = items.map((it, i) => `<label class="pick-row cursor-pointer">
      <input type="checkbox" data-ai-item="${i}" class="big-check" ${aiDraft.checked.has(i) ? 'checked' : ''} />
      <span class="min-w-0 flex-1"><span class="block text-lg font-semibold text-stone-900 break-words">${esc(it.name)}</span>
      <span class="block text-base text-stone-500 tabular-nums">約 ${it.grams} g</span></span>
      <span class="text-lg font-bold text-emerald-700 tabular-nums shrink-0">${it.kcal} kcal</span></label>`).join('');
  const n = aiDraft.checked.size;
  $('aiAddBtn').textContent = '加入這一餐（' + n + ' 樣）';
  $('aiAddBtn').disabled = !n;
}
$('aiPhotoBtn').addEventListener('click', () => $('aiPhotoInput').click());
$('aiPhotoInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try { aiDraft.photo = await compressImage(file, 1024); } catch (err) { showToast('照片讀不到，請再試一次'); return; }
  clearAiResults();
  renderAiPhoto();
});
$('aiPhotoClear').addEventListener('click', () => { aiDraft.photo = null; $('aiPhotoInput').value = ''; clearAiResults(); renderAiPhoto(); });
$('aiText').addEventListener('input', clearAiResults);
$('aiResults').addEventListener('change', (e) => {
  const cb = e.target.closest('[data-ai-item]');
  if (!cb) return;
  const i = Number(cb.getAttribute('data-ai-item'));
  if (cb.checked) aiDraft.checked.add(i); else aiDraft.checked.delete(i);
  renderAiResults();
});
$('aiGoBtn').addEventListener('click', async () => {
  const text = $('aiText').value.trim();
  if (!aiDraft.photo && !text) { setBox('aiStatus', 'err', '請先拍照，或用說的、打字描述吃了什麼'); return; }
  const btn = $('aiGoBtn');
  btn.disabled = true; btn.textContent = 'AI 辨識中…（大約 5～15 秒）';
  setBox('aiStatus', 'info', 'AI 辨識中，請稍等…');
  try {
    const out = normalizeMeal(await callGemini({ key: aiKey(), request: buildRequest({ prompt: mealPrompt(text), imageDataUrl: aiDraft.photo, schema: MEAL_SCHEMA }) }));
    aiDraft.items = out.items;
    aiDraft.source = aiDraft.photo ? 'photo' : 'text';
    aiDraft.checked = new Set(out.items.map((_, i) => i));
    renderAiResults();
    if (!out.items.length) setBox('aiStatus', 'err', 'AI 沒有認出食物。' + (out.note ? out.note : '請換個角度再拍，或用說的。'));
    else setBox('aiStatus', 'info', '不對的可以取消打勾。' + (out.note ? out.note : ''));
  } catch (e) {
    setBox('aiStatus', 'err', aiErrorText(e));
  } finally {
    btn.disabled = false; btn.textContent = '請 AI 幫我認';
  }
});
// 從目前的畫面換到另一個畫面（返回鍵直接回到首頁）
function swapScreen(id) {
  const once = () => { window.removeEventListener('popstate', once); setTimeout(() => openScreen(id), 0); };
  window.addEventListener('popstate', once);
  closeScreen();
}
$('aiAddBtn').addEventListener('click', () => {
  const picked = (aiDraft.items || []).filter((_, i) => aiDraft.checked.has(i));
  if (!picked.length) return;
  picked.forEach((it, i) => {
    const food = aiItemToFood(it, aiDraft.source);
    const { weighed, entry } = cartEntryFor(food, it.grams, 'asis');
    // 照片跟著第一樣存（營養師看得到這一餐的照片）
    foodCart.push({ key: uid('c'), food, grams: it.grams, weighed, entry, photo: i === 0 ? aiDraft.photo : null });
  });
  showToast('已加入 ' + picked.length + ' 樣，可以改克數，再按「記到' + MEAL_META[ui.meal].label + '」');
  swapScreen('scr-food');
});

// 語音輸入（瀏覽器支援才顯示）
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRec) {
  $('aiMicBtn').classList.remove('hidden');
  let rec = null;
  $('aiMicBtn').addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new SpeechRec();
    rec.lang = 'zh-TW';
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const said = Array.from(ev.results).map(r => r[0].transcript).join('');
      $('aiText').value = ($('aiText').value ? $('aiText').value + '、' : '') + said;
      clearAiResults();
    };
    rec.onend = () => { rec = null; $('aiMicBtn').textContent = '🎤 按一下開始說話'; };
    rec.onerror = () => showToast('沒聽清楚，請再說一次，或直接打字');
    $('aiMicBtn').textContent = '⏹ 說完了，按這裡';
    rec.start();
  });
}

// 拍營養標示 → 填進「自己輸入」
$('aiLabelBtn').addEventListener('click', () => $('aiLabelInput').click());
$('aiLabelInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const btn = $('aiLabelBtn');
  btn.disabled = true; btn.textContent = 'AI 讀取中…';
  try {
    const photo = await compressImage(file, 1280);   // 標示的字小，解析度高一點
    const lb = normalizeLabel(await callGemini({ key: aiKey(), request: buildRequest({ prompt: LABEL_PROMPT, imageDataUrl: photo, schema: LABEL_SCHEMA }) }));
    if (!lb) { setBox('aiLabelNote', 'err', '找不到營養標示。請把「營養標示」的表格拍清楚、拍正一點再試。'); return; }
    if (!$('foodNameInput').value.trim() && lb.name) $('foodNameInput').value = lb.name;
    $('foodKcalInput').value = lb.kcal;
    $('addNutrDetails').open = true;
    writeNutrFields('add', { p: lb.p, c: lb.c, f: lb.f, ex: null });
    const per = lb.servingG ? '每份 ' + lb.servingG + ' 公克' + (lb.servings ? '、這包有 ' + lb.servings + ' 份' : '') + '。' : '';
    setBox('aiLabelNote', 'info', 'AI 讀到：' + per + '每份 ' + lb.kcal + ' 大卡。已填好，請對照包裝確認；吃了幾份在下面選。');
  } catch (err) {
    setBox('aiLabelNote', 'err', aiErrorText(err));
  } finally {
    btn.disabled = false; btn.textContent = '📷 拍營養標示，AI 幫我填';
  }
});

/* ---------------- 小芽週報 ---------------- */
function weeklyData() {
  const wk = lastWeek(todayStr());
  const sum = periodSummary(reportContext(), datesBetween(wk.from, wk.to));
  return { ...wk, sum, ...buildWeekly(sum) };
}
// 首頁卡片：週一起出現，上週有記 3 天以上、還沒看過才顯示
function renderWeeklyCard() {
  const wk = lastWeek(todayStr());
  const logged = datesBetween(wk.from, wk.to).filter(d => (state.logs[d] || []).length).length;
  const show = ui.date === todayStr() && logged >= 3 && state.meta.weeklySeen !== wk.from;
  $('weeklyCard').classList.toggle('hidden', !show);
  if (show) $('weeklyCardSub').textContent = fmtMD(wk.from) + '～' + fmtMD(wk.to) + ' 出來了，點這裡看';
}
let lastWeekly = null;
function renderWeekly() {
  const w = weeklyData();
  lastWeekly = w;
  if (state.meta.weeklySeen !== w.from) { state.meta.weeklySeen = w.from; persistLocal(); renderWeeklyCard(); }
  const empty = w.sum.loggedDays === 0;
  $('weeklyMascot').innerHTML = mascotSVG(empty ? 'calm' : 'cheer');
  $('weeklyRange').textContent = fmtMD(w.from) + '～' + fmtMD(w.to);
  $('weeklyEmpty').classList.toggle('hidden', !empty);
  $('weeklyGood').parentElement.classList.toggle('hidden', empty);
  $('weeklyTry').parentElement.classList.toggle('hidden', empty);
  $('weeklyShareBtn').classList.toggle('hidden', empty);
  $('weeklyGood').innerHTML = w.good.map(g => `<li class="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-lg font-semibold text-emerald-900 leading-relaxed">✓ ${esc(g)}</li>`).join('');
  $('weeklyTry').textContent = '👉 ' + w.tryNext;
}
$('weeklyShareBtn').addEventListener('click', async () => {
  if (!lastWeekly) return;
  const text = weeklyText({ ...lastWeekly, name: state.profile.name }, fmtMD);
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  try { await navigator.clipboard.writeText(text); showToast('已複製週報，貼到 LINE 即可'); } catch (e) { showToast('無法複製'); }
});

function renderMascot() {
  const card = $('mascotCard');
  const insights = dayInsights(ui.date);
  if (state.meta.mascot === false) { card.classList.add('hidden'); renderTips(insights); return; }
  card.classList.remove('hidden');
  renderTips([]);
  const isToday = ui.date === todayStr();
  const t = dayTotals(ui.date);
  const d = getDay(ui.date, false);
  const w = weightInfo(ui.date);
  const bmi = w ? calcBmi(w.now, state.profile.height) : null;
  const streak = computeStreak(ui.date);
  mascotMsgs = buildMascotMessages({
    isToday, hour: new Date().getHours(), count: t.count, kcal: t.kcal, targetKcal: state.targets.kcal,
    meals: MEAL_KEYS.filter(k => t.meals[k] > 0).length, streak, weight: w,
    targetWeight: num(state.targets.weight), bmi, water: num(d.water) || 0, waterGoal: dayWaterGoal(ui.date),
    lastNight: daySleep(getDay(ui.date, false)),
    exercise: d.exercise || (d.exMin ? d.exMin + ' 分鐘' : ''),
    insights
  });
  mascotIdx = 0;
  showMascotMsg();
  const chips = [];
  if (streak.n >= 1) chips.push('🔥 連續 ' + streak.n + ' 天');
  if (w && w.week != null) { const dl = r1(w.now - w.week); chips.push('⚖️ 這週 ' + (dl > 0 ? '+' : dl < 0 ? '−' : '±') + Math.abs(dl) + ' kg'); }
  if (bmi) chips.push('BMI ' + bmi);
  $('mascotChips').innerHTML = chips.map(c => `<span class="mascot-chip">${c}</span>`).join('');
  const top = mascotMsgs[0];
  if (top && top.mood === 'cheer' && state.meta.lastCheer !== top.key) {
    state.meta.lastCheer = top.key;
    persistLocal();
    burstConfetti();
  }
}
function showMascotMsg() {
  const m = mascotMsgs[mascotIdx % mascotMsgs.length];
  if (!m) return;
  $('mascotBtn').innerHTML = mascotSVG(m.mood);
  $('mascotMsg').textContent = m.text;
}
function burstConfetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = $('confetti');
  const colors = ['#facc15', '#34d399', '#60a5fa', '#f472b6', '#fb923c'];
  box.innerHTML = Array.from({ length: 26 }, (_, i) =>
    `<span style="left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${Math.random() * 0.5}s"></span>`).join('');
  setTimeout(() => { box.innerHTML = ''; }, 2600);
}
$('mascotBtn').addEventListener('click', () => {
  if (mascotMsgs.length < 2) return;
  mascotIdx = (mascotIdx + 1) % mascotMsgs.length;
  showMascotMsg();
});

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
    const show = hasData && c.needAuth && !cloudBusy;
    banner.classList.toggle('hidden', !show);
    banner.dataset.mode = 'reauth';
    $('goBackupBtn').textContent = '重新連結';
    $('backupBannerText').textContent = 'Google 登入過期了，點一下重新連結，就能繼續自動同步。';
    return;
  }
  const last = state.meta.lastBackup;
  const daysSince = last ? Math.floor((Date.now() - last) / 86400000) : null;
  const needBackup = hasData && (daysSince === null ? Object.keys(state.logs).length >= 3 : daysSince >= 7);
  banner.classList.toggle('hidden', !needBackup);
  banner.dataset.mode = 'goto';
  $('goBackupBtn').textContent = '去備份';
  if (needBackup) {
    const tip = cloud.isConfigured() ? '可以連結 Google 雲端自動同步。' : '建議定期下載備份。';
    $('backupBannerText').textContent = daysSince === null
      ? '資料只存在這支手機，' + tip
      : '已經 ' + daysSince + ' 天沒備份了，' + tip;
  }
}
function renderAll() {
  renderSummary();
  renderAiUi();
  renderWeeklyCard();
  renderMealSelector();
  renderQuickStrip();
  renderLogs();
  renderDayPanel();
  renderTiles();
  renderMascot();
  renderSyncChip();
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
  if (screenStack.includes('scr-food')) renderFoodCart();
});
$('portionGroup').addEventListener('click', (e) => {
  const b = e.target.closest('[data-portion]');
  if (!b) return;
  $('portionSelect').value = b.getAttribute('data-portion');
  document.querySelectorAll('#portionGroup [data-portion]').forEach(x => x.classList.toggle('is-active', x === b));
});
$('libraryMealSelect').addEventListener('change', (e) => { ui.meal = e.target.value; renderMealSelector(); });
$('dismissInstallBtn').addEventListener('click', () => { state.meta.installHintDismissed = true; persistLocal(); renderBanners(); });
$('goBackupBtn').addEventListener('click', () => {
  if ($('backupBanner').dataset.mode === 'reauth') { startSignIn('sync'); return; }
  goToCloudSection();
});
/* ---------------- 歡迎（新裝置第一次打開） ---------------- */
// 只在這台裝置沒有任何資料、也沒連結雲端時出現；選過一次就不再出現（meta.welcomed 只存本機）
function shouldWelcome() {
  return !state.meta.welcomed && !state.meta.cloud.linked && !hasLocalData();
}
function finishWelcome() {
  state.meta.welcomed = true;
  persistLocal();
  closeScreen();
}
$('welcomeCloudBtn').classList.toggle('hidden', !cloud.isConfigured());
$('welcomeCloudBtn').addEventListener('click', () => {
  if (cloud.isBlockedInAppBrowser()) { $('welcomeInAppWarn').classList.remove('hidden'); return; }
  // 先回到雲端區塊再登入，登入失敗的訊息才看得到
  finishWelcome();
  goToCloudSection();
  setTimeout(() => cloudRun('connect'), 300);
});
$('welcomeImportBtn').addEventListener('click', () => {
  $('importJsonInput').click();
  finishWelcome();
  switchTab('report');
  setTimeout(() => $('backupSection').scrollIntoView({ behavior: 'smooth' }), 50);
});
$('welcomeStartBtn').addEventListener('click', finishWelcome);

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
  const newPhotoKey = editPhoto.changed && editPhoto.src ? item.id + '-' + now() : item.photoKey;
  if (editPhoto.changed) {
    if (editPhoto.src) await savePhoto(item.id, editPhoto.src); else await deletePhoto(item.id);
    setLocalPhotoKey(item.id, editPhoto.src ? newPhotoKey : null);
  }
  list[idx] = {
    ...item, name, kcal, meal: $('editLogMealSelect').value, time: $('editLogTimeInput').value || item.time,
    pending: $('editLogPendingCheck').checked, p: n.p, c: n.c, f: n.f, ex: n.ex,
    hasPhoto: editPhoto.changed ? Boolean(editPhoto.src) : item.hasPhoto,
    photoKey: newPhotoKey,
    updatedAt: now()
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
  cur.push(...copyEntries(prev, { makeId: uid, at: now() }));
  persist();
  renderAll();
  showToast('已複製前一天 ' + prev.length + ' 筆（不含照片）');
});
$('clearDayBtn').addEventListener('click', () => {
  const list = state.logs[ui.date] || [];
  if (!list.length) { showToast('本日沒有記錄'); return; }
  openConfirm('清空本日記錄', '確定要刪除 ' + ui.date + ' 的 ' + list.length + ' 筆飲食記錄嗎？（身體數據與備註會保留）', async () => {
    for (const it of list) { if (it.hasPhoto) await deletePhoto(it.id); tombstone('e:' + it.id); }
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
  const data = { name, kcal, cat, p: n.p, c: n.c, f: n.f, ex: n.ex, updatedAt: now() };
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
    const presetIds = new Set(PRESET_FOODS.map(f => f.id));
    state.quickItems.forEach(q => { if (!presetIds.has(q.id)) tombstone('q:' + q.id); });
    PRESET_FOODS.forEach(f => { delete state.tomb['q:' + f.id]; });
    state.quickItems = PRESET_FOODS.map(f => ({ ...f, isFav: false, updatedAt: now() }));
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
    tombstone('q:' + removed.id);
    persist(); renderLibrary(); renderQuickStrip();
    showToast('已刪除「' + removed.name + '」', '復原', () => {
      delete state.tomb['q:' + removed.id];
      touch(removed);
      state.quickItems.splice(idx, 0, removed);
      persist(); renderLibrary(); renderQuickStrip();
    });
    return;
  }
  const add = e.target.closest('.quick-add-btn');
  if (add) { const it = state.quickItems.find(q => q.id === add.getAttribute('data-qid')); if (it) addFromQuick(it); }
});

/* ---------------- 每餐份數分配／這一餐還差什麼 ---------------- */
const MEALEX_MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
function mealTarget(meal) { return (state.targets.mealEx || {})[meal] || null; }
function mealGapFor(date, meal) {
  return mealGap((state.logs[date] || []).filter(i => i.meal === meal), mealTarget(meal));
}
// 記完一餐時附在提示後面的一句（有設目標、還有缺才有）
function gapHint(meal) {
  const m = gapMessage(mealGapFor(ui.date, meal), MEAL_META[meal].label);
  return m && !mealGapFor(ui.date, meal).done ? '。' + m.short : '';
}
// 首頁每一餐標題下面那一行
function mealGapHTML(meal) {
  const g = mealGapFor(ui.date, meal);
  if (!g) return '';
  const overKeys = new Set(g.over.map(o => o.k));
  const chips = Object.keys(g.target).map(k => {
    const over = overKeys.has(k);   // 全穀、豆魚蛋肉、油脂吃多了：不打勾，用黃色
    const ok = !over && g.have[k] >= g.target[k] - 0.25;
    return `<span class="inline-block mr-2 whitespace-nowrap ${over ? 'text-amber-700' : ok ? 'text-emerald-700' : 'text-stone-700'}">${EX_META[k].short} ${fmt(g.have[k], 1)}/${fmt(g.target[k], 1)}${ok ? ' ✓' : ''}</span>`;
  }).join('');
  const m = gapMessage(g, MEAL_META[meal].label);
  return `<div data-meal-gap="${meal}" class="px-4 py-2.5 bg-sky-50 border-b border-sky-100 text-base leading-relaxed space-y-1">
    <div class="font-semibold tabular-nums">${chips}</div>
    <div class="text-sky-900">${esc(m.short)}</div>
    ${m.over ? `<div class="text-amber-800">${esc(m.over)}</div>` : ''}
    ${m.unknown ? `<div class="text-sm text-stone-500">${esc(m.unknown)}</div>` : ''}
  </div>`;
}

// 設定頁
function renderMealEx() {
  const me = state.targets.mealEx || {};
  $('mealExCards').innerHTML = MEALEX_MEALS.map(meal => `<div class="rounded-2xl bg-white border border-stone-200 p-3 space-y-2">
      <div class="text-lg font-bold text-stone-800">${MEAL_META[meal].label}</div>
      <div class="grid grid-cols-3 gap-2 items-end">${EX_KEYS.map(k => `<label class="block"><span class="block text-sm text-stone-600">${EX_META[k].emoji} ${EX_META[k].short}</span>
        <input data-mealex="${meal}:${k}" type="number" inputmode="decimal" step="any" min="0" max="20" class="field text-center tabular-nums" placeholder="份" value="${me[meal] && me[meal][k] ? me[meal][k] : ''}" /></label>`).join('')}</div>
    </div>`).join('');
  $('mealExSplitBtn').classList.toggle('hidden', !EX_KEYS.some(k => state.targets.ex && state.targets.ex[k]));
  renderMealExSum();
}
function readMealEx() {
  const out = {};
  document.querySelectorAll('[data-mealex]').forEach(el => {
    const [meal, k] = el.getAttribute('data-mealex').split(':');
    const v = num(el.value);
    if (v > 0) (out[meal] || (out[meal] = {}))[k] = r1(v);
  });
  return out;
}
function renderMealExSum() {
  const me = readMealEx();
  const daily = state.targets.ex || {};
  const rows = EX_KEYS.map(k => {
    const sum = r1(MEALEX_MEALS.reduce((s, meal) => s + ((me[meal] && me[meal][k]) || 0), 0));
    const d = daily[k] || 0;
    if (!sum && !d) return '';
    const diff = d && Math.abs(sum - d) >= 0.3;
    return `<div class="${diff ? 'text-amber-800' : ''}">${EX_META[k].emoji} ${EX_META[k].short}：各餐加起來 ${fmt(sum, 1)} 份${d ? '，每日目標 ' + fmt(d, 1) + ' 份' + (diff ? '（不一樣）' : ' ✓') : ''}</div>`;
  }).join('');
  $('mealExSum').innerHTML = rows || '<div class="text-stone-500">還沒有填</div>';
}
$('mealExCards').addEventListener('input', renderMealExSum);
$('mealExSplitBtn').addEventListener('click', () => {
  const daily = state.targets.ex || {};
  EX_KEYS.forEach(k => {
    const parts = splitDaily(daily[k] || 0);
    ['breakfast', 'lunch', 'dinner'].forEach((meal, i) => {
      document.querySelector(`[data-mealex="${meal}:${k}"]`).value = parts[i] || '';
    });
  });
  renderMealExSum();
  showToast('已平均分到三餐，可以再照營養師的單子調整');
});
$('mealExSaveBtn').addEventListener('click', () => {
  const me = readMealEx();
  const next = { ...state.targets };
  if (Object.keys(me).length) next.mealEx = me; else delete next.mealEx;
  state.targets = next;
  state.targetsAt = now();
  persist();
  renderAll();
  closeScreen();
  showToast(Object.keys(me).length ? '已儲存每餐份數，記完一餐就會告訴你還差什麼' : '已清除每餐份數');
});
$('openMealExBtn').addEventListener('click', () => { closeModal('targetModal'); openScreen('scr-mealex'); });

/* ---------------- 依體重試算目標 ---------------- */
const calcDraft = { sex: null, activity: 'low', goal: 'slow', protein: 1.2, inbody: null, comp: null, bmrSrc: 'formula' };
// 試算用的體重：最近 7 天平均；7 天內沒量就用最後一次
function currentWeight() {
  const avg = rollingAverage(state.days, 'weight', [todayStr()])[0];
  if (avg != null) return { w: avg, note: '最近 7 天平均' };
  const k = Object.keys(state.days).filter(d => num(state.days[d].weight) != null).sort().pop();
  return k ? { w: num(state.days[k].weight), note: fmtMD(k) + ' 量的' } : null;
}
function choiceHTML(attr, items, active) {
  return items.map(i => `<button type="button" ${attr}="${i.key}" class="choice-btn ${String(i.key) === String(active) ? 'is-active' : ''}"><span class="c-t">${esc(i.label)}</span><span class="c-s">${esc(i.sub || i.steps)}</span></button>`).join('');
}
function initCalc() {
  const pr = state.profile;
  const c = state.targets.calc || {};
  calcDraft.sex = pr.sex || null;
  calcDraft.activity = pr.activity || c.activity || 'low';
  calcDraft.goal = c.goal || 'slow';
  calcDraft.protein = c.protein || 1.2;
  // 基礎代謝來源：體脂機顯示的 > 用去脂體重算的 > 公式（上次選過的優先）
  calcDraft.inbody = latestInbodyBmr(state.days, todayStr());
  calcDraft.comp = latestBodyComp(state.days, todayStr());
  const avail = [calcDraft.inbody && 'inbody', calcDraft.comp && 'ffm', 'formula'].filter(Boolean);
  calcDraft.bmrSrc = avail.includes(c.bmrSource) ? c.bmrSource : avail[0];
  $('calcTargetFat').value = state.targets.bodyFat || '';
  $('calcBirthYear').value = pr.birthYear || '';
  $('calcHeight').value = pr.height || '';
  const cw = currentWeight();
  $('calcWeight').value = cw ? cw.w : '';
  $('calcWeightNote').textContent = cw ? '體重用' + cw.note + '，可以改' : '還沒量過體重，請填目前體重';
}
function calcInput() {
  return {
    sex: calcDraft.sex, weight: num($('calcWeight').value), height: num($('calcHeight').value),
    age: ageFrom(num($('calcBirthYear').value)),
    activity: calcDraft.activity, goal: calcDraft.goal, protein: calcDraft.protein,
    measuredBmr: calcDraft.bmrSrc === 'inbody' && calcDraft.inbody ? calcDraft.inbody.value
      : calcDraft.bmrSrc === 'ffm' && calcDraft.comp ? katchBmr(calcDraft.comp.ffm) : null,
    measuredSource: calcDraft.bmrSrc
  };
}
function renderCalc() {
  document.querySelectorAll('[data-calc-sex]').forEach(b => b.classList.toggle('is-active', b.getAttribute('data-calc-sex') === calcDraft.sex));
  $('calcActivity').innerHTML = choiceHTML('data-calc-act', ACTIVITY, calcDraft.activity);
  $('calcGoal').innerHTML = choiceHTML('data-calc-goal', GOALS, calcDraft.goal);
  $('calcProtein').innerHTML = choiceHTML('data-calc-prot', PROTEIN, calcDraft.protein);
  const inp = calcInput();
  const ib = calcDraft.inbody;
  const comp = calcDraft.comp;
  $('calcBmrWrap').classList.toggle('hidden', !ib && !comp);
  if (ib || comp) {
    const fb = calcBmr({ ...inp, measuredBmr: null });
    $('calcBmrSrc').innerHTML = choiceHTML('data-calc-bmr', [
      ib && { key: 'inbody', label: '用體脂機量的 ' + ib.value.toLocaleString() + ' kcal', sub: fmtMD(ib.date) + ' 量的，依肌肉量計算，最準' },
      comp && { key: 'ffm', label: '用體脂率算 ' + katchBmr(comp.ffm).toLocaleString() + ' kcal', sub: fmtMD(comp.date) + ' 體重 ' + comp.weight + ' kg、體脂 ' + comp.bodyFat + '%，去脂體重 ' + comp.ffm + ' kg' },
      { key: 'formula', label: '用公式估算' + (fb ? ' ' + fb.toLocaleString() + ' kcal' : ''), sub: '依體重、身高、年齡、性別估算' }
    ].filter(Boolean), calcDraft.bmrSrc);
  }
  renderCalcFat();
  const t = calcTargets(inp);
  $('calcApplyBtn').disabled = !t;
  if (!t) {
    const miss = (inp.measuredBmr ? [!inp.weight && '體重'] : [!inp.sex && '性別', !inp.age && '出生年', !inp.height && '身高', !inp.weight && '體重']).filter(Boolean);
    $('calcResult').innerHTML = `<div class="text-base text-stone-500">請填${miss.join('、')}，就會算出建議</div>`;
    return;
  }
  const g = GOALS.find(x => x.key === inp.goal);
  const row = (label, v, unit) => `<div class="flex justify-between items-baseline text-lg"><span class="text-stone-600">${label}</span><span class="font-bold text-stone-900 tabular-nums">${v.toLocaleString()} ${unit}</span></div>`;
  $('calcResult').innerHTML = `
    <div class="text-center"><div class="text-base text-stone-500">每天建議吃</div><span class="text-4xl font-bold text-emerald-700 tabular-nums">${t.kcal.toLocaleString()}</span> <span class="text-lg text-stone-600">kcal</span></div>
    <div class="text-sm text-stone-500 text-center">基礎代謝 ${t.bmr.toLocaleString()}${{ inbody: '（體脂機）', ffm: '（依體脂率）' }[t.bmrSource] || ''}・每天約消耗 ${t.tdee.toLocaleString()}${g.deficit ? '・少吃 ' + g.deficit : ''}</div>
    ${t.floored ? `<div class="rounded-xl bg-sky-50 text-sky-900 p-2 text-sm leading-relaxed">為了安全，熱量不會低於基礎代謝和 1,200 kcal，所以用 ${t.kcal.toLocaleString()} kcal。想減得更快，可以多走路、多活動。</div>` : ''}
    ${row('蛋白質', t.p, 'g')}${row('脂肪', t.f, 'g')}${row('碳水', t.c, 'g')}${row('喝水', t.water, 'ml')}
    ${t.adjusted ? '<div class="text-sm text-stone-500">熱量不多，蛋白質和脂肪已調低一點，留一些碳水。</div>' : ''}
    ${(() => {
      const sm = latestSmi(state.days, todayStr(), num($('calcHeight').value) || state.profile.height);
      if (!sm || !smiLow(sm.smi, inp.sex || state.profile.sex) || inp.goal === 'keep') return '';
      return `<div class="rounded-xl bg-amber-50 text-amber-900 p-2 text-sm leading-relaxed">${fmtMD(sm.date)} 的四肢骨骼肌指數 ${sm.smi} kg/m² 偏低（肌肉偏少）。不建議積極減重，可以先選「維持體重」、蛋白質選高一點，並和營養師、醫師討論。</div>`;
    })()}
    <div class="text-sm text-stone-500 leading-relaxed">有運動的那天，喝水每 30 分鐘多 250 ml。心臟、腎臟需要限水的人，請照醫師說的量。</div>`;
}
// 用目標體脂率訂目標體重（有體重＋體脂率才顯示）
function calcFatTarget() {
  const comp = calcDraft.comp;
  return comp ? targetWeightFromBodyFat(comp.ffm, num($('calcTargetFat').value)) : null;
}
function renderCalcFat() {
  const comp = calcDraft.comp;
  $('calcFatWrap').classList.toggle('hidden', !comp);
  if (!comp) return;
  const lim = BODY_FAT_LIMIT[calcDraft.sex];
  $('calcFatInfo').textContent = fmtMD(comp.date) + ' 體脂率 ' + comp.bodyFat + '%，去脂體重（肌肉、骨骼、水分）' + comp.ffm + ' kg。'
    + (lim ? '一般建議' + (calcDraft.sex === 'm' ? '男性' : '女性') + '體脂率低於 ' + lim + '%。' : '');
  const tw = calcFatTarget();
  $('calcFatResult').textContent = tw
    ? '肌肉維持不變的話，目標體重約 ' + tw + ' kg（比現在' + (tw < comp.weight ? '少 ' : '多 ') + r1(Math.abs(comp.weight - tw)) + ' kg）。按下面的按鈕會一起存成目標體重。'
    : '填了就會算出目標體重。';
}
$('calcTargetFat').addEventListener('input', renderCalcFat);
$('openCalcBtn').addEventListener('click', () => { closeModal('targetModal'); openScreen('scr-calc'); });
$('scr-calc').addEventListener('click', (e) => {
  const sex = e.target.closest('[data-calc-sex]');
  const act = e.target.closest('[data-calc-act]');
  const goal = e.target.closest('[data-calc-goal]');
  const prot = e.target.closest('[data-calc-prot]');
  const bmr = e.target.closest('[data-calc-bmr]');
  if (bmr) calcDraft.bmrSrc = bmr.getAttribute('data-calc-bmr');
  else if (sex) calcDraft.sex = sex.getAttribute('data-calc-sex');
  else if (act) calcDraft.activity = act.getAttribute('data-calc-act');
  else if (goal) calcDraft.goal = goal.getAttribute('data-calc-goal');
  else if (prot) calcDraft.protein = Number(prot.getAttribute('data-calc-prot'));
  else return;
  renderCalc();
});
['calcBirthYear', 'calcHeight', 'calcWeight'].forEach(id => $(id).addEventListener('input', renderCalc));
function applyCalc() {
  const inp = calcInput();
  const t = calcTargets(inp);
  if (!t) return;
  // 性別、出生年、身高、活動量存進個人資料（BMI 等也會用到）；用 InBody 時沒填的就保留原本的
  const keep = (v, old) => (v == null || v === '' ? (old ?? null) : v);
  const pr = { ...state.profile, sex: keep(inp.sex, state.profile.sex), height: keep(inp.height, state.profile.height), birthYear: keep(num($('calcBirthYear').value), state.profile.birthYear), activity: inp.activity };
  if (['sex', 'height', 'birthYear', 'activity'].some(k => pr[k] !== state.profile[k])) { state.profile = pr; state.profileAt = now(); }
  state.targets = {
    ...state.targets, kcal: t.kcal, p: t.p, c: t.c, f: t.f, water: t.water,
    calc: { at: now(), weight: inp.weight, activity: inp.activity, goal: inp.goal, protein: inp.protein, bmrSource: t.bmrSource, bmr: t.bmr }
  };
  const tw = calcFatTarget();
  if (tw) { state.targets.weight = tw; state.targets.bodyFat = num($('calcTargetFat').value); }
  state.targetsAt = now();
  persist();
  renderAll();
  closeScreen();
  showToast('已設定目標：每天 ' + t.kcal.toLocaleString() + ' kcal');
}
$('calcApplyBtn').addEventListener('click', () => {
  const t = calcTargets(calcInput());
  if (!t) return;
  const cur = state.targets;
  // 原本已經有目標（可能是營養師給的）：先確認
  if (state.targetsAt && cur.kcal && cur.kcal !== t.kcal && !cur.calc) {
    openConfirm('換成試算的目標？', '目前的目標是每天 ' + cur.kcal.toLocaleString() + ' kcal。如果這是營養師給的數字，建議保留。', applyCalc, '換成 ' + t.kcal.toLocaleString() + ' kcal', null, '保留原本的');
    return;
  }
  applyCalc();
});

/* ---------------- 事件：目標設定 ---------------- */
$('openTargetBtn').addEventListener('click', () => {
  const t = state.targets;
  $('tgt-kcal').value = t.kcal;
  MACRO_KEYS.forEach(k => { $('tgt-' + k).value = t[k] ?? ''; });
  EX_KEYS.forEach(k => { $('tgt-ex-' + k).value = (t.ex && t.ex[k]) ?? ''; });
  $('tgt-weight').value = t.weight ?? '';
  $('tgt-water').value = t.water ?? '';
  $('profileName').value = state.profile.name || '';
  $('mascotToggle').checked = state.meta.mascot !== false;
  $('bankToggle').checked = Boolean(t.bank);
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
  const water = num($('tgt-water').value);
  const next = {
    ...state.targets,   // 保留新版 App 加的欄位（例如試算記錄 calc）
    kcal: Math.round(kcal),
    p: num($('tgt-p').value), c: num($('tgt-c').value), f: num($('tgt-f').value),
    ex, weight: num($('tgt-weight').value), water: water > 0 ? Math.round(water) : null
  };
  // 手動改過熱量、營養素或喝水，就不再是試算的數字：拿掉試算記錄（之後不會提醒重算）
  if (['kcal', 'p', 'c', 'f', 'water'].some(k => (next[k] ?? null) !== (state.targets[k] ?? null))) delete next.calc;
  if ($('bankToggle').checked) next.bank = true; else delete next.bank;
  // 手動改目標體重：不再是用體脂率算的
  if ((next.weight ?? null) !== (state.targets.weight ?? null)) delete next.bodyFat;
  state.targets = next;
  state.targetsAt = now();
  if (state.profile.name !== $('profileName').value.trim()) {
    state.profile.name = $('profileName').value.trim();
    state.profileAt = now();
  }
  state.meta.mascot = $('mascotToggle').checked;
  persist();
  renderAll();
  closeModal('targetModal');
  showToast('已更新目標');
});
$('openSourceBtn').addEventListener('click', () => openModal('sourceModal'));
document.addEventListener('click', (e) => { if (e.target.closest('[data-open-sources]')) openModal('sourceModal'); });

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
  return { state, dayTotals, rangeStats, datesBetween, esc, fmt, r1, num, fmtMD, parseDate, getPhoto, calcBmi, addDays };
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
  return { app: 'diet-tracker', version: SYNC_VERSION, exportedAt: new Date().toISOString(), ...syncData() };
}
function syncData() {
  return {
    ...pickExtras(state),
    targets: state.targets, targetsAt: state.targetsAt, profile: state.profile, profileAt: state.profileAt,
    logs: state.logs, days: state.days, quickItems: state.quickItems, tomb: state.tomb
  };
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
  persistLocal();
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
  const rows = [['日期', '總熱量', '蛋白質(g)', '碳水(g)', '脂肪(g)', ...EX_KEYS.map(k => EX_META[k].short + '(份)'), '體重(kg)', 'BMI', '腰圍(cm)', '臀圍(cm)', '上臂圍(cm)', '大腿圍(cm)', '胸圍(cm)', '體脂率(%)', '喝水(ml)', '運動', '運動分鐘', '上床', '起床', '夜間睡眠(分)', '補眠(分)', '總睡眠(小時)', '睡眠品質(1-5)', '飢餓感(1-5)', '心情(1-5)', '排便', '備註', '想問營養師', '體脂機基礎代謝(kcal)', '骨骼肌(kg)', '內臟脂肪等級', '相位角(°)', '細胞外水分比', '內臟脂肪面積(cm²)', '四肢肌肉量(kg)', 'SMI(kg/m²)']];
  dates.forEach(date => {
    const t = dayTotals(date);
    const d = state.days[date] || {};
    rows.push([date, t.kcal, t.macroItems ? t.p : '', t.macroItems ? t.c : '', t.macroItems ? t.f : '', ...EX_KEYS.map(k => (t.exItems ? t.ex[k] : '')),
      d.weight, calcBmi(d.weight, state.profile.height), d.waist, d.hip, d.arm, d.thigh, d.chest, d.bodyFat, d.water, d.exercise, d.exMin, d.sleepBed, d.sleepWake, d.sleepMin, daySleep(d).nap || '', daySleep(d).total ? r1(daySleep(d).total / 60) : '', d.sleepQ, d.hunger, d.mood, d.bowel != null ? BOWEL_LABELS[d.bowel] : '', d.note, d.question, d.bmr, d.smm, d.vfl, d.pa, d.ecw, d.vfa, d.asm, calcSmi(d.asm, state.profile.height)]);
  });
  downloadBlob('每日身體與備註_' + todayStr() + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
  showToast('已匯出每日 CSV');
});


/* ---------------- Google 雲端同步 ---------------- */
let cloudBusy = false;
let syncTimer = null;
let syncAgain = false;
// 本機每張照片是哪個版本（編輯換照片時版本會變）
function localPhotoKey(id) { return (state.meta.photoVer || {})[id] || id; }
function setLocalPhotoKey(id, key) {
  const m = state.meta.photoVer || (state.meta.photoVer = {});
  if (!key || key === id) delete m[id]; else m[id] = key;
}
function fmtTime(ms) { return new Date(ms).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function fmtClock(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function setCloudStatus(msg, tone = 'ok') {
  const el = $('cloudStatus');
  if (!msg) { el.classList.add('hidden'); return; }
  const tones = { ok: 'bg-emerald-50 text-emerald-800', busy: 'bg-stone-100 text-stone-700', warn: 'bg-amber-50 text-amber-800', err: 'bg-rose-50 text-rose-700' };
  el.className = 'text-sm font-medium rounded-xl px-3 py-2 ' + (tones[tone] || tones.ok);
  el.textContent = msg;
}
function renderCloud() {
  const sec = $('cloudSection');
  renderSyncChip();
  if (!cloud.isConfigured()) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  const c = state.meta.cloud;
  $('cloudInAppWarn').classList.toggle('hidden', !cloud.isBlockedInAppBrowser());
  $('cloudSignedOut').classList.toggle('hidden', c.linked);
  $('cloudSignedIn').classList.toggle('hidden', !c.linked);
  $('cloudEmail').textContent = c.email || 'Google 帳號';
  $('cloudLastText').textContent = c.lastSync ? '上次同步：' + fmtTime(c.lastSync) : '還沒有同步過';
  $('cloudAutoCheck').checked = c.auto !== false;
  ['cloudConnectBtn', 'cloudSyncBtn', 'cloudDisconnectBtn'].forEach(id => { $(id).disabled = cloudBusy; });
  $('cloudSyncBtn').textContent = cloudBusy ? '同步中…' : '立即同步';
}
function renderSyncChip() {
  const chip = $('syncChip');
  const c = state.meta.cloud;
  if (!cloud.isConfigured() || !c.linked) { chip.classList.add('hidden'); return; }
  chip.classList.remove('hidden');
  let icon = '☁️';
  let label = '已同步';
  let tone = 'ok';
  if (cloudBusy) { label = '同步中'; tone = 'busy'; }
  else if (c.needAuth) { label = '需登入'; tone = 'warn'; }
  else if (c.dirty) { label = '待同步'; tone = 'idle'; }
  else if (c.lastSync) { label = fmtClock(c.lastSync); }
  chip.dataset.tone = tone;
  $('syncChipIcon').textContent = icon;
  $('syncChipLabel').textContent = label;
  chip.setAttribute('aria-label', '雲端同步：' + label);
}

function startSignIn(action, silent = false) {
  // 避免授權後馬上又失效時無限跳轉
  const last = Number(sessionStorage.getItem('diet_reauth_at') || 0);
  if (!silent && Date.now() - last < 30000) {
    setCloudStatus('Google 登入沒有成功，請稍後再試一次', 'err');
    return;
  }
  try { sessionStorage.setItem(silent ? 'diet_silent_tried' : 'diet_reauth_at', String(Date.now())); } catch (e) { /* ignore */ }
  if (!silent) setCloudStatus('前往 Google 登入…', 'busy');
  cloud.signIn(action, state.meta.cloud.email, silent);
}

function scheduleSync(delay = 8000) {
  const c = state.meta.cloud;
  renderSyncChip();
  if (!cloud.isConfigured() || !c.linked || c.auto === false) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => cloudRun('sync', { auto: true }), delay);
}

async function cloudRun(action, { auto = false } = {}) {
  if (!cloud.isConfigured()) return;
  if (cloudBusy) { syncAgain = true; return; }
  const c = state.meta.cloud;
  if (cloud.isBlockedInAppBrowser()) {
    if (!auto) { goToCloudSection(); showToast('請改用 Safari／Chrome 開啟後再登入 Google'); }
    return;
  }
  if (!cloud.getToken()) {
    if (!auto) startSignIn(action);
    else if (c.linked && !c.needAuth) { c.needAuth = true; persistLocal(); renderBanners(); renderSyncChip(); }
    return;
  }
  clearTimeout(syncTimer);
  cloudBusy = true;
  renderCloud();
  try {
    if (!c.linked || !c.email) {
      const u = await cloud.getUser();
      c.email = u.emailAddress || '';
      c.linked = true;
      persistLocal();
    }
    c.needAuth = false;
    await doSync({ auto, first: action === 'connect' });
    try { sessionStorage.removeItem('diet_reauth_at'); } catch (e) { /* ignore */ }
  } catch (err) {
    if (err && err.auth) {
      c.needAuth = true;
      persistLocal();
      if (auto) setCloudStatus('Google 登入過期了，按「立即同步」重新登入', 'warn');
      else { cloudBusy = false; startSignIn(action); }
    } else {
      setCloudStatus((err && err.message) || '同步失敗', 'err');
      if (!auto) showToast('同步失敗，請稍後再試');
    }
  } finally {
    cloudBusy = false;
    renderCloud();
    renderBanners();
    renderBackupInfo();
    if (syncAgain) { syncAgain = false; scheduleSync(1500); }
  }
}

function applySyncData(d) {
  state.targets = { ...DEFAULT_TARGETS, ...(d.targets || {}), ex: { ...((d.targets && d.targets.ex) || {}) } };
  state.targetsAt = d.targetsAt;
  state.profile = { name: '', ...(d.profile || {}) };
  state.profileAt = d.profileAt;
  state.logs = d.logs;
  state.days = d.days;
  state.quickItems = d.quickItems;
  state.tomb = d.tomb;
  Object.assign(state, pickExtras(d));
}
function photoKeyOf(it) { return it.photoKey || it.id; }

async function doSync({ auto, first }) {
  const c = state.meta.cloud;
  if (!auto) setCloudStatus('同步中…', 'busy');
  const info = await cloud.getInfo();
  const remoteChanged = info.exists && info.modifiedTime !== c.knownModified;
  if (info.exists && !c.dirty && !remoteChanged) {
    c.lastSync = now();
    persistLocal();
    if (!auto) setCloudStatus('✓ 已經是最新的了（' + fmtTime(c.lastSync) + '）', 'ok');
    return;
  }
  const wasEmpty = !hasLocalData();
  const local = syncShape(syncData());
  const localStr = stableStringify(local);
  const remote = info.exists ? syncShape(await cloud.downloadData(info.fileId)) : null;
  const merged = mergeData(local, remote);

  // 照片：本機是最新版本、雲端沒有 → 上傳；本機沒有或是舊版本、雲端有 → 下載
  const cloudPhotoMap = await cloud.listPhotos();
  const keyToId = new Map();
  Object.values(merged.logs).forEach(list => (list || []).forEach(it => { if (it.hasPhoto) keyToId.set(photoKeyOf(it), it.id); }));
  const toUpload = [];
  const toDownload = [];
  for (const [key, id] of keyToId) {
    const haveCurrent = localPhotoKey(id) === key && Boolean(await getPhoto(id));
    if (haveCurrent && !cloudPhotoMap.has(key)) toUpload.push(key);
    else if (!haveCurrent && cloudPhotoMap.has(key)) toDownload.push([key, cloudPhotoMap.get(key)]);
  }
  if (toUpload.length) {
    await cloud.uploadPhotos(toUpload, (key) => getPhoto(keyToId.get(key)), (n, total) => setCloudStatus(`上傳照片 ${n}/${total}…`, 'busy'));
  }
  if (toDownload.length) {
    const got = await cloud.downloadPhotos(toDownload, (n, total) => setCloudStatus(`下載照片 ${n}/${total}…`, 'busy'));
    for (const [key, dataUrl] of Object.entries(got)) {
      const id = keyToId.get(key);
      await savePhoto(id, dataUrl);
      setLocalPhotoKey(id, key);
    }
  }
  // 清掉雲端上已刪除記錄或舊版本的照片
  {
    for (const [key, fileId] of cloudPhotoMap) {
      if (keyToId.has(key)) continue;
      const entryId = key.split('-')[0];
      if (merged.tomb['e:' + entryId] || Object.values(merged.logs).some(l => (l || []).some(it => it.id === entryId))) {
        await cloud.deleteFile(fileId);
      }
    }
  }

  const mergedStr = stableStringify(merged);
  let modifiedTime = info.modifiedTime;
  if (!remote || mergedStr !== stableStringify(remote)) {
    const r = await cloud.uploadData({ app: 'diet-tracker', version: SYNC_VERSION, ...merged }, info, state.meta.deviceId);
    modifiedTime = r.modifiedTime;
  }
  // 同步期間使用者若又改了東西，以最新的本機資料再合併一次
  const nowLocal = syncShape(syncData());
  let finalData = merged;
  if (stableStringify(nowLocal) !== localStr) { finalData = mergeData(nowLocal, merged); syncAgain = true; }
  const changedLocally = stableStringify(finalData) !== stableStringify(nowLocal);
  if (changedLocally) applySyncData(finalData);
  c.knownModified = modifiedTime;
  c.lastSync = now();
  c.lastBackup = c.lastSync;
  state.meta.lastBackup = c.lastSync;
  c.dirty = syncAgain;
  persistLocal();
  if (changedLocally) renderAll();
  const extra = [];
  if (toUpload.length) extra.push('上傳 ' + toUpload.length + ' 張照片');
  if (toDownload.length) extra.push('下載 ' + toDownload.length + ' 張照片');
  if (first) {
    const days = Object.values(state.logs).filter(l => l && l.length).length;
    if (wasEmpty && remote && days) {
      setCloudStatus('✓ 已取回 ' + days + ' 天的記錄，之後會自動同步' + (extra.length ? '（' + extra.join('、') + '）' : ''), 'ok');
      showToast('已取回 ' + days + ' 天的記錄 ✓');
      switchTab('log');
      return;
    }
    setCloudStatus('✓ 已連結並同步' + (remote ? '：這台裝置和雲端的資料已合併' : '') + (extra.length ? '（' + extra.join('、') + '）' : ''), 'ok');
    showToast('已連結 Google 雲端，之後會自動同步');
  } else {
    setCloudStatus('✓ 已同步（' + fmtTime(c.lastSync) + '）' + (extra.length ? '，' + extra.join('、') : ''), 'ok');
    if (!auto) showToast(changedLocally ? '已同步，資料已更新' : '已同步');
  }
}

function autoSyncOnOpen() {
  const c = state.meta.cloud;
  if (!cloud.isConfigured() || !c.linked || c.auto === false) return;
  if (cloud.getToken()) { cloudRun('sync', { auto: true }); return; }
  if (cloud.isBlockedInAppBrowser()) return;
  // 登入過期：每次開啟最多試一次「不跳畫面」的重新登入
  if (!sessionStorage.getItem('diet_silent_tried')) startSignIn('sync', true);
  else { c.needAuth = true; persistLocal(); renderBanners(); renderSyncChip(); }
}

$('cloudConnectBtn').addEventListener('click', () => cloudRun('connect'));
$('cloudSyncBtn').addEventListener('click', () => cloudRun('sync'));
$('syncChip').addEventListener('click', () => cloudRun('sync'));
$('cloudAutoCheck').addEventListener('change', (e) => { state.meta.cloud.auto = e.target.checked; persistLocal(); renderBanners(); if (e.target.checked) scheduleSync(500); });
$('cloudDisconnectBtn').addEventListener('click', () => {
  openConfirm('中斷 Google 連結', '這台裝置會停止同步。雲端硬碟裡的資料不會刪除，之後重新連結就能繼續使用。', async () => {
    await cloud.revoke();
    cloud.resetCache();
    state.meta.cloud = { linked: false, email: '', auto: true, lastBackup: null, knownModified: null, dirty: false, needAuth: false };
    persistLocal();
    setCloudStatus('');
    renderCloud();
    renderBanners();
    showToast('已中斷 Google 連結');
  }, '中斷連結');
});
setInterval(() => {
  if (document.visibilityState === 'visible' && state.meta.cloud.linked && state.meta.cloud.auto !== false && cloud.getToken()) cloudRun('sync', { auto: true });
}, 60000);

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
  persistLocal();
  applyFontSize();
  showToast('字體：' + FONT_SIZES[state.meta.fontSize].label);
});

/* ---------------- 啟動 ---------------- */
document.querySelectorAll('.range-btn').forEach(b => b.addEventListener('click', () => { ui.trendRange = Number(b.getAttribute('data-range')); renderTrends(); }));

// 桌面捷徑（manifest 的 shortcuts，Android 長按 App 圖示）與網址參數 ?go=water：直接打開那一頁
const GO_SCREENS = {
  quick: 'scr-quick', photo: 'scr-photo', water: 'scr-water', weight: 'scr-weight', sleep: 'scr-sleep',
  food: 'scr-food', manual: 'scr-manual', est: 'scr-est', exercise: 'scr-exercise', note: 'scr-note',
  ai: 'scr-ai', weekly: 'scr-weekly'
};
function openFromUrl() {
  const params = new URLSearchParams(location.search);
  const go = params.get('go');
  if (!go) return;
  // 拿掉參數：重新整理不會又打開，返回鍵回到首頁
  params.delete('go');
  history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  const id = GO_SCREENS[go];
  if (!id || (go === 'ai' && !aiKey())) return;
  ui.date = todayStr();
  renderAll();
  openScreen(id);
}

(async function init() {
  await loadState();
  if (!state.meta.deviceId) { state.meta.deviceId = uid('dev'); persistLocal(); }
  applyFontSize();
  renderAll();
  switchTab('log');
  const redirect = cloud.isConfigured() ? cloud.consumeRedirect() : null;
  if (redirect) {
    if (redirect.silent && redirect.error) {
      state.meta.cloud.needAuth = true; persistLocal(); renderBanners(); renderSyncChip();
    } else if (redirect.error) {
      goToCloudSection(); setCloudStatus(redirect.error, 'err');
    } else {
      if (redirect.action === 'connect') goToCloudSection();
      cloudRun(redirect.action === 'connect' ? 'connect' : 'sync', { auto: Boolean(redirect.silent) });
    }
  } else {
    autoSyncOnOpen();
    if (shouldWelcome()) openScreen('scr-welcome');
    else openFromUrl();
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
    if (document.visibilityState === 'hidden') {
      if (state.meta.cloud.dirty && cloud.getToken()) cloudRun('sync', { auto: true });
      return;
    }
    if (state.meta.cloud.linked && state.meta.cloud.auto !== false) {
      if (cloud.getToken()) cloudRun('sync', { auto: true });
      else if (!state.meta.cloud.needAuth) { state.meta.cloud.needAuth = true; persistLocal(); renderBanners(); renderSyncChip(); }
    }
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
window.__dietApp = { state, ui, dayTotals, lastReportText: () => lastReport && lastReport.text, exportPayload: () => buildPayload() };
