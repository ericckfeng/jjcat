import {
  MEAL_KEYS, MEAL_META, MACRO_KEYS, MACRO_META, EX_KEYS, EX_META, EX_DEFAULT_NUTR,
  EST_PARTS, HUNGER_LABELS, MOOD_OPTIONS, BOWEL_LABELS
} from './nutrition.js';
import { photoDB, sharedDB } from './db.js';
import { REPORT_CSS, buildReportHTML, buildReportText, periodSummary } from './report.js';
import { buildWeekly, lastWeek, weeklyText } from './highlights.js';
import * as cloud from './cloud.js';
import { mergeData, mergeExtras, pickExtras, syncShape, stableStringify, SYNC_VERSION } from './sync.js';
import { MEASURES, MEASURE_META, rollingAverage, weightAvgChange, muscleChange, sumLimbs, calcSmi, smiLow, latestSmi, SMI_CUTOFF, calcBmi, bmiCategory, healthyWeightRange, waistRisk, waistHipRatio, bmiScalePct, SLEEP_QUALITY, sleepQualityLabel, sleepMinutes, fmtDuration, daySleep } from './body.js';
import { mascotSVG, buildMascotMessages, castMessages } from './mascot.js';
import { catSVG, docSVG } from './characters.js';
import { searchFoods, nutrientsFor, cookConversion, baseGrams, GRAM_PRESETS, energyDensity, isGlutinous, kjToKcal, scaleLabel } from './foods.js';
import { sumNutr, copyEntries, mealEntries, mealGap, splitDaily, gapMessage, shouldAskWhen, eatenAt, MEAL_TIME_CHIPS } from './meals.js';
import { buildInsights } from './insights.js';
import { APP_REV, APP_LABEL, parseLatest, requiredRev, minRevToWrite, deviceName, deviceRecord, upsertDevice, deviceRows } from './version.js';
import { customFoodFromForm, formFromCustomFood, servingNutrients, servingKcal, servingText, searchMine, sortByUse, isPerServing, formFromManual } from './myfoods.js';
import { packFromFile, searchPacks, groupHits, packRows, myFoodsFile, isMyFoodsFile, planMyFoodsImport, packsWithMine, looseMine, packFields, packFileWithMine, sharedPlan, withShared, libraryShops, pickShared, toggleShops, LIBRARY_GROUPS, OTHER_GROUP, libraryThanks } from './packs.js';
import { toCsv } from './lookup.js';
import { normalizeBarcode, checkDigitOk, findByBarcode, offUrl, offToForm } from './barcode.js';
import { computeBadges, badgesToShow, newBadges, remainText } from './achievements.js';
import { comboFromCart, resolveCombo, comboTotals, comboSummary, searchCombos, sortCombos } from './combos.js';
import { HAND_REFS, AMOUNTS, LOOKUP_CATS, lookupCat, cleanAmount, amountText, sizeText, estimateLookup, buildLookupCsv, readFilledCsv, lookupMyFoodForm, AI_LOOKUP_PROMPT } from './lookup.js';
import { partyTemplate, startCounts, partyEntries, partyTotals } from './party.js';
import { ACTIVITY, GOALS, PROTEIN, ageFrom, calcBmr, calcTargets, waterGoal, recalcHint, latestInbodyBmr, katchBmr, latestBodyComp, targetWeightFromBodyFat, BODY_FAT_LIMIT } from './targets.js';
import { calorieBank, bankMacros, weekOf } from './bank.js';
import { mealPastePrompt, LABEL_PASTE_PROMPT, mealFromPaste, labelFromPaste, foodDiaryLines, weekReviewPrompt } from './ai.js';
import { brandsOf, mealBudget, suggestMeals } from './eatout.js';
import { wallDays, wallPhotoCount } from './photowall.js';
import { splitAdvice, activeAdvice, todaysAdvice, toggleDone } from './advice.js';
import { FEATURES, featureOn, featuresOff, BADGE_FEATURE } from './features.js';
import { backupReminder, backupText, SNOOZE_DAYS } from './backup.js';
import { normalizeInvite, gateState, cloudInviteFor, needCheck, waitSeconds, addFail, inviteMessage, FEEDBACK_MAX, canSendFeedback, feedbackInfo, feedbackMessage } from './invite.js';
import { INVITE_URL } from './config.js';
import { CONTRIB_PHOTOS, contribFood, contribProblem, contribMessage, maskName, ANON } from './contrib.js';
import { GLUCOSE_KINDS, glucoseKindLabel, bpReading, glucoseReading, bpAlert, glucoseAlert, bpText, glucoseText, vitalsSummary, dailyVitals } from './vitals.js';
import { callGemini, buildRequest, mealPrompt, LABEL_PROMPT, MEAL_SCHEMA, LABEL_SCHEMA, PING_REQUEST, normalizeMeal, aiItemToFood, normalizeLabel, runAiCheck, checkReport, CHECK_KCAL } from './ai.js';

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
  const t = { kcal: 0, p: 0, c: 0, f: 0, fiber: 0, fiberItems: 0, ex: {}, macroItems: 0, exItems: 0, pending: 0, count: list.length, meals: {} };
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
    // 膳食纖維：只有衛福部資料、我的食物有填的記錄才有（fiber），其他記錄不知道
    if (it.fiber != null) { t.fiberItems++; t.fiber += it.fiber || 0; }
    if (it.pending) t.pending++;
  });
  t.p = r1(t.p); t.c = r1(t.c); t.f = r1(t.f); t.fiber = r1(t.fiber);
  EX_KEYS.forEach(k => { t.ex[k] = r1(t.ex[k]); });
  return t;
}

/* ---------------- 狀態與儲存 ---------------- */
const DEFAULT_TARGETS = { kcal: 1800, p: null, c: null, f: null, ex: {}, weight: null };
const state = {
  targets: { ...DEFAULT_TARGETS, ex: {} },
  logs: {},
  days: {},
  quickItems: [],   // 舊版「常吃的」：不再顯示、不再新增，但要原樣保留、照常同步（見 DATA_FORMAT.md）
  customFoods: [],
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
  trendRange: 7,
  bodyMetric: 'weight'
};

// 只存在這支手機（設定、狀態），不需要同步
function persistLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    showError('⚠ 無法儲存，請先下載備份');
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
    persistTimer = null;
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
          for (const k of morePhotoKeys(it)) {
            const src = photoMap[k];
            if (typeof src === 'string' && src.startsWith('data:image')) { await savePhoto(k, src); photos++; }
          }
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
// 畫面下方的提示：字和一般內文一樣大，停 5 秒（有「復原」這類按鈕 7 秒），點一下就關。
// 錯誤（showError）不會自己消失，要按「知道了」，長輩才不會漏看。
let toastTimer = null;
let toastActionFn = null;
function showToast(msg, actionLabel, actionFn, ms, sticky = false) {
  $('toastMsg').textContent = msg;
  $('toast').classList.toggle('toast-err', sticky);
  const btn = $('toastAction');
  if (actionLabel && actionFn) {
    btn.textContent = actionLabel; btn.classList.remove('hidden'); toastActionFn = actionFn;
  } else {
    btn.classList.add('hidden'); toastActionFn = null;
  }
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => $('toast').classList.add('hidden'), ms || (actionFn ? 7000 : 5000));
}
function showError(msg) { showToast(msg, '知道了', () => {}, 0, true); }
$('toastAction').addEventListener('click', (e) => {
  e.stopPropagation();
  if (toastActionFn) toastActionFn();
  toastActionFn = null;
  $('toast').classList.add('hidden');
});
$('toast').addEventListener('click', () => { clearTimeout(toastTimer); toastActionFn = null; $('toast').classList.add('hidden'); });

let pendingConfirm = null;
let pendingCancel = null;
function openConfirm(title, message, onOk, okLabel = '確定', onCancel = null, cancelLabel = '取消') {
  if (typeof pendingCancel === 'function') pendingCancel();
  $('confirmTitle').textContent = title;
  $('confirmMessage').textContent = message;
  $('confirmOkBtn').textContent = okLabel;
  // 刪除、清空這類才用紅色；「加入」「匯入」用綠色，不要嚇到人
  $('confirmOkBtn').classList.toggle('btn-danger', /刪除|清空|移除|中斷|不要了|換掉/.test(okLabel + title));
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
const KCAL_FIELD = { add: 'foodKcalInput', edit: 'editLogKcalInput' };
// step 一律用 any：份數、公克都可能有小數（例如自動算出的 0.7 份），
// 設成 0.5／0.1 的話，瀏覽器會擋下表單，連改名稱都存不了。
function nutrFieldsHTML(prefix) {
  const inp = (id, ph, step) =>
    `<input id="${id}" type="number" inputmode="decimal" min="0" step="${step}" placeholder="${ph}" class="field px-2 py-1.5 min-h-[38px] text-center tabular-nums bg-white" />`;
  return `
    <div class="space-y-2 pt-1">
      <div class="grid grid-cols-3 gap-1.5">
        ${MACRO_KEYS.map(k => `<label class="block"><span class="block text-xs text-stone-600 mb-0.5">${MACRO_META[k].label} (g)</span>${inp(prefix + '-' + k, 'g', 'any')}</label>`).join('')}
      </div>
      <div class="flex items-center justify-between pt-1">
        <span class="text-sm font-semibold text-stone-700">六大類份數</span>
        <button type="button" data-derive="${prefix}" class="derive-btn text-sm font-semibold text-emerald-700 underline py-1">依份數推算熱量／營養素</button>
      </div>
      <div class="grid grid-cols-3 gap-1.5">
        ${EX_KEYS.map(k => `<label class="block"><span class="block text-xs text-stone-600 mb-0.5">${EX_META[k].emoji} ${EX_META[k].short}</span>${inp(prefix + '-ex-' + k, '份', 'any')}</label>`).join('')}
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
$('tgtExFields').innerHTML = EX_KEYS.map(k =>
  `<label class="block"><span class="block text-sm text-stone-600">${EX_META[k].emoji} ${EX_META[k].short}</span><input id="tgt-ex-${k}" type="number" inputmode="decimal" min="0" step="any" placeholder="份" class="field text-center tabular-nums" /></label>`
).join('');

document.addEventListener('click', (e) => {
  const b = e.target.closest('.derive-btn');
  if (!b) return;
  const prefix = b.getAttribute('data-derive');
  const n = readNutrFields(prefix);
  if (!n.ex) { showError('請先填六大類份數'); return; }
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
async function addEntry({ name, nutr, mult = 1, meal, photo = null, morePhotos = [], pending = false, saveMine = false, extra = null }) {
  const s = scaleNutr(nutr, mult);
  const it = {
    id: uid('item'), name: name.trim(), kcal: s.kcal, multiplier: mult, meal, time: nowTime(),
    pending: Boolean(pending), hasPhoto: Boolean(photo), p: s.p, c: s.c, f: s.f, ex: s.ex, updatedAt: now(),
    ...(extra || {})
  };
  if (ui.date !== todayStr()) it.backfill = true;   // 記在過去的日期：時間是記錄的時間，不是吃的時間
  if (photo) await savePhoto(it.id, photo);
  if (photo && morePhotos.length) {
    it.morePhotos = [];
    for (const src of morePhotos) { const k = newPhotoKey(it.id); await savePhoto(k, src); it.morePhotos.push(k); }
  }
  (state.logs[ui.date] || (state.logs[ui.date] = [])).push(it);
  // saveMine：true 或來源字串（'ai-label'＝AI 讀營養標示）
  let mineNote = '';
  if (saveMine) mineNote = saveAsMyFood(formFromManual({ name: it.name, nutr, label: it.label, grams: it.grams, mult }), saveMine);
  persist();
  renderAll();
  const hint = gapHint(it.meal);
  showToast('已加入「' + it.name + '」(' + it.kcal + ' kcal)' + mineNote + hint, null, null, hint || mineNote ? 6000 : 0);
  askWhen([it]);
}
async function deleteEntry(id) {
  const list = state.logs[ui.date] || [];
  const idx = list.findIndex(i => i.id === id);
  if (idx === -1) return;
  const [item] = list.splice(idx, 1);
  const date = ui.date;
  const photo = item.hasPhoto ? await getPhoto(item.id) : null;
  const more = [];
  for (const k of morePhotoKeys(item)) more.push([k, await getPhoto(k)]);
  await deleteEntryPhotos(item);
  tombstone('e:' + item.id);
  persist();
  renderAll();
  showToast('已刪除「' + item.name + '」', '復原', async () => {
    if (photo) await savePhoto(item.id, photo);
    for (const [k, src] of more) if (src) await savePhoto(k, src);
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
    html = '<p class="text-sm text-stone-500">提示：在右上「目標」填入營養師給的三大營養素／六大類份數，這裡會顯示每日進度。</p>';
  }
  if (t.macroItems && t.macroItems < t.count) {
    html += `<p class="text-sm text-stone-500">營養素只計入有填的 ${t.macroItems}/${t.count} 筆</p>`;
  }
  if (t.pending) {
    html += `<p class="text-base font-semibold text-amber-800">⚠ 有 ${t.pending} 筆「暫估待修」，記得對照照片修正</p>`;
  }
  $('summaryNutr').innerHTML = html;
}
function meterHTML(label, val, target, unit, bar) {
  const v = r1(val || 0);
  const pct = target ? Math.min(100, v / target * 100) : 0;
  const over = target && v > target * 1.1;
  return `<div class="bg-stone-50 rounded-xl p-2">
    <div class="text-xs text-stone-600 leading-tight">${label}</div>
    <div class="text-sm font-bold tabular-nums ${over ? 'text-rose-600' : 'text-stone-800'}">${fmt(v, 1)}${target ? `<span class="font-normal text-stone-400"> / ${fmt(target, 1)}</span>` : ''}<span class="font-normal text-stone-400 text-[0.625rem]"> ${unit}</span></div>
    ${target ? `<div class="mt-1 h-1.5 rounded-full bg-stone-200 overflow-hidden"><div class="h-full rounded-full ${over ? 'bg-rose-500' : bar}" style="width:${pct}%"></div></div>` : ''}
  </div>`;
}

function renderMealSelector() {
  document.querySelectorAll('.meal-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.getAttribute('data-meal') === ui.meal);
  });
}

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
// 糯米類提醒（設定「我在控制血糖」才顯示）
const sugarCare = () => Boolean(state.profile.sugarCare);
function glutinousBadge(food) {
  return sugarCare() && isGlutinous(food) ? '<span data-glutinous class="inline-block mt-1 mr-1 px-2 py-0.5 rounded-md bg-sky-100 text-sky-900 text-sm font-semibold">糯米類・升糖較快</span>' : '';
}
// 熱量密度高的小標籤（每公克 3 大卡以上）
function densityBadge(d) {
  return d && d.high ? `<span data-density class="inline-block mt-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-sm font-semibold">熱量密度高・每公克 ${d.perG} 大卡</span>` : '';
}
function foodRowHTML(food) {
  const kcal = Math.round(food.per100g.kcal);
  return `<button type="button" data-food-id="${esc(food.id)}" class="pick-row">
    <span class="min-w-0 flex-1 text-left"><span class="block text-lg font-semibold text-stone-900 leading-snug break-words">${esc(food.name)}</span>
    ${food.note ? `<span class="block text-sm text-stone-500 break-words">${esc(food.note)}</span>` : ''}
    <span class="block text-base text-emerald-700 font-bold tabular-nums">每 100 g　${kcal} kcal</span>
    ${glutinousBadge(food)}${densityBadge(energyDensity(food))}</span>
    <span class="pick-add">選擇 ›</span>
  </button>`;
}
async function renderFoodResults() {
  const box = $('foodResults');
  const q = $('foodSearch').value.trim();
  renderFoodFilter();
  if (foodFilter === '' || foodFilter === 'mine') renderFoodMine(q); else $('foodMine').innerHTML = '';
  renderFoodPacks(q);
  if (foodFilter !== '' && foodFilter !== 'tfda') {
    // 只查我的食物或某個資料庫：不列衛福部資料
    $('foodSource').textContent = '';
    const none = q && !$('foodMine').innerHTML && !$('foodPacks').innerHTML;
    box.innerHTML = none ? `<div class="rounded-2xl border border-dashed border-stone-300 p-6 text-center text-base text-stone-500">找不到「${esc(q)}」，可以按上面的「全部」再找一次</div>` : '';
    return;
  }
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
    box.innerHTML = foodMode === 'mine' ? '' : '<div class="text-base text-stone-500 leading-relaxed py-2">輸入食物名稱就會列出來。<br>這裡是生鮮食材和常見食品；便當、小吃可以存成「我的食物」，或用「自己輸入」。</div>';
    return;
  }
  const results = searchFoods(foodDB.foods, q, { limit: 30, now: new Date() });
  if (results.length) box.innerHTML = '<div class="sec-title px-1 pt-2">衛福部食品資料庫</div>' + results.map(r => foodRowHTML(r.food)).join('');
  else if (searchMine(myLoose(), q).length || $('foodPacks').innerHTML) box.innerHTML = '';
  else {
    box.innerHTML = `<div class="rounded-2xl border border-dashed border-stone-300 p-6 text-center text-base text-stone-500 space-y-3">
      <div>資料庫裡找不到「${esc(q)}」</div>
      <div class="text-sm">換個說法試試（例如「雞胸」「甘藷」），<br>或用「自己輸入」記錄。</div>
      <button type="button" data-screen="scr-manual" class="btn-secondary w-full">✏️ 自己輸入</button>
      <button type="button" data-mf-new class="btn-secondary w-full">⭐ 新增成我的食物</button></div>`;
  }
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
  foodMode = 'all';
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
  const first = isPerServing(food) ? 1 : (food.serving && food.serving.g) || 100;
  $('gramsInput').value = String(cartItem ? cartItem.grams : first);
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
  const byServing = isPerServing(food);
  const mine = isMine(food);
  const pk = foodPack.get(food);
  $('gramsFoodName').textContent = (food.brand ? food.brand + ' ' : '') + food.name;
  $('gramsFoodNote').textContent = [food.note, mine ? '我的食物・一份 ' + servingText(food) + ' ' + servingKcal(food) + ' kcal' : '',
    pk ? '一份 ' + servingText(food) + ' ' + servingKcal(food) + ' kcal' : '',
    byServing ? '' : '每 100 g ' + Math.round(food.per100g.kcal) + ' kcal',
    pk ? '資料來源：' + (food.source || pk.name) : ''].filter(Boolean).join('・');
  $('gramsLabel').textContent = byServing ? '吃了幾份' : '幾公克（g）';
  $('gramsCookWrap').classList.toggle('hidden', !conv);
  if (conv) {
    const rice = conv.factor > 1;
    $('gramsRawBtn').textContent = rice ? '生米' : '生的';
    $('gramsCookedBtn').textContent = rice ? '煮好的飯' : '煮熟的';
    $('gramsRawBtn').classList.toggle('is-active', gramsDraft.weighed !== 'cooked');
    $('gramsCookedBtn').classList.toggle('is-active', gramsDraft.weighed === 'cooked');
  }
  const sg = !byServing && food.serving && food.serving.g;
  $('gramsPresets').innerHTML = (byServing
    ? [0.5, 1, 1.5, 2, 3].map(v => `<button type="button" data-grams-set="${v}" class="chip-btn chip-lg">${v} 份</button>`)
    : [
      ...(sg ? [0.5, 1, 2].map(m => `<button type="button" data-grams-set="${Math.round(sg * m * 10) / 10}" class="chip-btn chip-lg">${m === 0.5 ? '半' : m} 份 ${Math.round(sg * m * 10) / 10}g</button>`) : []),
      ...GRAM_PRESETS.map(p => `<button type="button" data-grams-set="${p.g}" class="chip-btn chip-lg">${p.label} ${p.g}g</button>`),
      '<button type="button" data-grams-add="10" class="chip-btn chip-lg">+10g</button>',
      '<button type="button" data-grams-add="-10" class="chip-btn chip-lg">−10g</button>'
    ]).join('');
  $('gramsSaveBtn').textContent = gramsDraft.cartKey ? '改好了' : '加入這一餐';
  const g = gramsValue();
  const box = $('gramsResult');
  if (!g) { box.innerHTML = '<div class="text-base text-stone-500">' + (byServing ? '請輸入幾份' : '請輸入公克數') + '</div>'; $('gramsSaveBtn').disabled = true; return; }
  $('gramsSaveBtn').disabled = false;
  const n = byServing ? servingNutrients(food, g) : nutrientsFor(food, g, gramsDraft.weighed);
  const cooked = conv && gramsDraft.weighed === 'cooked';
  const macro = (k, label) => `<div class="bg-stone-50 rounded-xl p-2 text-center"><div class="text-sm text-stone-500">${label}</div><div class="text-lg font-bold text-stone-800 tabular-nums">${n[k] == null ? '—' : n[k] + ' g'}</div></div>`;
  const ex = n.ex ? Object.entries(n.ex).map(([k, v]) => `${EX_META[k].emoji} ${EX_META[k].short} ${v} 份`).join('、') : '';
  box.innerHTML = `
    <div class="text-center"><span class="text-4xl font-bold text-emerald-700 tabular-nums">${n.kcal}</span> <span class="text-lg text-stone-600">kcal</span></div>
    ${cooked ? `<div class="text-sm text-stone-500 text-center">熟重 ${g} g ≈ ${conv.factor > 1 ? '生米' : '生重'} ${Math.round(baseGrams(food, g, 'cooked'))} g（${esc(conv.label)}）</div>` : ''}
    <div class="grid grid-cols-3 gap-2">${macro('p', '蛋白質')}${macro('f', '脂肪')}${macro('c', '碳水')}</div>
    ${n.fiber != null ? `<div class="text-base text-stone-700">膳食纖維 ${n.fiber} g</div>` : ''}
    <div class="text-base text-stone-700">${ex ? '六大類：' + ex : '<span class="text-stone-500">' + (mine || pk ? '沒有填六大類份數' : '這類食物無法換算六大類份數') + '</span>'}</div>
    ${sugarCare() && isGlutinous(food) ? '<div data-glutinous class="rounded-xl bg-sky-50 text-sky-900 p-2 text-base leading-relaxed">糯米類：支鏈澱粉多，血糖上升比較快。份量少一點，搭配青菜和蛋白質一起吃。</div>' : ''}
    ${byServing ? '' : (() => { const d = energyDensity(food, n.kcal / g); return d && d.high ? `<div data-density class="rounded-xl bg-amber-50 text-amber-900 p-2 text-base leading-relaxed">熱量密度高：每公克 ${d.perG} 大卡，一小份熱量就很多，份量要留意。</div>` : ''; })()}`;
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
let foodCart = [];   // [{ key, food, grams, weighed, entry, comboId }]
let cartCombo = null; // 最後放進購物車的套餐（存成套餐時預填名稱，同名就是更新它）
// 食物資料庫的食物：記下是哪個資料庫的哪一樣，和資料庫名稱（快照，資料庫刪掉也還在）
function packLink(food, pk) {
  return { src: pk.id, srcName: pk.name + (food.source && food.source !== pk.name ? '・' + food.source : ''), packFoodId: food.id };
}
// 我的食物：記 customFoodId；自己加到資料庫的，也記是哪個資料庫（報告的「資料來源」）
function mineLink(food, entry) {
  entry.customFoodId = food.id;
  const pk = food.packId && allPacks().find(p => p.id === food.packId);
  if (pk) Object.assign(entry, { src: pk.id, srcName: pk.name });
}
function cartEntryFor(food, g, weighed) {
  const pk = foodPack.get(food);
  const label = food.brand ? food.brand + ' ' + food.name : food.name;
  if (isPerServing(food)) {
    const n = servingNutrients(food, g);
    const entry = { name: label + ' ' + fmt(g, 1) + ' 份', kcal: n.kcal, p: n.p, c: n.c, f: n.f, ex: n.ex, servings: g };
    if (isMine(food)) mineLink(food, entry);
    else if (pk) Object.assign(entry, packLink(food, pk));
    else if (food.id) entry.customFoodId = food.id;
    if (n.fiber != null) entry.fiber = n.fiber;
    return { weighed: 'asis', entry };
  }
  const cooked = Boolean(cookConversion(food)) && weighed === 'cooked';
  const n = nutrientsFor(food, g, cooked ? 'cooked' : 'asis');
  const entry = {
    name: label + ' ' + g + 'g' + (cooked ? '（熟重）' : ''),
    kcal: n.kcal, p: n.p, c: n.c, f: n.f, ex: n.ex, grams: g
  };
  if (isMine(food)) mineLink(food, entry);
  else if (pk) Object.assign(entry, packLink(food, pk));
  else if (food.id) entry.foodId = food.id;
  if (n.fiber != null) entry.fiber = n.fiber;
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
  if (!has) { box.innerHTML = ''; cartCombo = null; return; }
  const t = sumNutr(foodCart.map(c => c.entry));
  box.innerHTML = `<div class="text-base font-bold text-emerald-900">這一餐已選 ${foodCart.length} 樣</div>
    <ul class="space-y-2">${foodCart.map(c => `<li class="flex items-center gap-2 bg-white rounded-xl border border-emerald-100 p-2">
      <span class="min-w-0 flex-1"><span class="block text-base font-semibold text-stone-900 leading-snug break-words">${esc(c.entry.name)}</span>
      <span class="block text-sm text-emerald-700 font-bold tabular-nums">${c.entry.kcal} kcal</span></span>
      <button type="button" data-cart-edit="${c.key}" class="chip-btn chip-lg shrink-0">改</button>
      <button type="button" data-cart-del="${c.key}" class="chip-btn chip-lg shrink-0" aria-label="拿掉">✕</button>
    </li>`).join('')}</ul>
    <div class="text-base text-stone-800"><span class="font-bold tabular-nums">合計 ${t.kcal} kcal</span>${macroText(t) ? '<br><span class="text-sm text-stone-600">' + esc(macroText(t)) + '</span>' : ''}</div>
    ${foodCart.length > 1 ? '<button type="button" data-cart-combo class="btn-secondary w-full">🍱 這幾樣存成套餐</button>' : ''}`;
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
  } else if (e.target.closest('[data-cart-combo]')) openCombo(null);
});
$('gramsSaveBtn').addEventListener('click', () => {
  const food = gramsDraft.food;
  const g = gramsValue();
  if (!food || !g) { showError(isPerServing(food) ? '請輸入幾份' : '請輸入公克數'); return; }
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
  const items = foodCart;
  foodCart = [];
  saveGroup(items);
  renderFoodCart();
}
// 一次記好幾樣到目前這一餐（查食物的購物車、舊的吃到飽速記）：每樣一筆，2 樣以上用 groupId 標成同一組
function saveGroup(items) {
  const meal = ui.meal;
  const date = ui.date;
  const groupId = items.length > 1 ? uid('grp') : null;
  const time = nowTime();
  const photos = [];
  const added = items.map(c => {
    const it = {
      id: uid('item'), multiplier: 1, meal, time, pending: false, hasPhoto: Boolean(c.photo),
      ...c.entry, ex: cleanEx(c.entry.ex), updatedAt: now()
    };
    if (groupId) it.groupId = groupId;
    if (c.comboId) it.comboId = c.comboId;   // 從哪個套餐放進來的（套餐依最近用的排序）
    if (date !== todayStr()) it.backfill = true;
    if (c.photo) photos.push([it.id, c.photo]);
    return it;
  });
  photos.forEach(([id, photo]) => savePhoto(id, photo));
  (state.logs[date] || (state.logs[date] = [])).push(...added);
  persist();
  renderAll();
  const total = sumNutr(added).kcal;
  const hint = gapHint(meal);
  showToast('已記到' + MEAL_META[meal].label + '：' + added.length + ' 樣、' + total + ' kcal' + hint, '復原', () => {
    const ids = new Set(added.map(a => a.id));
    state.logs[date] = (state.logs[date] || []).filter(it => !ids.has(it.id));
    added.forEach(a => tombstone('e:' + a.id));
    persist();
    renderAll();
  }, hint ? 8000 : 0);
  askWhen(added);
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
  el.style.zIndex = String(45 + screenStack.length);   // 後打開的疊在上面（不看 HTML 裡的順序）
  history.pushState({ screen: id }, '');
  document.body.style.overflow = 'hidden';
  el.querySelector('.scr-body').scrollTop = 0;
  renderMealSelector();
  renderDayPanel();
  if (id === 'scr-food') { foodFilter = ''; $('foodSearch').value = ''; $('foodTitle').textContent = foodMode === 'mine' ? '⭐ 我的食物' : '🔍 查食物'; $('eatoutOpenBtn').classList.toggle('hidden', !brandsOf(pickedPacks()).length); renderFoodResults(); renderFoodCart(); }
  if (id === 'scr-eatout') openEatout();
  if (id === 'scr-move') { moveTarget = null; $('moveNewName').value = ''; $('moveBrand').value = ''; renderMove(); }
  if (id === 'scr-grams') renderGrams();
  if (id === 'scr-est') renderEst();
  if (id === 'scr-weight') renderWeightHint();
  if (id === 'scr-bodycomp') { bcDate = ui.date; renderBodyComp(); }
  if (id === 'scr-water') renderWaterBig();
  if (id === 'scr-calc') { initCalc(); renderCalc(); }
  if (id === 'scr-mealex') renderMealEx();
  if (id === 'scr-settings') renderSettings();
  if (id === 'scr-profile') renderProfileScreen();
  if (id === 'scr-targets') fillTargetFields();
  if (id === 'scr-features') renderFeatures();
  if (id === 'scr-about') { renderAbout(); checkLatest(true); }
  if (id === 'scr-feedback') renderFeedback();
  if (id === 'scr-library') { setBox('libCheckNote', null, ''); renderLibrary(); }
  if (id === 'scr-data') { renderCloud(); renderBackupInfo(); }   // 關掉自動同步的人也要看得到雲端區塊
  if (id === 'scr-weekly') renderWeekly();
  if (id === 'scr-badges') renderBadges();
  if (id === 'scr-bp') { ['bpSys', 'bpDia', 'bpPulse'].forEach(x => { $(x).value = ''; }); $('bpTime').value = ui.date === todayStr() ? nowTime() : ''; setBox('bpNote', null, ''); renderBp(); }
  if (id === 'scr-glucose') { $('glValue').value = ''; $('glTime').value = ui.date === todayStr() ? nowTime() : ''; setBox('glNote', null, ''); renderGlucose(); }
  if (id === 'scr-advice') { $('advicePaste').value = ''; $('adviceDate').value = todayStr(); $('adviceFrom').value = state.meta.adviceFrom || ''; adviceDraft = []; renderAdviceDraft(); setBox('adviceNote', null, ''); renderAdviceScreen(); }
  if (id === 'scr-photowall') { wallMonday = weekOf(ui.date)[0]; renderPhotoWall(); }
  if (id === 'scr-exercise') renderStepsGoal();
  if (id === 'scr-ai') { resetAi(); ['aiFallbackBtn', 'aiPasteFallbackBtn', 'aiPasteWrap'].forEach(x => $(x).classList.add('hidden')); $('aiPasteText').value = ''; }
  if (id === 'scr-manual') { setBox('add-lb-note', null, ''); manualBarcode = ''; }
  if (id === 'scr-aikey') renderAiKey();
  if (id === 'scr-sleep') renderSleepScreen();
  if (id === 'scr-photo') resetPhotoQuick();
  if (id === 'scr-lookup') { renderLookup(); setBox('lookupNote', null, ''); }
}
function hideTopScreen() {
  const id = screenStack.pop();
  if (id) $(id).classList.add('hidden');
  if (!screenStack.length) document.body.style.overflow = '';
  if (id === 'scr-food') askUnsavedCart();
  // 從體重頁去填體脂機報告：回來時更新體重和 BMI（同一天的體重可能改了）
  if (id === 'scr-bodycomp' && screenStack[screenStack.length - 1] === 'scr-weight') { renderDayPanel(); renderBmiCard(); }
  // 從試算頁去填體脂機報告，回來時更新基礎代謝的選項
  if (id === 'scr-bodycomp' && screenStack[screenStack.length - 1] === 'scr-calc') {
    calcDraft.inbody = latestInbodyBmr(state.days, todayStr());
    calcDraft.comp = latestBodyComp(state.days, todayStr());
    if (calcDraft.bmrSrc === 'formula') calcDraft.bmrSrc = calcDraft.inbody ? 'inbody' : calcDraft.comp ? 'ffm' : 'formula';
    renderCalc();
  }
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

// 功能開關：關掉的格子不顯示；「記錄身體」全部關掉就整區不出現
function renderFeatureTiles() {
  let any = false;
  document.querySelectorAll('[data-feature]').forEach(el => {
    const on = featureOn(state.profile, el.getAttribute('data-feature'));
    el.classList.toggle('hidden', !on);
    if (on) any = true;
  });
  $('bodySection').classList.toggle('hidden', !any);
  const d = getDay(ui.date, false);
  const bp = Array.isArray(d.bp) ? d.bp : [];
  const gl = Array.isArray(d.glucose) ? d.glucose : [];
  const lastBp = bp[bp.length - 1], lastGl = gl[gl.length - 1];
  $('tileBp').textContent = lastBp ? lastBp.sys + '/' + lastBp.dia + (bp.length > 1 ? '（量了 ' + bp.length + ' 次）' : '') : '還沒量';
  $('tileGlucose').textContent = lastGl ? glucoseKindLabel(lastGl.kind) + ' ' + lastGl.v + (gl.length > 1 ? '（' + gl.length + ' 次）' : '') : '還沒量';
}
function renderTiles() {
  renderFeatureTiles();
  const d = getDay(ui.date, false);
  const ts = daySleep(d);
  const parts = [];
  if (ts.night) parts.push('昨晚 ' + fmtDuration(ts.night) + (ts.quality ? '・' + sleepQualityLabel(ts.quality) : ''));
  if (ts.nap) parts.push('補眠 ' + fmtDuration(ts.nap));
  $('tileSleep').textContent = parts.length ? parts.join('　') : '記一下昨晚睡多久';
  const b = calcBmi(d.weight, state.profile.height);
  $('tileWeight').textContent = d.weight != null ? d.weight + ' 公斤' + (b ? '・BMI ' + b : '') : '還沒量';
  const wg = dayWaterGoal(ui.date);
  const lbc = lastBodyCompDate();
  $('tileBodyComp').textContent = lbc ? '上次 ' + fmtMD(lbc) + ' 量的' : 'InBody、健身房或家用體脂機';
  $('tileWater').textContent = wg
    ? (d.water || 0) + ' / ' + wg + ' ml' + ((d.water || 0) >= wg ? ' ✓' : '')
    : (d.water || 0) + ' ml' + (d.water ? '（約 ' + r1(d.water / 250) + ' 杯）' : '');
  const exTxt = d.exercise || d.exMin ? (d.exercise || '運動') + (d.exMin ? ' ' + d.exMin + ' 分' : '') : '';
  const stepTxt = num(d.steps) ? fmt(num(d.steps)) + ' 步' + (state.targets.steps ? (num(d.steps) >= state.targets.steps ? ' ✓' : ' / ' + fmt(state.targets.steps)) : '') : '';
  $('tileExercise').textContent = [stepTxt, exTxt].filter(Boolean).join('・') || (state.targets.steps ? '目標 ' + fmt(state.targets.steps) + ' 步' : '還沒記');
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
// 四肢骨骼肌指數 SMI（肌少症篩檢）：在體脂機報告頁顯示
function renderSmi() {
  const asm = num(getDay(bcDate, false).asm);
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
  $('bcAsm').value = sum;
  setDayField('asm', sum, bcDate);
  renderBcInfo();
}));

/* ---------------- 📊 體脂機報告（一頁填完一張報表；可以選量的日期） ---------------- */
const BC_FIELDS = ['bodyFat', 'smm', 'bmr', 'asm', 'vfl', 'vfa', 'pa', 'ecw'];
let bcDate = todayStr();
// 最近一次量體脂機的日期（首頁按鈕的副標題）
function lastBodyCompDate() {
  return Object.keys(state.days).filter(d => d <= todayStr() && BC_FIELDS.some(f => num(state.days[d][f]) != null)).sort().pop() || null;
}
function renderBodyComp() {
  $('bcDate').value = bcDate;
  $('bcDate').max = todayStr();
  const d = getDay(bcDate, false);
  document.querySelectorAll('[data-bc]').forEach(el => {
    if (el === document.activeElement) return;
    const v = d[el.getAttribute('data-bc')];
    el.value = v == null ? '' : v;
  });
  document.querySelectorAll('[data-limb]').forEach(x => { x.value = ''; });
  renderBcInfo();
}
// 有體重＋體脂率就算去脂體重和估計的基礎代謝；四肢肌肉量算 SMI
function renderBcInfo() {
  const d = getDay(bcDate, false);
  const w = num(d.weight), bf = num(d.bodyFat);
  const info = $('bcInfo');
  if (w && bf && bf < 70) {
    const ffm = r1(w * (1 - bf / 100));
    info.textContent = '去脂體重（肌肉、骨骼、水分）約 ' + ffm + ' 公斤，依此估計基礎代謝約 ' + katchBmr(ffm).toLocaleString() + ' kcal' + (num(d.bmr) ? '（報表上是 ' + num(d.bmr).toLocaleString() + '）' : '') + '。';
    info.classList.remove('hidden');
  } else info.classList.add('hidden');
  renderSmi();
}
document.querySelectorAll('[data-bc]').forEach(el => el.addEventListener('input', () => {
  setDayField(el.getAttribute('data-bc'), num(el.value), bcDate);
  renderBcInfo();
}));
$('bcDate').addEventListener('change', () => {
  const v = $('bcDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v > todayStr()) { $('bcDate').value = bcDate; return; }
  bcDate = v;
  renderBodyComp();
});

function renderBmiCard() {
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
// 步數：和醫生、營養師給的下限比
function renderStepsGoal() {
  const steps = num(getDay(ui.date, false).steps);
  const goal = state.targets.steps;
  const el = $('stepsGoalText');
  if (!goal) { el.className = 'text-base leading-relaxed text-stone-600'; el.textContent = '醫生或營養師有給「每天至少走幾步」的話，可以填在右上 ⚙️ 設定 → 每日目標。'; return; }
  el.className = 'text-base leading-relaxed font-semibold ' + (steps >= goal ? 'text-emerald-700' : 'text-stone-700');
  el.textContent = steps == null ? '每天至少走 ' + fmt(goal) + ' 步' : steps >= goal ? '✓ 達到每天 ' + fmt(goal) + ' 步了，很棒！' : '每天至少 ' + fmt(goal) + ' 步，還差 ' + fmt(goal - steps) + ' 步，飯後散步一下 🚶';
}
$('daySteps').addEventListener('input', () => setTimeout(renderStepsGoal, 0));

/* 拍照記 */
/* ---------------- 拍照記・待查 ---------------- */
// 拍照（最多 3 張）＋用手比大小＋數量；選了類別就先粗估，記成「待查」（pending）。之後在待查清單補。
const pq = { ref: null, amt: null, n: 1, cat: null };
function resetPhotoQuick() {
  formPhotos.pq = [];
  Object.assign(pq, { ref: null, amt: null, n: 1, cat: null });
  $('photoQuickName').value = '';
  $('photoQuickKcal').value = '';
  $('pqAmtOther').value = '';
  renderPhotoQuick();
}
function pqLookup() {
  const lk = {};
  if (pq.ref) lk.ref = pq.ref;
  if (pq.amt) lk.amt = pq.amt;
  if (pq.n !== 1) lk.n = pq.n;
  if (pq.cat) lk.cat = pq.cat;
  return Object.keys(lk).length ? lk : null;
}
function renderPhotoQuick() {
  renderPhotoStrip('pq');
  const has = formPhotos.pq.length > 0;
  $('pq-photos').classList.toggle('hidden', !has);
  $('photoQuickShoot').classList.toggle('hidden', has);
  $('pqRefs').innerHTML = HAND_REFS.map(r => `<button type="button" data-pq-ref="${r.id}" class="toggle-btn ref-btn${pq.ref === r.id ? ' is-active' : ''}"><span class="ref-ic">${r.icon}</span><span>${r.label}</span><span class="ref-hint">${r.hint}</span></button>`).join('');
  $('pqAmts').innerHTML = AMOUNTS.map(a => `<button type="button" data-pq-amt="${a.v}" class="toggle-btn${pq.amt && Math.abs(pq.amt - a.v) < 0.001 ? ' is-active' : ''}">${a.t}</button>`).join('');
  $('pqN').textContent = amountText(pq.n);
  $('pqCats').innerHTML = LOOKUP_CATS.map(c => `<button type="button" data-pq-cat="${c.id}" class="toggle-btn justify-start text-left${pq.cat === c.id ? ' is-active' : ''}">${c.icon} ${c.label}</button>`).join('')
    + `<button type="button" data-pq-cat="" class="toggle-btn${pq.cat ? '' : ' is-active'}">不確定</button>`;
  const est = estimateLookup(pqLookup());
  const box = $('pqEst');
  box.classList.toggle('hidden', !est && !pq.cat);
  box.textContent = est
    ? '粗估約 ' + est.kcal + ' 大卡（' + sizeText(pqLookup()) + '）。會標成「待查」，之後再查正確的。'
    : pq.cat ? '再選「多大」，就能先粗估熱量。' : '';
}
$('scr-photo').addEventListener('click', (e) => {
  const ref = e.target.closest('[data-pq-ref]');
  if (ref) { const id = ref.getAttribute('data-pq-ref'); pq.ref = pq.ref === id ? null : id; if (pq.ref && !pq.amt) pq.amt = 1; renderPhotoQuick(); return; }
  const amt = e.target.closest('[data-pq-amt]');
  if (amt) { pq.amt = Number(amt.getAttribute('data-pq-amt')); $('pqAmtOther').value = ''; if (!pq.ref) pq.ref = 'fist'; renderPhotoQuick(); return; }
  const cat = e.target.closest('[data-pq-cat]');
  if (cat) { pq.cat = cat.getAttribute('data-pq-cat') || null; renderPhotoQuick(); }
});
$('pqAmtOther').addEventListener('input', (e) => {
  const v = cleanAmount(e.target.value);
  if (v) { pq.amt = v; if (!pq.ref) pq.ref = 'fist'; }
  renderPhotoQuick();
});
$('pqMinus').addEventListener('click', () => { pq.n = Math.max(1, pq.n - 1); renderPhotoQuick(); });
$('pqPlus').addEventListener('click', () => { pq.n = Math.min(20, pq.n + 1); renderPhotoQuick(); });
$('photoQuickShoot').addEventListener('click', () => $('photoQuickInput').click());
$('photoQuickSave').addEventListener('click', async () => {
  const name = $('photoQuickName').value.trim();
  const kcal = num($('photoQuickKcal').value);
  const photos = formPhotos.pq.map(p => p.src);
  const lk = pqLookup();
  if (!photos.length && !name && kcal == null && !lk) { showError('請先拍照，或寫下吃了什麼'); return; }
  const est = kcal == null ? estimateLookup(lk) : null;
  const cat = lk && lookupCat(lk.cat);
  await addEntry({
    name: name || (cat ? '待查・' + cat.label : MEAL_META[ui.meal].label + '拍照待查'),
    nutr: est || { kcal: kcal || 0 }, meal: ui.meal,
    photo: photos[0] || null, morePhotos: photos.slice(1), pending: kcal == null,
    extra: lk ? { lookup: lk } : null
  });
  resetPhotoQuick();
  closeScreen();
});

/* ---------------- 待查清單 ---------------- */
function pendingRows() {
  const rows = [];
  Object.keys(state.logs).sort().forEach(date => (state.logs[date] || []).forEach(it => { if (it.pending) rows.push({ date, it }); }));
  return rows;
}
function renderLookupTile() {
  const n = pendingRows().length;
  $('lookupTile').classList.toggle('hidden', !n);
  $('lookupTileT').textContent = '還有 ' + n + ' 筆待查';
}
function renderLookup() {
  const rows = pendingRows();
  $('lookupList').innerHTML = rows.length ? rows.map(({ date, it }) => {
    const size = sizeText(it.lookup);
    return `<button type="button" data-lookup-edit="${esc(date)}|${esc(it.id)}" class="pick-row">
      ${it.hasPhoto ? `<img data-photo-id="${esc(it.id)}" alt="" class="w-16 h-16 rounded-xl object-cover border border-stone-200 bg-stone-100 shrink-0" />` : ''}
      <span class="min-w-0 flex-1 text-left">
        <span class="block text-lg font-semibold text-stone-900 break-words">${esc(it.name)}</span>
        <span class="block text-base text-stone-500">${esc(fmtMD(date))} ${MEAL_META[it.meal].label}${size ? '・' + esc(size) : ''}</span>
        <span class="block text-base text-amber-800 tabular-nums">${it.kcal ? '目前估 ' + it.kcal + ' 大卡' : '還沒有熱量'}</span>
      </span>
      <span class="pick-add">修改</span></button>`;
  }).join('') : '<p class="rounded-2xl bg-emerald-50 text-emerald-900 p-4 text-lg">👍 沒有待查的記錄了</p>';
  hydratePhotos($('lookupList'));
  $('lookupExportBtn').disabled = !rows.length;
}
$('lookupList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lookup-edit]');
  if (!b) return;
  const [date, id] = b.getAttribute('data-lookup-edit').split('|');
  ui.date = date;
  renderAll();
  openEditModal(id);
});
// 照片檔名：編號_第幾張.jpg（AI、營養師對照表格用）
async function lookupFiles() {
  const rows = pendingRows();
  const files = [];
  const csvRows = [];
  for (const { date, it } of rows) {
    const names = [];
    const srcs = await entryPhotos(it);
    srcs.forEach((src, i) => {
      const name = it.id + '_' + (i + 1) + '.jpg';
      names.push(name);
      files.push(new File([dataUrlToBlob(src)], name, { type: 'image/jpeg' }));
    });
    csvRows.push({ id: it.id, date, meal: MEAL_META[it.meal].label, name: it.name, lookup: it.lookup, kcal: it.kcal, photos: names });
  }
  const csvName = '待查表_' + todayStr() + '.csv';
  files.unshift(new File([buildLookupCsv(csvRows)], csvName, { type: 'text/csv' }));
  return files;
}
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg' });
}
$('lookupExportBtn').addEventListener('click', async () => {
  const files = await lookupFiles();
  // 手機：用分享（可以直接傳到 LINE、Email、ChatGPT）；電腦：一個一個下載
  try {
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title: '待查表' });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    await new Promise(r => setTimeout(r, 300));   // 連續下載太快，瀏覽器會擋
  }
  showToast('已下載待查表和 ' + (files.length - 1) + ' 張照片');
});
$('lookupPromptBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(AI_LOOKUP_PROMPT); showToast('已複製，貼給 AI 時連同表格和照片一起傳'); }
  catch (e) { $('lookupPaste').value = AI_LOOKUP_PROMPT; showError('無法自動複製，說明放在下面的框框裡，請自己複製'); }
});
$('lookupFileBtn').addEventListener('click', () => $('lookupFileInput').click());
$('lookupFileInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  // Excel 另存的 CSV 可能是 Big5
  if (text.includes('�')) { try { text = new TextDecoder('big5').decode(buf); } catch (err) { /* 不支援就用原本的 */ } }
  $('lookupPaste').value = text;
  importLookup();
});
$('lookupImportBtn').addEventListener('click', importLookup);
function findEntry(id) {
  for (const [date, list] of Object.entries(state.logs)) {
    const it = (list || []).find(x => x.id === id);
    if (it) return { date, it };
  }
  return null;
}
function importLookup() {
  const { items, error } = readFilledCsv($('lookupPaste').value);
  if (error) { setBox('lookupNote', 'err', error); return; }
  const found = [];
  const missing = [];
  items.forEach(row => { const hit = findEntry(row.id); if (hit) found.push({ row, ...hit }); else missing.push(row.id); });
  if (!found.length) { setBox('lookupNote', 'err', '表格裡的編號都對不到這台的記錄（可能已經刪掉了）。'); return; }
  const list = found.map(({ row, it }) => '・' + (row.name || it.name) + '：' + (it.pending ? '' : '（已經查過）') + it.kcal + ' → ' + row.kcal + ' 大卡').join('\n');
  // 也存到我的食物：要有「查到的名稱」，我的食物裡已經有同名的就不存
  const mine = [];
  if ($('lookupSaveMineCheck').checked) {
    found.forEach(({ row, it }) => {
      const form = lookupMyFoodForm(row, it.lookup);
      if (form && !customFoods().some(f => f.name === form.name) && !mine.some(m => m.name === form.name)) mine.push(form);
    });
  }
  const mineText = mine.length ? '\n\n也存到我的食物（' + mine.length + ' 樣）：' + mine.map(m => m.name).join('、') : '';
  openConfirm('回填 ' + found.length + ' 筆', list + mineText + (missing.length ? '\n\n另外 ' + missing.length + ' 筆對不到記錄，會略過。' : ''), () => {
    mine.forEach(form => {
      const { food } = customFoodFromForm({ ...form, source: 'lookup' }, { id: uid('cf'), now: now() });
      if (food) customFoods().unshift(food);
    });
    found.forEach(({ row, it }) => {
      Object.assign(it, { kcal: row.kcal, multiplier: 1, pending: false, updatedAt: now() });
      if (row.name) it.name = row.name;
      ['p', 'c', 'f'].forEach(k => { it[k] = row[k] != null ? row[k] : null; });
      it.ex = null;   // 粗估的六大類份數不準，填好的表沒有就清掉
    });
    persist();
    renderAll();
    renderLookup();
    $('lookupPaste').value = '';
    setBox('lookupNote', 'ok', '已回填 ' + found.length + ' 筆' + (missing.length ? '，' + missing.length + ' 筆對不到記錄' : '') + '。' + (mine.length ? '\n也存了 ' + mine.length + ' 樣到我的食物，下次吃一樣的直接選。' : ''));
  }, '回填');
}

function nutrLine(it) {
  const parts = [];
  if (it.p != null || it.c != null || it.f != null) {
    parts.push(MACRO_KEYS.map(k => MACRO_META[k].short + fmt(it[k] || 0, 1)).join(' '));
  }
  if (it.ex) parts.push(EX_KEYS.filter(k => it.ex[k]).map(k => EX_META[k].short + fmt(it.ex[k], 1)).join(' '));
  return parts.join('・');
}

// 「吃的和前幾天一樣？」：上面選餐別（預設是現在該記的那一餐，可以改），
// 下面左右滑前 7 天同一餐的卡片（昨天在最前面）；按一下整餐放進來，多的少的再到記錄區改
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];
function copyDayLabel(date) {
  const d = new Date(date + 'T12:00:00');
  const wd = '星期' + WEEKDAY[d.getDay()];
  const back = Math.round((new Date(ui.date + 'T12:00:00') - d) / 86400000);
  return (back === 1 ? (ui.date === todayStr() ? '昨天' : '前一天') + '・' + wd : wd) + '　' + (d.getMonth() + 1) + '/' + d.getDate();
}
function copyMealHTML(list) {
  const meal = ui.meal;
  const days = Array.from({ length: 7 }, (_, i) => addDays(ui.date, -(i + 1)));
  if (!days.some(d => (state.logs[d] || []).length)) return '';   // 前 7 天都沒記錄就不顯示
  const tabs = MEAL_KEYS.map(k => `<button type="button" data-meal="${k}" class="meal-btn${k === meal ? ' is-active' : ''}">${MEAL_META[k].label}</button>`).join('');
  const cards = days.map(date => {
    const items = mealEntries(state.logs, date, meal);
    if (!items.length) return '';
    const shown = items.slice(0, 4).map(i => `<li class="truncate">${esc(i.name)}</li>`).join('');
    const more = items.length > 4 ? `<li class="text-stone-400">…還有 ${items.length - 4} 樣</li>` : '';
    return `<button type="button" data-copy-from="${date}" class="copy-card">
      <span class="block text-lg font-bold text-stone-900">${copyDayLabel(date)}</span>
      <ul class="copy-items">${shown}${more}</ul>
      <span class="block text-base text-emerald-700 font-bold tabular-nums">${items.length} 樣・${sumNutr(items).kcal} kcal</span>
      <span class="copy-go">放入${MEAL_META[meal].label}</span></button>`;
  }).filter(Boolean);
  const has = list.some(i => i.meal === meal);
  const body = cards.length
    ? `<div class="copy-strip">${cards.join('')}</div>
       <p class="text-sm text-stone-500 px-1">${cards.length > 1 ? '左右滑看前幾天。' : ''}按一下整餐放進來，多的或少的再到上面的記錄增加或刪除。${has ? '這一餐已經有記錄，放入的會加在後面。' : ''}</p>`
    : `<p class="text-base text-stone-500 px-1">前 7 天沒有記${MEAL_META[meal].label}。</p>`;
  return `<div id="copyMealBox" class="space-y-2"><div class="sec-title px-1">吃的和前幾天一樣？</div>
    <div class="meal-picker copy-meals">${tabs}</div>${body}</div>`;
}
function copyMeal(from) {
  const meal = ui.meal;
  const date = ui.date;
  const added = copyEntries(mealEntries(state.logs, from, meal), { makeId: uid, at: now() });
  if (!added.length) return;
  (state.logs[date] || (state.logs[date] = [])).push(...added);
  persist();
  renderAll();
  showToast('已放入' + MEAL_META[meal].label + ' ' + added.length + ' 樣（不含照片）。多的或少的請到記錄區增加或刪除', '復原', () => {
    const ids = new Set(added.map(a => a.id));
    state.logs[date] = (state.logs[date] || []).filter(it => !ids.has(it.id));
    added.forEach(a => tombstone('e:' + a.id));
    persist();
    renderAll();
  });
}
$('mealLogContainer').addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy-from]');
  if (b) copyMeal(b.getAttribute('data-copy-from'));
});

function renderLogs() {
  const container = $('mealLogContainer');
  const list = state.logs[ui.date] || [];
  $('clearDayBtn').classList.toggle('hidden', !list.length);
  if (!list.length) {
    container.innerHTML = `<div class="bg-white rounded-2xl border border-dashed border-stone-300 p-8 text-center space-y-2">
      <p class="text-base font-medium text-stone-600">這天還沒有記錄</p>
      <p class="text-sm text-stone-400">點上面的「我的食物」「拍照記」開始</p></div>` + copyMealHTML(list);
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
      const pending = item.pending ? '<span class="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-bold">暫估待修</span>' : '';
      const thumb = item.hasPhoto
        ? `<button type="button" data-view-photo="${esc(item.id)}" class="view-photo-btn relative shrink-0" title="放大照片">
             <img data-photo-id="${esc(item.id)}" alt="餐點照片" class="w-14 h-14 rounded-xl object-cover border border-stone-200 bg-stone-100" />
             ${morePhotoKeys(item).length ? `<span class="absolute -bottom-1 -right-1 px-1.5 rounded-full bg-stone-800 text-white text-xs font-bold">+${morePhotoKeys(item).length}</span>` : ''}
           </button>`
        : '';
      const nl = nutrLine(item);
      html += `<li class="px-4 py-3 flex items-start gap-3">${thumb}
        <div class="min-w-0 flex-1">
          <div class="text-base font-semibold text-stone-900 leading-snug break-words">${esc(item.name)}${pending}</div>
          <div class="text-sm text-stone-500 leading-snug">${esc(item.time || '')}${esc(mult)}${nl ? '・' + esc(nl) : ''}</div>
          ${item.srcName ? `<div class="text-sm text-stone-400 leading-snug break-words">資料來源：${esc(item.srcName)}</div>` : ''}
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

/* ---------------- Render：我的食物（下方分頁，管理用） ---------------- */
// 選取模式（mfSelected 不是 null）：點一下勾選，可以移到資料庫、分享選的
let mfSelected = null;
function renderMyFoods() {
  const q = $('myFoodSearch').value.trim();
  const all = myLoose();
  const list = q ? searchMine(all, q) : sortByUse(all, state.logs);
  const sel = mfSelected;
  $('myFoodSelectBtn').classList.toggle('hidden', Boolean(sel) || !all.length);
  $('myFoodSelectBar').classList.toggle('hidden', !sel);
  if (sel) $('myFoodSelectText').textContent = sel.size ? '已選 ' + sel.size + ' 樣' : '點食物勾選';
  const row = (f) => sel ? `<button type="button" data-mf-sel="${esc(f.id)}" class="pick-row${sel.has(f.id) ? ' pick-done' : ''}" aria-pressed="${sel.has(f.id)}">
      <span class="text-2xl shrink-0">${sel.has(f.id) ? '☑️' : '⬜'}</span>
      <span class="min-w-0 flex-1 text-left"><span class="block text-lg font-semibold text-stone-900 leading-snug break-words">${esc(f.name)}</span>
      <span class="block text-base text-emerald-700 font-bold tabular-nums">一份 ${esc(servingText(f))}　${servingKcal(f)} kcal</span></span></button>`
    : myFoodRowHTML(f, 'edit');
  $('myFoodList').innerHTML = list.length ? list.map(row).join('')
    : all.length ? `<p class="text-base text-stone-500 py-2">找不到「${esc(q)}」</p>`
      : '<p class="rounded-2xl bg-stone-50 text-stone-600 p-4 text-base leading-relaxed">還沒有我的食物。按上面的「＋ 新增我的食物」，照包裝上的營養標示填一次就好；「自己輸入」時也可以勾「也存到我的食物」。</p>';
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
  const stepsList = dates.map(d => num((state.days[d] || {}).steps)).filter(v => v != null && v > 0);
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
    // 膳食纖維：有纖維資料的天數平均；fiberShare＝有纖維資料的記錄佔幾成（少的話實際吃的會比平均多）
    avgFiber: avg(totals.filter(t => t.fiberItems > 0), t => t.fiber),
    fiberDays: totals.filter(t => t.fiberItems > 0).length,
    fiberShare: logged.length ? totals.reduce((a, t) => a + t.fiberItems, 0) / logged.reduce((a, t) => a + t.count, 0) : 0,
    weights,
    avgWater: waters.length ? waters.reduce((a, b) => a + b, 0) / waters.length : null,
    exMinTotal: exMins.reduce((a, b) => a + b, 0),
    // 步數：有記的天數平均；達到下限（醫生、營養師給的）的天數
    avgSteps: stepsList.length ? stepsList.reduce((a, b) => a + b, 0) / stepsList.length : null,
    stepsDays: stepsList.length,
    stepsMetDays: state.targets.steps ? stepsList.filter(v => v >= state.targets.steps).length : null,
    pending: totals.reduce((s, t) => s + t.pending, 0)
  };
}
function statTile(label, value, sub = '') {
  return `<div class="bg-stone-50 rounded-xl p-2.5"><div class="text-xs text-stone-600">${label}</div><div class="text-base font-bold text-stone-900 tabular-nums">${value}</div>${sub ? `<div class="text-[0.625rem] text-stone-400">${sub}</div>` : ''}</div>`;
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
    statTile('平均喝水', s.avgWater != null ? fmt(s.avgWater) + ' ml' : '–', '運動共 ' + s.exMinTotal + ' 分'),
    ...(s.stepsDays || state.targets.steps ? [statTile('平均步數', s.avgSteps != null ? fmt(s.avgSteps) + ' 步' : '–', state.targets.steps ? '達到 ' + fmt(state.targets.steps) + ' 步：' + (s.stepsMetDays || 0) + ' 天' : s.stepsDays + ' 天有記')] : [])
  ].join('');

  // 身體數據、睡眠的文字摘要不靠 Chart.js；圖表函式自己會檢查 Chart 在不在
  const labels = dates.map(fmtMD);
  renderBodyChart(dates, labels);
  // 功能開關關掉體重、這段期間也沒量：身體數據卡片不出現
  $('weightCard').classList.toggle('hidden', !featureOn(state.profile, 'weight') && !dates.some(d => num((state.days[d] || {}).weight) != null));
  renderSleepChart(dates, labels);
  renderVitalsCharts(dates, labels);
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
    nh += `<div><div class="text-sm text-stone-600 mb-1.5">三大營養素（${s.macroDays} 天有填）</div><div class="grid grid-cols-3 gap-2">` +
      MACRO_KEYS.map(k => meterHTML(MACRO_META[k].label + (kc ? ' ' + Math.round((s.avgMacro[k] || 0) * MACRO_META[k].kcalPerG / kc * 100) + '%' : ''), s.avgMacro[k], tg[k], 'g', MACRO_META[k].bar)).join('') + '</div></div>';
  }
  if (s.exDays) {
    nh += `<div><div class="text-sm text-stone-600 mb-1.5">六大類份數（${s.exDays} 天有填）</div><div class="grid grid-cols-3 sm:grid-cols-6 gap-2">` +
      EX_KEYS.map(k => meterHTML(EX_META[k].emoji + ' ' + EX_META[k].short, s.avgEx[k], tg.ex && tg.ex[k], '份', 'bg-emerald-500')).join('') + '</div></div>';
  }
  if (!nh) nh = '<p class="text-sm text-stone-500">這段期間還沒有填營養素或六大類份數。用「份量估算」或在記錄時展開「營養素／六大類份數」就會出現在這裡。</p>';
  if (s.pending) nh += `<p class="text-base font-semibold text-amber-800">⚠ 這段期間有 ${s.pending} 筆暫估待修</p>`;
  $('trendNutr').innerHTML = nh;
}

// 血壓、血糖：功能開關有打開、或這段期間有記錄才出現（關掉的人看不到空的圖）
let bpChart = null, glChart = null;
const GL_COLORS = { fasting: '#0ea5e9', before: '#14b8a6', after: '#f97316', bedtime: '#8b5cf6', other: '#78716c' };
function renderVitalsCharts(dates, labels) {
  const v = dailyVitals(state.days, dates);
  const bpOn = featureOn(state.profile, 'bp') || v.hasBp;
  const glOn = featureOn(state.profile, 'glucose') || v.hasGlucose;
  $('vitalsCard').classList.toggle('hidden', !bpOn && !glOn);
  $('bpBlock').classList.toggle('hidden', !bpOn);
  $('glBlock').classList.toggle('hidden', !glOn);
  $('bpEmpty').classList.toggle('hidden', v.hasBp);
  $('bpChartWrap').classList.toggle('hidden', !v.hasBp);
  $('glEmpty').classList.toggle('hidden', v.hasGlucose);
  $('glChartWrap').classList.toggle('hidden', !v.hasGlucose);
  const sum = vitalsSummary(state.days, dates);
  const bpDays = v.bp.sys.filter(x => x != null).length;
  $('bpStats').innerHTML = sum.bp ? [
    statTile('平均', sum.bp.sys + '/' + sum.bp.dia, '量了 ' + sum.bp.n + ' 次（' + bpDays + ' 天）'),
    statTile('最高', sum.bp.max.sys + '/' + sum.bp.max.dia, '')
  ].join('') : '';
  $('glStats').innerHTML = sum.glucose.map(g => statTile(g.label + '平均', String(g.avg), g.n + ' 次' + (g.min !== g.max ? '・' + g.min + '～' + g.max : ''))).join('');
  if (bpChart) { bpChart.destroy(); bpChart = null; }
  if (glChart) { glChart.destroy(); glChart = null; }
  if (typeof Chart === 'undefined') return;
  const opts = (y) => ({
    responsive: true, maintainAspectRatio: false, animation: false, spanGaps: true,
    plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
    scales: { y: { ...y, grid: { color: '#f5f5f4' } }, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } } }
  });
  const ref = (label, value) => ({ label, data: Array(dates.length).fill(value), borderColor: '#a8a29e', borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0 });
  if (bpOn && v.hasBp) {
    bpChart = new Chart($('bpChart').getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [
        { label: '上面（收縮壓）', data: v.bp.sys, borderColor: '#e11d48', backgroundColor: '#e11d48', borderWidth: 2.5, pointRadius: 3 },
        { label: '下面（舒張壓）', data: v.bp.dia, borderColor: '#2563eb', backgroundColor: '#2563eb', borderWidth: 2.5, pointRadius: 3 },
        ref('130/80', 130), { ...ref('', 80) }
      ] },
      options: { ...opts({ suggestedMin: 60, suggestedMax: 160, title: { display: true, text: 'mmHg' } }), plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, filter: (it) => it.text } } } }
    });
  }
  if (glOn && v.hasGlucose) {
    glChart = new Chart($('glChart').getContext('2d'), {
      type: 'line',
      data: { labels, datasets: Object.entries(v.glucose).map(([k, data]) => ({ label: glucoseKindLabel(k), data, borderColor: GL_COLORS[k], backgroundColor: GL_COLORS[k], borderWidth: 2.5, pointRadius: 3 })) },
      options: opts({ suggestedMin: 60, suggestedMax: 200 })
    });
  }
}

let sleepChart = null;
function renderSleepChart(dates, labels) {
  const rows = dates.map(d => daySleep(state.days[d] || {}));
  const has = rows.some(r => r.total > 0);
  // 功能開關關掉睡眠、這段期間也沒記：整張卡片不出現
  $('sleepCard').classList.toggle('hidden', !has && !featureOn(state.profile, 'sleep'));
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
  if (!min || min <= 0 || min > 600) { showError('請輸入 1–600 分鐘'); return; }
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
/* ---------------- 小成就（js/achievements.js；全部從記錄算） ---------------- */
// 體重前進的方向：有目標體重看目標，沒有就看 BMI（過重想減、過輕想增、正常不算）
function weightDir() {
  const w = weightInfo(todayStr());
  if (!w) return 0;
  const tw = num(state.targets.weight);
  if (tw) return Math.abs(w.now - tw) < 0.05 ? 0 : Math.sign(tw - w.now);
  const bmi = calcBmi(w.now, state.profile.height);
  return bmi == null ? -1 : bmi >= 24 ? -1 : bmi < 18.5 ? 1 : 0;
}
function currentBadges() {
  const today = todayStr();
  const dates = [...new Set([...Object.keys(state.logs), ...Object.keys(state.days)])].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today).sort();
  const facts = dates.map(date => {
    const d = state.days[date] || {};
    const water = num(d.water) || 0;
    return { date, food: (state.logs[date] || []).length > 0, water: water > 0 && water >= (dayWaterGoal(date) || 1500),
      weigh: num(d.weight) != null, sleep: daySleep(d).night > 0, move: Boolean(num(d.exMin) > 0 || String(d.exercise || '').trim() || num(d.steps) > 0),
      walk: num(d.steps) > 0 && num(d.steps) >= (state.targets.steps || 1) };
  });
  const weights = dates.filter(date => num((state.days[date] || {}).weight) != null).map(date => ({ date, kg: num(state.days[date].weight) }));
  const helper = INVITE_URL && canSendFeedback(state.meta.invite) ? ((state.meta.contribStats && state.meta.contribStats.approved) || []) : null;
  const res = computeBadges({ facts, weights, dir: weightDir(), today, helper });
  // 關掉的功能（喝水、睡眠…）不列那一組
  const off = new Set(featuresOff(state.profile));
  return { ...res, badges: res.badges.filter(b => !off.has(BADGE_FEATURE[b.group])) };
}
// 這台裝置還沒慶祝過的新成就；第一次用這個功能時，以前得到的全部當成看過（不要一次放一堆彩帶）
function freshBadges(badges) {
  if (!Array.isArray(state.meta.badgesSeen)) {
    state.meta.badgesSeen = badges.filter(b => b.earnedOn).map(b => b.id);
    persistLocal();
    return [];
  }
  return newBadges(badges, state.meta.badgesSeen);
}
function markBadgesSeen(list) {
  if (!list.length) return;
  state.meta.badgesSeen = [...new Set([...(state.meta.badgesSeen || []), ...list.map(b => b.id)])];
  persistLocal();
}
function renderBadges() {
  const { stats, badges } = currentBadges();
  const got = badges.filter(b => b.earnedOn);
  $('badgeSummary').innerHTML = `<div class="text-xl font-bold">已經得到 ${got.length} 個小成就</div>
    <div>🔥 ${stats.streak ? '現在連續記錄 ' + stats.streak + ' 天' : '今天記一筆，就開始連續'}${stats.longest > stats.streak ? '（最長 ' + stats.longest + ' 天）' : ''}</div>
    <div>📒 累計記錄 ${stats.days} 天</div>`;
  $('badgeList').innerHTML = badgesToShow(badges).map(({ group, earned, next }) => `<section class="space-y-2">
    <h3 class="text-lg font-bold text-stone-900">${group.emoji} ${esc(group.name)}<span class="text-sm font-normal text-stone-500">　${esc(group.hint)}</span></h3>
    <div class="badge-grid">${earned.map(b => `<div class="badge" data-badge="${b.id}"><span class="b-ic">${b.emoji}</span><span class="b-t">${esc(b.title)}</span>${b.life ? `<span class="b-s">${esc(b.life)}</span>` : ''}<span class="b-s">${fmtMD(b.earnedOn)} 得到</span></div>`).join('')}
      ${next ? `<div class="badge next" data-badge-next="${next.id}"><span class="b-ic">${next.emoji}</span><span class="b-t">${esc(next.title)}</span><span class="b-s">${esc(remainText(next))}</span>
        <span class="b-bar"><span style="width:${Math.min(100, Math.round((next.have || 0) / next.need * 100))}%"></span></span></div>` : ''}</div>
  </section>`).join('');
}
function renderBadgeTile(badges) {
  const n = badges.filter(b => b.earnedOn).length;
  $('badgeTileSub').textContent = n ? '已經得到 ' + n + ' 個：連續記錄、喝水、量體重…' : '連續記錄、喝水、量體重…';
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
  key: 'API Key 不對或已經失效，請到右上 ⚙️ 設定的「AI 辨識」重新設定。',
  quota: '今天的免費次數可能用完了（Google 免費方案一天只能用幾十次），明天再用。現在可以先用「拍照記」存起來，之後再查。',
  referrer: '這把 Key 限制了可以使用的網站，請確認有加上 https://ericckfeng.github.io/*',
  forbidden: 'Google 拒絕了這個請求，請確認這把 Key 是 Gemini API 用的。',
  network: '連不上網路，請確認網路後再試一次。',
  busy: 'Google 的 AI 現在太多人用，請過一兩分鐘再試。',
  timeout: 'AI 等太久沒有回應（超過 1 分鐘），請再試一次；照片可以拍近一點。',
  empty: 'AI 這次沒有給答案（可能被 Google 的安全過濾擋下），請換張照片或用說的。',
  model: '找不到可以用的 AI 模型，請截圖這個畫面給開發者。'
};
// 後面附上原始原因（代碼），截圖給開發者就能查
const aiErrorText = (e) => (AI_ERRORS[e && e.kind] || 'AI 這次沒有回答好，請再試一次。') +
  (e && (e.kind || e.detail) ? '\n（代碼：' + [e.kind, e.detail].filter(Boolean).join(' ') + '）' : '');
function setBox(id, tone, text) {
  const el = $(id);
  el.classList.toggle('hidden', !text);
  el.className = el.className.replace(/\b(bg|text)-(sky|rose|emerald|amber)-\d+\b/g, '').trim();
  if (text) el.classList.add(...({ info: ['bg-sky-50', 'text-sky-900'], err: ['bg-rose-50', 'text-rose-800'], ok: ['bg-emerald-50', 'text-emerald-900'] }[tone]));
  el.textContent = text || '';
}
// 用自己的 AI App（複製貼上，不用 Key）：只存這台裝置的開關
const aiPasteOn = () => Boolean(state.meta.aiPaste);
function renderAiUi() {
  const on = Boolean(aiKey());
  $('aiTile').classList.toggle('hidden', !on && !aiPasteOn());
  document.querySelectorAll('[data-lb-photo]').forEach(b => { b.textContent = labelPhotoText(); });
  $('aiStatusText').textContent = on ? '已開啟（Key 只存在這支手機）' : aiPasteOn() ? '用自己的 AI App（複製貼上）' : '關閉・用自己的免費 Google API Key';
  $('aiGoBtn').textContent = on ? '請 AI 幫我認' : '📤 傳給我的 AI App';
  $('aiPrivacyNote').textContent = (on ? '照片和文字會傳到 Google 的 Gemini 辨識。' : '照片和說明由你自己傳給你選的 AI App，這個 App 不會另外傳送。') + 'AI 估的份量和熱量可能有誤差，加入後還可以改克數。';
}
// 照片（data URL）→ 檔案：同步轉，按下按鈕後馬上叫出分享選單（iPhone 要求不能先等別的事）
function dataUrlToFile(dataUrl, name) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: m[1] });
}
// 把說明複製好、照片用分享選單傳給 AI App。回傳 'shared'｜'copied'（不能分享，只複製了）｜'aborted'｜'failed'
async function shareToAi(prompt, photo) {
  let copied = Promise.resolve(false);
  try { copied = navigator.clipboard.writeText(prompt).then(() => true, () => false); } catch (e) { /* 不能複製 */ }
  const file = photo ? dataUrlToFile(photo, '照片.jpg') : null;
  const data = file ? { files: [file], text: prompt } : { text: prompt };
  try {
    if (navigator.share && (!file || (navigator.canShare && navigator.canShare({ files: [file] })))) {
      await navigator.share(data);
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'aborted';
  }
  return (await copied) ? 'copied' : 'failed';
}
function savePhotoFile(photo) {
  const file = dataUrlToFile(photo, '照片_' + todayStr() + '.jpg');
  if (file) downloadBlob(file.name, file);
}

// 設定頁
function renderAiKey() {
  $('aiPasteState').textContent = aiPasteOn() ? '✓ 已開啟：首頁有「AI 幫我認」' : '目前沒有開啟';
  $('aiPasteToggle').textContent = aiPasteOn() ? '關閉「用自己的 AI App」' : '開啟「用自己的 AI App」';
  const on = Boolean(aiKey());
  $('aiKeyOn').classList.toggle('hidden', !on);
  $('aiKeyInput').value = '';
  $('aiKeySaveBtn').textContent = on ? '換一把 Key' : '測試並開啟';
  $('aiCheckResult').classList.add('hidden');
  $('aiCheckCopy').classList.add('hidden');
  setBox('aiKeyStatus', null, '');
}
$('aiPasteToggle').addEventListener('click', () => {
  state.meta.aiPaste = !aiPasteOn();
  persistLocal();
  renderAll();
  renderAiKey();
  if (aiPasteOn()) showToast('已開啟。首頁多了「AI 幫我認」');
});
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
// 檢查 AI：畫一張答案已知的營養標示，請 AI 讀；每一步列出成功／失敗、秒數、模型、錯誤代碼
function checkLabelImage() {
  const cv = document.createElement('canvas');
  cv.width = 480; cv.height = 360;
  const g = cv.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeRect(10, 10, 460, 340);
  g.fillStyle = '#000'; g.font = 'bold 34px sans-serif';
  g.fillText('營養標示', 30, 60);
  g.font = '26px sans-serif';
  [['每一份量', '30 公克'], ['本包裝含', '5 份'], ['熱量', CHECK_KCAL + ' 大卡'], ['蛋白質', '3.0 公克'], ['脂肪', '4.5 公克'], ['碳水化合物', '18.0 公克'], ['鈉', '95 毫克']]
    .forEach(([a, b], i) => { g.fillText(a, 30, 110 + i * 34); g.fillText(b, 280, 110 + i * 34); });
  return cv.toDataURL('image/jpeg', 0.9);
}
let aiCheckText = '';
$('aiCheckBtn').addEventListener('click', async () => {
  const btn = $('aiCheckBtn');
  btn.disabled = true; btn.textContent = '檢查中…（最多 2 分鐘）';
  $('aiCheckCopy').classList.add('hidden');
  $('aiCheckResult').classList.remove('hidden');
  $('aiCheckResult').textContent = '檢查中，請稍等…';
  try {
    const steps = await runAiCheck({ key: aiKey(), labelImage: checkLabelImage() });
    const bad = steps.find(st => !st.ok);
    const head = !bad ? (steps.length > 1 ? '✅ AI 可以正常使用（文字和照片都沒問題）' : '✅ 文字正常（這台裝置無法產生測試照片）')
      : '❌ AI 目前不能正常使用\n' + (bad.kind === 'wrong' ? 'AI 有回答，但內容不對。' : aiErrorText({ kind: bad.kind }).split('\n')[0]);
    aiCheckText = head + '\n\n' + checkReport(steps) + '\n\n飲控隨身記 版本 ' + APP_VERSION + '・' + new Date().toLocaleString('zh-TW') + '\n' + navigator.userAgent;
    $('aiCheckResult').textContent = head + '\n\n' + checkReport(steps);
    $('aiCheckCopy').classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = '🔍 檢查 AI 能不能用';
  }
});
$('aiCheckCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(aiCheckText); showToast('已複製，可以貼到 LINE 傳給開發者'); }
  catch (e) { showError('這台裝置不能自動複製，請截圖'); }
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
      <span class="block text-base text-stone-500 tabular-nums">約 ${it.grams} g</span>${glutinousBadge({ name: it.name })}${densityBadge(energyDensity({ name: it.name }, it.kcal / it.grams))}</span>
      <span class="text-lg font-bold text-emerald-700 tabular-nums shrink-0">${it.kcal} kcal</span></label>`).join('');
  const n = aiDraft.checked.size;
  $('aiAddBtn').textContent = '加入這一餐（' + n + ' 樣）';
  $('aiAddBtn').disabled = !n;
}
$('aiPhotoBtn').addEventListener('click', () => $('aiPhotoInput').click());
$('aiPhotoInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try { aiDraft.photo = await compressImage(file, 1024); } catch (err) { showError('照片讀不到，請再試一次'); return; }
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
  if (!aiKey()) { sendMealToAiApp(); return; }
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
    // AI 不能用（次數用完、太忙、網路）：照片和描述不要白拍，直接帶到「拍照記」存成待查
    if (['quota', 'busy', 'timeout', 'network', 'server'].includes(e && e.kind)) {
      $('aiFallbackBtn').classList.remove('hidden');
      if (e.kind !== 'network') $('aiPasteFallbackBtn').classList.remove('hidden');
    }
  } finally {
    btn.disabled = false; btn.textContent = '請 AI 幫我認';
  }
});
// 用自己的 AI App：傳照片＋說明 → 貼回答 → 和 Gemini 一樣拆成一樣一樣
async function sendMealToAiApp() {
  const text = $('aiText').value.trim();
  const how = await shareToAi(mealPastePrompt(text), aiDraft.photo);
  if (how === 'aborted') return;
  $('aiPasteWrap').classList.remove('hidden');
  $('aiPasteFallbackBtn').classList.add('hidden');
  const noShare = how !== 'shared';
  $('aiPhotoSaveBtn').classList.toggle('hidden', !(noShare && aiDraft.photo));
  setBox('aiPasteHint', noShare ? 'info' : null, how === 'failed' ? '這台裝置沒辦法自動複製。請打開 AI App，自己描述「把這餐拆成一樣一樣，列出克數和熱量」，再把回答貼回來。'
    : noShare ? '說明已經複製好了。請打開你的 AI App（或 chatgpt.com、gemini.google.com），貼上說明' + (aiDraft.photo ? '，再附上這張照片（可以先按下面的「下載這張照片」）' : '') + '。' : '');
  $('aiPasteText').focus({ preventScroll: true });
}
$('aiPasteFallbackBtn').addEventListener('click', sendMealToAiApp);
$('aiPhotoSaveBtn').addEventListener('click', () => savePhotoFile(aiDraft.photo));
$('aiPasteReadBtn').addEventListener('click', () => {
  const out = mealFromPaste($('aiPasteText').value);
  if (!out.items.length) { setBox('aiStatus', 'err', '讀不到 AI 的回答：請把 AI 回答的整段（表格）複製、貼上。AI 說「沒有食物」的話，換張照片或用說的再試。'); return; }
  aiDraft.items = out.items;
  aiDraft.source = aiDraft.photo ? 'photo' : 'text';
  aiDraft.checked = new Set(out.items.map((_, i) => i));
  renderAiResults();
  $('aiPasteText').value = '';
  $('aiPasteWrap').classList.add('hidden');
  setBox('aiStatus', 'info', '不對的可以取消打勾，加入後還可以改克數。');
});
$('aiFallbackBtn').addEventListener('click', () => {
  const photo = aiDraft.photo;
  const text = $('aiText').value.trim();
  afterClose(() => {
    openScreen('scr-photo');
    if (photo) formPhotos.pq = [{ src: photo, key: null }];
    if (text) $('photoQuickName').value = text.slice(0, 40);
    renderPhotoQuick();
  });
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
    rec.onerror = () => showError('沒聽清楚，請再說一次，或直接打字');
    $('aiMicBtn').textContent = '⏹ 說完了，按這裡';
    rec.start();
  });
}

// 拍營養標示 → 填進「自己輸入」
// 拍營養標示（自己輸入、修改記錄）：有開 AI 就順便讀出數字，填進「照營養標示算」
async function readLabelByAi(prefix, photo) {
  const btn = document.querySelector(`[data-lb-photo="${prefix}"]`);
  const note = prefix + '-lb-note';
  btn.disabled = true; btn.textContent = 'AI 讀取中…';
  try {
    const lb = normalizeLabel(await callGemini({ key: aiKey(), request: buildRequest({ prompt: LABEL_PROMPT, imageDataUrl: photo, schema: LABEL_SCHEMA }) }));
    if (!lb) { setBox(note, 'err', '找不到營養標示。照片已經存了，可以對照照片自己填；或把表格拍清楚、拍正一點再試。'); return; }
    applyLabelResult(prefix, lb);
  } catch (err) {
    setBox(note, 'err', aiErrorText(err) + '\n照片已經存了，可以對照照片自己填，或改傳給你的 AI App。');
    $(prefix + '-lb-paste').classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = labelPhotoText();
  }
}
// AI（Gemini 或自己的 AI App）讀到的標示 → 填進「照營養標示算」和熱量
function applyLabelResult(prefix, lb) {
  const note = prefix + '-lb-note';
  {
    const nameEl = $(prefix === 'add' ? 'foodNameInput' : 'editLogNameInput');
    if (!nameEl.value.trim() && lb.name) nameEl.value = lb.name;
    // 拍了營養標示的多半會再吃：「也存到我的食物」預設勾起來（可以取消）
    if (prefix === 'add') { $('saveMineCheck').checked = true; addLabelByAi = true; }
    const per = lb.servingG ? '每份 ' + lb.servingG + ' 公克' + (lb.servings ? '、這包有 ' + lb.servings + ' 份' : '') + '。' : '';
    const kj = lb.kj ? '（標示是 ' + lb.kj + ' 千焦耳，已換成大卡）' : '';
    if (lb.servingG) {
      fillLabelCalc(prefix, { label: { g: lb.servingG, kcal: lb.kcal, p: lb.p, c: lb.c, f: lb.f } });
      if (!$(prefix + '-lb-eat').value) $(prefix + '-lb-eat').value = lb.servingG;
      applyLabelCalc(prefix);
      setBox(note, 'info', 'AI 讀到：' + per + '每份 ' + lb.kcal + ' 大卡' + kj + '。請對照包裝確認；吃的不是 1 份就改「我吃了幾克」。');
    } else {
      // 標示沒寫每份幾克：直接填一份的數字
      $(KCAL_FIELD[prefix]).value = lb.kcal;
      writeNutrFields(prefix, { p: lb.p, c: lb.c, f: lb.f, ex: null });
      if (prefix === 'add') { $('addMore').open = true; $('addNutrDetails').open = true; }
      setBox(note, 'info', 'AI 讀到：每份 ' + lb.kcal + ' 大卡' + kj + '，已填好（標示沒寫每份幾克）。請對照包裝確認。');
    }
  }
}

/* ---------------- 版本：有沒有新版、我的裝置 ---------------- */
// 網站上的 version.json 是目前最新版；比這一版新就在首頁提示更新
let latest = null;
let latestCheckedAt = 0;
async function checkLatest(force = false) {
  if (location.protocol === 'file:') return;
  if (!force && Date.now() - latestCheckedAt < 30 * 60 * 1000) return;
  latestCheckedAt = Date.now();
  try {
    const res = await fetch('version.json', { cache: 'no-store' });
    if (res.ok) latest = parseLatest(await res.json());
  } catch (e) { /* 離線：當作沒檢查到 */ }
  renderUpdateBanner();
  if (screenStack.includes('scr-about')) renderAbout();
}
const hasNewer = () => Boolean(latest && latest.rev > APP_REV);
const syncBlocked = () => (Number(state.meta.cloud.blockedRev) || 0) > APP_REV;
function renderUpdateBanner() {
  const show = hasNewer() || syncBlocked();
  $('updateBanner').classList.toggle('hidden', !show);
  if (!show) return;
  $('updateBannerText').textContent = syncBlocked()
    ? '雲端的資料是新版 App 存的，這台要更新才能繼續同步（資料都還在）。'
    : '有新版本（' + (latest.ver || 'Rev. ' + latest.rev) + '），按「更新」就好，記的資料不會不見。';
}
async function updateApp() {
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
  } catch (e) { /* ignore */ }
  location.reload();
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-update-app]')) updateApp(); });

const myDeviceName = () => state.meta.deviceName || deviceName(navigator.userAgent, navigator.maxTouchPoints || 0);
// 雲端記錄這台的版本（同步時順便更新；版本、名字沒變就一天最多一次）
function refreshDevice() {
  let changed = false;
  const rec = deviceRecord(state.devices, { id: state.meta.deviceId, name: myDeviceName() });
  if (rec) { state.devices = upsertDevice(state.devices, rec); changed = true; }
  const mr = minRevToWrite(state.minRev);
  if (mr) { state.minRev = mr; changed = true; }
  return changed;
}
function renderAbout() {
  $('appVersionText').textContent = '版本 ' + APP_VERSION;
  const el = $('appLatestText');
  el.className = 'text-lg font-semibold ' + (hasNewer() || syncBlocked() ? 'text-amber-700' : latest ? 'text-emerald-700' : 'text-stone-500');
  el.textContent = syncBlocked() ? '⚠ 雲端資料需要 Rev. ' + state.meta.cloud.blockedRev + ' 以上，請更新'
    : hasNewer() ? '⚠ 有新版本：' + (latest.ver ? latest.ver + '（Rev. ' + latest.rev + '）' : 'Rev. ' + latest.rev)
    : latest ? '✓ 已經是最新版'
    : navigator.onLine === false ? '沒有網路，等連上網再檢查有沒有新版' : '正在檢查有沒有新版…';
  $('aboutUpdateBtn').classList.toggle('hidden', !(hasNewer() || syncBlocked()));
  const linked = cloud.isConfigured() && state.meta.cloud.linked;
  const rows = linked ? deviceRows(state.devices, { myId: state.meta.deviceId, latestRev: latest && latest.rev, now: now() }) : [];
  rows.forEach(r => { if (r.mine) r.name = myDeviceName(); });   // 剛改的名字馬上顯示（雲端下次同步才更新）
  $('devicesNote').textContent = linked
    ? '每一台同步時會記下自己的版本。沒出現在這裡的裝置，代表還沒更新到 Rev. 39 以後的版本，或還沒同步過：請在那台連網打開 App。'
    : '連結 Google 雲端同步後，這裡會列出每一台手機、電腦用的版本。';
  $('devicesList').innerHTML = rows.map(r => {
    const when = r.mine ? '這台' : r.days === 0 ? '今天同步' : r.days + ' 天前同步';
    const st = r.state === 'ok' ? '<span class="text-emerald-700 font-bold">✓ 最新</span>'
      : r.state === 'old' ? '<span class="text-amber-700 font-bold">⚠ 要更新</span>' : '';
    return `<div class="rounded-xl border ${r.state === 'old' ? 'border-amber-300 bg-amber-50' : 'border-stone-200'} p-3">
      <div class="flex items-center gap-2 flex-wrap"><span class="text-lg font-bold text-stone-900 break-all">${esc(r.name)}</span><span class="text-base text-stone-500">${when}</span><span class="ml-auto">${st}</span></div>
      <div class="flex items-center gap-2"><span class="text-base text-stone-700 tabular-nums">${esc(r.ver ? r.ver + '（Rev. ' + r.rev + '）' : 'Rev. ' + r.rev)}</span>${r.mine ? '' : `<button type="button" data-remove-device="${esc(r.id)}" class="ml-auto px-3 py-1 rounded-lg text-base text-stone-500 underline">移除</button>`}</div>
    </div>`;
  }).join('');
  $('deviceNameInput').value = state.meta.deviceName || '';
  $('deviceNameInput').placeholder = deviceName(navigator.userAgent);
}
$('deviceNameInput').addEventListener('change', (e) => {
  const v = e.target.value.trim().slice(0, 20);
  if (v) state.meta.deviceName = v; else delete state.meta.deviceName;
  persist();   // 下次同步時更新雲端上這台的名字
  renderAbout();
});
$('devicesList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove-device]');
  if (!b) return;
  const id = b.getAttribute('data-remove-device');
  const d = (state.devices || []).find(x => x.id === id);
  openConfirm('移除這台裝置', '「' + (d ? d.name : '裝置') + '」不再用了才移除（例如換手機）。那台如果之後又同步，會自動回到清單。不會刪除任何飲食記錄。', () => {
    state.devices = (state.devices || []).filter(x => x.id !== id);
    tombstone('devices:' + id);
    persist();
    renderAbout();
  }, '移除');
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
  $('weeklyMascot').innerHTML = state.meta.mascot === false && palsOn().cat ? catSVG(empty ? 'calm' : 'cheer') : mascotSVG(empty ? 'calm' : 'cheer');
  $('weeklyRange').textContent = fmtMD(w.from) + '～' + fmtMD(w.to);
  $('weeklyEmpty').classList.toggle('hidden', !empty);
  $('weeklyGood').parentElement.classList.toggle('hidden', empty);
  $('weeklyTry').parentElement.classList.toggle('hidden', empty);
  $('weeklyShareBtn').classList.toggle('hidden', empty);
  // 有開「用自己的 AI App」或 Gemini Key 的人才出現（沒在用 AI 的人不會多一顆看不懂的按鈕）
  $('weeklyAiBtn').classList.toggle('hidden', empty || !(aiPasteOn() || aiKey()));
  setBox('weeklyAiNote', null, '');
  $('weeklyGood').innerHTML = w.good.map(g => `<li class="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-lg font-semibold text-emerald-900 leading-relaxed">✓ ${esc(g)}</li>`).join('');
  $('weeklyTry').textContent = '👉 ' + w.tryNext;
}
// 一週回顧：摘要＋每天吃了什麼＋請 AI 怎麼回答，用分享選單傳給自己的 AI App（App 不另外傳送）
$('weeklyAiBtn').addEventListener('click', async () => {
  if (!lastWeekly) return;
  const dates = datesBetween(lastWeekly.from, lastWeekly.to);
  const diary = foodDiaryLines(state.logs, dates, {
    meals: MEAL_KEYS.map(k => [k, MEAL_META[k].label]),
    dayLabel: (d) => fmtMD(d) + '（' + WEEKDAY[parseDate(d).getDay()] + '）'
  });
  const text = weekReviewPrompt(buildReportText(reportContext(), { from: lastWeekly.from, to: lastWeekly.to }), diary);
  const how = await shareToAi(text, null);
  if (how === 'shared') setBox('weeklyAiNote', 'ok', '傳好了。AI 回答後，挑一件做得到的試試看；有吃藥或身體的問題，還是要問營養師。');
  else if (how === 'copied') setBox('weeklyAiNote', 'info', '已經複製好了。打開你的 AI App（ChatGPT、Gemini…），長按輸入框 →「貼上」，再送出。');
  else if (how === 'failed') showError('沒辦法分享，也沒辦法複製。請改用「傳到 LINE／分享」，把週報傳給營養師。');
});
$('weeklyShareBtn').addEventListener('click', async () => {
  if (!lastWeekly) return;
  const text = weeklyText({ ...lastWeekly, name: state.profile.name }, fmtMD);
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  try { await navigator.clipboard.writeText(text); showToast('已複製週報，貼到 LINE 即可'); } catch (e) { showError('無法複製'); }
});

// 設定裡勾了誰：小芽 meta.mascot、小貓 meta.cat、營養師 meta.doc。
// 小貓、營養師沒設過的話跟著小芽（以前關掉小芽的人，不會突然冒出新角色）
function palsOn() {
  const sprout = state.meta.mascot !== false;
  const on = (k) => state.meta[k] != null ? state.meta[k] !== false : sprout;
  return { sprout, cat: on('cat'), doc: on('doc') };
}
function docSeenToday() {
  const d = state.meta.docSeen;
  return d && d.date === todayStr() ? d.keys || [] : [];
}
function renderMascot() {
  const card = $('mascotCard');
  const insights = dayInsights(ui.date);
  const pals = palsOn();
  const isToday = ui.date === todayStr();
  const { badges } = currentBadges();
  renderBadgeTile(badges);
  const fresh = isToday ? freshBadges(badges) : [];
  if (!pals.sprout && !pals.cat && !pals.doc) {
    card.classList.add('hidden'); renderTips(insights);
    if (fresh.length) { markBadgesSeen(fresh); showToast('🏅 得到新的小成就：' + fresh[0].title, '看看', () => openScreen('scr-badges'), 8000); }
    return;
  }
  const t = dayTotals(ui.date);
  const d = getDay(ui.date, false);
  const w = weightInfo(ui.date);
  const bmi = w ? calcBmi(w.now, state.profile.height) : null;
  const streak = computeStreak(ui.date);
  mascotMsgs = castMessages(buildMascotMessages({
    isToday, hour: new Date().getHours(), count: t.count, kcal: t.kcal, targetKcal: state.targets.kcal,
    meals: MEAL_KEYS.filter(k => t.meals[k] > 0).length, streak, weight: w, newBadge: fresh[0] || null,
    steps: num(d.steps), stepsTarget: state.targets.steps || null,
    targetWeight: num(state.targets.weight), bmi, water: num(d.water) || 0, waterGoal: dayWaterGoal(ui.date),
    protein: t.macroItems ? t.p : 0, proteinTarget: num(state.targets.p),
    lastNight: daySleep(getDay(ui.date, false)),
    exercise: d.exercise || (d.exMin ? d.exMin + ' 分鐘' : ''),
    insights, off: featuresOff(state.profile)
  }), { ...pals, isToday, docSeen: docSeenToday() });
  // 只勾營養師時，營養師沒說到的提醒照樣放在「小提醒」卡片
  const said = new Set(mascotMsgs.map(m => m.key));
  renderTips(pals.sprout || pals.cat ? [] : insights.filter(m => !said.has(m.key)));
  if (!mascotMsgs.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  mascotIdx = 0;
  showMascotMsg();
  markBadgesSeen(fresh);
  const chips = [];
  // 連續天數和小成就可以點，打開「我的小成就」
  if (streak.n >= 1) chips.push(`<button type="button" data-screen="scr-badges" class="mascot-chip">🔥 連續 ${streak.n} 天 ›</button>`);
  const nBadges = badges.filter(b => b.earnedOn).length;
  if (nBadges) chips.push(`<button type="button" data-screen="scr-badges" class="mascot-chip">🏅 小成就 ${nBadges} ›</button>`);
  if (w && w.week != null) { const dl = r1(w.now - w.week); chips.push('⚖️ 這週 ' + (dl > 0 ? '+' : dl < 0 ? '−' : '±') + Math.abs(dl) + ' kg'); }
  if (bmi) chips.push('BMI ' + bmi);
  $('mascotChips').innerHTML = chips.map(c => c.startsWith('<button') ? c : `<span class="mascot-chip">${c}</span>`).join('');
  const top = mascotMsgs[0];
  if (top && top.mood === 'cheer' && state.meta.lastCheer !== top.key) {
    state.meta.lastCheer = top.key;
    persistLocal();
    burstConfetti();
  }
}
// 這一句的角色：營養師說的時候她站前面，小芽、小貓縮小在旁邊加油；其他時候小芽和小貓一起
const SPROUT_MOODS = ['cheer', 'happy', 'encourage', 'calm', 'hello'];
function mascotArt(m) {
  const pals = palsOn();
  const pal = (svg, sm) => `<span class="pal${sm ? ' pal-sm' : ''}">${svg}</span>`;
  const sproutMood = SPROUT_MOODS.includes(m.mood) ? m.mood : 'happy';
  if (m.who === 'doc') {
    return pal(docSVG('calm')) +
      (pals.sprout ? pal(mascotSVG('encourage'), true) : '') +
      (pals.cat ? pal(catSVG(m.pose === 'sleepy' ? 'sleepy' : 'encourage'), true) : '');
  }
  return (pals.sprout ? pal(mascotSVG(sproutMood)) : '') + (pals.cat ? pal(catSVG(m.pose || m.mood)) : '');
}
function showMascotMsg() {
  const m = mascotMsgs[mascotIdx % mascotMsgs.length];
  if (!m) return;
  const doc = m.who === 'doc';
  const btn = $('mascotBtn');
  btn.innerHTML = mascotArt(m);
  const n = btn.querySelectorAll('.pal').length;
  $('mascotCard').classList.toggle('mascot-multi', n > 1);
  $('mascotCard').classList.toggle('mascot-doc', doc);
  btn.setAttribute('aria-label', (doc ? '營養師' : '小芽') + '，點一下看下一句');
  $('mascotWho').textContent = doc ? '營養師：' : '';
  $('mascotMsg').textContent = m.text;
  // 營養師一天最多出來 DOC_PER_DAY 次：說過的 key 記在這台裝置
  if (doc && ui.date === todayStr()) {
    const keys = docSeenToday();
    if (!keys.includes(m.key)) { state.meta.docSeen = { date: todayStr(), keys: [...keys, m.key] }; persistLocal(); }
  }
}
function burstConfetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = $('confetti');
  const colors = ['#facc15', '#34d399', '#60a5fa', '#f472b6', '#fb923c'];
  box.innerHTML = Array.from({ length: 26 }, (_, i) =>
    `<span style="left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${Math.random() * 0.5}s"></span>`).join('');
  setTimeout(() => { box.innerHTML = ''; }, 2600);
}
// 點角色：跳一下、冒個愛心，再換下一句
$('mascotBtn').addEventListener('click', () => {
  if (mascotMsgs.length > 1) {
    mascotIdx = (mascotIdx + 1) % mascotMsgs.length;
    showMascotMsg();
  }
  const btn = $('mascotBtn');
  btn.classList.remove('pal-tap'); void btn.offsetWidth; btn.classList.add('pal-tap');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const pop = document.createElement('span');
  pop.className = 'pal-pop';
  pop.textContent = ['💕', '✨', '🌱', '😺'][Math.floor(Math.random() * 4)];
  $('mascotCard').appendChild(pop);
  setTimeout(() => pop.remove(), 900);
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
  renderUpdateBanner();
  const show = !isStandalone() && !state.meta.installHintDismissed;
  $('installBanner').classList.toggle('hidden', !show);
  // 備份提醒（js/backup.js）：沒連雲端 7 天沒備份；連了雲端但 7 天沒同步成功；登入過期；要先更新
  const c = state.meta.cloud;
  const linked = cloud.isConfigured() && c.linked;
  const r = cloudBusy ? null : backupReminder({
    hasData: Object.values(state.logs).some(l => l && l.length), logDays: Object.keys(state.logs).length,
    linked, needAuth: Boolean(c.needAuth), blocked: syncBlocked(), lastSync: c.lastSync, lastBackup: state.meta.lastBackup,
    snoozeUntil: state.meta.backupSnoozeUntil, now: Date.now()
  });
  const banner = $('backupBanner');
  banner.classList.toggle('hidden', !r);
  if (!r) return;
  banner.dataset.mode = r.mode;
  $('goBackupBtn').textContent = { reauth: '重新連結', update: '更新', sync: '立即同步', goto: '去備份' }[r.mode];
  $('snoozeBackupBtn').classList.toggle('hidden', r.mode === 'reauth');
  $('backupBannerText').textContent = backupText(r, { cloudReady: cloud.isConfigured() });
}
function renderAll() {
  renderSummary();
  renderLookupTile();
  if (screenStack.includes('scr-lookup')) renderLookup();
  renderAiUi();
  renderWeeklyCard();
  renderAdviceCard();
  renderMealSelector();
  renderLogs();
  renderDayPanel();
  renderTiles();
  renderMascot();
  renderSyncChip();
  renderExercisePresets();
  renderMyFoods();
  renderComboList();
  renderPackList();
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
  if (btn.closest('#copyMealBox')) renderLogs();
  if (screenStack.includes('scr-food')) renderFoodCart();
});
$('portionGroup').addEventListener('click', (e) => {
  const b = e.target.closest('[data-portion]');
  if (!b) return;
  setPortion(b.getAttribute('data-portion'));
});
$('dismissInstallBtn').addEventListener('click', () => { state.meta.installHintDismissed = true; persistLocal(); renderBanners(); });
$('goBackupBtn').addEventListener('click', () => {
  const mode = $('backupBanner').dataset.mode;
  if (mode === 'reauth') { startSignIn('sync'); return; }
  if (mode === 'update') { updateApp(); return; }
  if (mode === 'sync') { goToCloudSection(); cloudRun('sync'); return; }   // 打開資料與備份頁，看得到同步的結果
  goToCloudSection();
});
// 晚點：3 天內不再提醒（只存這台裝置）
$('snoozeBackupBtn').addEventListener('click', () => {
  state.meta.backupSnoozeUntil = Date.now() + SNOOZE_DAYS * 86400000;
  persistLocal();
  renderBanners();
  showToast(SNOOZE_DAYS + ' 天後再提醒你');
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
  // 先到雲端區塊再登入，登入失敗的訊息才看得到
  state.meta.welcomed = true;
  persistLocal();
  swapScreen('scr-data');
  setTimeout(() => cloudRun('connect'), 300);
});
$('welcomeImportBtn').addEventListener('click', () => {
  $('importJsonInput').click();
  state.meta.welcomed = true;
  persistLocal();
  swapScreen('scr-data');
  setTimeout(() => $('backupSection').scrollIntoView({ behavior: 'smooth' }), 400);
});
$('welcomeStartBtn').addEventListener('click', finishWelcome);

// 設定 → 資料與備份（雲端同步、備份）；已經開著別的頁面時直接疊上去
function goToCloudSection() {
  openScreen('scr-data');
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
// 「自己輸入」不知道熱量 → 換到「拍照記」（帶著已經填的名稱）
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-screen-swap]');
  if (!b) return;
  const name = $('foodNameInput').value.trim();
  afterClose(() => { openScreen(b.getAttribute('data-screen-swap')); if (name) $('photoQuickName').value = name; });
});
// 千焦耳 → 大卡：一邊打一邊換算，填到熱量欄
$('foodKjInput').addEventListener('input', (e) => {
  const kj = Number(e.target.value);
  const ok = e.target.value.trim() !== '' && Number.isFinite(kj) && kj >= 0 && kj <= 20000;
  $('kjResult').textContent = ok ? '＝ ' + kjToKcal(kj) + ' 大卡' : '';
  if (ok) $('foodKcalInput').value = kjToKcal(kj);
});

/* ---------------- 一筆記錄的照片（最多 3 張） ---------------- */
// 第 1 張是原本就有的照片（IndexedDB key＝記錄 id，雲端用 photoKey）；第 2、3 張的 key 存在 morePhotos，
// 格式 x_<記錄id>_<時間>，IndexedDB 和雲端都用這個 key。key 裡不能有「-」：舊版 App 清雲端照片時，
// 把「-」前面那段當記錄 id，那筆記錄還在就刪掉；x_ 開頭的對不到記錄，舊版不會誤刪。
const MAX_PHOTOS = 3;
const PHOTO_INPUT = { add: 'foodPhotoInput', edit: 'editLogPhotoInput', pq: 'photoQuickInput' };
// [{ src, key }]：key＝'@main' 原本的第 1 張、'x_…' 原本的第 2、3 張、null 新拍的
const formPhotos = { add: [], edit: [], pq: [] };
function newPhotoKey(id) { return 'x_' + id + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function morePhotoKeys(it) {
  return it && it.hasPhoto && Array.isArray(it.morePhotos) ? it.morePhotos.filter(k => typeof k === 'string' && k.startsWith('x_')) : [];
}
async function entryPhotos(it) {
  const out = [];
  if (it.hasPhoto) { const src = await getPhoto(it.id); if (src) out.push(src); }
  for (const k of morePhotoKeys(it)) { const src = await getPhoto(k); if (src) out.push(src); }
  return out;
}
async function deleteEntryPhotos(it) {
  for (const k of morePhotoKeys(it)) await deletePhoto(k);
  if (it.hasPhoto) await deletePhoto(it.id);
}
function renderPhotoStrip(prefix) {
  const list = formPhotos[prefix];
  $(prefix + '-photos').innerHTML = list.map((ph, i) =>
    `<div class="ph"><img src="${ph.src}" alt="照片 ${i + 1}" /><button type="button" class="ph-x" data-ph-del="${prefix}:${i}" aria-label="移除第 ${i + 1} 張照片">✕</button></div>`).join('')
    + (list.length < MAX_PHOTOS ? `<button type="button" class="ph-add" data-ph-add="${prefix}">📷<br>加照片</button>` : '');
}
async function addFormPhoto(prefix, file, maxDim) {
  if (formPhotos[prefix].length >= MAX_PHOTOS) { showError('最多 3 張照片，請先移除一張'); return null; }
  const src = await compressImage(file, maxDim);
  formPhotos[prefix].push({ src, key: null });
  if (prefix === 'pq') renderPhotoQuick(); else renderPhotoStrip(prefix);
  return src;
}
document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-ph-add]');
  if (add) { $(PHOTO_INPUT[add.getAttribute('data-ph-add')]).click(); return; }
  const del = e.target.closest('[data-ph-del]');
  if (del) {
    const [prefix, i] = del.getAttribute('data-ph-del').split(':');
    formPhotos[prefix].splice(Number(i), 1);
    if (prefix === 'pq') renderPhotoQuick(); else renderPhotoStrip(prefix);
  }
});
Object.entries(PHOTO_INPUT).forEach(([prefix, id]) => $(id).addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try { if (await addFormPhoto(prefix, file)) showToast('已附上照片'); } catch (err) { showError('照片讀取失敗'); }
}));
// 修改記錄存檔時：依畫面上的照片更新這筆的第 1 張和 morePhotos，拿掉的照片從這台刪除
async function saveEditPhotos(item) {
  const list = formPhotos.edit;
  const out = { hasPhoto: item.hasPhoto, photoKey: item.photoKey };
  const first = list[0];
  if (!first) {
    if (item.hasPhoto) { await deletePhoto(item.id); setLocalPhotoKey(item.id, null); }
    out.hasPhoto = false;
  } else if (first.key !== '@main') {
    out.photoKey = item.id + '-' + now();
    await savePhoto(item.id, first.src);
    setLocalPhotoKey(item.id, out.photoKey);
    out.hasPhoto = true;
  }
  const more = [];
  for (const ph of list.slice(1)) {
    if (ph.key && ph.key.startsWith('x_')) more.push(ph.key);
    else { const k = newPhotoKey(item.id); await savePhoto(k, ph.src); more.push(k); }
  }
  for (const k of morePhotoKeys(item)) if (!more.includes(k)) await deletePhoto(k);
  out.morePhotos = more;
  return out;
}

/* ---------------- 照營養標示算（自己輸入、修改記錄都有） ---------------- */
// 標示寫「每 35 克 100 大卡」、吃了 7 克 → 自動算好填進熱量和營養素，不用拿計算機
const LB_FIELDS = [['kcal', '熱量（大卡）'], ['p', '蛋白質（克）'], ['f', '脂肪（克）'], ['c', '碳水（克）']];
function labelPhotoText() { return aiKey() ? '📷 拍營養標示，AI 幫我填（照片會一起存）' : aiPasteOn() ? '📷 拍營養標示（可以傳給你的 AI App 讀）' : '📷 拍營養標示（照片會跟這筆一起存）'; }
let addLabelByAi = false;   // 這次「自己輸入」有用 AI 讀營養標示（存成我的食物時記來源）
// 存一樣我的食物（form＝customFoodFromForm 的表單）；同名的不重複存。回傳要接在提示後面的說明
function saveAsMyFood(form, source) {
  const name = String(form.name || '').trim();
  if (manualBarcode) form.barcode = manualBarcode;
  const same = customFoods().find(f => f.name === name);
  if (same) {
    // 從掃條碼來的：同名的還沒有條碼就補上，下次掃得到
    if (form.barcode && !same.barcode) { same.barcode = form.barcode; touch(same); return '。我的食物已經有「' + name + '」，幫它記下條碼了'; }
    return '。我的食物已經有「' + name + '」，沒有重複存';
  }
  if (typeof source === 'string') form.source = source;
  const { food } = customFoodFromForm(form, { id: uid('cf'), now: now() });
  if (!food) return '';
  customFoods().unshift(food);
  return '，也存到我的食物了';
}
function labelCalcHTML(prefix) {
  const inp = (k, ph) => `<input id="${prefix}-lb-${k}" data-lb="${prefix}" type="number" inputmode="decimal" min="0" step="any" placeholder="${ph}" class="field tabular-nums" />`;
  return `<details id="${prefix}-lb" class="lb-calc">
    <summary>🧮 照營養標示算（不用拿計算機）</summary>
    <div class="lb-body">
      <p class="text-base text-stone-600 leading-relaxed">例如標示寫「每 35 克 100 大卡、脂肪 10 克」，你吃了 7 克，會自動算出 20 大卡、脂肪 2 克，填進${prefix === 'add' ? '下面的欄位' : '這筆記錄'}。</p>
      <input id="${prefix}-lb-file" type="file" accept="image/*" capture="environment" class="hidden" />
      <button type="button" data-lb-photo="${prefix}" class="btn-secondary w-full bg-white">${labelPhotoText()}</button>
      <p id="${prefix}-lb-note" class="hidden rounded-2xl whitespace-pre-line break-words p-3 text-base leading-relaxed"></p>
      <div id="${prefix}-lb-paste" class="hidden rounded-xl bg-white border border-stone-200 p-3 space-y-2">
        <button type="button" data-lb-share="${prefix}" class="btn-primary w-full">📤 把標示照片傳給我的 AI App</button>
        <p class="text-base text-stone-700 leading-relaxed">在 AI App 長按輸入框 →「貼上」說明（已複製）、送出；AI 回答後長按 →「複製」，貼在下面。</p>
        <textarea id="${prefix}-lb-pastetext" rows="3" class="field text-base" placeholder="把 AI 的回答貼在這裡"></textarea>
        <button type="button" data-lb-pasteread="${prefix}" class="btn-secondary w-full">讀入 AI 的回答</button>
      </div>
      <div class="lb-line">標示上寫：每 ${inp('g', '克')} 克</div>
      <div class="lb-grid">${LB_FIELDS.map(([k, t]) => `<label><span>${t}</span>${inp(k, '')}</label>`).join('')}</div>
      <div class="lb-line">我吃了 ${inp('eat', '克')} 克
        <button type="button" data-lb-one="${prefix}" class="chip-btn chip-lg">吃了 1 份</button></div>
      <div id="${prefix}-lb-out" class="lb-out" aria-live="polite"></div>
      ${prefix === 'edit' ? `<button type="button" id="edit-lb-mine" class="btn-secondary w-full bg-white">⭐ 照這個標示存成「我的食物」</button>` : ''}
    </div>
  </details>`;
}
document.querySelectorAll('[data-label-calc]').forEach(el => { el.innerHTML = labelCalcHTML(el.getAttribute('data-label-calc')); });
// 修改記錄時：以前照標示算過的（記錄有 label），一鍵存成我的食物（一份＝這次吃的克數）
$('edit-lb-mine').addEventListener('click', () => {
  const lx = labelExtra('edit', 1);
  const name = $('editLogNameInput').value.trim();
  if (!lx) { showToast('先填好標示上的克數、熱量和「我吃了幾克」'); return; }
  if (!name) { showError('請先填食物名稱'); return; }
  const note = saveAsMyFood(formFromManual({ name, nutr: { kcal: lx.label.kcal }, label: lx.label, grams: lx.grams }), 'label');
  if (note.startsWith('，')) { persist(); renderAll(); showToast('已存到我的食物：「' + name + '」，一份 ' + lx.grams + ' 克'); }
  else showToast(note.slice(1));
});
function readLabel(prefix) {
  const v = (k) => $(prefix + '-lb-' + k).value.trim();
  return { g: v('g'), kcal: v('kcal'), p: v('p'), c: v('c'), f: v('f'), eat: v('eat') };
}
function applyLabelCalc(prefix) {
  const l = readLabel(prefix);
  const r = scaleLabel(l, l.eat);
  const out = $(prefix + '-lb-out');
  if (!r) { out.textContent = ''; return; }
  $(KCAL_FIELD[prefix]).value = r.kcal;
  MACRO_KEYS.forEach(k => { if (r[k] != null) $(prefix + '-' + k).value = r[k]; });
  if (prefix === 'add') { setPortion(1); $('addMore').open = true; $('addNutrDetails').open = true; }   // 算出來的就是吃的量
  const parts = [r.kcal + ' 大卡'].concat(['p', 'f', 'c'].filter(k => r[k] != null).map(k => MACRO_META[k].label + ' ' + r[k] + ' 克'));
  out.textContent = '＝ ' + parts.join('、') + (prefix === 'add' ? '（已填進下面）' : '（已填好）');
}
// 這筆要存的標示資料：算得出來才存（之後可以再改、也能變成「我的食物」）
function labelExtra(prefix, mult) {
  const l = readLabel(prefix);
  if (!scaleLabel(l, l.eat)) return null;
  const label = { g: Number(l.g), kcal: Number(l.kcal) };
  ['p', 'c', 'f'].forEach(k => { if (l[k] !== '') label[k] = Number(l[k]); });
  return { label, grams: Math.round(Number(l.eat) * mult * 10) / 10 };
}
function fillLabelCalc(prefix, item) {
  const lb = item && item.label;
  ['g', 'kcal', 'p', 'c', 'f'].forEach(k => { $(prefix + '-lb-' + k).value = lb && lb[k] != null ? lb[k] : ''; });
  $(prefix + '-lb-eat').value = lb && item.grams != null ? item.grams : '';
  $(prefix + '-lb-out').textContent = '';
  setBox(prefix + '-lb-note', null, '');
  $(prefix + '-lb').open = Boolean(lb);
}
function resetLabelCalc(prefix) {
  fillLabelCalc(prefix, null);
  if (prefix === 'add') addLabelByAi = false;
  $(prefix + '-lb-paste').classList.add('hidden');
  $(prefix + '-lb-pastetext').value = '';
  labelPhoto[prefix] = null;
}
function setPortion(v) {
  $('portionSelect').value = String(v);
  document.querySelectorAll('#portionGroup [data-portion]').forEach(x => x.classList.toggle('is-active', x.getAttribute('data-portion') === String(v)));
}
document.addEventListener('input', (e) => {
  const prefix = e.target.getAttribute && e.target.getAttribute('data-lb');
  if (prefix) applyLabelCalc(prefix);
});
document.addEventListener('click', (e) => {
  const one = e.target.closest('[data-lb-one]');
  if (one) {
    const prefix = one.getAttribute('data-lb-one');
    const g = $(prefix + '-lb-g').value;
    if (!g) { showToast('先填標示上「每幾克」'); return; }
    $(prefix + '-lb-eat').value = g;
    applyLabelCalc(prefix);
    return;
  }
  const ph = e.target.closest('[data-lb-photo]');
  if (ph) $(ph.getAttribute('data-lb-photo') + '-lb-file').click();
});
const labelPhoto = { add: null, edit: null };   // 這次拍的營養標示（傳給 AI App 用）
document.addEventListener('click', async (e) => {
  const share = e.target.closest('[data-lb-share]');
  const read = e.target.closest('[data-lb-pasteread]');
  if (share) {
    const prefix = share.getAttribute('data-lb-share');
    const how = await shareToAi(LABEL_PASTE_PROMPT, labelPhoto[prefix]);
    if (how === 'copied') { setBox(prefix + '-lb-note', 'info', '說明已經複製好了。請打開你的 AI App，貼上說明，再附上營養標示的照片。'); savePhotoFile(labelPhoto[prefix]); }
    else if (how === 'failed') setBox(prefix + '-lb-note', 'err', '這台裝置沒辦法自動複製和分享。請對照照片自己填下面的數字。');
  } else if (read) {
    const prefix = read.getAttribute('data-lb-pasteread');
    const lb = labelFromPaste($(prefix + '-lb-pastetext').value);
    if (!lb) { setBox(prefix + '-lb-note', 'err', '讀不到 AI 的回答：請把 AI 回答的整段（表格）複製、貼上。AI 說找不到營養標示的話，拍清楚一點再試。'); return; }
    applyLabelResult(prefix, lb);
    $(prefix + '-lb-pastetext').value = '';
    $(prefix + '-lb-paste').classList.add('hidden');
  }
});
['add', 'edit'].forEach(prefix => $(prefix + '-lb-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let src = null;
  try { src = await addFormPhoto(prefix, file, 1280); } catch (err) { showError('照片讀取失敗'); return; }   // 標示的字小，解析度高一點
  if (!src) return;
  labelPhoto[prefix] = src;
  if (aiKey()) readLabelByAi(prefix, src);
  else if (aiPasteOn()) { $(prefix + '-lb-paste').classList.remove('hidden'); setBox(prefix + '-lb-note', 'info', '照片存好了。可以按下面的按鈕傳給你的 AI App 讀，或對照著自己填。'); }
  else showToast('已附上營養標示照片，對照著填下面的數字');
}));
renderPhotoStrip('add');

$('addFoodForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const kcalRaw = $('foodKcalInput').value.trim();
  const hasKcal = kcalRaw !== '';
  const kcal = hasKcal ? Number(kcalRaw) : 0;
  const pendingChecked = $('pendingVerifyCheck').checked;
  const nutr = readNutrFields('add');
  const photos = formPhotos.add.map(p => p.src);
  if (!hasKcal && !photos.length && !pendingChecked) {
    showError('請輸入熱量，或先拍照／勾選「暫估待修」');
    return;
  }
  if (!Number.isFinite(kcal) || kcal < 0) return;
  const rawName = $('foodNameInput').value.trim();
  // 沒填名稱會自動叫「午餐拍照待查」：這種名字存進我的食物，之後就認不出是什麼
  if (!rawName && $('saveMineCheck').checked) {
    showError('要存到「我的食物」，請先在最上面填名稱，例如「全聯雞胸肉」。\n不想存的話，把「也存到我的食物」取消勾選。');
    $('foodNameInput').focus();
    return;
  }
  const mealLabel = MEAL_META[ui.meal].label;
  const name = rawName || (photos.length ? mealLabel + '拍照待查' : mealLabel + '快記');
  const mult = Number($('portionSelect').value) || 1;
  await addEntry({
    name, nutr: { kcal, ...nutr }, mult, meal: ui.meal,
    photo: photos[0] || null, morePhotos: photos.slice(1),
    pending: pendingChecked || (!hasKcal && photos.length > 0), saveMine: $('saveMineCheck').checked && (addLabelByAi ? 'ai-label' : true),
    extra: labelExtra('add', mult)
  });
  $('addFoodForm').reset();
  setPortion(1);
  writeNutrFields('add', null);
  resetLabelCalc('add');
  $('addNutrDetails').open = false;
  $('kjDetails').open = false;
  $('addMore').open = false;
  $('kjResult').textContent = '';
  formPhotos.add = [];
  renderPhotoStrip('add');
  closeScreen();
});

/* ---------------- 事件：明細（看照片／修改／刪除） ---------------- */
let lightboxItemId = null;
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
  formPhotos.edit = [];
  if (item.hasPhoto) { const src = await getPhoto(item.id); if (src) formPhotos.edit.push({ src, key: '@main' }); }
  for (const k of morePhotoKeys(item)) { const src = await getPhoto(k); if (src) formPhotos.edit.push({ src, key: k }); }
  renderPhotoStrip('edit');
  fillLabelCalc('edit', item);
  const lk = item.lookup;
  const lkText = lk ? [sizeText(lk), (lookupCat(lk.cat) || {}).label].filter(Boolean).join('・') : '';
  $('editLookupInfo').classList.toggle('hidden', !lkText);
  $('editLookupInfo').textContent = '記的時候用手比：' + lkText;
  openModal('editLogModal');
}
$('editLogForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const list = state.logs[ui.date] || [];
  const idx = list.findIndex(i => i.id === editingId);
  const name = $('editLogNameInput').value.trim();
  const kcal = Math.round(Number($('editLogKcalInput').value));
  if (idx === -1 || !name || !Number.isFinite(kcal) || kcal < 0) return;
  const n = readNutrFields('edit');
  const item = list[idx];
  const photoFields = await saveEditPhotos(item);
  list[idx] = {
    ...item, name, kcal, meal: $('editLogMealSelect').value, time: $('editLogTimeInput').value || item.time,
    pending: $('editLogPendingCheck').checked, p: n.p, c: n.c, f: n.f, ex: n.ex,
    ...photoFields,
    ...(labelExtra('edit', 1) || {}),
    updatedAt: now()
  };
  if (!list[idx].morePhotos || !list[idx].morePhotos.length) delete list[idx].morePhotos;
  persist();
  renderAll();
  closeModal('editLogModal');
  showToast('已更新記錄');
});

$('mealLogContainer').addEventListener('click', async (e) => {
  const view = e.target.closest('.view-photo-btn');
  if (view) { openLightbox(ui.date, view.getAttribute('data-view-photo')); return; }
  const edit = e.target.closest('.edit-entry-btn');
  if (edit) { openEditModal(edit.getAttribute('data-edit-id')); return; }
  const del = e.target.closest('.del-entry-btn');
  if (del) deleteEntry(del.getAttribute('data-del-id'));
});
// 看大圖（首頁的記錄、照片牆共用）；date＝記錄在哪一天
let lightboxDate = null;
async function openLightbox(date, id) {
  const item = (state.logs[date] || []).find(i => i.id === id);
  if (!item) return;
  lightboxItemId = item.id;
  lightboxDate = date;
  $('lightboxFoodTitle').textContent = item.name + (item.pending ? '（暫估待修）' : '');
  $('lightboxFoodSub').textContent = (date === ui.date ? '' : fmtMD(date) + ' ') + MEAL_META[item.meal].label + '・目前 ' + item.kcal + ' kcal';
  $('lightboxImgs').innerHTML = (await entryPhotos(item)).map((src, i) =>
    `<img src="${src}" alt="照片 ${i + 1}" class="max-h-[60vh] w-auto object-contain" />`).join('');
  openModal('photoLightboxModal');
}
$('lightboxEditEntryBtn').addEventListener('click', () => {
  closeModal('photoLightboxModal');
  if (!lightboxItemId) return;
  // 從照片牆看別天的：修改頁只看「現在顯示的那天」，先切過去
  if (lightboxDate && lightboxDate !== ui.date) { ui.date = lightboxDate; renderAll(); }
  openEditModal(lightboxItemId);
});

/* ---------------- 血壓、血糖（js/vitals.js；⚙️ 功能開關打開才出現） ---------------- */
// 每日欄位 bp、glucose：一天好幾次，整個陣列一起換（setDayField 記修改時間）
const dayLabelText = () => (ui.date === todayStr() ? '今天' : fmtMD(ui.date));
function readingRows(list, text, attr) {
  return list.length ? list.map(r => `<div class="flex items-center gap-2 bg-white rounded-xl border border-stone-200 p-3">
      <span class="min-w-0 flex-1 text-lg font-semibold text-stone-900 tabular-nums">${esc(text(r))}</span>
      <button type="button" ${attr}="${esc(r.id)}" class="chip-btn chip-lg shrink-0" aria-label="刪除這次">✕</button></div>`).join('')
    : '<p class="text-base text-stone-500">還沒有</p>';
}
function renderBp() {
  $('bpDayLabel').textContent = dayLabelText();
  const list = getDay(ui.date).bp || [];
  $('bpList').innerHTML = readingRows(list, r => bpText([r]), 'data-bp-del');
}
$('bpAddBtn').addEventListener('click', () => {
  const { reading, error } = bpReading({ sys: $('bpSys').value, dia: $('bpDia').value, pulse: $('bpPulse').value, t: $('bpTime').value }, uid('bp'));
  if (error) { setBox('bpNote', 'err', error); return; }
  setDayField('bp', [...(getDay(ui.date).bp || []), reading].sort((a, b) => String(a.t).localeCompare(String(b.t))));
  const alert = bpAlert(reading);
  setBox('bpNote', alert ? (alert.level === 'urgent' ? 'err' : 'info') : 'ok', '記下來了：' + reading.sys + '/' + reading.dia + (alert ? '\n' + alert.text : ''));
  ['bpSys', 'bpDia', 'bpPulse'].forEach(x => { $(x).value = ''; });
  renderBp();
  renderFeatureTiles();
});
$('bpList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-bp-del]');
  if (!b) return;
  const next = (getDay(ui.date).bp || []).filter(r => r.id !== b.getAttribute('data-bp-del'));
  setDayField('bp', next.length ? next : null);
  renderBp();
  renderFeatureTiles();
});
let glKind = 'fasting';
function renderGlucose() {
  $('glKinds').innerHTML = GLUCOSE_KINDS.map(([k, l]) => `<button type="button" data-gl-kind="${k}" class="toggle-btn ${k === glKind ? 'is-active' : ''}">${l}</button>`).join('');
  $('glDayLabel').textContent = dayLabelText();
  const list = getDay(ui.date).glucose || [];
  $('glList').innerHTML = readingRows(list, r => glucoseText([r]), 'data-gl-del');
}
$('glKinds').addEventListener('click', (e) => {
  const b = e.target.closest('[data-gl-kind]');
  if (!b) return;
  glKind = b.getAttribute('data-gl-kind');
  renderGlucose();
});
$('glAddBtn').addEventListener('click', () => {
  const { reading, error } = glucoseReading({ kind: glKind, v: $('glValue').value, t: $('glTime').value }, uid('gl'));
  if (error) { setBox('glNote', 'err', error); return; }
  setDayField('glucose', [...(getDay(ui.date).glucose || []), reading].sort((a, b) => String(a.t).localeCompare(String(b.t))));
  const alert = glucoseAlert(reading);
  setBox('glNote', alert ? 'err' : 'ok', '記下來了：' + glucoseKindLabel(reading.kind) + ' ' + reading.v + (alert ? '\n' + alert.text : ''));
  $('glValue').value = '';
  renderGlucose();
  renderFeatureTiles();
});
$('glList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-gl-del]');
  if (!b) return;
  const next = (getDay(ui.date).glucose || []).filter(r => r.id !== b.getAttribute('data-gl-del'));
  setDayField('glucose', next.length ? next : null);
  renderGlucose();
  renderFeatureTiles();
});

/* ---------------- 營養師的叮嚀（js/advice.js） ---------------- */
// 最上層 advice：[{ id, text, from, date, active, updatedAt }]，一條一條同步（tomb 'advice:<id>'）
function adviceList() {
  if (!Array.isArray(state.advice)) state.advice = [];
  return state.advice;
}
// 首頁卡片：有叮嚀才出現；未來的日子不出現。做到了記在那天的 adviceDone
function renderAdviceCard() {
  const today = todaysAdvice(adviceList(), ui.date);
  const show = today.length > 0 && ui.date <= todayStr();
  $('adviceCard').classList.toggle('hidden', !show);
  const n = activeAdvice(adviceList()).length;
  $('adviceTileSub').textContent = n ? '現在有 ' + n + ' 條，首頁每天輪流提醒' : '把營養師在 LINE、門診說的話存進來，每天提醒';
  if (!show) return;
  const done = (getDay(ui.date) || {}).adviceDone || [];
  $('adviceToday').innerHTML = today.map(a => {
    const ok = done.includes(a.id);
    return `<li class="flex items-center gap-2 bg-white rounded-xl border border-sky-100 p-2">
      <span class="min-w-0 flex-1 text-lg text-stone-900 leading-snug break-words">${esc(a.text)}</span>
      <button type="button" data-advice-done="${esc(a.id)}" class="shrink-0 ${ok ? 'btn-primary' : 'btn-secondary'} px-3" aria-pressed="${ok}">${ok ? '✓ 做到了' : '今天做到了'}</button></li>`;
  }).join('');
}
$('adviceToday').addEventListener('click', (e) => {
  const b = e.target.closest('[data-advice-done]');
  if (!b) return;
  const id = b.getAttribute('data-advice-done');
  const next = toggleDone((getDay(ui.date) || {}).adviceDone, id);
  setDayField('adviceDone', next.length ? next : null);
  renderAdviceCard();
  if (next.includes(id)) showToast('很好！營養師看報告時會看到 👍');
});
function renderAdviceScreen() {
  const on = activeAdvice(adviceList());
  const off = adviceList().filter(a => a.active === false);
  const sub = (a) => [a.from, a.date ? fmtMD(a.date) + ' 說的' : ''].filter(Boolean).join('・');
  $('adviceList').innerHTML = on.length ? on.map(a => `<div class="rounded-2xl bg-sky-50 border border-sky-200 p-3 space-y-2">
      <div class="text-lg font-semibold text-stone-900 leading-snug break-words">${esc(a.text)}</div>
      ${sub(a) ? `<div class="text-sm text-stone-500">${esc(sub(a))}</div>` : ''}
      <button type="button" data-advice-off="${esc(a.id)}" class="chip-btn chip-lg">不用再提醒</button></div>`).join('')
    : '<p class="rounded-2xl bg-stone-50 text-stone-600 p-4 text-base leading-relaxed">還沒有。把營養師說的話貼在下面，存起來之後，首頁每天會輪流提醒 2 條，可以按「今天做到了」；給營養師的報告會列出每一條做到幾天。</p>';
  $('adviceOff').classList.toggle('hidden', !off.length);
  $('adviceOffList').innerHTML = off.map(a => `<div class="flex items-center gap-2">
      <span class="min-w-0 flex-1 text-base text-stone-600 break-words">${esc(a.text)}</span>
      <button type="button" data-advice-on="${esc(a.id)}" class="chip-btn chip-lg shrink-0">再提醒</button>
      <button type="button" data-advice-del="${esc(a.id)}" class="chip-btn chip-lg shrink-0">刪除</button></div>`).join('');
}
$('scr-advice').addEventListener('click', (e) => {
  const off = e.target.closest('[data-advice-off]');
  const on = e.target.closest('[data-advice-on]');
  const del = e.target.closest('[data-advice-del]');
  const id = (off || on || del) && (off || on || del).getAttribute(off ? 'data-advice-off' : on ? 'data-advice-on' : 'data-advice-del');
  const a = id && adviceList().find(x => x.id === id);
  if (!a) return;
  if (del) {
    openConfirm('刪除這條叮嚀', '「' + a.text + '」。以前按過的「做到了」會留在記錄裡，但報告不會再列這一條。', () => {
      adviceList().splice(adviceList().indexOf(a), 1);
      tombstone('advice:' + a.id);
      persist(); renderAll(); renderAdviceScreen();
    }, '刪除');
    return;
  }
  a.active = Boolean(on);
  touch(a);
  persist(); renderAll(); renderAdviceScreen();
  if (off) showToast('這條不會再出現在首頁，在「不用再提醒的」可以恢復');
});
// 貼上的話 → 一條一條（可以改字、拿掉）→ 存起來
let adviceDraft = [];
function renderAdviceDraft() {
  $('advicePreview').classList.toggle('hidden', !adviceDraft.length);
  $('adviceSaveBtn').classList.toggle('hidden', !adviceDraft.length);
  $('adviceSaveBtn').textContent = '存起來（' + adviceDraft.length + ' 條）';
  $('advicePreview').innerHTML = '<div class="text-base text-stone-600">看一下對不對，可以改字、拿掉不要的：</div>' + adviceDraft.map((t, i) => `<div class="flex items-center gap-2">
      <input type="text" data-advice-edit="${i}" value="${esc(t)}" class="field text-lg min-w-0 flex-1" />
      <button type="button" data-advice-drop="${i}" class="chip-btn chip-lg shrink-0" aria-label="拿掉">✕</button></div>`).join('');
}
$('adviceSplitBtn').addEventListener('click', () => {
  adviceDraft = splitAdvice($('advicePaste').value);
  renderAdviceDraft();
  setBox('adviceNote', adviceDraft.length ? null : 'err', adviceDraft.length ? '' : '沒有讀到叮嚀。請貼上營養師說的話，一行一條。');
});
$('advicePreview').addEventListener('input', (e) => {
  const inp = e.target.closest('[data-advice-edit]');
  if (inp) adviceDraft[Number(inp.getAttribute('data-advice-edit'))] = inp.value;
});
$('advicePreview').addEventListener('click', (e) => {
  const b = e.target.closest('[data-advice-drop]');
  if (!b) return;
  adviceDraft.splice(Number(b.getAttribute('data-advice-drop')), 1);
  renderAdviceDraft();
});
$('adviceSaveBtn').addEventListener('click', () => {
  const texts = adviceDraft.map(t => t.trim()).filter(Boolean);
  if (!texts.length) return;
  const from = $('adviceFrom').value.trim();
  const date = $('adviceDate').value || todayStr();
  const have = new Set(activeAdvice(adviceList()).map(a => a.text));
  const add = texts.filter(t => !have.has(t)).map(text => ({ id: uid('ad'), text, from: from || null, date, active: true, updatedAt: now() }));
  adviceList().push(...add);
  state.meta.adviceFrom = from;   // 下次預填（只存本機）
  persist();
  renderAll();
  adviceDraft = [];
  $('advicePaste').value = '';
  renderAdviceDraft();
  renderAdviceScreen();
  setBox('adviceNote', 'ok', '存好了 ' + add.length + ' 條' + (texts.length > add.length ? '（' + (texts.length - add.length) + ' 條已經有了）' : '') + '。首頁每天會輪流提醒 2 條。');
});

/* ---------------- 餐點照片牆（js/photowall.js） ---------------- */
let wallMonday = null;
function renderPhotoWall() {
  const dates = weekOf(wallMonday);
  const today = todayStr();
  const shown = dates.filter(d => d <= today);   // 還沒到的日子不列
  const days = wallDays(state.logs, shown, MEAL_KEYS).reverse();   // 最近的在上面
  $('wallRange').textContent = fmtMD(dates[0]) + '～' + fmtMD(dates[6]);
  $('wallNext').disabled = dates[6] >= today;
  const n = wallPhotoCount(days);
  $('wallSummary').textContent = n ? '這週有 ' + n + ' 筆附照片的記錄。' : '這週還沒有附照片的記錄。記的時候拍一張，回頭看很有感覺，給營養師看也比較清楚。';
  $('wallDays').innerHTML = days.map(d => `<section class="space-y-2">
      <div class="flex items-baseline gap-2 flex-wrap">
        <span class="text-lg font-bold text-stone-900">${esc(fmtMD(d.date))}（${WEEKDAY[parseDate(d.date).getDay()]}）</span>
        <span class="text-base text-stone-500 tabular-nums">${d.count ? '共 ' + d.kcal + ' 大卡・記了 ' + d.count + ' 筆' : '沒有記錄'}</span>
      </div>
      ${d.items.length ? `<div class="grid grid-cols-3 gap-2">${d.items.map(it => `<button type="button" data-wall="${esc(d.date)}|${esc(it.id)}" class="wall-cell" aria-label="${esc(MEAL_META[it.meal].label + ' ' + it.name)}">
          <img data-photo-id="${esc(it.id)}" alt="" class="wall-img" />
          <span class="block text-sm font-semibold text-stone-800 leading-tight">${MEAL_META[it.meal].label}${it.pending ? '<span class="text-amber-700">・待查</span>' : ''}</span>
          <span class="block text-sm text-stone-500 tabular-nums">${it.kcal} 大卡</span>
        </button>`).join('')}</div>` : (d.count ? '<p class="text-base text-stone-400">這天的記錄沒有照片</p>' : '')}
    </section>`).join('');
  hydratePhotos($('wallDays'));
}
$('wallPrev').addEventListener('click', () => { wallMonday = addDays(wallMonday, -7); renderPhotoWall(); $('scr-photowall').querySelector('.scr-body').scrollTop = 0; });
$('wallNext').addEventListener('click', () => { wallMonday = addDays(wallMonday, 7); renderPhotoWall(); $('scr-photowall').querySelector('.scr-body').scrollTop = 0; });
$('wallDays').addEventListener('click', (e) => {
  const c = e.target.closest('[data-wall]');
  if (!c) return;
  const [date, id] = c.getAttribute('data-wall').split('|');
  openLightbox(date, id);
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
    for (const it of list) { await deleteEntryPhotos(it); tombstone('e:' + it.id); }
    delete state.logs[ui.date];
    persist();
    renderAll();
    showToast('已清空本日記錄');
  }, '刪除');
});

/* ---------------- 我的食物（customFoods）：新增／修改／刪除 ---------------- */
// 取代原本的「常吃的」。記的時候和查食物同一套流程：選食物 → 填幾克（或幾份）→ 加入這一餐 → 記到午餐
function customFoods() {
  if (!Array.isArray(state.customFoods)) state.customFoods = [];
  return state.customFoods;
}
function isMine(food) { return Boolean(food && customFoods().includes(food)); }
// 我的食物清單要列的：歸到資料庫的（packId）在資料庫裡找，不放這裡，清單才不會越來越長
function myLoose() { return looseMine(customFoods(), allPacks()); }
// 畫面用的資料庫：原本匯入的＋自己加、改過的（js/packs.js 的 packsWithMine）
function packsView() { return packsWithMine(allPacks(), customFoods()); }
function myFoodRowHTML(f, action) {
  const attr = action === 'edit' ? `data-mf-edit="${esc(f.id)}"` : `data-cf-id="${esc(f.id)}"`;
  const row = `<button type="button" ${attr} class="pick-row${action === 'edit' ? '' : ' min-w-0 flex-1'}">
    <span class="min-w-0 flex-1 text-left"><span class="block text-lg font-semibold text-stone-900 leading-snug break-words">${action === 'edit' ? '' : '<span class="mr-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-sm font-bold align-middle">我的</span>'}${esc(f.name)}</span>
    <span class="block text-base text-emerald-700 font-bold tabular-nums">一份 ${esc(servingText(f))}　${servingKcal(f)} kcal</span></span>
    <span class="pick-add">${action === 'edit' ? '修改' : '選擇 ›'}</span>
  </button>`;
  // 選食物的地方也能直接修改（名字、數字錯了不用再去找下方分頁）
  return action === 'edit' ? row : `<div class="flex gap-2 items-stretch">${row}<button type="button" data-mf-edit="${esc(f.id)}" class="mine-edit" aria-label="修改${esc(f.name)}">✏️<span>修改</span></button></div>`;
}
// 查食物頁上方：我的食物（「⭐ 我的食物」打開時沒打字就列全部，最常記的在前）
let foodMode = 'all';
function renderFoodMine(q) {
  const all = myLoose();
  const list = q ? searchMine(all, q) : foodMode === 'mine' ? sortByUse(all, state.logs) : [];
  const add = '<button type="button" data-mf-new class="btn-secondary w-full">＋ 新增我的食物</button>';
  let html = '';
  const cbs = q ? searchCombos(combos(), q) : foodMode === 'mine' ? sortCombos(combos(), state.logs) : [];
  if (cbs.length) html += '<div class="sec-title px-1">🍱 我的套餐</div>' + cbs.map(c => comboRowHTML(c, 'pick')).join('');
  if (list.length) html += '<div class="sec-title px-1">⭐ 我的食物</div>' + list.map(f => myFoodRowHTML(f, 'pick')).join('');
  if (!q && foodMode === 'mine') {
    html += all.length ? add : `<div class="rounded-2xl bg-stone-50 p-4 space-y-3 text-base text-stone-600 leading-relaxed">
      <p>還沒有我的食物。常吃的東西照包裝上的營養標示存一次，之後點一下、填吃了多少就記好。</p>${add}
      <p class="text-sm">也可以直接在上面打字，查衛福部的食品資料庫。</p></div>`;
  }
  $('foodMine').innerHTML = html;
}
document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-food-open]');
  if (open) { foodMode = open.getAttribute('data-food-open'); openScreen('scr-food'); return; }
  const pick = e.target.closest('[data-cf-id]');
  if (pick) { const f = customFoods().find(x => x.id === pick.getAttribute('data-cf-id')); if (f) openGrams(f); return; }
  const edit = e.target.closest('[data-mf-edit]');
  if (edit) { const f = customFoods().find(x => x.id === edit.getAttribute('data-mf-edit')); if (f) openMyFood(f); return; }
  if (e.target.closest('[data-mf-new]')) openMyFood(null, $('foodSearch').value.trim() && screenStack.includes('scr-food') ? $('foodSearch').value.trim() : '');
});
$('myFoodAddBtn').addEventListener('click', () => openMyFood(null));
$('myFoodSelectBtn').addEventListener('click', () => { mfSelected = new Set(); renderMyFoods(); });
$('myFoodSelectDone').addEventListener('click', () => { mfSelected = null; renderMyFoods(); });
$('myFoodList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mf-sel]');
  if (!b || !mfSelected) return;
  const id = b.getAttribute('data-mf-sel');
  if (mfSelected.has(id)) mfSelected.delete(id); else mfSelected.add(id);
  renderMyFoods();
});
const selectedFoods = () => customFoods().filter(f => mfSelected && mfSelected.has(f.id));
$('myFoodShareSelBtn').addEventListener('click', () => {
  const foods = selectedFoods();
  if (!foods.length) { showToast('先點食物勾選'); return; }
  shareFile('我的食物_' + todayStr() + '.json', JSON.stringify(myFoodsFile(foods)), 'application/json',
    '已下載。對方在「我的食物 → 匯入別人分享的食物」選這個檔案');
});
$('myFoodMoveBtn').addEventListener('click', () => {
  if (!selectedFoods().length) { showToast('先點食物勾選'); return; }
  openScreen('scr-move');
});
$('myFoodSearch').addEventListener('input', renderMyFoods);
$('mf-ex').innerHTML = EX_KEYS.map(k => `<label class="block"><span class="block text-sm text-stone-600 mb-1">${EX_META[k].emoji} ${EX_META[k].short}（份）</span><input id="mf-ex-${k}" type="number" inputmode="decimal" min="0" step="any" class="field tabular-nums text-center" /></label>`).join('');
const MF_FIELDS = ['name', 'servingG', 'servingLabel', 'kcal', 'p', 'f', 'c', 'sugar', 'na', 'fiber'];
let mfEditing = null;
let mfThenRecord = false;   // 從掃條碼來的：存好直接進「吃了多少」
let mfSource = null;        // 新增時記的來源（'off'＝Open Food Facts）
let mfPack = null;          // 存到資料庫：{ packId, brand, replaces }（replaces＝改資料庫原本的哪一樣）
// prefill：掃條碼查到的表單（Open Food Facts 的數字，或只有條碼）
// pack：新增到資料庫、或改資料庫原本的一樣（{ packId, brand, replaces, from＝原本那一樣 }）
function openMyFood(food, name = '', prefill = null, pack = null) {
  mfEditing = food ? food.id : null;
  mfThenRecord = Boolean(prefill);
  mfSource = (prefill && prefill.source) || null;
  const inPack = food && food.packId && allPacks().find(p => p.id === food.packId);
  mfPack = inPack ? { packId: food.packId, brand: food.brand || '', replaces: food.replaces || null } : pack;
  const form = food ? formFromCustomFood(food) : pack && pack.from ? formFromCustomFood(pack.from) : prefill ? { ...prefill } : { name, ex: {} };
  MF_FIELDS.forEach(k => { $('mf-' + k).value = form[k] == null ? '' : form[k]; });
  EX_KEYS.forEach(k => { $('mf-ex-' + k).value = form.ex && form.ex[k] ? form.ex[k] : ''; });
  const barcode = (food && food.barcode) || (prefill && prefill.barcode) || '';
  $('mf-barcode').value = barcode;
  $('mf-more').open = Boolean((food || prefill) && (form.sugar !== '' || form.na !== '' || form.fiber !== '' || Object.keys(form.ex || {}).length || barcode));
  const pk = mfPack && allPacks().find(p => p.id === mfPack.packId);
  $('mf-packBox').classList.toggle('hidden', !pk);
  $('mf-unpack').classList.toggle('hidden', !(food && pk));
  if (pk) {
    $('mf-brand').value = mfPack.brand || '';
    $('mf-brandList').innerHTML = brandsOf(packsView().filter(p => p.id === pk.id)).map(b => `<option value="${esc(b.brand)}"></option>`).join('');
    $('mf-packText').textContent = mfPack.replaces ? '這是「' + pk.name + '」原本的一樣。存了之後，查到的會是你改過的數字（原本的藏起來；刪掉你改的就恢復）。' : '存在「' + pk.name + '」資料庫裡：查食物、外食怎麼點都找得到，不會讓我的食物清單變長。';
  }
  $('myFoodTitle').textContent = pk ? (food || mfPack.replaces ? '🏪 修改資料庫的食物' : '🏪 新增到「' + pk.name + '」') : food ? '⭐ 修改我的食物' : '⭐ 新增我的食物';
  $('mf-delete').classList.toggle('hidden', !food);
  $('mf-contrib').classList.toggle('hidden', !(food && !food.replaces && INVITE_URL && canSendFeedback(state.meta.invite)));
  const sent = food && state.meta.contribs && state.meta.contribs[food.id];
  $('mf-contrib').textContent = sent ? '📮 已推薦過（' + fmtTime(sent) + '），再推薦一次' : '📮 推薦給外食圖書館（讓大家都查得到）';
  $('mf-delete').textContent = food && food.replaces && pk ? '不要我改的，恢復原本的' : '刪除這樣食物';
  setBox('mf-note', prefill ? 'info' : null, prefill ? (prefill.source === 'off' ? '數字來自 Open Food Facts（大家一起建的國際資料庫），請對照包裝上的營養標示，不對就改掉再存。' : '照包裝上的營養標示填，存好之後下次掃這個條碼就找得到。') : '');
  openScreen('scr-myfood');
}
function afterMyFoodChange() {
  persist();
  renderAll();
  if (screenStack.includes('scr-food')) renderFoodResults();
  if (screenStack.includes('scr-pack')) renderPackScreen();
  if (screenStack.includes('scr-eatout') && !$('eoPlan').classList.contains('hidden')) renderEatoutPlan();
}
$('mf-save').addEventListener('click', () => {
  const form = { ex: {} };
  MF_FIELDS.forEach(k => { form[k] = $('mf-' + k).value.trim(); });
  EX_KEYS.forEach(k => { form.ex[k] = $('mf-ex-' + k).value; });
  const old = mfEditing ? customFoods().find(f => f.id === mfEditing) : null;
  // 以後才有的欄位（別名、來源…）保留
  ['aliases', 'category', 'source', 'note'].forEach(k => { if (old && old[k] != null) form[k] = old[k]; });
  const bcRaw = $('mf-barcode').value.trim();
  form.barcode = normalizeBarcode(bcRaw);
  if (bcRaw && !form.barcode) { setBox('mf-note', 'err', '條碼是 8～14 位數字，請再確認一次'); return; }
  const bcOwner = form.barcode && customFoods().find(f => f !== old && f.barcode && findByBarcode(form.barcode, { mine: [f] }));
  if (bcOwner) { setBox('mf-note', 'err', '「' + bcOwner.name + '」已經用這個條碼了'); return; }
  if (!old && mfSource) form.source = mfSource;
  const { food, error } = customFoodFromForm(form, { id: old ? old.id : uid('cf'), now: now() });
  if (error) { setBox('mf-note', 'err', error); return; }
  if (mfPack) Object.assign(food, packFields(food, { packId: mfPack.packId, brand: $('mf-brand').value }), mfPack.replaces ? { replaces: mfPack.replaces } : {});
  // 同名：我的食物裡不能重複；資料庫裡同一家店不能重複（不同店可以都有「鍋貼」）
  const sameName = (f) => f !== old && f.name === food.name && (mfPack ? f.packId === food.packId && (f.brand || '') === (food.brand || '') : !myLoose().every(x => x !== f));
  if (customFoods().some(sameName)) { setBox('mf-note', 'err', '已經有「' + food.name + '」了，請換個名稱' + (mfPack ? '' : '（例如加上店名）')); return; }
  const list = customFoods();
  if (old) list[list.indexOf(old)] = food; else list.unshift(food);
  const pkName = mfPack && (allPacks().find(p => p.id === mfPack.packId) || {}).name;
  afterMyFoodChange();
  if (mfThenRecord && !old) afterClose(() => openGrams(food)); else closeScreen();
  showToast((old ? '已更新' : pkName ? '已存到「' + pkName + '」：' : '已存到我的食物：') + '「' + food.name + '」');
});
$('mf-delete').addEventListener('click', () => {
  const list = customFoods();
  const food = list.find(f => f.id === mfEditing);
  if (!food) return;
  const msg = food.replaces && food.packId ? '會恢復資料庫原本的數字，已經記的飲食記錄不會改變。' : food.packId ? '只會從資料庫拿掉你加的這一樣，已經記的飲食記錄不會改變。' : '只會從我的食物拿掉，已經記的飲食記錄不會改變。';
  openConfirm(food.replaces && food.packId ? '恢復原本的「' + food.name + '」' : '刪除「' + food.name + '」', msg, () => {
    const idx = list.indexOf(food);
    list.splice(idx, 1);
    tombstone('customFoods:' + food.id);
    afterMyFoodChange();
    closeScreen();
    showToast('已刪除「' + food.name + '」', '復原', () => {
      delete state.tomb['customFoods:' + food.id];
      touch(food);
      customFoods().splice(idx, 0, food);
      afterMyFoodChange();
    });
  }, '刪除');
});

// 資料庫裡自己加的 → 移回我的食物（改過原本那一樣的：原本的會回來，這一樣變成我的食物）
$('mf-unpack').addEventListener('click', () => {
  const food = customFoods().find(f => f.id === mfEditing);
  if (!food) return;
  ['packId', 'replaces', 'base', 'variant'].forEach(k => { delete food[k]; });
  touch(food);
  afterMyFoodChange();
  closeScreen();
  showToast('已移回我的食物：「' + food.name + '」');
});

/* ---------------- 食物資料庫（foodPacks） ---------------- */
// 使用者／營養師用整理工具（tools/foodpack.html）做的資料庫檔，匯入後同步到自己的其他裝置。格式見 js/packs.js
function foodPacks() {
  if (!Array.isArray(state.foodPacks)) state.foodPacks = [];
  return state.foodPacks;
}
// 共用資料庫（管理者發佈、自動更新）：存在這台的 IndexedDB（js/db.js 的 sharedDB），不同步；meta.shared 記著哪幾份、哪一版
let sharedPacks = [];
// 讀資料庫一律用這個（自己匯入的＋共用的）；要改、要同步的才用 foodPacks()
function allPacks() { return withShared(sharedPacks, foodPacks()); }
// 查食物、外食小幫手用：外食圖書館只列勾選的店（找記錄來源、套餐、條碼還是用全部的）
const libraryOff = () => (state.libraryOff && Array.isArray(state.libraryOff.brands) ? state.libraryOff.brands : []);
function pickedPacks() { return packsWithMine(withShared(pickShared(sharedPacks, libraryOff()), foodPacks()), customFoods()); }
// 交給畫面的資料庫食物 → 它在哪個資料庫（記錄要記 src／srcName）。同步會換掉物件，所以每次查到時重新登記
const foodPack = new WeakMap();
// 查食物上方：只查某一個（全部／我的／衛福部／各資料庫）。沒有資料庫時不顯示，和以前一樣
let foodFilter = '';
function renderFoodFilter() {
  const packs = allPacks();
  const box = $('foodFilter');
  if (!packs.length) { box.innerHTML = ''; foodFilter = ''; return; }
  if (foodFilter && !['mine', 'tfda'].includes(foodFilter) && !packs.some(p => p.id === foodFilter)) foodFilter = '';
  const chips = [['', '全部'], ['mine', '我的'], ...packs.map(p => [p.id, p.name]), ['tfda', '衛福部']];
  box.innerHTML = chips.map(([k, l]) => `<button type="button" data-food-filter="${esc(k)}" class="toggle-btn chip-lg ${foodFilter === k ? 'is-active' : ''}">${esc(l)}</button>`).join('');
}
$('foodFilter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-food-filter]');
  if (!b) return;
  foodFilter = b.getAttribute('data-food-filter');
  renderFoodResults();
});
const kcalRange = (foods) => {
  const ks = foods.map(servingKcal);
  const lo = Math.min(...ks), hi = Math.max(...ks);
  return lo === hi ? lo + ' kcal' : lo + '～' + hi + ' kcal';
};
let packGroups = [];
function renderFoodPacks(q) {
  const box = $('foodPacks');
  const packs = pickedPacks();
  const only = packs.find(p => p.id === foodFilter);
  if (!q || !packs.length || !(foodFilter === '' || only)) { box.innerHTML = ''; packGroups = []; return; }
  const hits = searchPacks(packs, q, { packId: only ? only.id : null });
  hits.forEach(h => foodPack.set(h.food, h.pack));
  packGroups = groupHits(hits).slice(0, 30);
  if (!packGroups.length) { box.innerHTML = ''; return; }
  const title = only ? only.name : packs.length === 1 ? packs[0].name : '食物資料庫';
  box.innerHTML = '<div class="sec-title px-1 pt-2">🏪 ' + esc(title) + '</div>' + packGroups.map((g, i) => {
    const foods = g.hits.map(h => h.food);
    if (foods.length === 1) {
      const f = foods[0];
      return `<button type="button" data-pack-group="${i}" class="pick-row">
        <span class="min-w-0 flex-1 text-left"><span class="block text-lg font-semibold text-stone-900 leading-snug break-words">${esc(f.name)}</span>
        ${f.brand ? `<span class="block text-sm text-stone-500 break-words">${esc(f.brand)}</span>` : ''}
        <span class="block text-base text-emerald-700 font-bold tabular-nums">一份 ${esc(servingText(f))}　${servingKcal(f)} kcal</span></span>
        <span class="pick-add">選擇 ›</span></button>`;
    }
    const brands = g.brands.filter(Boolean);
    const sub = brands.length > 1 ? brands.length + ' 家：' + brands.slice(0, 3).join('、') + (brands.length > 3 ? '…' : '')
      : (brands[0] ? brands[0] + '・' : '') + foods.length + ' 種';
    return `<button type="button" data-pack-group="${i}" class="pick-row">
      <span class="min-w-0 flex-1 text-left"><span class="block text-lg font-semibold text-stone-900 leading-snug break-words">${esc(g.base)}</span>
      <span class="block text-sm text-stone-500 break-words">${esc(sub)}</span>
      <span class="block text-base text-emerald-700 font-bold tabular-nums">${kcalRange(foods)}</span></span>
      <span class="pick-add">選擇 ›</span></button>`;
  }).join('');
}
// 同一個品項好幾家、好幾種（大杯／甜度）：另一頁依店家分開列，選一個再填幾份
let pickGroup = null;
$('foodPacks').addEventListener('click', (e) => {
  const row = e.target.closest('[data-pack-group]');
  const g = row && packGroups[Number(row.getAttribute('data-pack-group'))];
  if (!g) return;
  if (g.hits.length === 1) { openGrams(g.hits[0].food); return; }
  pickGroup = g;
  $('pickTitle').textContent = g.base;
  const byBrand = new Map();
  g.hits.forEach((h, i) => { const b = h.food.brand || ''; (byBrand.get(b) || byBrand.set(b, []).get(b)).push([h, i]); });
  $('pickList').innerHTML = [...byBrand.entries()].map(([brand, list]) =>
    (byBrand.size > 1 || brand ? `<div class="sec-title px-1 pt-2">${esc(brand || '其他')}</div>` : '') + list.map(([h, i]) => `
      <button type="button" data-pick-hit="${i}" class="pick-row">
        <span class="min-w-0 flex-1 text-left"><span class="block text-lg font-semibold text-stone-900 leading-snug break-words">${esc(h.food.variant || h.food.name)}</span>
        <span class="block text-base text-emerald-700 font-bold tabular-nums">一份 ${esc(servingText(h.food))}　${servingKcal(h.food)} kcal</span></span>
        <span class="pick-add">選擇 ›</span></button>`).join('')).join('');
  openScreen('scr-pick');
});
$('pickList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick-hit]');
  const h = b && pickGroup && pickGroup.hits[Number(b.getAttribute('data-pick-hit'))];
  if (!h) return;
  // 關掉這一頁再打開克數頁：記好回到查食物頁
  const once = () => { window.removeEventListener('popstate', once); setTimeout(() => openGrams(h.food), 0); };
  window.addEventListener('popstate', once);
  closeScreen();
});

// 我的食物分頁：資料庫清單、匯入、刪除
const minePacked = (packId) => customFoods().filter(f => f.packId === packId);
function libraryJoinCard() {
  if (!INVITE_URL || sharedPacks.length) return '';
  const member = canSendFeedback(state.meta.invite);
  return `<div class="bg-emerald-50 rounded-xl p-3 space-y-2">
    <span class="block text-lg font-semibold text-stone-900">🌐 外食圖書館（大家共用、自動更新）</span>
    <span class="block text-base text-stone-700 leading-relaxed">${member ? '連上網路後會自動下載。等不及可以按下面的按鈕。' : '這台是公測之前就在用的，還沒有邀請碼。輸入邀請碼就能下載。'}</span>
    <button type="button" ${member ? 'data-library-now' : 'data-invite-join'} class="btn-primary w-full">${member ? '現在下載' : '我有邀請碼'}</button></div>`;
}
function renderPackList() {
  const packs = allPacks();
  if (!packs.length && libraryJoinCard()) { $('packList').innerHTML = libraryJoinCard(); return; }
  $('packList').innerHTML = libraryJoinCard() + (packs.length ? packs.map(p => {
    const mine = minePacked(p.id);
    const fixed = mine.filter(f => f.replaces).length;
    const info = [p.shared ? '共用・會自動更新' : p.org, p.edition, (p.foods || []).length + ' 樣', mine.length - fixed ? '我加了 ' + (mine.length - fixed) + ' 樣' : '', fixed ? '改過 ' + fixed + ' 樣' : ''].filter(Boolean).join('・');
    if (p.shared) {
      return `<div class="bg-emerald-50 rounded-xl p-3">
        <span class="block text-lg font-semibold text-stone-900 leading-snug break-words">🌐 ${esc(p.name)}</span>
        <span class="block text-sm text-stone-600 break-words">${esc(info)}</span>
        ${libraryShops([p]).length ? `<button type="button" data-screen="scr-library" class="btn-primary w-full mt-2">📚 選我會去的店（${esc(libraryCount())}）</button>` : ''}
        <button type="button" data-pack-open="${esc(p.id)}" class="btn-secondary w-full mt-2">打開：找、新增、修改</button></div>`;
    }
    return `<div class="flex items-center gap-2 bg-stone-50 rounded-xl p-3">
      <span class="min-w-0 flex-1"><span class="block text-lg font-semibold text-stone-900 leading-snug break-words">${esc(p.name)}</span>
      <span class="block text-sm text-stone-500 break-words">${esc(info)}</span>
      <button type="button" data-pack-open="${esc(p.id)}" class="btn-secondary w-full mt-2">打開：找、新增、修改</button></span>
      <span class="shrink-0 flex flex-col gap-1"><button type="button" data-pack-share="${esc(p.id)}" class="chip-btn chip-lg">分享</button>
      <button type="button" data-pack-del="${esc(p.id)}" class="chip-btn chip-lg">刪除</button></span></div>`;
  }).join('')
    : '<p class="rounded-2xl bg-stone-50 text-stone-600 p-4 text-base leading-relaxed">還沒有。用「整理工具」把試算表（例如連鎖店外食營養表）做成資料庫檔，再按「匯入」。</p>');
}
$('packList').addEventListener('click', async (e) => {
  if (e.target.closest('[data-invite-join]')) { openInviteJoin(); return; }
  const b = e.target.closest('[data-library-now]');
  if (!b) return;
  b.disabled = true; b.textContent = '下載中…';
  await checkSharedPacks(true);
  if (!sharedPacks.length) { showError('現在下載不到外食圖書館。請確認有網路，稍後再試；一直不行的話，用「設定 → 關於 → 意見回饋」告訴我們。'); renderPackList(); }
});
function afterPackChange() {
  persist();
  renderAll();
  if (screenStack.includes('scr-food')) renderFoodResults();
}
function importPack(data) {
  const { pack, error } = packFromFile(data, { now: now() });
  if (error) { showError(error); return; }
  const list = foodPacks();
  const old = list.find(p => p.id === pack.id);
  const add = () => {
    delete state.tomb['foodPacks:' + pack.id];
    if (old) list[list.indexOf(old)] = pack; else list.push(pack);
    afterPackChange();
    showToast((old ? '已換成新版：' : '已加入：') + pack.name + '（' + pack.foods.length + ' 樣）');
  };
  const info = [pack.org, pack.edition].filter(Boolean).join('・');
  if (old) {
    openConfirm('已經有「' + old.name + '」', '目前的：' + [old.edition, (old.foods || []).length + ' 樣'].filter(Boolean).join('・') + '；新的：' + [pack.edition, pack.foods.length + ' 樣'].filter(Boolean).join('・') + '。換成新版後，已經記的飲食記錄不會改變。', add, '換成新版', null, '保留舊版');
  } else {
    openConfirm('加入食物資料庫', '「' + pack.name + '」' + (info ? '（' + info + '）' : '') + '，共 ' + pack.foods.length + ' 樣。加入後在「查食物」找得到，也會同步到你的其他裝置。', add, '加入');
  }
}
$('packImportBtn').addEventListener('click', () => $('packImportInput').click());
$('packImportInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (err) { showError('檔案無法讀取，請選食物檔（.json）'); return; }
  if (isMyFoodsFile(data)) importMyFoods(data); else importPack(data);
});
$('myFoodImportBtn').addEventListener('click', () => $('packImportInput').click());

// 分享檔案：手機可以直接傳 LINE（分享選單），不行就下載
async function shareFile(fileName, content, mime, downloadedMsg) {
  const file = new File([content], fileName, { type: mime });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: fileName }); return; }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  downloadBlob(fileName, content, mime);
  showToast(downloadedMsg);
}
const fileSafe = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, '_');
$('myFoodShareBtn').addEventListener('click', () => {
  const foods = customFoods();
  if (!foods.length) { showToast('還沒有我的食物可以分享'); return; }
  shareFile('我的食物_' + todayStr() + '.json', JSON.stringify(myFoodsFile(foods)), 'application/json',
    '已下載。對方在「我的食物 → 匯入別人分享的食物」選這個檔案');
});
$('myFoodCsvBtn').addEventListener('click', () => {
  const foods = customFoods();
  if (!foods.length) { showToast('還沒有我的食物'); return; }
  shareFile('我的食物_' + todayStr() + '.csv', '\ufeff' + toCsv(packRows({ pack: { name: '我的食物' }, foods })), 'text/csv', '已下載表格（CSV）');
});
$('packList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pack-share]');
  const pack = b && foodPacks().find(p => p.id === b.getAttribute('data-pack-share'));
  if (!pack) return;
  // 原本的＋自己加、改過的一起分享
  shareFile(fileSafe('食物資料_' + pack.name + (pack.edition ? '_' + pack.edition : '')) + '.json', JSON.stringify(packFileWithMine(pack, customFoods(), { now: now() })), 'application/json',
    '已下載。對方在「我的食物 → 匯入食物資料庫」選這個檔案');
});
// 別人分享的我的食物：新的先問要不要加；同名但數字不同的再問一次要不要換（預設留自己的）
function importMyFoods(data) {
  // 只和我的食物清單比：資料庫裡自己加的同名食物不要被蓋掉（會掉了 packId）
  const plan = planMyFoodsImport(myLoose(), data.foods, { makeId: uid, now: now() });
  const names = (list) => list.slice(0, 5).map(f => '「' + f.name + '」').join('') + (list.length > 5 ? '等' : '');
  if (!plan.add.length && !plan.update.length) { showToast(plan.same ? '這些食物你都有了（' + plan.same + ' 樣）' : '檔案裡沒有可以加的食物'); return; }
  const askUpdate = () => {
    if (!plan.update.length) return;
    const olds = plan.update.map(u => u.old);
    openConfirm('有 ' + olds.length + ' 樣和你的同名', names(olds) + '的數字和你存的不一樣。要換成檔案裡的數字嗎？已經記的飲食記錄不會改變。', () => {
      const list = customFoods();
      plan.update.forEach(({ old, food }) => { const i = list.indexOf(old); if (i >= 0) list[i] = food; });
      afterMyFoodChange();
      showToast('已更新 ' + plan.update.length + ' 樣');
    }, '換成檔案裡的', null, '保留我的');
  };
  if (!plan.add.length) { askUpdate(); return; }
  openConfirm('加入我的食物', '共 ' + plan.add.length + ' 樣新的：' + names(plan.add) + '。' + (plan.same ? '另外 ' + plan.same + ' 樣你已經有了。' : ''), () => {
    customFoods().push(...plan.add);
    afterMyFoodChange();
    showToast('已加入 ' + plan.add.length + ' 樣到我的食物');
    askUpdate();
  }, '加入');
}
$('packList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pack-del]');
  if (!b) return;
  const list = foodPacks();
  const pack = list.find(p => p.id === b.getAttribute('data-pack-del'));
  if (!pack) return;
  const mine = minePacked(pack.id).filter(f => !f.replaces).length;
  openConfirm('刪除「' + pack.name + '」', '只會刪掉這個資料庫，已經記的飲食記錄不會改變；用到它的套餐會用存套餐時的數字。' + (mine ? '你加的 ' + mine + ' 樣會回到我的食物。' : ''), () => {
    const idx = list.indexOf(pack);
    list.splice(idx, 1);
    tombstone('foodPacks:' + pack.id);
    afterPackChange();
    showToast('已刪除「' + pack.name + '」', '復原', () => {
      delete state.tomb['foodPacks:' + pack.id];
      touch(pack);
      foodPacks().splice(idx, 0, pack);
      afterPackChange();
    });
  }, '刪除');
});

// 資料庫的內容：搜尋、新增到這個資料庫、修改（自己加的直接改；原本的改成自己的版本）
let packOpenId = null;
$('packList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pack-open]');
  if (!b) return;
  packOpenId = b.getAttribute('data-pack-open');
  $('packSearch').value = '';
  openScreen('scr-pack');
  renderPackScreen();
});
function renderPackScreen() {
  const view = packsView().find(p => p.id === packOpenId);
  if (!view) { $('packFoods').innerHTML = ''; return; }
  const mine = minePacked(view.id);
  const fixed = mine.filter(f => f.replaces).length;
  $('packTitle').textContent = '📚 ' + view.name;
  $('packInfo').textContent = '共 ' + view.foods.length + ' 樣' + (mine.length - fixed ? '，你加了 ' + (mine.length - fixed) + ' 樣' : '') + (fixed ? '，改過 ' + fixed + ' 樣' : '') + '。數字不對可以點那一樣修改。';
  const q = $('packSearch').value.trim();
  let list;
  if (q) {
    const hits = searchPacks([view], q, { limit: 60 }).map(h => h.food);
    // 打店名：列這家全部
    const byBrand = view.foods.filter(f => f.brand && f.brand.includes(q));
    list = [...new Set([...byBrand, ...hits])].slice(0, 80);
  } else list = [...view.foods.filter(f => f.packId), ...view.foods.filter(f => !f.packId).slice(0, 30)];
  const tag = (f) => f.replaces ? '<span class="ml-1 px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 text-sm font-bold align-middle">改過</span>'
    : f.packId ? '<span class="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-sm font-bold align-middle">我加的</span>' : '';
  $('packFoods').innerHTML = (list.length ? list.map(f => `<button type="button" data-pf="${esc(f.id)}" class="pick-row">
      <span class="min-w-0 flex-1 text-left"><span class="block text-lg font-semibold text-stone-900 leading-snug break-words">${esc(f.name)}${tag(f)}</span>
      ${f.brand ? `<span class="block text-sm text-stone-500 break-words">${esc(f.brand)}</span>` : ''}
      <span class="block text-base text-emerald-700 font-bold tabular-nums">一份 ${esc(servingText(f))}　${servingKcal(f)} kcal</span></span>
      <span class="pick-add">修改</span></button>`).join('') : `<p class="text-base text-stone-500 py-2">找不到「${esc(q)}」，可以按上面的「＋ 新增到這個資料庫」。</p>`)
    + (!q && view.foods.length > list.length ? '<p class="text-base text-stone-500 py-2">只列前面幾樣，打字找其他的。</p>' : '');
}
$('packSearch').addEventListener('input', renderPackScreen);
$('packAddBtn').addEventListener('click', () => {
  const q = $('packSearch').value.trim();
  const view = packsView().find(p => p.id === packOpenId);
  const brand = view && q && view.foods.some(f => f.brand === q) ? q : '';   // 正在看某一家：店家先填好
  openMyFood(null, '', null, { packId: packOpenId, brand });
});
$('packFoods').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pf]');
  if (!b) return;
  const view = packsView().find(p => p.id === packOpenId);
  const f = view && view.foods.find(x => x.id === b.getAttribute('data-pf'));
  if (!f) return;
  if (isMine(f)) openMyFood(f);
  else openMyFood(null, '', null, { packId: packOpenId, brand: f.brand || '', replaces: f.id, from: f });
});

// 我的食物 → 移到資料庫（packId＋店家；同一個物件，id 不變：記錄、套餐都不受影響）
let moveTarget = null;
function renderMove() {
  const packs = allPacks();
  const n = selectedFoods().length;
  $('moveWhat').textContent = '要移的：' + selectedFoods().slice(0, 5).map(f => '「' + f.name + '」').join('') + (n > 5 ? '等 ' + n + ' 樣' : '');
  if (!moveTarget) moveTarget = packs.length ? packs[0].id : 'new';
  $('movePacks').innerHTML = [...packs.map(p => [p.id, p.name]), ['new', '＋ 新建一個資料庫']].map(([id, name]) =>
    `<button type="button" data-move-to="${esc(id)}" class="pick-row${moveTarget === id ? ' pick-done' : ''}" aria-pressed="${moveTarget === id}">
      <span class="text-2xl shrink-0">${moveTarget === id ? '🔘' : '⚪'}</span>
      <span class="min-w-0 flex-1 text-left text-lg font-semibold text-stone-900 break-words">${esc(name)}</span></button>`).join('');
  $('moveNewBox').classList.toggle('hidden', moveTarget !== 'new');
  const view = packsView().find(p => p.id === moveTarget);
  $('moveBrandList').innerHTML = view ? brandsOf([view]).map(b => `<option value="${esc(b.brand)}"></option>`).join('') : '';
  setBox('moveNote', null, '');
}
$('movePacks').addEventListener('click', (e) => {
  const b = e.target.closest('[data-move-to]');
  if (!b) return;
  moveTarget = b.getAttribute('data-move-to');
  renderMove();
  if (moveTarget === 'new') $('moveNewName').focus();
});
$('moveSaveBtn').addEventListener('click', () => {
  const foods = selectedFoods();
  if (!foods.length) { closeScreen(); return; }
  let pack = allPacks().find(p => p.id === moveTarget);
  let created = null;
  if (!pack) {
    const name = $('moveNewName').value.trim();
    if (!name) { setBox('moveNote', 'err', '請填新資料庫的名稱，例如「常吃的外食」'); $('moveNewName').focus(); return; }
    if (allPacks().some(p => p.name === name)) { setBox('moveNote', 'err', '已經有「' + name + '」了，請在上面選它'); return; }
    created = pack = { id: uid('pk'), name, org: '自己建的', foods: [], updatedAt: now() };
    foodPacks().push(pack);
  }
  const before = foods.map(f => [f, { packId: f.packId, brand: f.brand, base: f.base, variant: f.variant, updatedAt: f.updatedAt }]);
  foods.forEach(f => { Object.assign(f, packFields(f, { packId: pack.id, brand: $('moveBrand').value })); touch(f); });
  mfSelected = null;
  afterMyFoodChange();
  closeScreen();
  showToast('已把 ' + foods.length + ' 樣移到「' + pack.name + '」', '復原', () => {
    before.forEach(([f, old]) => { Object.keys(old).forEach(k => { if (old[k] == null) delete f[k]; else f[k] = old[k]; }); touch(f); });
    if (created) { foodPacks().splice(foodPacks().indexOf(created), 1); tombstone('foodPacks:' + created.id); }
    afterMyFoodChange();
  });
});

/* ---------------- 掃商品條碼 ---------------- */
// 查的順序：我的食物 → 食物資料庫 → Open Food Facts（只送條碼號碼）→ 查不到：照包裝填，存成我的食物並記下條碼
// 拍一張照片再辨識（和拍營養標示一樣），iPhone 也能用：有 BarcodeDetector（Android Chrome）就用，沒有才載入 ZXing
let manualBarcode = '';   // 從掃條碼去「自己輸入」拍營養標示：存成我的食物時記下這個條碼
const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
// 檔案內容的檢查碼：CDN 上的檔案被改過就不執行（換版本要重算，見 sw.js 開頭說明）
const ZXING_SRI = 'sha384-BzBxP10ZE72aitqj5UMmUsbKFliP/DZqA8Wq+BNNhlIJDGoEd1tpkMYXOg9+n6sB';
let zxingLoading = null;
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingLoading) {
    zxingLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = ZXING_URL;
      s.integrity = ZXING_SRI;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error('ZXing')));
      s.onerror = () => { zxingLoading = null; reject(new Error('ZXing')); };
      document.head.appendChild(s);
    });
  }
  return zxingLoading;
}
// 照片太大時 ZXing 很慢：先縮到長邊 1600
async function scaledImageUrl(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}
// 回傳條碼號碼，認不出來是 ''；辨識程式載入失敗會丟錯
async function decodeBarcode(file) {
  if ('BarcodeDetector' in window) {
    try {
      const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      const found = await det.detect(await createImageBitmap(file));
      if (found && found.length) return found[0].rawValue;
    } catch (e) { /* 這台不支援這些格式：改用 ZXing */ }
  }
  const ZX = await loadZxing();
  try { return (await new ZX.BrowserMultiFormatReader().decodeFromImageUrl(await scaledImageUrl(file))).getText(); } catch (e) { return ''; }
}
function afterClose(fn) {
  const once = () => { window.removeEventListener('popstate', once); setTimeout(fn, 0); };
  window.addEventListener('popstate', once);
  closeScreen();
}
let scanForm = null;   // 查到（或查不到）時要帶去新增頁的表單
function scanBox(tone, html) {
  const el = $('scanResult');
  el.classList.toggle('hidden', !html);
  el.className = el.className.replace(/\b(bg|text)-(sky|rose|emerald|amber|stone)-\d+\b/g, '').trim();
  if (html) el.classList.add(...({ info: ['bg-sky-50', 'text-sky-900'], err: ['bg-rose-50', 'text-rose-800'], ok: ['bg-emerald-50', 'text-emerald-900'], plain: ['bg-stone-50', 'text-stone-800'] }[tone]));
  el.innerHTML = html || '';
}
function scanButtons(code) {
  return `<button type="button" data-scan-fill class="btn-primary w-full">⭐ 照包裝填，存成我的食物</button>` +
    (aiKey() ? `<button type="button" data-scan-ai class="btn-secondary w-full">📷 拍營養標示，AI 幫我填</button>` : '');
}
async function lookupBarcode(raw) {
  const code = normalizeBarcode(raw);
  if (!code) { scanBox('err', '條碼是 8～13 位數字（在黑白直線下面），請再確認一次。'); return; }
  $('scanInput').value = code;
  if (!checkDigitOk(code)) { scanBox('err', '「' + code + '」好像少了或打錯一個數字，請對照包裝再輸入一次。'); return; }
  const hit = findByBarcode(code, { mine: customFoods(), packs: allPacks() });
  if (hit) {
    if (hit.pack) foodPack.set(hit.food, hit.pack);
    showToast('找到了：' + (hit.food.brand ? hit.food.brand + ' ' : '') + hit.food.name);
    afterClose(() => openGrams(hit.food));
    return;
  }
  scanForm = { name: '', ex: {}, barcode: code };
  if (!navigator.onLine) {
    scanBox('plain', '<p>你的食物裡沒有這個條碼，現在沒有網路，查不了國際資料庫。可以照包裝上的營養標示填一次，下次掃就有了。</p>' + scanButtons(code));
    return;
  }
  scanBox('info', '查詢中…');
  let json = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(offUrl(code), { signal: ctrl.signal });
    clearTimeout(timer);
    json = await r.json();
  } catch (e) {
    scanBox('plain', '<p>連不上國際資料庫（Open Food Facts）。可以照包裝上的營養標示填一次，下次掃就有了。</p>' + scanButtons(code));
    return;
  }
  const off = offToForm(json, code);
  if (off && off.hasNutrition) {
    scanForm = off.form;
    const f = off.form;
    const parts = [['蛋白質', f.p, 'g'], ['脂肪', f.f, 'g'], ['碳水', f.c, 'g'], ['糖', f.sugar, 'g'], ['鈉', f.na, 'mg']].filter(x => x[1] !== '').map(x => x[0] + ' ' + x[1] + ' ' + x[2]);
    scanBox('ok', `<p class="text-lg font-bold break-words">${esc(f.name)}</p>
      <p>一份 ${esc(f.servingLabel || f.servingG + ' g')}：<b class="tabular-nums">${f.kcal} kcal</b>${parts.length ? '<br><span class="text-sm">' + esc(parts.join('・')) + '</span>' : ''}</p>
      <p class="text-sm">資料來自 Open Food Facts（大家一起建的國際資料庫），可能和包裝不一樣，存之前請對照一下。</p>
      <button type="button" data-scan-fill class="btn-primary w-full">⭐ 看一下數字，存成我的食物</button>`);
    return;
  }
  if (off) scanForm = off.form;   // 有商品名稱、沒有營養資料：至少帶名稱
  scanBox('plain', `<p>${off ? '查到「' + esc(off.form.name) + '」，但沒有營養資料。' : '查不到這個條碼。台灣的商品在國際資料庫比較少。'}照包裝上的營養標示填一次，下次掃就有了。</p>` + scanButtons(code));
}
$('scanOpenBtn').addEventListener('click', () => {
  $('scanInput').value = '';
  scanBox(null, '');
  openScreen('scr-scan');
});
$('scanShotBtn').addEventListener('click', () => $('scanFile').click());
$('scanFile').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  scanBox('info', '辨識條碼中…');
  let code = '';
  try { code = await decodeBarcode(file); } catch (err) {
    scanBox('err', '條碼辨識程式載入失敗（要連網）。請直接輸入條碼下面的數字。');
    return;
  }
  if (!code) { scanBox('err', '看不清楚條碼。靠近一點、對準黑白直線、不要反光再拍一次，或直接輸入條碼下面的數字。'); return; }
  lookupBarcode(code);
});
$('scanLookupBtn').addEventListener('click', () => lookupBarcode($('scanInput').value));
$('scanInput').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  // 注音、倉頡選字時按的 Enter 不算查詢（Safari 要另外看 keyCode 229）
  if (e.isComposing || e.keyCode === 229) return;
  lookupBarcode($('scanInput').value);
});
$('scanResult').addEventListener('click', (e) => {
  if (!scanForm) return;
  const form = scanForm;
  if (e.target.closest('[data-scan-fill]')) afterClose(() => openMyFood(null, '', form));
  else if (e.target.closest('[data-scan-ai]')) {
    afterClose(() => {
      openScreen('scr-manual');
      manualBarcode = form.barcode;
      $('saveMineCheck').checked = true;
      setBox('add-lb-note', 'info', '條碼 ' + form.barcode + '：拍營養標示讓 AI 填好、記下來，會一起存成我的食物，下次掃就有了。');
    });
  }
});

/* ---------------- 套餐（combos） ---------------- */
// 購物車「存成套餐」；選套餐＝整組放進購物車（可以再改克數、拿掉）→ 記到某餐。格式見 js/combos.js
function combos() {
  if (!Array.isArray(state.combos)) state.combos = [];
  return state.combos;
}
function comboRowHTML(c, action) {
  const attr = action === 'edit' ? `data-combo-edit="${esc(c.id)}"` : `data-combo-pick="${esc(c.id)}"`;
  return `<button type="button" ${attr} class="pick-row">
    <span class="min-w-0 flex-1 text-left"><span class="block text-lg font-semibold text-stone-900 leading-snug break-words">${action === 'edit' ? '' : '<span class="mr-1 px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 text-sm font-bold align-middle">套餐</span>'}${esc(c.name)}</span>
    <span class="block text-sm text-stone-500 break-words">${esc(comboSummary(c))}</span>
    <span class="block text-base text-emerald-700 font-bold tabular-nums">${(c.items || []).length} 樣　${comboTotals(c).kcal} kcal</span></span>
    <span class="pick-add">${action === 'edit' ? '修改' : '選擇 ›'}</span>
  </button>`;
}
function renderComboList() {
  const list = sortCombos(combos(), state.logs);
  $('comboList').innerHTML = list.length ? list.map(c => comboRowHTML(c, 'edit')).join('')
    : '<p class="rounded-2xl bg-stone-50 text-stone-600 p-4 text-base leading-relaxed">還沒有套餐。</p>';
}
// 選套餐：整組放進購物車（加在已經選的後面）
async function pickCombo(combo) {
  let tfda = null;
  try { tfda = (await loadFoodDB()).foods; } catch (e) { /* 離線又沒快取：用存套餐時的數字 */ }
  const items = resolveCombo(combo, { tfda, mine: customFoods(), packs: allPacks() });
  // 資料庫裡找得到的，登記它在哪個資料庫（記錄要帶 src）
  const where = new Map();
  allPacks().forEach(p => (p.foods || []).forEach(f => where.set(f, p)));
  items.forEach(({ food }) => { if (where.has(food)) foodPack.set(food, where.get(food)); });
  items.forEach(({ food, grams, weighed: w }) => {
    const { weighed, entry } = cartEntryFor(food, grams, w);
    foodCart.push({ key: uid('c'), food, grams, weighed, entry, comboId: combo.id });
  });
  cartCombo = { id: combo.id, name: combo.name };
  $('foodSearch').value = '';
  renderFoodResults();
  renderFoodCart();
  showToast('已放入「' + combo.name + '」' + items.length + ' 樣，可以改克數或拿掉');
}
/* ---------------- 外食點餐小幫手（js/eatout.js） ---------------- */
// 從查食物頁點進來：選店家 → 這一餐還能吃多少 → 3 組點法 → 「就點這個」放進購物車，回查食物頁記到這一餐
const eo = { brand: '', adj: 0, list: [] };
function openEatout() {
  eo.adj = 0;
  $('eoSearch').value = '';
  showEatoutPick(!eo.brand || !brandsOf(pickedPacks()).some(b => b.brand === eo.brand));
}
function showEatoutPick(pick) {
  $('eoPick').classList.toggle('hidden', !pick);
  $('eoPlan').classList.toggle('hidden', pick);
  if (pick) renderEatoutBrands(); else renderEatoutPlan();
}
function renderEatoutBrands() {
  const q = $('eoSearch').value.trim().toLowerCase();
  const recent = state.meta.eatoutRecent || [];
  let list = brandsOf(pickedPacks());
  if (q) list = list.filter(b => b.brand.toLowerCase().includes(q));
  // 最近去過的排前面
  list.sort((a, b) => (recent.includes(a.brand) ? recent.indexOf(a.brand) : 99) - (recent.includes(b.brand) ? recent.indexOf(b.brand) : 99));
  $('eoBrands').innerHTML = list.length ? list.map(b => `<button type="button" data-eo-brand="${esc(b.brand)}" class="pick-row">
    <span class="min-w-0 flex-1 text-left"><span class="block text-lg font-semibold text-stone-900 break-words">${esc(b.brand)}</span>
    <span class="block text-base text-stone-500">${b.count} 樣${recent.includes(b.brand) ? '・最近去過' : ''}</span></span>
    <span class="pick-add">選擇 ›</span></button>`).join('')
    : '<p class="text-base text-stone-500">找不到這家店。店家要先整理進食物資料庫（我的食物 → 匯入食物資料庫）。</p>';
}
function eatoutFoods() {
  const out = [];
  pickedPacks().forEach(pk => (pk.foods || []).forEach(f => { if (f.brand === eo.brand) { foodPack.set(f, pk); out.push(f); } }));
  return out;
}
function eatoutBudget() {
  const bank = bankFor(ui.date);
  const target = bank ? bank.todayTarget : state.targets.kcal > 0 ? state.targets.kcal : 1800;
  // 已經記的＋購物車裡還沒記的
  const eaten = dayTotals(ui.date).kcal + foodCart.reduce((a, c) => a + (c.entry.kcal || 0), 0);
  const b = mealBudget({ target, eaten, meal: ui.meal });
  return { ...b, target, eaten: Math.round(eaten), budget: Math.max(0, b.budget + eo.adj) };
}
function renderEatoutPlan() {
  const b = eatoutBudget();
  const label = MEAL_META[ui.meal].label;
  $('eoBrand').textContent = eo.brand;
  $('eoBudgetText').textContent = b.budget > 0
    ? label + '建議 ' + b.budget + ' 大卡以內（今天目標 ' + b.target + '，已經吃了 ' + b.eaten + '）'
    : '今天的熱量差不多用完了（目標 ' + b.target + '，已經吃了 ' + b.eaten + '）。真的餓，選無糖飲料或清淡的，也可以按「多 50 大卡」看看。';
  eo.list = suggestMeals(eatoutFoods(), b.budget);   // 吃完了也算：飲料店還有無糖茶
  const line = (t) => [['蛋白質', t.p], ['碳水', t.c], ['脂肪', t.f]].filter(x => x[1] != null).map(x => x[0] + ' ' + x[1] + ' 克').join('・');
  $('eoList').innerHTML = eo.list.length ? eo.list.map((c, i) => `<div class="rounded-2xl border border-stone-200 bg-white p-3 space-y-2">
      <div class="text-lg font-bold text-stone-900">第 ${i + 1} 組・<span class="tabular-nums">${c.total.kcal}</span> 大卡</div>
      <ul class="space-y-1">${c.items.map(it => `<li class="text-lg text-stone-800 leading-snug break-words">・${esc(it.food.name)}${it.byServing ? '' : ' ' + it.amount + 'g'}</li>`).join('')}</ul>
      <div class="text-sm text-stone-600">${line(c.total)}</div>
      ${c.notes.map(n => `<div class="text-base ${/偏/.test(n) ? 'text-amber-800' : 'text-emerald-800'}">${/偏/.test(n) ? '！' : '✓'} ${esc(n)}</div>`).join('')}
      <button type="button" data-eo-use="${i}" class="btn-primary w-full">就點這個，放進${label}</button>
    </div>`).join('')
    : (b.budget > 0 ? '<p class="text-base text-stone-600 leading-relaxed">這家店的東西都超過 ' + b.budget + ' 大卡。可以按「多 50 大卡」，或點一份、和別人分著吃。</p>' : '');
}
$('eoSearch').addEventListener('input', renderEatoutBrands);
// 這家有新菜：存進有這家店的資料庫（品項最多的那個），店家先填好
$('eoAddBtn').addEventListener('click', () => {
  const pk = pickedPacks().map(p => [p, p.foods.filter(f => f.brand === eo.brand).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1])[0];
  if (pk) openMyFood(null, '', null, { packId: pk[0].id, brand: eo.brand });
});
$('eoChange').addEventListener('click', () => { $('eoSearch').value = ''; showEatoutPick(true); });
$('scr-eatout').addEventListener('click', (e) => {
  const br = e.target.closest('[data-eo-brand]');
  if (br) {
    eo.brand = br.getAttribute('data-eo-brand');
    eo.adj = 0;
    state.meta.eatoutRecent = [eo.brand, ...(state.meta.eatoutRecent || []).filter(x => x !== eo.brand)].slice(0, 5);
    persistLocal();
    showEatoutPick(false);
    return;
  }
  const adj = e.target.closest('[data-eo-adj]');
  if (adj) { eo.adj += Number(adj.getAttribute('data-eo-adj')); renderEatoutPlan(); return; }
  const use = e.target.closest('[data-eo-use]');
  if (use) {
    const c = eo.list[Number(use.getAttribute('data-eo-use'))];
    if (!c) return;
    c.items.forEach(({ food, amount }) => {
      const { weighed, entry } = cartEntryFor(food, amount, 'asis');
      foodCart.push({ key: uid('c'), food, grams: amount, weighed, entry });
    });
    renderFoodCart();
    closeScreen();
    showToast('已放進 ' + c.items.length + ' 樣。可以改份數或拿掉，再按「記到' + MEAL_META[ui.meal].label + '」');
  }
});

// 存成套餐（editId＝null，從購物車）或修改套餐（從我的食物分頁）
const comboDraft = { editId: null, items: [] };
function openCombo(editId) {
  comboDraft.editId = editId;
  const old = editId ? combos().find(c => c.id === editId) : null;
  if (editId && !old) return;
  // 修改：可以改名字、拿掉某一樣；要改克數或加東西，就選這個套餐、在購物車改好再存一次
  comboDraft.items = old ? old.items.map(it => ({ ...it })) : null;
  $('comboTitle').textContent = old ? '🍱 修改套餐' : '🍱 存成套餐';
  $('comboName').value = old ? old.name : (cartCombo ? cartCombo.name : '');
  $('comboHint').textContent = old ? '要改克數或加東西：在「我的食物」選這個套餐，在「這一餐已選」改好，再按「存成套餐」、用同一個名字存。'
    : '只存食物和克數，不會記到哪一餐。用同一個名字存，就會更新那個套餐。';
  $('comboDelete').classList.toggle('hidden', !old);
  setBox('comboNote', null, '');
  renderComboItems();
  openScreen('scr-combo');
}
function renderComboItems() {
  const rows = comboDraft.items
    ? comboDraft.items.map((it, i) => ({ name: (it.snapshot && it.snapshot.name) || '', kcal: comboTotals({ items: [it] }).kcal, amount: it.snapshot && it.snapshot.perServing && !it.snapshot.per100g ? fmt(it.grams, 1) + ' 份' : it.grams + 'g' + (it.weighed === 'cooked' ? '（熟重）' : ''), del: i }))
    : foodCart.map(c => ({ name: c.entry.name, kcal: c.entry.kcal, amount: '', del: null }));
  $('comboItems').innerHTML = rows.map(r => `<li class="flex items-center gap-2 bg-stone-50 rounded-xl p-2">
    <span class="min-w-0 flex-1"><span class="block text-base font-semibold text-stone-900 leading-snug break-words">${esc(r.name)}${r.amount ? ' ' + esc(r.amount) : ''}</span>
    <span class="block text-sm text-emerald-700 font-bold tabular-nums">${r.kcal} kcal</span></span>
    ${r.del != null && rows.length > 1 ? `<button type="button" data-combo-del="${r.del}" class="chip-btn chip-lg shrink-0" aria-label="拿掉">✕</button>` : ''}
  </li>`).join('');
  const t = comboDraft.items ? comboTotals({ items: comboDraft.items }) : sumNutr(foodCart.map(c => c.entry));
  $('comboTotal').innerHTML = `<span class="font-bold tabular-nums">合計 ${t.kcal} kcal</span>${macroText(t) ? '<br><span class="text-sm text-stone-600">' + esc(macroText(t)) + '</span>' : ''}`;
}
$('comboItems').addEventListener('click', (e) => {
  const d = e.target.closest('[data-combo-del]');
  if (!d || !comboDraft.items || comboDraft.items.length < 2) return;
  comboDraft.items.splice(Number(d.getAttribute('data-combo-del')), 1);
  renderComboItems();
});
function afterComboChange() {
  persist();
  renderAll();
  if (screenStack.includes('scr-food')) renderFoodMine($('foodSearch').value.trim());
}
function storeCombo(combo, old) {
  const list = combos();
  if (old) list[list.indexOf(old)] = combo; else list.unshift(combo);
  cartCombo = { id: combo.id, name: combo.name };
  afterComboChange();
  closeScreen();
  showToast((old ? '已更新套餐「' : '已存成套餐「') + combo.name + '」');
}
$('comboSaveBtn').addEventListener('click', () => {
  const name = $('comboName').value.trim();
  const list = combos();
  if (comboDraft.editId) {
    const old = list.find(c => c.id === comboDraft.editId);
    if (!old) return;
    if (!name) { setBox('comboNote', 'err', '請幫套餐取個名字'); return; }
    if (list.some(c => c !== old && c.name === name)) { setBox('comboNote', 'err', '已經有「' + name + '」了，請換個名稱'); return; }
    storeCombo({ ...old, name, items: comboDraft.items, updatedAt: now() }, old);
    return;
  }
  const same = list.find(c => c.name === name);
  const { combo, error } = comboFromCart(foodCart, { id: same ? same.id : uid('cb'), name, now: now(), mine: isMine, packOf: (f) => (foodPack.get(f) || {}).id || null });
  if (error) { setBox('comboNote', 'err', error); return; }
  if (!same) { storeCombo(combo, null); return; }
  openConfirm('已經有「' + name + '」', '要把這個套餐換成現在這 ' + combo.items.length + ' 樣嗎？', () => storeCombo({ ...same, ...combo }, same), '換成這幾樣');
});
$('comboDelete').addEventListener('click', () => {
  const list = combos();
  const combo = list.find(c => c.id === comboDraft.editId);
  if (!combo) return;
  openConfirm('刪除套餐「' + combo.name + '」', '只會刪掉這個套餐，裡面的食物和已經記的飲食記錄都不會改變。', () => {
    const idx = list.indexOf(combo);
    list.splice(idx, 1);
    tombstone('combos:' + combo.id);
    afterComboChange();
    closeScreen();
    showToast('已刪除套餐「' + combo.name + '」', '復原', () => {
      delete state.tomb['combos:' + combo.id];
      touch(combo);
      combos().splice(idx, 0, combo);
      afterComboChange();
    });
  }, '刪除');
});
document.addEventListener('click', (e) => {
  const pick = e.target.closest('[data-combo-pick]');
  if (pick) { const c = combos().find(x => x.id === pick.getAttribute('data-combo-pick')); if (c) pickCombo(c); return; }
  const edit = e.target.closest('[data-combo-edit]');
  if (edit) openCombo(edit.getAttribute('data-combo-edit'));
});

/* ---------------- 晚上記的：是現在吃的嗎？不是就問大約幾點吃的 ---------------- */
// 晚上 10 點到清晨 5 點記的（任何一餐）。選了時間就把記錄的時間改成吃的時間；
// 過了午夜補記前一天的晚餐，搬回前一天。這樣報告的夜間進食才準。
let whenEntries = null;
function askWhen(entries) {
  const first = entries && entries[0];
  if (!first || ui.date !== todayStr() || !shouldAskWhen(first.time)) return;
  // 剛才的提示會擋到按鈕：先收起來，選「現在吃的」後再顯示一次
  whenEntries = { ids: entries.map(e => e.id), date: ui.date, meal: first.meal, saved: first.time, toast: $('toastMsg').textContent };
  clearTimeout(toastTimer);
  $('toast').classList.add('hidden');
  $('whenMsg').textContent = MEAL_META[first.meal].label + '・' + (entries.length > 1 ? entries.length + ' 樣' : first.name) + '（現在 ' + first.time + '）';
  $('whenAsk').classList.remove('hidden');
  $('whenPick').classList.add('hidden');
  openModal('whenModal');
}
function closeWhen() { whenEntries = null; closeModal('whenModal'); }
$('whenNowBtn').addEventListener('click', () => {
  const msg = whenEntries && whenEntries.toast;
  closeWhen();
  if (msg) showToast(msg);
});
$('whenEarlierBtn').addEventListener('click', () => {
  if (!whenEntries) return;
  const chips = MEAL_TIME_CHIPS[whenEntries.meal] || MEAL_TIME_CHIPS.snack;
  $('whenChips').innerHTML = chips.map(t => `<button type="button" data-when="${t}" class="toggle-btn tabular-nums text-lg">${t}</button>`).join('');
  $('whenTime').value = chips[2];
  $('whenAsk').classList.add('hidden');
  $('whenPick').classList.remove('hidden');
  markWhenChip();
});
function markWhenChip() {
  document.querySelectorAll('#whenChips [data-when]').forEach(b => b.classList.toggle('is-active', b.getAttribute('data-when') === $('whenTime').value));
}
$('whenChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-when]');
  if (!b) return;
  $('whenTime').value = b.getAttribute('data-when');
  markWhenChip();
});
$('whenTime').addEventListener('input', markWhenChip);
$('whenOkBtn').addEventListener('click', () => {
  const w = whenEntries;
  const picked = $('whenTime').value;
  if (!w || !/^\d{2}:\d{2}$/.test(picked)) return;
  const { time, dayShift } = eatenAt(w.saved, picked);
  const to = dayShift ? addDays(w.date, dayShift) : w.date;
  const ids = new Set(w.ids);
  const from = state.logs[w.date] || [];
  const moving = from.filter(e => ids.has(e.id));
  moving.forEach(e => { e.time = time; delete e.backfill; touch(e); });
  if (to !== w.date) {
    state.logs[w.date] = from.filter(e => !ids.has(e.id));
    if (!state.logs[w.date].length) delete state.logs[w.date];
    (state.logs[to] || (state.logs[to] = [])).push(...moving);
  }
  persist();
  renderAll();
  closeWhen();
  showToast(to !== w.date ? '已記到 ' + fmtMD(to) + ' ' + MEAL_META[w.meal].label + '（' + time + '）' : '時間改成 ' + time);
});

/* ---------------- ⚙️ 設定 ---------------- */
// 版本號取自 index.html 載入 app.js 的 ?v=N（發佈時本來就要加 1，不用另外改）
const APP_VERSION = APP_LABEL;
function renderSettings() {
  const pr = state.profile;
  const age = ageFrom(pr.birthYear);
  $('setProfileSub').textContent = [pr.name, pr.sex === 'm' ? '男' : pr.sex === 'f' ? '女' : '', age ? age + ' 歲' : '', pr.height ? pr.height + ' 公分' : '']
    .filter(Boolean).join('・') || '名字、性別、出生年、身高';
  const t = state.targets;
  $('setTargetsSub').textContent = '每天 ' + (t.kcal || 1800).toLocaleString() + ' kcal' + (t.steps ? '・走 ' + t.steps.toLocaleString() + ' 步' : '') + (t.mealEx ? '・有每餐份數' : '') + (t.calc ? '・依體重試算' : '');
  $('setFeaturesSub').textContent = '字體 ' + FONT_SIZES[FONT_SIZES[state.meta.fontSize] ? state.meta.fontSize : 'l'].label
    + '・角色 ' + (Object.entries({ sprout: '小芽', cat: '小貓', doc: '營養師' }).filter(([k]) => palsOn()[k]).map(([, v]) => v).join('、') || '關') + '・熱量銀行 ' + (t.bank ? '開' : '關')
    + (() => { const on = FEATURES.filter(f => featureOn(state.profile, f.key)).length; return '・首頁記錄 ' + on + '/' + FEATURES.length + ' 項'; })();
  const c = state.meta.cloud;
  $('setDataSub').textContent = cloud.isConfigured() && c.linked ? '雲端同步：已連結' + (c.email ? '（' + c.email + '）' : '') : '雲端同步、下載備份、匯入、匯出 CSV';
  $('setAboutSub').textContent = '版本 ' + APP_VERSION + '・隱私權政策・資料來源';
}

// 我的基本資料
const pfDraft = { sex: null, activity: 'low' };
function renderProfileScreen() {
  const pr = state.profile;
  pfDraft.sex = pr.sex || null;
  pfDraft.activity = pr.activity || 'low';
  $('profileName').value = pr.name || '';
  $('pfBirthYear').value = pr.birthYear || '';
  $('pfHeight').value = pr.height || '';
  $('sugarCareToggle').checked = Boolean(pr.sugarCare);
  renderProfileChoices();
}
function renderProfileChoices() {
  document.querySelectorAll('[data-pf-sex]').forEach(b => b.classList.toggle('is-active', b.getAttribute('data-pf-sex') === pfDraft.sex));
  $('pfActivity').innerHTML = choiceHTML('data-pf-act', ACTIVITY, pfDraft.activity);
}
$('scr-profile').addEventListener('click', (e) => {
  const sx = e.target.closest('[data-pf-sex]');
  const act = e.target.closest('[data-pf-act]');
  if (sx) pfDraft.sex = pfDraft.sex === sx.getAttribute('data-pf-sex') ? null : sx.getAttribute('data-pf-sex');
  else if (act) pfDraft.activity = act.getAttribute('data-pf-act');
  else return;
  renderProfileChoices();
});
$('profileSaveBtn').addEventListener('click', () => {
  const h = num($('pfHeight').value);
  const by = num($('pfBirthYear').value);
  if (h && (h < 100 || h > 230)) { showError('身高請填 100～230 公分'); return; }
  if (by && !ageFrom(by)) { showError('出生年好像不對，請再看一下'); return; }
  const next = { ...state.profile, name: $('profileName').value.trim(), sex: pfDraft.sex, height: h || null, birthYear: by || null, activity: pfDraft.activity };
  if ($('sugarCareToggle').checked) next.sugarCare = true; else delete next.sugarCare;
  const changed = ['name', 'sex', 'height', 'birthYear', 'activity', 'sugarCare'].some(k => (next[k] ?? null) !== (state.profile[k] ?? null));
  if (changed) { state.profile = next; state.profileAt = now(); persist(); }
  renderAll();
  closeScreen();
  showToast(changed ? '已儲存基本資料' : '沒有變更');
});

// 功能開關與字體：按下去就生效
function renderFeatures() {
  const cur = FONT_SIZES[state.meta.fontSize] ? state.meta.fontSize : 'l';
  $('fontSizeGroup').innerHTML = Object.entries(FONT_SIZES).map(([k, f]) =>
    `<button type="button" data-font="${k}" class="toggle-btn ${k === cur ? 'is-active' : ''}" style="font-size:${f.px}px">${f.label}</button>`).join('');
  const pals = palsOn();
  $('mascotToggle').checked = pals.sprout;
  $('catToggle').checked = pals.cat;
  $('docToggle').checked = pals.doc;
  $('bankToggle').checked = Boolean(state.targets.bank);
  $('featureToggles').innerHTML = FEATURES.map(f => `<label class="flex items-start gap-3 py-1"><input type="checkbox" data-feature-toggle="${f.key}" class="big-check mt-1" ${featureOn(state.profile, f.key) ? 'checked' : ''} /><span>${esc(f.label)}</span></label>`).join('');
}
// 功能開關存在基本資料（profile.features），跟著同步到自己的其他裝置
$('featureToggles').addEventListener('change', (e) => {
  const c = e.target.closest('[data-feature-toggle]');
  if (!c) return;
  state.profile = { ...state.profile, features: { ...(state.profile.features || {}), [c.getAttribute('data-feature-toggle')]: c.checked } };
  state.profileAt = now();
  persist();
  renderAll();
});
$('fontSizeGroup').addEventListener('click', (e) => {
  const b = e.target.closest('[data-font]');
  if (!b) return;
  state.meta.fontSize = b.getAttribute('data-font');
  persistLocal();
  applyFontSize();
  renderFeatures();
});
// 三個角色各自勾選；小貓、營養師一旦動過就各自記住，不再跟著小芽
[['mascotToggle', 'mascot'], ['catToggle', 'cat'], ['docToggle', 'doc']].forEach(([id, key]) => $(id).addEventListener('change', () => {
  const cur = palsOn();
  state.meta.cat = cur.cat;
  state.meta.doc = cur.doc;
  state.meta[key] = $(id).checked;
  persistLocal();
  renderAll();
}));
$('bankToggle').addEventListener('change', () => {
  const next = { ...state.targets };
  if ($('bankToggle').checked) next.bank = true; else delete next.bank;
  state.targets = next;
  state.targetsAt = now();
  persist();
  renderAll();
  showToast($('bankToggle').checked ? '已開啟熱量銀行' : '已關閉熱量銀行');
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
$('openMealExBtn').addEventListener('click', () => openScreen('scr-mealex'));

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
  $('calcBcLink').classList.toggle('hidden', Boolean(ib || comp));
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
$('openCalcBtn').addEventListener('click', () => openScreen('scr-calc'));
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
  fillTargetFields();   // 底下的每日目標頁換成新的數字
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
// 每日目標頁（右上「目標」或設定 → 每日目標）
function fillTargetFields() {
  const t = state.targets;
  $('tgt-kcal').value = t.kcal;
  MACRO_KEYS.forEach(k => { $('tgt-' + k).value = t[k] ?? ''; });
  EX_KEYS.forEach(k => { $('tgt-ex-' + k).value = (t.ex && t.ex[k]) ?? ''; });
  $('tgt-weight').value = t.weight ?? '';
  $('tgt-water').value = t.water ?? '';
  $('tgt-steps').value = t.steps ?? '';
}
$('openTargetBtn').addEventListener('click', () => openScreen('scr-targets'));
document.querySelectorAll('.preset-btn').forEach(btn => btn.addEventListener('click', () => { $('tgt-kcal').value = btn.getAttribute('data-preset'); }));
$('deriveTargetBtn').addEventListener('click', () => {
  const ex = {};
  EX_KEYS.forEach(k => { ex[k] = num($('tgt-ex-' + k).value); });
  if (!cleanEx(ex)) { showError('請先填六大類份數'); return; }
  const d = deriveFromEx(ex);
  $('tgt-kcal').value = d.kcal;
  MACRO_KEYS.forEach(k => { $('tgt-' + k).value = d[k]; });
  showToast('已依份數試算：' + d.kcal + ' kcal（可再依營養師建議調整）');
});
$('saveTargetBtn').addEventListener('click', () => {
  const kcal = Number($('tgt-kcal').value);
  if (!Number.isFinite(kcal) || kcal < 800 || kcal > 6000) { showError('熱量目標請填 800–6000'); return; }
  const ex = {};
  EX_KEYS.forEach(k => { const v = num($('tgt-ex-' + k).value); if (v) ex[k] = v; });
  const water = num($('tgt-water').value);
  const steps = num($('tgt-steps').value);
  if (steps != null && (steps < 500 || steps > 50000)) { showError('步數下限請填 500～50000，或留空'); return; }
  const next = {
    ...state.targets,   // 保留新版 App 加的欄位（例如試算記錄 calc）
    kcal: Math.round(kcal),
    p: num($('tgt-p').value), c: num($('tgt-c').value), f: num($('tgt-f').value),
    ex, weight: num($('tgt-weight').value), water: water > 0 ? Math.round(water) : null,
    steps: steps > 0 ? Math.round(steps) : null
  };
  // 手動改過熱量、營養素或喝水，就不再是試算的數字：拿掉試算記錄（之後不會提醒重算）
  if (['kcal', 'p', 'c', 'f', 'water'].some(k => (next[k] ?? null) !== (state.targets[k] ?? null))) delete next.calc;
  // 手動改目標體重：不再是用體脂率算的
  if ((next.weight ?? null) !== (state.targets.weight ?? null)) delete next.bodyFat;
  state.targets = next;
  state.targetsAt = now();
  persist();
  renderAll();
  closeScreen();
  showToast('已更新目標');
});
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

/* ---------------- 吃到飽速記（Rev. 43 移除） ---------------- */
// 舊版留在這台裝置、還沒記下來的速記（meta.party）：開 App 時問一次，記到開始那天，不會默默丟掉
const partyPhotoKey = (code) => 'party_' + code;
async function clearPartyPhotos(d) {
  await Promise.all(Object.keys((d && d.photos) || {}).map(code => deletePhoto(partyPhotoKey(code)).catch(() => {})));
}
function rescuePartyDraft() {
  const d = state.meta.party;
  if (!d) return;
  const tpl = partyTemplate(d.tpl);
  const list = partyEntries(tpl, d.counts, d.grams);
  const base = startCounts(tpl);
  const touched = Object.keys(d.counts || {}).some(k => d.counts[k] !== (base[k] || 0));
  const drop = () => { clearPartyPhotos(d); delete state.meta.party; persistLocal(); };
  if (!touched || !list.length) { drop(); return; }
  const at = new Date(d.at || now());
  const date = toDateStr(at);
  const h = at.getHours();
  const meal = h < 10 ? 'breakfast' : h < 15 ? 'lunch' : 'dinner';
  const label = (at.getMonth() + 1) + '/' + at.getDate() + ' ' + MEAL_META[meal].label;
  const save = async () => {
    const items = await Promise.all(list.map(async entry => ({
      entry, photo: d.photos && d.photos[entry.party.code] ? await getPhoto(partyPhotoKey(entry.party.code)) : null
    })));
    const keep = { date: ui.date, meal: ui.meal };
    ui.date = date; ui.meal = meal;
    saveGroup(items);
    ui.date = keep.date; ui.meal = keep.meal;
    drop();
    renderAll();
    showToast('已記到 ' + label);
  };
  openConfirm('上次的吃到飽速記還沒記下來',
    '共 ' + partyTotals(tpl, d.counts).kcal + ' 大卡（' + list.length + ' 樣）。吃到飽速記已經拿掉了，要把這份記到 ' + label + ' 嗎？之後可以再改。',
    save, '記下來', () => openConfirm('不要這份速記？', '刪掉就找不回來了。', drop, '刪掉', null, '留著'), '不要了');
}
$('extGoogleSearchBtn').addEventListener('click', () => {
  const q = $('extSearchInput').value.trim() || '台灣外食';
  window.open('https://www.google.com/search?q=' + encodeURIComponent(q + ' 熱量 大卡'), '_blank', 'noopener,noreferrer');
});
$('applyEstimateBtn').addEventListener('click', async () => {
  const t = estTotals();
  if (!t.kcal) { showError('請先按上面的份量按鈕'); return; }
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
  if (!from || !to) { showError('請選擇期間'); return; }
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
    showError('產生報告失敗：' + err.message);
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
  try { await navigator.clipboard.writeText(text); showToast('已複製文字摘要，貼到 LINE 即可'); } catch (e) { showError('無法複製，請改用列印／存 PDF'); }
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
  Object.values(state.logs).forEach(list => (list || []).forEach(it => { if (it.hasPhoto) ids.push(it.id, ...morePhotoKeys(it)); }));
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
  try { data = JSON.parse(await file.text()); } catch (err) { showError('檔案無法讀取，請確認是 JSON 備份檔'); return; }
  if (data && data.app === 'diet-tracker-foods') { if (isMyFoodsFile(data)) importMyFoods(data); else importPack(data); return; }   // 選到食物檔也可以
  if (requiredRev(data)) { showError('這個備份檔是較新版的 App 做的，請先更新 App（設定 → 關於）再匯入'); return; }
  openConfirm('匯入備份', '會把「' + file.name + '」合併到目前資料，相同的記錄不會重複；目標設定會改成備份檔裡的設定。', async () => {
    try {
      const r = await mergeImport(data);
      persist();
      renderAll();
      showToast('匯入完成：新增 ' + r.added + ' 筆記錄、' + r.photos + ' 張照片');
    } catch (err) {
      showError('匯入失敗：' + err.message);
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
  const rows = [['日期', '時間', '餐別', '食物', '份數', '熱量(kcal)', '蛋白質(g)', '碳水(g)', '脂肪(g)', ...EX_KEYS.map(k => EX_META[k].short + '(份)'), '暫估待修', '有照片', '事後補記']];
  Object.keys(state.logs).sort().forEach(date => {
    (state.logs[date] || []).slice().sort((a, b) => MEAL_KEYS.indexOf(a.meal) - MEAL_KEYS.indexOf(b.meal) || (a.time || '').localeCompare(b.time || '')).forEach(it => {
      rows.push([date, it.time, MEAL_META[it.meal].label, it.name, it.multiplier || 1, it.kcal, it.p, it.c, it.f, ...EX_KEYS.map(k => (it.ex && it.ex[k]) || ''), it.pending ? '是' : '', it.hasPhoto ? '是' : '', it.backfill ? '是' : '']);
    });
  });
  downloadBlob('飲食明細_' + todayStr() + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
  showToast('已匯出飲食明細 CSV');
});
$('exportDaysCsvBtn').addEventListener('click', () => {
  const dates = Array.from(new Set([...Object.keys(state.logs), ...Object.keys(state.days)])).sort();
  const rows = [['日期', '總熱量', '蛋白質(g)', '碳水(g)', '脂肪(g)', ...EX_KEYS.map(k => EX_META[k].short + '(份)'), '體重(kg)', 'BMI', '腰圍(cm)', '臀圍(cm)', '上臂圍(cm)', '大腿圍(cm)', '胸圍(cm)', '體脂率(%)', '喝水(ml)', '運動', '運動分鐘', '上床', '起床', '夜間睡眠(分)', '補眠(分)', '總睡眠(小時)', '睡眠品質(1-5)', '飢餓感(1-5)', '心情(1-5)', '排便', '備註', '想問營養師', '體脂機基礎代謝(kcal)', '骨骼肌(kg)', '內臟脂肪等級', '相位角(°)', '細胞外水分比', '內臟脂肪面積(cm²)', '四肢肌肉量(kg)', 'SMI(kg/m²)', '步數', '血壓', '血糖']];
  dates.forEach(date => {
    const t = dayTotals(date);
    const d = state.days[date] || {};
    rows.push([date, t.kcal, t.macroItems ? t.p : '', t.macroItems ? t.c : '', t.macroItems ? t.f : '', ...EX_KEYS.map(k => (t.exItems ? t.ex[k] : '')),
      d.weight, calcBmi(d.weight, state.profile.height), d.waist, d.hip, d.arm, d.thigh, d.chest, d.bodyFat, d.water, d.exercise, d.exMin, d.sleepBed, d.sleepWake, d.sleepMin, daySleep(d).nap || '', daySleep(d).total ? r1(daySleep(d).total / 60) : '', d.sleepQ, d.hunger, d.mood, d.bowel != null ? BOWEL_LABELS[d.bowel] : '', d.note, d.question, d.bmr, d.smm, d.vfl, d.pa, d.ecw, d.vfa, d.asm, calcSmi(d.asm, state.profile.height), d.steps, bpText(d.bp), glucoseText(d.glucose)]);
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
  try { if (!silent) sessionStorage.setItem('diet_reauth_at', String(Date.now())); } catch (e) { /* ignore */ }
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
    if (!auto) { goToCloudSection(); showError('請改用 Safari／Chrome 開啟後再登入 Google'); }
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
    checkSharedPacks();   // 同步帶來別台的邀請碼（舊用戶裝置可以升級）、或該檢查外食圖書館新版了
    try { sessionStorage.removeItem('diet_reauth_at'); localStorage.removeItem(SILENT_FAIL); } catch (e) { /* ignore */ }
  } catch (err) {
    if (err && err.auth) {
      c.needAuth = true;
      persistLocal();
      if (auto) setCloudStatus('Google 登入過期了，按「立即同步」重新登入', 'warn');
      else { cloudBusy = false; startSignIn(action); }
    } else {
      setCloudStatus((err && err.message) || '同步失敗', 'err');
      if (!auto) showError('同步失敗，請稍後再試');
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
  if (refreshDevice()) { c.dirty = true; persistLocal(); }
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
  // 雲端資料是更新版的 App 寫的、這一版看不懂：先暫停同步（不合併、不上傳），提示更新；兩邊資料都不動
  const need = Math.max(requiredRev(remote), requiredRev(local));
  if (need) {
    c.blockedRev = need;
    persistLocal();
    setCloudStatus('雲端的資料需要較新版的 App（Rev. ' + need + ' 以上）。更新前先暫停同步，這台的資料都還在。', 'warn');
    return;
  }
  if (c.blockedRev) { delete c.blockedRev; persistLocal(); }
  const merged = mergeData(local, remote);

  // 照片：本機是最新版本、雲端沒有 → 上傳；本機沒有或是舊版本、雲端有 → 下載
  const cloudPhotoMap = await cloud.listPhotos();
  const keyToId = new Map();
  const moreKeys = new Set();   // 第 2、3 張：IndexedDB 和雲端都用同一個 key，內容不會改（換照片＝換 key）
  Object.values(merged.logs).forEach(list => (list || []).forEach(it => {
    if (it.hasPhoto) keyToId.set(photoKeyOf(it), it.id);
    morePhotoKeys(it).forEach(k => moreKeys.add(k));
  }));
  const toUpload = [];
  const toDownload = [];
  for (const [key, id] of keyToId) {
    const haveCurrent = localPhotoKey(id) === key && Boolean(await getPhoto(id));
    if (haveCurrent && !cloudPhotoMap.has(key)) toUpload.push(key);
    else if (!haveCurrent && cloudPhotoMap.has(key)) toDownload.push([key, cloudPhotoMap.get(key)]);
  }
  for (const key of moreKeys) {
    const have = Boolean(await getPhoto(key));
    if (have && !cloudPhotoMap.has(key)) toUpload.push(key);
    else if (!have && cloudPhotoMap.has(key)) toDownload.push([key, cloudPhotoMap.get(key)]);
  }
  if (toUpload.length) {
    await cloud.uploadPhotos(toUpload, (key) => getPhoto(keyToId.has(key) ? keyToId.get(key) : key), (n, total) => setCloudStatus(`上傳照片 ${n}/${total}…`, 'busy'));
  }
  if (toDownload.length) {
    const got = await cloud.downloadPhotos(toDownload, (n, total) => setCloudStatus(`下載照片 ${n}/${total}…`, 'busy'));
    for (const [key, dataUrl] of Object.entries(got)) {
      if (moreKeys.has(key) && !keyToId.has(key)) { await savePhoto(key, dataUrl); continue; }
      const id = keyToId.get(key);
      await savePhoto(id, dataUrl);
      setLocalPhotoKey(id, key);
    }
  }
  // 清掉雲端上已刪除記錄或舊版本的照片
  {
    for (const [key, fileId] of cloudPhotoMap) {
      if (keyToId.has(key) || moreKeys.has(key)) continue;
      // 第 2、3 張（x_<記錄id>_<時間>）：記錄已刪除，或記錄還在但不用這張了 → 刪掉（這台也一起刪）。
      // 記錄還沒同步到雲端的（別台剛拍、資料還沒上傳）先不動
      const entryId = key.startsWith('x_') ? key.slice(2, key.lastIndexOf('_')) : key.split('-')[0];
      if (merged.tomb['e:' + entryId] || Object.values(merged.logs).some(l => (l || []).some(it => it.id === entryId))) {
        await cloud.deleteFile(fileId);
        if (key.startsWith('x_')) await deletePhoto(key);
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
  if (changedLocally) {
    // 別台拿掉或刪掉的第 2、3 張照片，這台也刪
    const usedKeys = (d) => new Set(Object.values(d.logs || {}).flatMap(l => (l || []).flatMap(morePhotoKeys)));
    const keep = usedKeys(finalData);
    for (const k of usedKeys(nowLocal)) if (!keep.has(k)) await deletePhoto(k);
    applySyncData(finalData);
  }
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

// Google 的登入只有 1 小時。過期後在「沒有正在輸入的東西」時，自動跳去 Google 換新的再跳回來（不用按）。
// iPad、手機的 App 常常一直開在背景，所以切回來時也要試，不能只在打開 App 時試。
const SILENT_AT = 'diet_silent_at';       // 上次自動換登入的時間
const SILENT_FAIL = 'diet_silent_fail';   // 上次自動換失敗（Google 要你自己登入）的時間
function canSilentRenew() {
  const c = state.meta.cloud;
  if (!cloud.isConfigured() || !c.linked || c.auto === false) return false;
  if (cloud.isBlockedInAppBrowser()) return false;
  // 跳轉會清掉還沒存的輸入：有打開的畫面、對話框、購物車，或正在打字，就不跳
  if (screenStack.length || foodCart.length || document.querySelector('.modal:not(.hidden)')) return false;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
  let last = 0;
  try { last = Number(localStorage.getItem(SILENT_AT) || 0); } catch (e) { /* ignore */ }
  return Date.now() - last > 10 * 60000 && !silentFailedRecently();
}
function silentFailedRecently() {
  let t = 0;
  try { t = Number(localStorage.getItem(SILENT_FAIL) || 0); } catch (e) { /* ignore */ }
  return Date.now() - t < 6 * 3600000;
}
function markNeedAuth() {
  const c = state.meta.cloud;
  if (c.needAuth) return;
  c.needAuth = true; persistLocal(); renderBanners(); renderSyncChip();
}
function renewOrMarkNeedAuth() {
  if (!canSilentRenew()) { markNeedAuth(); return; }
  try { localStorage.setItem(SILENT_AT, String(Date.now())); } catch (e) { /* ignore */ }
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; persist(); }
  startSignIn('sync', true);
}

function autoSyncOnOpen() {
  const c = state.meta.cloud;
  if (!cloud.isConfigured() || !c.linked || c.auto === false) return;
  if (cloud.getToken()) { cloudRun('sync', { auto: true }); return; }
  renewOrMarkNeedAuth();
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
  quick: 'scr-food', photo: 'scr-photo', water: 'scr-water', weight: 'scr-weight', sleep: 'scr-sleep',
  food: 'scr-food', manual: 'scr-manual', est: 'scr-est', exercise: 'scr-exercise', note: 'scr-note',
  ai: 'scr-ai', weekly: 'scr-weekly', bodycomp: 'scr-bodycomp'
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
  if (id === 'scr-food') foodMode = go === 'quick' ? 'mine' : 'all';   // 舊捷徑「常吃的」＝我的食物
  openScreen(id);
}

/* ---------------- 公測邀請碼（js/invite.js；管理者的試算表 tools/invite/Code.gs） ---------------- */
// 送到管理者的 Apps Script：只送邀請碼、姓名、這台的裝置 ID 和名稱（不送飲食記錄）
async function callInvite(payload, timeout = 15000) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const r = await fetch(INVITE_URL, { method: 'POST', body: JSON.stringify(payload), signal: ctrl.signal });   // text/plain：不用預檢
    clearTimeout(timer);
    return await r.json();
  } catch (e) {
    return { ok: false, reason: 'network' };
  }
}
let invitePending = null;   // 號碼對了、等填姓名：{ code }
const canGoogle = () => cloud.isConfigured();
function showInviteStep(step) {
  ['Choice', 'Code', 'Name'].forEach(k => $('inviteStep' + k).classList.toggle('hidden', k !== step));
  $('inviteToChoiceBtn').classList.toggle('hidden', !canGoogle() || Boolean(state.meta.cloud.linked));
}
// reason：號碼被停用等原因要重新輸入；lead：換掉上面的說明（例如已連好 Google、雲端沒有邀請碼）
let inviteVoluntary = false;   // 舊用戶自己要加入（可以關掉）；一般的邀請碼畫面不能關
function showInviteGate(reason, lead) {
  $('inviteCloseBtn').classList.toggle('hidden', !inviteVoluntary);
  $('inviteGate').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  invitePending = null;
  // 第一次：先選用 Google 帳號或只用這台；要重新確認、或已經連好 Google 的，直接輸入邀請碼
  showInviteStep(!reason && !lead && canGoogle() && !state.meta.cloud.linked ? 'Choice' : 'Code');
  $('inviteLead').textContent = lead || (reason ? '你的邀請碼要重新確認。' : '現在是公測期間，請選一種方式開始。');
  if (!canGoogle() && !reason && !lead) $('inviteLead').textContent = '現在是公測期間，請輸入邀請你的人給你的邀請碼。';
  setBox('inviteNote', reason ? 'err' : null, reason ? inviteMessage(reason) : '');
}
function hideInviteGate() {
  inviteVoluntary = false;
  $('inviteGate').classList.add('hidden');
  if (!screenStack.length) document.body.style.overflow = '';
}
const inviteNow = () => gateState({ url: INVITE_URL, invite: state.meta.invite, hasData: hasLocalData(), cloudInvite: state.betaInvite });
// 這台的邀請碼也存進同步資料（連了雲端才會上傳），重裝後用 Google 登入就能取回
function saveCloudInvite() {
  const v = cloudInviteFor(state.meta.invite, state.betaInvite, now());
  if (!v) return;
  state.betaInvite = v;
  persist();
}
// 開 App 時：沒設網址就不管；舊用戶記成放行；雲端有邀請碼的用它登記；新裝置、被停用的要輸入；其他的每天問一次有沒有被停用
function initInviteGate() {
  const g = inviteNow();
  if (g === 'off') return;
  if (g === 'legacy') { state.meta.invite = { legacy: true, at: now(), rev: APP_REV }; persistLocal(); saveCloudInvite(); return; }
  if (g === 'restore') { restoreInvite(); return; }
  if (g === 'new' || g === 'locked') { showInviteGate(g === 'locked' ? state.meta.invite.reason : null); return; }
  saveCloudInvite();
  if (needCheck(state.meta.invite, now()) && navigator.onLine !== false) checkInviteAgain();
  setTimeout(() => checkSharedPacks(), 3000);
}
// 雲端記著的邀請碼：用它登記這台（同號碼＋同裝置名稱＋同姓名，試算表不會多算一台）
async function restoreInvite() {
  const ci = state.betaInvite;
  $('inviteGate').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  ['Choice', 'Code', 'Name'].forEach(k => $('inviteStep' + k).classList.add('hidden'));
  $('inviteLead').textContent = '找到你的邀請碼了，確認中…';
  setBox('inviteNote', null, '');
  const r = await callInvite({ action: 'register', code: ci.code, deviceId: state.meta.deviceId, deviceName: myDeviceName(), name: ci.name || '' });
  // 連不上：先讓他用，下次打開再確認（lastCheck 0）
  if (!r.ok && r.reason !== 'network' && r.reason !== 'busy') {
    showInviteGate(r.reason === 'unknown' ? 'disabled' : r.reason);
    return;
  }
  state.meta.invite = { code: ci.code, name: ci.name || r.name || '', at: now(), rev: APP_REV, lastCheck: r.ok ? now() : 0 };
  persistLocal();
  hideInviteGate();
  showToast('歡迎回來' + (state.meta.invite.name ? '，' + state.meta.invite.name : '') + '！');
  setTimeout(() => checkSharedPacks(true), 3000);
}
// 在邀請碼畫面按「用 Google 帳號登入」：登入回來（或本來就有登入）→ 連好雲端、取回記錄 → 看雲端有沒有邀請碼
async function inviteGoogle() {
  if (cloud.isBlockedInAppBrowser()) {
    setBox('inviteNote', 'err', '你現在是用 LINE／Facebook 等 App 裡的瀏覽器開啟，Google 不允許在這裡登入。請點右上角選單，選「用 Safari／Chrome 開啟」，再按一次。');
    return;
  }
  state.meta.welcomed = true;
  persistLocal();
  if (!cloud.getToken()) { setBox('inviteNote', 'info', '前往 Google 登入…'); startSignIn('gate'); return; }
  await afterInviteGoogle();
}
async function afterInviteGoogle() {
  $('inviteGate').classList.remove('hidden');
  ['Choice', 'Code', 'Name'].forEach(k => $('inviteStep' + k).classList.add('hidden'));
  $('inviteLead').textContent = '已登入 Google，正在讀取雲端的記錄…';
  setBox('inviteNote', null, '');
  const before = state.meta.cloud.lastSync || 0;
  await cloudRun('connect');
  if (!state.meta.cloud.linked || (state.meta.cloud.lastSync || 0) === before) {
    showInviteGate(null);
    setBox('inviteNote', 'err', '沒有連上 Google 雲端，請再試一次；或選「只用這台裝置」輸入邀請碼。');
    return;
  }
  const g = inviteNow();
  if (g === 'restore') { restoreInvite(); return; }
  if (g === 'legacy') {
    state.meta.invite = { legacy: true, at: now(), rev: APP_REV };
    persistLocal();
    saveCloudInvite();
    hideInviteGate();
    showToast('歡迎回來！記錄已經取回');
    return;
  }
  if (g === 'open') { hideInviteGate(); return; }
  showInviteGate(null, '已連好 Google 雲端。第一次使用，請輸入邀請你的人給你的邀請碼（只要輸入這一次）。');
}
$('inviteGoogleBtn').addEventListener('click', inviteGoogle);
$('inviteCloseBtn').addEventListener('click', hideInviteGate);
// 公測之前就在用的（沒有邀請碼）：自己輸入邀請碼，才下載得到外食圖書館、能用意見回饋和推薦食物
function openInviteJoin() {
  inviteVoluntary = true;
  showInviteGate(null, '輸入邀請碼，就能下載大家共用的外食圖書館，也能送意見回饋、推薦食物。你的記錄都不會變。');
}
// 舊用戶裝置：雲端（同一個 Google 帳號）已經有邀請碼（例如另一台登記過）→ 用它登記這台，不用輸入
let upgrading = false;
async function upgradeLegacy() {
  const inv = state.meta.invite;
  const ci = state.betaInvite;
  if (upgrading || !INVITE_URL || !inv || !inv.legacy || !ci || !ci.code || navigator.onLine === false) return false;
  if (inv.upgradeTried && now() - inv.upgradeTried < SHARED_EVERY) return false;
  upgrading = true;
  try {
    const r = await callInvite({ action: 'register', code: ci.code, deviceId: state.meta.deviceId, deviceName: myDeviceName(), name: ci.name || '' });
    if (!r.ok) { inv.upgradeTried = now(); inv.upgradeReason = r.reason; persistLocal(); return false; }
    state.meta.invite = { code: ci.code, name: ci.name || r.name || '', at: now(), rev: APP_REV, lastCheck: now(), from: 'legacy' };
    persistLocal();
    return true;
  } finally {
    upgrading = false;
  }
}
$('inviteLocalBtn').addEventListener('click', () => { showInviteStep('Code'); setBox('inviteNote', null, ''); $('inviteCode').focus(); });
$('inviteToChoiceBtn').addEventListener('click', () => showInviteGate(null));
async function checkInviteAgain() {
  const inv = state.meta.invite;
  const r = await callInvite({ action: 'ping', code: inv.code, deviceId: state.meta.deviceId, deviceName: myDeviceName() });
  if (r.ok) { inv.lastCheck = now(); persistLocal(); return; }
  // 連不上、太忙：下次再問，不擋人
  if (!['unknown', 'disabled', 'full'].includes(r.reason)) return;
  Object.assign(inv, { locked: true, reason: r.reason });
  persistLocal();
  showInviteGate(r.reason);
}
$('inviteCode').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  $('inviteCodeBtn').click();
});
$('inviteCodeBtn').addEventListener('click', async () => {
  const wait = waitSeconds(state.meta.inviteFails, now());
  if (wait) { setBox('inviteNote', 'err', '輸錯太多次了，請 ' + wait + ' 秒後再試。'); return; }
  const code = normalizeInvite($('inviteCode').value);
  if (!code) { setBox('inviteNote', 'err', '邀請碼是 4 個數字，例如 JJ-4821 就填 4821。'); return; }
  const btn = $('inviteCodeBtn');
  btn.disabled = true; btn.textContent = '確認中…';
  const r = await callInvite({ action: 'check', code, deviceId: state.meta.deviceId, deviceName: myDeviceName() });
  btn.disabled = false; btn.textContent = '確認';
  if (!r.ok) {
    if (r.reason === 'unknown') { state.meta.inviteFails = addFail(state.meta.inviteFails, now()); persistLocal(); }
    setBox('inviteNote', 'err', inviteMessage(r.reason));
    return;
  }
  delete state.meta.inviteFails;
  invitePending = { code };
  // 這組碼已經有人登記過姓名（同一個人的第二台）：直接用那個姓名
  if (r.name) { $('inviteName').value = r.name; }
  $('inviteStepCode').classList.add('hidden');
  $('inviteStepName').classList.remove('hidden');
  setBox('inviteNote', 'ok', r.name ? '邀請碼正確。這組邀請碼登記的是「' + r.name + '」，是你的話直接按「開始使用」。' : '邀請碼正確！請填你的姓名。');
});
$('inviteBackBtn').addEventListener('click', () => { invitePending = null; showInviteStep('Code'); setBox('inviteNote', null, ''); });
$('inviteNameBtn').addEventListener('click', async () => {
  if (!invitePending) return;
  const name = $('inviteName').value.trim();
  if (!name) { setBox('inviteNote', 'err', inviteMessage('name')); $('inviteName').focus(); return; }
  const btn = $('inviteNameBtn');
  btn.disabled = true; btn.textContent = '送出中…';
  const r = await callInvite({ action: 'register', code: invitePending.code, deviceId: state.meta.deviceId, deviceName: myDeviceName(), name });
  btn.disabled = false; btn.textContent = '開始使用';
  if (!r.ok) { setBox('inviteNote', 'err', inviteMessage(r.reason)); return; }
  state.meta.invite = { code: invitePending.code, name, at: now(), rev: APP_REV, lastCheck: now() };
  invitePending = null;
  persistLocal();
  saveCloudInvite();
  hideInviteGate();
  showToast('歡迎加入公測，' + name + '！');
  setTimeout(() => checkSharedPacks(true), 3000);
});

/* ---------------- 共用資料庫：管理者發佈（tools/invite/Code.gs 的 packs、pack），App 自動更新 ---------------- */
// 只給用邀請碼登記過的裝置；大約每 12 小時問一次有沒有新版，有就下載換掉（不用使用者按）
const SHARED_EVERY = 12 * 3600 * 1000;
function sharedMeta() {
  if (!state.meta.shared || typeof state.meta.shared !== 'object') state.meta.shared = { files: {}, checkedAt: 0 };
  if (!state.meta.shared.files) state.meta.shared.files = {};
  return state.meta.shared;
}
async function loadSharedPacks() {
  const m = sharedMeta();
  const out = [];
  for (const key of Object.keys(m.files)) {
    const pack = await sharedDB.get(key);
    if (pack && pack.id) out.push(pack); else delete m.files[key];   // 讀不到：下次檢查重新下載
  }
  sharedPacks = out;
}
// 我推薦的有幾樣被採用（同一組邀請碼的所有裝置一起算）：熱心貢獻者小成就、「謝謝你」提示。只存這台
async function checkContribStats(who) {
  const r = await callInvite({ action: 'myContribs', ...who });
  if (!r.ok || !Array.isArray(r.approved)) return;
  const before = state.meta.contribStats ? state.meta.contribStats.approved.length : null;
  state.meta.contribStats = { sent: Number(r.sent) || 0, approved: r.approved.map(String).sort(), at: now() };
  persistLocal();
  const more = before == null ? 0 : state.meta.contribStats.approved.length - before;
  if (more > 0) showToast('你推薦的食物有 ' + more + ' 樣被加進外食圖書館了，謝謝你！🙌');
  renderMascot();
}
let sharedBusy = false;
let lastSharedResult = null;   // 最近一次檢查：{ ok, changed, failed }（「立刻檢查」按鈕顯示結果用）
async function checkSharedPacks(force = false) {
  if (INVITE_URL && state.meta.invite && state.meta.invite.legacy) {
    if (!(await upgradeLegacy())) return;
    force = true;
  }
  if (sharedBusy || !INVITE_URL || !canSendFeedback(state.meta.invite) || navigator.onLine === false) return;
  const m = sharedMeta();
  if (!force && now() - (m.checkedAt || 0) < SHARED_EVERY) return;
  sharedBusy = true;
  try {
    const who = { code: state.meta.invite.code, deviceId: state.meta.deviceId };
    const r = await callInvite({ action: 'packs', ...who });
    if (!r.ok || !Array.isArray(r.packs)) return;
    checkContribStats(who);
    const plan = sharedPlan(m.files, r.packs);
    const versions = new Map(r.packs.map(x => [String(x.key), Number(x.version) || 0]));
    const done = [];
    let failed = false;
    for (const key of plan.fetch) {
      const d = await callInvite({ action: 'pack', key, ...who });
      const { pack, error } = d.ok ? packFromFile(d.file, { now: now() }) : { error: d.reason };
      if (error) { failed = true; continue; }
      const sp = { ...pack, shared: true };
      done.push((m.files[key] ? '已更新' : '已加入') + '「' + sp.name + '」（' + sp.foods.length + ' 樣）');
      await sharedDB.put(key, sp);
      m.files[key] = { version: versions.get(key), id: sp.id, name: sp.name, n: sp.foods.length };
    }
    for (const key of plan.drop) { await sharedDB.del(key); delete m.files[key]; }
    if (!failed) m.checkedAt = now();   // 有沒下載成功的：下次打開再試
    persistLocal();
    lastSharedResult = { ok: true, changed: done.length + plan.drop.length, failed };
    if (done.length || plan.drop.length) {
      await loadSharedPacks();
      renderAll();
      if (screenStack.includes('scr-food')) renderFoodResults();
      if (done.length) showToast('共用資料庫' + done.join('、'));
    }
  } finally {
    sharedBusy = false;
  }
}

/* ---------------- 📮 投稿：我的食物推薦給外食圖書館（js/contrib.js；試算表「投稿」分頁，管理者人工審核） ---------------- */
let ctFood = null;
let ctPhotos = [];   // JPEG data URL
$('mf-contrib').addEventListener('click', () => {
  const food = customFoods().find(f => f.id === mfEditing);
  if (!food) return;
  ctFood = food;
  ctPhotos = [];
  const row = contribFood(food);
  const nutr = [['熱量', row.kcal, '大卡'], ['蛋白質', row.p, '克'], ['脂肪', row.f, '克'], ['碳水', row.c, '克'], ['糖', row.sugar, '克'], ['鈉', row.na, '毫克']]
    .filter(x => x[1] != null).map(x => x[0] + ' ' + x[1] + ' ' + x[2]).join('・');
  $('ctSummary').innerHTML = `<div class="text-xl font-bold text-stone-900 break-words">${esc(row.name)}</div>
    <div class="text-base text-stone-600">一份：${esc(row.serving)}</div>
    <div class="text-lg text-emerald-800 font-semibold tabular-nums">${esc(nutr)}</div>
    <div class="text-sm text-stone-500">數字不對的話，先回上一頁改好、儲存，再推薦。</div>`;
  $('ctBrand').value = food.brand || '';
  const groups = libraryShops(sharedPacks);
  $('ctBrandList').innerHTML = groups.flatMap(g => g.shops).map(x => `<option value="${esc(x.brand)}"></option>`).join('');
  const myGroup = (groups.find(g => g.shops.some(x => x.brand === food.brand)) || {}).group || '';
  $('ctGroup').innerHTML = ['', ...new Set([...LIBRARY_GROUPS, ...groups.map(g => g.group)].filter(g => g !== OTHER_GROUP))].map(g => `<option value="${esc(g)}"${g === myGroup ? ' selected' : ''}>${esc(g || '不知道（讓管理者分）')}</option>`).join('');
  $('ctWhere').value = '';
  if (state.meta.creditName == null) state.meta.creditName = maskName(state.meta.invite && state.meta.invite.name);
  $('ctCredit').value = state.meta.creditName;
  $('ctWhat').textContent = '按「送出推薦」會把這樣食物的名稱和數字、店家、照片、在哪裡看到的，連同版本、裝置名稱、邀請碼和姓名，送到公測管理者的 Google 試算表和雲端硬碟。不會送出你的飲食記錄。照片裡請不要拍到人臉或個人資料。';
  setBox('ctNote', null, '');
  renderCtPhotos();
  openScreen('scr-contrib');
});
function renderCtPhotos() {
  $('ctPhotos').innerHTML = ctPhotos.map((src, i) => `<div class="relative"><img src="${src}" alt="照片 ${i + 1}" class="w-full aspect-square object-cover rounded-xl border border-stone-200" />
    <button type="button" data-ct-del="${i}" class="absolute top-1 right-1 bg-white/90 rounded-full w-9 h-9 text-lg" aria-label="拿掉照片 ${i + 1}">✕</button></div>`).join('');
  $('ctAddPhoto').classList.toggle('hidden', ctPhotos.length >= CONTRIB_PHOTOS);
}
$('ctAddPhoto').addEventListener('click', () => $('ctPhotoInput').click());
$('ctPhotoInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try { ctPhotos.push(await compressImage(file, 1600)); } catch (err) { setBox('ctNote', 'err', '這張照片讀不到，請換一張'); return; }
  setBox('ctNote', null, '');
  renderCtPhotos();
});
$('ctPhotos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ct-del]');
  if (!b) return;
  ctPhotos.splice(Number(b.getAttribute('data-ct-del')), 1);
  renderCtPhotos();
});
$('ctSendBtn').addEventListener('click', async () => {
  if (!ctFood) return;
  const food = contribFood(ctFood);
  const brand = $('ctBrand').value.trim();
  const problem = contribProblem({ food, brand, photos: ctPhotos });
  if (problem) { setBox('ctNote', 'err', problem); return; }
  const btn = $('ctSendBtn');
  btn.disabled = true; btn.textContent = '送出中，照片比較久…';
  const r = await callInvite({ action: 'contrib', code: state.meta.invite.code, deviceId: state.meta.deviceId, deviceName: myDeviceName(), ver: APP_LABEL,
    brand, group: $('ctGroup').value, where: $('ctWhere').value.trim(), credit: $('ctCredit').value.trim() || ANON, food, photos: ctPhotos }, 90000);
  btn.disabled = false; btn.textContent = '送出推薦';
  if (!r.ok) { setBox('ctNote', 'err', contribMessage(r.reason)); return; }
  state.meta.creditName = $('ctCredit').value.trim();   // 下次預填一樣的名字
  if (!state.meta.contribs) state.meta.contribs = {};
  state.meta.contribs[ctFood.id] = now();
  persistLocal();
  $('mf-contrib').textContent = '📮 已推薦過（' + fmtTime(now()) + '），再推薦一次';
  ctPhotos = [];
  closeScreen();
  showToast('謝謝你！已經送給管理者，看過照片就會加進外食圖書館');
});

/* ---------------- 📚 外食圖書館：勾自己會去的店 ---------------- */
function libraryCount() {
  const shops = libraryShops(sharedPacks).flatMap(g => g.shops);
  const off = new Set(libraryOff());
  return '已選 ' + shops.filter(x => !off.has(x.brand)).length + '／' + shops.length + ' 家';
}
function renderLibrary() {
  const groups = libraryShops(sharedPacks);
  const off = new Set(libraryOff());
  if (!groups.length) {
    $('libSummary').textContent = '';
    $('libList').innerHTML = '<p class="rounded-2xl bg-stone-50 text-stone-700 p-4 text-lg leading-relaxed">還沒有下載外食圖書館。用邀請碼加入公測、連上網路，打開 App 後會自動下載。</p>';
    return;
  }
  $('libSummary').textContent = libraryCount();
  const thanks = libraryThanks(sharedPacks);
  $('libThanks').classList.toggle('hidden', !thanks.length);
  $('libThanks').innerHTML = thanks.length ? '<div class="text-lg font-bold text-stone-900">🙏 感謝提供資料的朋友</div><p class="text-base text-stone-700 leading-relaxed">' +
    thanks.map(t => esc(t.name) + '（' + t.n + ' 樣）').join('、') + '</p><p class="text-sm text-stone-500">在「我的食物」按「📮 推薦給外食圖書館」，被採用就會列在這裡。</p>' : '';
  $('libList').innerHTML = groups.map((g, gi) => {
    const onN = g.shops.filter(x => !off.has(x.brand)).length;
    const all = onN === g.shops.length;
    return `<div class="rounded-2xl bg-white border border-stone-200 p-3 space-y-2">
      <div class="flex items-center gap-2"><span class="min-w-0 flex-1 text-xl font-bold text-stone-900 break-words">${esc(g.group)}</span>
      <button type="button" data-lib-group="${gi}" data-on="${all ? '0' : '1'}" class="chip-btn chip-lg shrink-0">${all ? '全不選' : '全選'}</button></div>
      ${g.shops.map(x => {
        const on = !off.has(x.brand);
        return `<button type="button" data-lib-shop="${esc(x.brand)}" aria-pressed="${on}" class="pick-row${on ? ' pick-done' : ''}">
          <span class="text-2xl shrink-0" aria-hidden="true">${on ? '☑️' : '⬜'}</span>
          <span class="min-w-0 flex-1 text-left"><span class="block text-lg font-semibold text-stone-900 break-words">${esc(x.brand)}</span>
          <span class="block text-sm text-stone-500">${x.n} 樣</span></span></button>`;
      }).join('')}</div>`;
  }).join('');
}
$('libCheckBtn').addEventListener('click', async () => {
  const btn = $('libCheckBtn');
  btn.disabled = true; btn.textContent = '檢查中…';
  lastSharedResult = null;
  await checkSharedPacks(true);
  btn.disabled = false; btn.textContent = '🔄 立刻檢查外食圖書館有沒有新版';
  const r = lastSharedResult;
  setBox('libCheckNote', r && r.ok && !r.failed ? 'ok' : 'err',
    !r ? '連不上，請確認有網路再試一次。' : r.failed ? '有新版但沒下載完，請稍後再試一次。' : r.changed ? '已經更新到最新版了。' : '已經是最新版了。');
  renderLibrary();
});
function setLibraryOff(brands) {
  state.libraryOff = { updatedAt: now(), brands };
  persist();
  renderLibrary();
  renderPackList();
}
$('libList').addEventListener('click', (e) => {
  const shop = e.target.closest('[data-lib-shop]');
  if (shop) { const b = shop.getAttribute('data-lib-shop'); setLibraryOff(toggleShops(libraryOff(), [b], libraryOff().includes(b))); return; }
  const grp = e.target.closest('[data-lib-group]');
  if (!grp) return;
  const g = libraryShops(sharedPacks)[Number(grp.getAttribute('data-lib-group'))];
  if (g) setLibraryOff(toggleShops(libraryOff(), g.shops.map(x => x.brand), grp.getAttribute('data-on') === '1'));
});

/* ---------------- 💬 意見回饋（設定 → 關於）---------------- */
let fbKind = '';
function renderFeedback() {
  const inv = state.meta.invite;
  const can = Boolean(INVITE_URL) && canSendFeedback(inv);
  $('fbForm').classList.toggle('hidden', !can);
  $('fbChatTitle').textContent = can ? '有截圖要給我們？' : '用聊天 App 告訴我們';
  if (can) {
    $('fbWhat').textContent = '按「送出」會把你寫的內容，和版本（' + APP_LABEL + '）、裝置名稱（' + myDeviceName() + '）、邀請碼和姓名，送到公測管理者的 Google 試算表。不會送出你的飲食記錄。請不要寫身分證字號、電話、地址。';
  }
  setBox('fbNote', null, '');
  renderFbKind();
  renderFbCount();
}
function renderFbKind() {
  document.querySelectorAll('[data-fb-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fbKind === fbKind)));
}
function renderFbCount() {
  $('fbCount').textContent = $('fbText').value.length + '／' + FEEDBACK_MAX + ' 字';
}
document.querySelectorAll('[data-fb-kind]').forEach(b => b.addEventListener('click', () => { fbKind = b.dataset.fbKind; renderFbKind(); }));
$('fbText').addEventListener('input', renderFbCount);
$('fbSendBtn').addEventListener('click', async () => {
  const text = $('fbText').value.trim();
  if (!text) { setBox('fbNote', 'err', feedbackMessage('empty')); $('fbText').focus(); return; }
  if (text.length > FEEDBACK_MAX) { setBox('fbNote', 'err', feedbackMessage('long')); return; }
  const inv = state.meta.invite;
  const btn = $('fbSendBtn');
  btn.disabled = true; btn.textContent = '送出中…';
  const r = await callInvite({ action: 'feedback', code: inv.code, deviceId: state.meta.deviceId, deviceName: myDeviceName(), ver: APP_LABEL, kind: fbKind || 'other', text });
  btn.disabled = false; btn.textContent = '送出';
  if (!r.ok) { setBox('fbNote', 'err', feedbackMessage(r.reason)); return; }
  $('fbText').value = '';
  fbKind = '';
  renderFbKind();
  renderFbCount();
  setBox('fbNote', 'ok', '謝謝你！已經送給公測管理者了。');
});
// 分享選單（手機）：列出這台有的 App，選常用的那個；不能分享的（電腦）複製起來，貼到任何聊天 App
$('fbShareBtn').addEventListener('click', async () => {
  const typed = $('fbText').value.trim();
  const text = feedbackInfo({ label: APP_LABEL, device: myDeviceName(), invite: state.meta.invite }) + (typed ? '\n' + typed : '\n');
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('已複製版本資訊，貼到 LINE、Messenger、Teams 或 Email 都可以');
  } catch (e) {
    showError('沒辦法自動複製。請直接用你常用的聊天 App 告訴邀請你的人，並說明版本是「' + APP_LABEL + '」。');
  }
});

(async function init() {
  await loadState();
  await loadSharedPacks();
  if (!state.meta.deviceId) { state.meta.deviceId = uid('dev'); persistLocal(); }
  applyFontSize();
  renderAll();
  switchTab('log');
  initInviteGate();
  const redirect = cloud.isConfigured() ? cloud.consumeRedirect() : null;
  if (redirect) {
    if (redirect.silent && redirect.error) {
      try { localStorage.setItem(SILENT_FAIL, String(Date.now())); } catch (e) { /* ignore */ }
      state.meta.cloud.needAuth = true; persistLocal(); renderBanners(); renderSyncChip();
    } else if (redirect.action === 'gate') {
      // 從邀請碼畫面去登入 Google 回來
      if (redirect.error) setBox('inviteNote', 'err', redirect.error + '。也可以選「只用這台裝置」輸入邀請碼。');
      else afterInviteGoogle();
    } else if (redirect.error) {
      goToCloudSection(); setCloudStatus(redirect.error, 'err');
    } else {
      if (redirect.action === 'connect') goToCloudSection();
      cloudRun(redirect.action === 'connect' ? 'connect' : 'sync', { auto: Boolean(redirect.silent) });
    }
  } else {
    autoSyncOnOpen();
    if (shouldWelcome()) openScreen('scr-welcome');
    else { openFromUrl(); rescuePartyDraft(); }
  }
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch (e) { /* ignore */ }
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  setTimeout(() => checkLatest(), 2000);
  // 跨日後回到 App 時自動跳到今天
  let lastToday = todayStr();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (state.meta.cloud.dirty && cloud.getToken()) cloudRun('sync', { auto: true });
      return;
    }
    checkLatest();
    if (state.meta.cloud.linked && state.meta.cloud.auto !== false) {
      if (cloud.getToken()) cloudRun('sync', { auto: true });
      else renewOrMarkNeedAuth();
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
