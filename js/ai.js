// AI 辨識（使用者自己的 Gemini API Key；預設關閉）
//   (A) 拍餐點或用一句話 → 拆成品項（名稱、估計克數、熱量、三大營養素、六大類份數）
//   (B) 拍包裝營養標示 → 每份的熱量與營養素
// Key 只存在這台裝置（state.meta.ai），不進同步檔、不進備份檔。
// 這個檔案不碰畫面：組請求、呼叫 API、整理回傳的資料（整理的部分是純函式，有單元測試）。
//
// 用 generateContent 端點：瀏覽器的 CORS 只允許 content-type、x-goog-api-key 兩個標頭
// （新的 interactions API 要求的 Api-Revision 標頭會被 CORS 擋掉，網頁無法使用）。
// 模型用 -latest 別名，舊版下架時不必改程式；找不到模型（404）才換下一個。

export const AI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
export const AI_MODELS = ['gemini-flash-latest', 'gemini-3.5-flash-lite'];

const EX_KEYS = ['grain', 'prot', 'veg', 'fruit', 'dairy', 'oil'];
const r1 = (v) => Math.round(v * 10) / 10;
const numOr = (v, d = null) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };

/* ---------------- 提示詞與回傳格式 ---------------- */

const EX_SCHEMA = {
  type: 'OBJECT',
  properties: { grain: { type: 'NUMBER' }, protein: { type: 'NUMBER' }, vegetable: { type: 'NUMBER' }, fruit: { type: 'NUMBER' }, dairy: { type: 'NUMBER' }, oil: { type: 'NUMBER' } }
};
export const MEAL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' }, grams: { type: 'NUMBER' }, kcal: { type: 'NUMBER' },
          protein: { type: 'NUMBER' }, carbs: { type: 'NUMBER' }, fat: { type: 'NUMBER' }, exchanges: EX_SCHEMA
        },
        required: ['name', 'grams', 'kcal']
      }
    },
    note: { type: 'STRING' }
  },
  required: ['items']
};
export const LABEL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    found: { type: 'BOOLEAN' },
    name: { type: 'STRING' },
    serving_g: { type: 'NUMBER' },
    servings_per_package: { type: 'NUMBER' },
    kcal: { type: 'NUMBER' }, protein: { type: 'NUMBER' }, fat: { type: 'NUMBER' }, carbs: { type: 'NUMBER' },
    sugar: { type: 'NUMBER' }, sodium_mg: { type: 'NUMBER' }
  },
  required: ['found']
};

export function mealPrompt(text) {
  return [
    '你是台灣的營養師助理。請辨識這一餐吃了哪些食物，每一樣分開列出（例如便當要拆成飯、主菜、各樣配菜）。',
    '名稱用台灣常用的繁體中文。grams 是估計的可食重量（公克；飲料用毫升當公克）。',
    'kcal、protein、carbs、fat 是這個份量的總量。exchanges 依台灣國民健康署「食物代換表」估六大類份數（全穀雜糧 grain、豆魚蛋肉 protein、蔬菜 vegetable、水果 fruit、乳品 dairy、油脂與堅果種子 oil），沒有就填 0。',
    '份量依台灣常見的份量估計。不確定的也列出最可能的食物，在 note 用一句話說明不確定的地方。',
    '如果不是食物，items 回傳空陣列，note 說明原因。',
    text ? '使用者的描述：' + text : '請看照片。'
  ].join('\n');
}
export const LABEL_PROMPT = [
  '這是台灣食品包裝上的「營養標示」。請讀出每一份的數值。',
  '如果標示只有「每 100 公克（毫升）」，serving_g 填 100，數值照每 100 公克填。',
  'name 填產品名稱（看不到就留空）。kcal 是熱量（大卡），protein 蛋白質、fat 脂肪、carbs 碳水化合物、sugar 糖（公克），sodium_mg 鈉（毫克）。',
  '照片裡找不到營養標示，found 回傳 false。'
].join('\n');

/* ---------------- 呼叫 API ---------------- */

export function buildRequest({ prompt, imageDataUrl = null, schema }) {
  const parts = [{ text: prompt }];
  if (imageDataUrl) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(imageDataUrl);
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.2 }
  };
}

// 把 API 的錯誤分成幾種，畫面依種類給長輩看得懂的說明
// detail：給使用者截圖用的原始原因（HTTP 狀態碼＋Google 的英文訊息），方便查問題
export class AiError extends Error {
  constructor(kind, message, detail = '') { super(message || kind); this.kind = kind; this.detail = detail; }
}
export function errorDetail(status, body) {
  const err = (Array.isArray(body) ? body[0] : body) || {};
  const e = err.error || {};
  return [status, e.status, String(e.message || '').slice(0, 160)].filter(Boolean).join(' ');
}
export function classifyError(status, body) {
  const err = (Array.isArray(body) ? body[0] : body) || {};
  const e = err.error || {};
  const reason = ((e.details || []).find(d => d.reason) || {}).reason || '';
  const msg = String(e.message || '');
  if (reason === 'API_KEY_INVALID' || /API key not valid/i.test(msg)) return 'key';
  if (status === 429 || e.status === 'RESOURCE_EXHAUSTED') return 'quota';
  if (status === 403) return /referer|referrer/i.test(msg) || reason === 'API_KEY_HTTP_REFERRER_BLOCKED' ? 'referrer' : 'forbidden';
  if (status === 404) return 'model';
  if (status === 503 || /overloaded|high demand/i.test(msg)) return 'busy';
  if (status >= 500) return 'server';
  return 'other';
}

// 從回應取出模型產生的文字（generateContent；也容許 interactions 的形狀）
export function responseText(json) {
  const j = Array.isArray(json) ? json[0] : json;
  if (!j) return '';
  const cand = j.candidates && j.candidates[0];
  if (cand && cand.content && Array.isArray(cand.content.parts)) return cand.content.parts.map(p => p.text || '').join('');
  if (Array.isArray(j.steps)) {
    return j.steps.filter(s => s.type === 'model_output').flatMap(s => s.content || []).map(c => c.text || '').join('');
  }
  return j.output_text || j.text || '';
}
export function parseJsonText(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch (e) { throw new AiError('parse', '', t ? 'JSON: ' + t.slice(0, 80) : ''); }
}
// 回應成功但沒有內容：被安全過濾擋掉、或字數用完被截斷
export function emptyReason(json) {
  const j = (Array.isArray(json) ? json[0] : json) || {};
  const block = j.promptFeedback && j.promptFeedback.blockReason;
  if (block) return 'blocked ' + block;
  const cand = j.candidates && j.candidates[0];
  return cand && cand.finishReason && cand.finishReason !== 'STOP' ? 'finish ' + cand.finishReason : '';
}

// 模型找不到（404）或太忙（503）就換下一個；每個模型最多等 timeoutMs，不讓畫面一直卡住
// info（可不給）：成功時寫入實際回答的模型 info.model，給「檢查 AI」顯示
export async function callGemini({ key, request, fetchFn = fetch, models = AI_MODELS, timeoutMs = 60000, info = null }) {
  if (!key) throw new AiError('key');
  let last = new AiError('other');
  for (const model of models) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res, body = null;
    try {
      res = await fetchFn(AI_ENDPOINT + encodeURIComponent(model) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(request),
        signal: ctrl ? ctrl.signal : undefined
      });
      try { body = await res.json(); } catch (e) { body = null; }
    } catch (e) {
      if (ctrl && ctrl.signal.aborted) { last = new AiError('timeout', '', model); continue; }
      throw new AiError('network', '', String((e && e.message) || ''));
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.ok) {
      const text = responseText(body);
      if (!text.trim()) throw new AiError('empty', '', model + ' ' + emptyReason(body));
      if (info) info.model = model;
      return parseJsonText(text);
    }
    const kind = classifyError(res.status, body);
    last = new AiError(kind, '', model + ' ' + errorDetail(res.status, body));
    if (kind !== 'model' && kind !== 'busy') throw last;
  }
  throw last;
}

/* ---------------- 整理回傳的資料（純函式） ---------------- */

// (A) → [{ name, grams, kcal, p, c, f, ex }]，不合理的品項丟掉
export function normalizeMeal(obj) {
  const items = (obj && Array.isArray(obj.items) ? obj.items : []).map(it => {
    const name = String((it && it.name) || '').trim().slice(0, 40);
    const grams = Math.round(numOr(it.grams, 0));
    const kcal = Math.round(numOr(it.kcal, 0));
    if (!name || !(grams > 0) || grams > 3000 || kcal > 5000) return null;
    const e = it.exchanges || {};
    const raw = { grain: e.grain, prot: e.protein, veg: e.vegetable, fruit: e.fruit, dairy: e.dairy, oil: e.oil };
    const ex = {};
    EX_KEYS.forEach(k => { const v = numOr(raw[k], 0); if (v > 0 && v < 30) ex[k] = r1(v); });
    const m = (v) => { const n = numOr(v); return n == null ? null : r1(n); };
    return { name, grams, kcal, p: m(it.protein), c: m(it.carbs), f: m(it.fat), ex: Object.keys(ex).length ? ex : null };
  }).filter(Boolean);
  return { items: items.slice(0, 15), note: String((obj && obj.note) || '').trim().slice(0, 200) };
}

// AI 的品項 → 「食物」形狀（每 100 g），可以直接用查食物的克數換算、改克數
// 每 100 g 的值不四捨五入：換回原本的克數時要剛好等於 AI 給的數字
export function aiItemToFood(item, source) {
  const k = 100 / item.grams;
  const per = (v) => (v == null ? null : v * k);
  const exPer100g = item.ex ? Object.fromEntries(Object.entries(item.ex).map(([key, v]) => [key, v * k])) : null;
  return {
    id: null, name: item.name, ai: source,
    note: 'AI 估算',
    per100g: { kcal: item.kcal * k, p: per(item.p), c: per(item.c), f: per(item.f) },
    exPer100g
  };
}

// (B) → { name, servingG, servings, kcal, p, c, f, sugar, na } 或 null（找不到標示）
export function normalizeLabel(obj) {
  if (!obj || obj.found === false) return null;
  const kcal = numOr(obj.kcal);
  if (kcal == null || kcal > 5000) return null;
  const m = (v) => { const n = numOr(v); return n == null ? null : r1(n); };
  return {
    name: String(obj.name || '').trim().slice(0, 40),
    servingG: m(obj.serving_g), servings: m(obj.servings_per_package),
    kcal: Math.round(kcal), p: m(obj.protein), c: m(obj.carbs), f: m(obj.fat), sugar: m(obj.sugar),
    na: numOr(obj.sodium_mg) == null ? null : Math.round(obj.sodium_mg)
  };
}

// 測試 Key 用的最小請求
export const PING_REQUEST = {
  contents: [{ role: 'user', parts: [{ text: '回傳 {"ok": true}' }] }],
  generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } } } }
};

/* ---------------- 檢查 AI 能不能用（設定頁） ---------------- */

// 依序檢查：(1) 文字回答 (2) 讀照片（App 自己畫的一張營養標示，答案已知）。
// 每一步回傳 { name, ok, ms, model, kind, detail, note }，畫面照著列出來，使用者截圖就能查。
export const CHECK_KCAL = 123;
export async function runAiCheck({ key, labelImage, fetchFn = fetch, clock = () => Date.now(), timeoutMs = 60000 }) {
  const steps = [];
  const step = async (name, request, verify) => {
    const info = {};
    const t0 = clock();
    try {
      const out = await callGemini({ key, request, fetchFn, timeoutMs, info });
      const note = verify(out);
      steps.push({ name, ok: !note, ms: clock() - t0, model: info.model || '', kind: note ? 'wrong' : '', detail: '', note: note || '' });
    } catch (e) {
      steps.push({ name, ok: false, ms: clock() - t0, model: '', kind: e.kind || 'other', detail: e.detail || String(e.message || ''), note: '' });
    }
    return steps[steps.length - 1].ok;
  };
  const textOk = await step('文字', PING_REQUEST, (o) => (o && o.ok === true ? '' : 'AI 回答的內容不對：' + JSON.stringify(o).slice(0, 60)));
  // 文字都不行（Key、網路、額度），照片一定也不行，不必再等
  if (textOk && labelImage) {
    await step('照片', buildRequest({ prompt: LABEL_PROMPT, imageDataUrl: labelImage, schema: LABEL_SCHEMA }), (o) => {
      const lb = normalizeLabel(o);
      if (!lb) return 'AI 看不到測試圖上的營養標示';
      return lb.kcal === CHECK_KCAL ? '' : 'AI 讀到 ' + lb.kcal + ' 大卡（應該是 ' + CHECK_KCAL + '）';
    });
  }
  return steps;
}

// 檢查結果 → 給使用者看／複製傳給開發者的文字
export function checkReport(steps) {
  return steps.map(s => (s.ok ? '✓ ' : '✗ ') + s.name + '：' + (s.ok ? '正常' : '失敗') + '（' + (s.ms / 1000).toFixed(1) + ' 秒' +
    (s.model ? '，' + s.model : '') + '）' + (s.note ? '\n  ' + s.note : '') + (s.kind && s.kind !== 'wrong' ? '\n  代碼：' + [s.kind, s.detail].filter(Boolean).join(' ') : '')).join('\n');
}
