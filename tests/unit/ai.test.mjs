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
  assert.equal(classifyError(503, null), 'busy');
  assert.equal(classifyError(500, null), 'server');
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
    { name: '高纖蘇打餅', servingG: 30, servings: 6, kcal: 132, kj: null, p: 2.7, c: 19.6, f: 4.8, sugar: 1.2, na: 151 });
  assert.equal(normalizeLabel({ found: false }), null);
  assert.equal(normalizeLabel({ found: true }), null, '沒有熱量不算');
});

test('營養標示只有千焦耳：程式換成大卡', () => {
  const a = normalizeLabel({ found: true, serving_g: 100, kj: 1650, protein: 8, fat: 15, carbs: 60 });
  assert.equal(a.kcal, 394, '1650 ÷ 4.184');
  assert.equal(a.kj, 1650);
  const b = normalizeLabel({ found: true, kj: 552, kcal: 552 });
  assert.equal(b.kcal, 132, 'AI 把千焦耳也填進大卡，用千焦耳換算');
  const c = normalizeLabel({ found: true, kj: 552, kcal: 132 });
  assert.equal(c.kcal, 132, '兩個都有就用標示上的大卡');
  assert.equal(normalizeLabel({ found: true, kj: 30000 }), null, '換算後太大不算');
});

test('呼叫：模型太忙（503）換下一個；都失敗時保留原始原因給使用者截圖', async () => {
  let n = 0;
  const out = await callGemini({ key: 'K', request: {}, fetchFn: async () => (++n === 1 ? errRes(503, { error: { status: 'UNAVAILABLE', message: 'The model is overloaded.' } }) : okRes({ ok: 1 })) });
  assert.deepEqual(out, { ok: 1 });
  await assert.rejects(callGemini({ key: 'K', request: {}, fetchFn: async () => errRes(503, { error: { status: 'UNAVAILABLE', message: 'The model is overloaded.' } }) }),
    (e) => e.kind === 'busy' && /503 UNAVAILABLE The model is overloaded/.test(e.detail));
  await assert.rejects(callGemini({ key: 'K', request: {}, fetchFn: async () => errRes(400, { error: { status: 'FAILED_PRECONDITION', message: 'User location is not supported' } }) }),
    (e) => e.kind === 'other' && /400 FAILED_PRECONDITION User location/.test(e.detail));
});

test('呼叫：成功但沒有內容（被擋、被截斷）', async () => {
  const res = (body) => async () => ({ ok: true, status: 200, json: async () => body });
  await assert.rejects(callGemini({ key: 'K', request: {}, fetchFn: res({ promptFeedback: { blockReason: 'SAFETY' } }) }), (e) => e.kind === 'empty' && /blocked SAFETY/.test(e.detail));
  await assert.rejects(callGemini({ key: 'K', request: {}, fetchFn: res({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"items":[' }] } }] }) }), (e) => e.kind === 'parse');
});

test('呼叫：等太久就放棄這個模型，不讓畫面卡住', async () => {
  const hang = async (url, opt) => new Promise((_, reject) => opt.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(callGemini({ key: 'K', request: {}, fetchFn: hang, timeoutMs: 20 }), (e) => e.kind === 'timeout');
});

test('檢查 AI：文字和照片都正常；文字失敗就不再試照片；讀錯數字也算失敗', async () => {
  const { runAiCheck, checkReport, CHECK_KCAL } = await import('../../js/ai.js');
  let t = 0;
  const clock = () => (t += 1500);
  const good = async (url, opt) => okRes(JSON.parse(opt.body).contents[0].parts.length > 1 ? { found: true, kcal: CHECK_KCAL } : { ok: true });
  const ok = await runAiCheck({ key: 'K', labelImage: 'data:image/jpeg;base64,QUJD', fetchFn: good, clock });
  assert.deepEqual(ok.map(s => [s.name, s.ok, s.model]), [['文字', true, AI_MODELS[0]], ['照片', true, AI_MODELS[0]]]);
  assert.match(checkReport(ok), /✓ 文字：正常（1\.5 秒，gemini-flash-latest）/);

  const calls = [];
  const bad = await runAiCheck({ key: 'K', labelImage: 'data:image/jpeg;base64,QUJD', clock, fetchFn: async (u) => { calls.push(u); return errRes(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }); } });
  assert.equal(bad.length, 1);
  assert.equal(calls.length, 1);
  assert.match(checkReport(bad), /✗ 文字：失敗[\s\S]*代碼：quota gemini-flash-latest 429 RESOURCE_EXHAUSTED Quota exceeded/);

  const wrong = await runAiCheck({ key: 'K', labelImage: 'data:image/jpeg;base64,QUJD', clock, fetchFn: async (url, opt) => okRes(JSON.parse(opt.body).contents[0].parts.length > 1 ? { found: true, kcal: 12 } : { ok: true }) });
  assert.equal(wrong[1].ok, false);
  assert.match(checkReport(wrong), /AI 讀到 12 大卡（應該是 123）/);
});

test('用自己的 AI App：提示詞要表格；貼回的回答（```csv、Markdown、一行一行）讀回成一樣的形狀', async () => {
  const { mealPastePrompt, mealFromPaste, labelFromPaste, LABEL_PASTE_PROMPT, MEAL_PASTE_HEAD } = await import('../../js/ai.js');
  assert.ok(mealPastePrompt('一碗白飯').includes(MEAL_PASTE_HEAD.join(',')));
  assert.match(mealPastePrompt('一碗白飯'), /我的描述：一碗白飯$/);
  const meal = mealFromPaste('好的，以下是辨識結果：\n```csv\n' + MEAL_PASTE_HEAD.join(',') + '\n白飯,200,280,5,62,0.5,4,0,0,0,0,0\n滷排骨,120,330,22,8,23,0,3,0,0,0,2\n```');
  assert.deepEqual(meal.items, [
    { name: '白飯', grams: 200, kcal: 280, p: 5, c: 62, f: 0.5, ex: { grain: 4 } },
    { name: '滷排骨', grams: 120, kcal: 330, p: 22, c: 8, f: 23, ex: { prot: 3, oil: 2 } }
  ]);
  const md = mealFromPaste('| 名稱 | 克數 | 熱量(kcal) |\n|---|---|---|\n| 茶葉蛋 | 55 | 75 kcal |');
  assert.deepEqual(md.items.map(i => [i.name, i.grams, i.kcal]), [['茶葉蛋', 55, 75]]);
  assert.deepEqual(mealFromPaste('沒有食物').items, []);

  assert.match(LABEL_PASTE_PROMPT, /名稱,每份克數,本包裝份數,熱量\(kcal\)/);
  assert.deepEqual(labelFromPaste('```csv\n名稱,每份克數,本包裝份數,熱量(kcal),千焦耳(kJ),蛋白質(g),脂肪(g),碳水(g),糖(g),鈉(mg)\n燕麥片,30,10,115,,3.5,2,20,1,45\n```'),
    { name: '燕麥片', servingG: 30, servings: 10, kcal: 115, kj: null, p: 3.5, c: 20, f: 2, sugar: 1, na: 45 });
  // 一行一行的寫法；只有千焦耳 → 換成大卡
  const lb = labelFromPaste('名稱：某餅乾\n每份克數：25 公克\n熱量：\n千焦耳：502\n蛋白質：1.5 公克');
  assert.equal(lb.kcal, 120);
  assert.equal(lb.servingG, 25);
  assert.equal(labelFromPaste('找不到營養標示'), null);
});
