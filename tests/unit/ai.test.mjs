// AI 辨識：請求、錯誤分類、回傳整理（js/ai.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, classifyError, responseText, parseJsonText, callGemini, normalizeMeal, aiItemToFood, normalizeLabel, MEAL_SCHEMA, AI_MODELS } from '../../js/ai.js';
import { nutrientsFor } from '../../js/foods.js';

test('請求：文字＋照片（data URL 拆成 mime 和 base64），要求 JSON 回傳', () => {
  const r = buildRequest({ prompt: 'hi', imageDataUrl: 'data:image/jpeg;base64,QUJD', schema: MEAL_SCHEMA });
  assert.deepEqual(r.contents[0].parts, [{ text: 'hi' }, { inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } }]);
  assert.equal(r.generationConfig.responseMimeType, 'application/json');
  assert.equal(r.generationConfig.responseSchema, MEAL_SCHEMA);
  assert.equal(buildRequest({ prompt: 'x', schema: {} }).contents[0].parts.length, 1);
});

test('錯誤分類', () => {
  assert.equal(classifyError(400, [{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } }]), 'key');
  assert.equal(classifyError(429, { error: { status: 'RESOURCE_EXHAUSTED' } }), 'quota');
  assert.equal(classifyError(403, { error: { message: 'Requests from referer http://localhost are blocked.', details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } }), 'referrer');
  assert.equal(classifyError(403, { error: { message: 'denied' } }), 'forbidden');
  assert.equal(classifyError(404, null), 'model');
  assert.equal(classifyError(503, null), 'server');
});

test('取出回應文字：generateContent 與 interactions 兩種形狀', () => {
  assert.equal(responseText({ candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }] }), '{"a":1}');
  assert.equal(responseText({ steps: [{ type: 'user_input' }, { type: 'model_output', content: [{ type: 'text', text: '{"b":2}' }] }] }), '{"b":2}');
  assert.deepEqual(parseJsonText('```json\n{"c":3}\n```'), { c: 3 });
  assert.throws(() => parseJsonText('不是 JSON'), (e) => e.kind === 'parse');
});

const okRes = (obj) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
const errRes = (status, body) => ({ ok: false, status, json: async () => body });

test('呼叫：帶 Key 標頭、成功回傳 JSON；模型找不到才換下一個', async () => {
  const calls = [];
  const fetchFn = async (url, opt) => { calls.push({ url, opt }); return calls.length === 1 ? errRes(404, {}) : okRes({ ok: true }); };
  const out = await callGemini({ key: 'K', request: { x: 1 }, fetchFn });
  assert.deepEqual(out, { ok: true });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, new RegExp(AI_MODELS[0] + ':generateContent$'));
  assert.match(calls[1].url, new RegExp(AI_MODELS[1] + ':generateContent$'));
  assert.equal(calls[0].opt.headers['x-goog-api-key'], 'K');
  assert.deepEqual(Object.keys(calls[0].opt.headers).sort(), ['Content-Type', 'x-goog-api-key'], '只用 CORS 允許的標頭');
});

test('呼叫：Key 錯、額度用完、連不上網路、沒有 Key', async () => {
  await assert.rejects(callGemini({ key: 'K', request: {}, fetchFn: async () => errRes(400, { error: { message: 'API key not valid.' } }) }), (e) => e.kind === 'key');
  await assert.rejects(callGemini({ key: 'K', request: {}, fetchFn: async () => errRes(429, {}) }), (e) => e.kind === 'quota');
  await assert.rejects(callGemini({ key: 'K', request: {}, fetchFn: async () => { throw new TypeError('Failed to fetch'); } }), (e) => e.kind === 'network');
  await assert.rejects(callGemini({ key: '', request: {} }), (e) => e.kind === 'key');
});

test('整理餐點：欄位改成 App 的名稱，不合理的丟掉', () => {
  const m = normalizeMeal({ items: [
    { name: ' 白飯 ', grams: 200.4, kcal: 364, protein: 6.2, carbs: 80.1, fat: 0.6, exchanges: { grain: 4, protein: 0, vegetable: 0 } },
    { name: '滷雞腿', grams: 150, kcal: 330, protein: 30, carbs: 2, fat: 22, exchanges: { protein: 3.5, oil: 1 } },
    { name: '', grams: 50, kcal: 10 },
    { name: '空氣', grams: 0, kcal: 0 },
    { name: '奇怪', grams: 99999, kcal: 1 }
  ], note: '配菜看不太清楚' });
  assert.deepEqual(m.items, [
    { name: '白飯', grams: 200, kcal: 364, p: 6.2, c: 80.1, f: 0.6, ex: { grain: 4 } },
    { name: '滷雞腿', grams: 150, kcal: 330, p: 30, c: 2, f: 22, ex: { prot: 3.5, oil: 1 } }
  ]);
  assert.equal(m.note, '配菜看不太清楚');
  assert.deepEqual(normalizeMeal(null), { items: [], note: '' });
});

test('AI 品項變成「食物」：改克數時營養素和六大類等比例換算', () => {
  const food = aiItemToFood({ name: '白飯', grams: 200, kcal: 364, p: 6.2, c: 80.1, f: 0.6, ex: { grain: 4 } }, 'photo');
  assert.equal(food.ai, 'photo');
  assert.equal(food.id, null);
  const n = nutrientsFor(food, 200);
  assert.equal(n.kcal, 364);
  assert.deepEqual(n.ex, { grain: 4 });
  const half = nutrientsFor(food, 100);
  assert.equal(half.kcal, 182);
  assert.equal(half.c, 40.1);
  assert.deepEqual(half.ex, { grain: 2 });
  // 克數不是 100 的倍數時，原本的份量要剛好換回來（不能因為四捨五入變成 1.1 份）
  const chicken = aiItemToFood({ name: '滷雞腿', grams: 150, kcal: 330, p: 30, c: 2, f: 22, ex: { prot: 3.5, oil: 1 } }, 'text');
  const n2 = nutrientsFor(chicken, 150);
  assert.equal(n2.kcal, 330);
  assert.equal(n2.p, 30);
  assert.deepEqual(n2.ex, { prot: 3.5, oil: 1 });
});

test('整理營養標示', () => {
  assert.deepEqual(normalizeLabel({ found: true, name: '高纖蘇打餅', serving_g: 30, servings_per_package: 6, kcal: 132.4, protein: 2.7, fat: 4.8, carbs: 19.6, sugar: 1.2, sodium_mg: 150.6 }),
    { name: '高纖蘇打餅', servingG: 30, servings: 6, kcal: 132, p: 2.7, c: 19.6, f: 4.8, sugar: 1.2, na: 151 });
  assert.equal(normalizeLabel({ found: false }), null);
  assert.equal(normalizeLabel({ found: true }), null, '沒有熱量不算');
});
