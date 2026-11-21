// AI 辨識：Gemini API 用假的回應（不連真的網路、不用真的 Key）
import { test, expect } from '@playwright/test';
import { openApp, appState, closeScreens, openSettings } from './helpers.mjs';

// 2×2 的 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAAMBgEB1JqCEwAAAABJRU5ErkJggg==', 'base64');
const photo = { name: 'meal.png', mimeType: 'image/png', buffer: PNG };
const KEY = 'AIzaTEST-KEY-123';

const reply = (obj) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
const MEAL = { items: [
  { name: '白飯', grams: 200, kcal: 364, protein: 6.2, carbs: 80.1, fat: 0.6, exchanges: { grain: 4 } },
  { name: '滷雞腿', grams: 150, kcal: 330, protein: 30, carbs: 2, fat: 22, exchanges: { protein: 3.5, oil: 1 } },
  { name: '炒高麗菜', grams: 100, kcal: 60, protein: 1.3, carbs: 5, fat: 4, exchanges: { vegetable: 1, oil: 0.8 } }
], note: '' };

async function mockGemini(page, handler) {
  const calls = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() || '{}');
    calls.push({ url: req.url(), headers: req.headers(), body });
    await route.fulfill(handler(body, calls.length));
  });
  return calls;
}
async function enableAi(page) {
  await openSettings(page, '#aiSetupBtn');
  await page.fill('#aiKeyInput', KEY);
  await page.click('#aiKeySaveBtn');
  await expect(page.locator('#aiKeyStatus')).toContainText('成功');
  await closeScreens(page);
}

test('預設關閉：首頁沒有 AI，拍營養標示只存照片、不會連到 Gemini', async ({ page }) => {
  const calls = await mockGemini(page, () => reply({}));
  await openApp(page);
  await expect(page.locator('#aiTile')).toBeHidden();
  await page.click('[data-screen=scr-manual]');
  await page.click('#add-lb summary');
  await expect(page.locator('[data-lb-photo=add]')).not.toContainText('AI');
  await page.setInputFiles('#add-lb-file', photo);
  await expect(page.locator('#add-photos .ph')).toHaveCount(1);
  expect(calls).toHaveLength(0);
});

test('設定：Key 不對會說明；對的 Key 開啟，只存在本機，不進備份／同步檔；可以關閉刪除', async ({ page }) => {
  const calls = await mockGemini(page, (body, n) => n === 1
    ? { status: 400, contentType: 'application/json', body: JSON.stringify([{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }]) }
    : reply({ ok: true }));
  await openApp(page);
  await openSettings(page, '#aiSetupBtn');
  await page.fill('#aiKeyInput', 'wrong');
  await page.click('#aiKeySaveBtn');
  await expect(page.locator('#aiKeyStatus')).toContainText('這把 Key 不能用');
  await page.fill('#aiKeyInput', KEY);
  await page.click('#aiKeySaveBtn');
  await expect(page.locator('#aiKeyStatus')).toContainText('成功');
  expect(calls[1].headers['x-goog-api-key']).toBe(KEY);
  expect(calls[1].url).toMatch(/gemini-flash-latest:generateContent$/);
  // Key 在本機 meta，不在要同步／備份的資料裡
  expect((await appState(page)).meta.ai.key).toBe(KEY);
  const payload = await page.evaluate(() => JSON.stringify(window.__dietApp.exportPayload()));
  expect(payload).not.toContain(KEY);
  expect(payload).not.toContain('"meta"');
  await closeScreens(page);
  await expect(page.locator('#aiTile')).toBeVisible();
  // 關閉
  await openSettings(page, '#aiSetupBtn');
  await page.click('#aiOffBtn');
  expect((await appState(page)).meta.ai).toBeUndefined();
  await closeScreens(page);
  await expect(page.locator('#aiTile')).toBeHidden();
});

test('拍一餐：AI 拆成品項，取消一樣，加入購物車改克數，記到午餐（照片跟著第一樣）', async ({ page }) => {
  const errors = [];
  const calls = await mockGemini(page, (body) => body.contents[0].parts[0].text.includes('{"ok": true}') ? reply({ ok: true }) : reply(MEAL));
  await openApp(page, { errors });
  const today = await page.evaluate(() => window.__dietApp.ui.date);
  await enableAi(page);
  await page.click('#aiTile');
  await page.click('#scr-ai [data-meal=lunch]');
  await page.setInputFiles('#aiPhotoInput', photo);
  await expect(page.locator('#aiPhotoWrap')).toBeVisible();
  await page.click('#aiGoBtn');
  await expect(page.locator('#aiResults .pick-row')).toHaveCount(3);
  const req = calls[calls.length - 1].body;
  expect(req.contents[0].parts[1].inline_data.mime_type).toBe('image/jpeg');
  expect(req.generationConfig.responseMimeType).toBe('application/json');
  await expect(page.locator('#aiAddBtn')).toHaveText('加入這一餐（3 樣）');
  await page.locator('[data-ai-item="2"]').uncheck();
  await expect(page.locator('#aiAddBtn')).toHaveText('加入這一餐（2 樣）');
  await page.click('#aiAddBtn');
  await expect(page.locator('#scr-food')).toBeVisible();
  await expect(page.locator('#scr-ai')).toBeHidden();
  await expect(page.locator('#foodCart li')).toHaveCount(2);
  await expect(page.locator('#foodCartSaveBtn')).toHaveText('記到午餐（2 樣）');
  // 白飯改成 150 g：營養素和六大類等比例
  await page.locator('#foodCart li', { hasText: '白飯' }).locator('[data-cart-edit]').click();
  await page.fill('#gramsInput', '150');
  await expect(page.locator('#gramsResult')).toContainText('273');
  await page.click('#gramsSaveBtn');
  await page.click('#foodCartSaveBtn');
  await expect(page.locator('#scr-food')).toBeHidden();
  const list = (await appState(page)).logs[today];
  expect(list).toHaveLength(2);
  const rice = list.find(x => x.name.startsWith('白飯'));
  expect(rice).toMatchObject({ name: '白飯 150g', kcal: 273, grams: 150, ai: 'photo', meal: 'lunch', ex: { grain: 3 } });
  expect(rice.foodId).toBeUndefined();
  const chicken = list.find(x => x.name.startsWith('滷雞腿'));
  expect(chicken).toMatchObject({ kcal: 330, ex: { prot: 3.5, oil: 1 } });
  expect(list.filter(x => x.hasPhoto)).toHaveLength(1);
  expect(list[0].groupId).toBe(list[1].groupId);
  expect(errors).toEqual([]);
});

test('用打字：沒有照片也可以；額度用完時說明', async ({ page }) => {
  let quota = false;
  const calls = await mockGemini(page, (body) => {
    if (body.contents[0].parts[0].text.includes('{"ok": true}')) return reply({ ok: true });
    return quota ? { status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }) } : reply({ items: [MEAL.items[0]], note: '' });
  });
  await openApp(page);
  await enableAi(page);
  await page.click('#aiTile');
  await page.click('#aiGoBtn');
  await expect(page.locator('#aiStatus')).toContainText('請先拍照');
  await page.fill('#aiText', '一碗白飯');
  await page.click('#aiGoBtn');
  await expect(page.locator('#aiResults .pick-row')).toHaveCount(1);
  const last = calls[calls.length - 1].body.contents[0].parts;
  expect(last).toHaveLength(1);
  expect(last[0].text).toContain('使用者的描述：一碗白飯');
  quota = true;
  await page.fill('#aiText', '一碗白飯和一顆蛋');
  await expect(page.locator('#aiResults .pick-row')).toHaveCount(0); // 改了描述，舊結果清掉
  await page.click('#aiGoBtn');
  await expect(page.locator('#aiStatus')).toContainText('今天的免費次數可能用完了');
  // 不要白打：一鍵帶到「拍照記」存成待查
  await page.click('#aiFallbackBtn');
  await expect(page.locator('#scr-photo')).toBeVisible();
  await expect(page.locator('#scr-ai')).toBeHidden();
  await expect(page.locator('#photoQuickName')).toHaveValue('一碗白飯和一顆蛋');
});

test('拍營養標示：填進自己輸入的名稱、熱量、營養素', async ({ page }) => {
  await mockGemini(page, (body) => body.contents[0].parts[0].text.includes('{"ok": true}')
    ? reply({ ok: true })
    : reply({ found: true, name: '高纖蘇打餅', serving_g: 30, servings_per_package: 6, kcal: 132, protein: 2.7, fat: 4.8, carbs: 19.6, sugar: 1.2, sodium_mg: 150 }));
  await openApp(page);
  const today = await page.evaluate(() => window.__dietApp.ui.date);
  await enableAi(page);
  await page.click('[data-screen=scr-manual]');
  await page.click('#add-lb summary');
  await expect(page.locator('[data-lb-photo=add]')).toContainText('AI 幫我填');
  await page.setInputFiles('#add-lb-file', photo);
  await expect(page.locator('#add-lb-note')).toContainText('每份 30 公克、這包有 6 份');
  await expect(page.locator('#add-lb-g')).toHaveValue('30');
  await expect(page.locator('#add-lb-eat')).toHaveValue('30');
  await expect(page.locator('#foodNameInput')).toHaveValue('高纖蘇打餅');
  await expect(page.locator('#foodKcalInput')).toHaveValue('132');
  await expect(page.locator('#add-p')).toHaveValue('2.7');
  await expect(page.locator('#saveMineCheck')).toBeChecked();   // 拍了標示的，預設也存到我的食物
  await page.click('[data-portion="2"]');
  await page.click('[form=addFoodForm][type=submit]');
  await expect(page.locator('#scr-manual')).toBeHidden();   // 存照片要一點時間，關掉才算存好
  const it = (await appState(page)).logs[today].find(x => x.name === '高纖蘇打餅');
  expect(it).toMatchObject({ kcal: 264, p: 5.4, c: 39.2, f: 9.6, hasPhoto: true, grams: 60, label: { g: 30, kcal: 132, p: 2.7, c: 19.6, f: 4.8 } });
  const mine = (await appState(page)).customFoods.find(f => f.name === '高纖蘇打餅');
  expect(mine).toMatchObject({ source: 'ai-label', serving: { g: 30 }, per100g: { kcal: 440, p: 9, f: 16, c: 65.33 } });
  await expect(page.locator('#toast')).toContainText('也存到我的食物了');
});

test('拍營養標示：只有千焦耳的，換成大卡', async ({ page }) => {
  await mockGemini(page, () => reply({ found: true, name: '進口餅乾', serving_g: 100, kj: 1650, protein: 8, fat: 15, carbs: 60 }));
  await openApp(page);
  await enableAi(page);
  await page.click('[data-screen=scr-manual]');
  await page.click('#add-lb summary');
  await page.setInputFiles('#add-lb-file', photo);
  await expect(page.locator('#add-lb-note')).toContainText('1650 千焦耳');
  await expect(page.locator('#foodKcalInput')).toHaveValue('394');
});

test('設定：檢查 AI 能不能用（文字＋照片），失敗時列出代碼，可以複製結果', async ({ page }) => {
  let busy = false;
  const calls = await mockGemini(page, (body) => {
    if (busy) return { status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded.' } }) };
    const hasImage = body.contents[0].parts.some(p => p.inline_data);
    return reply(hasImage ? { found: true, serving_g: 30, kcal: 123, protein: 3, fat: 4.5, carbs: 18 } : { ok: true });
  });
  await openApp(page);
  await enableAi(page);
  await openSettings(page, '#aiSetupBtn');
  const n0 = calls.length;
  await page.click('#aiCheckBtn');
  await expect(page.locator('#aiCheckResult')).toContainText('AI 可以正常使用');
  await expect(page.locator('#aiCheckResult')).toContainText('✓ 照片：正常');
  await expect(page.locator('#aiCheckResult')).toContainText('gemini-flash-latest');
  expect(calls.length - n0).toBe(2);
  expect(calls[calls.length - 1].body.contents[0].parts[1].inline_data.mime_type).toBe('image/jpeg');
  await expect(page.locator('#aiCheckCopy')).toBeVisible();
  // 兩個模型都太忙
  busy = true;
  await page.click('#aiCheckBtn');
  await expect(page.locator('#aiCheckResult')).toContainText('AI 目前不能正常使用');
  await expect(page.locator('#aiCheckResult')).toContainText('太多人用');
  await expect(page.locator('#aiCheckResult')).toContainText('代碼：busy gemini-3.5-flash-lite 503 UNAVAILABLE');
});

test('AI 太忙或次數用完：拍的照片一起帶到「拍照記」，存成待查', async ({ page }) => {
  await mockGemini(page, (body) => {
    if (body.contents[0].parts[0].text.includes('{"ok": true}')) return reply({ ok: true });
    return { status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }) };
  });
  await openApp(page);
  await enableAi(page);
  await page.click('#aiTile');
  await expect(page.locator('#aiFallbackBtn')).toBeHidden();
  await page.setInputFiles('#aiPhotoInput', photo);
  await page.click('#aiGoBtn');
  await page.click('#aiFallbackBtn');
  await expect(page.locator('#scr-photo')).toBeVisible();
  await expect(page.locator('#pq-photos img')).toHaveCount(1);
  await page.click('#photoQuickSave');
  const date = await page.evaluate(() => window.__dietApp.ui.date);
  await expect.poll(async () => ((await appState(page)).logs[date] || []).length).toBe(1);
  expect((await appState(page)).logs[date][0]).toMatchObject({ pending: true, hasPhoto: true });
  // 下次打開 AI 頁，按鈕收起來
  await page.click('#aiTile');
  await expect(page.locator('#aiFallbackBtn')).toBeHidden();
});

/* ---------------- 用自己的 AI App（不用 Key） ---------------- */
// 假的分享選單：記下傳了什麼，馬上成功
async function fakeShare(page, { canShareFiles = true } = {}) {
  await page.addInitScript((can) => {
    window.__shared = [];
    navigator.share = async (d) => { window.__shared.push({ text: d.text, files: (d.files || []).map(f => f.name + ':' + f.type) }); };
    navigator.canShare = (d) => can || !(d && d.files);
  }, canShareFiles);
}
async function enablePaste(page) {
  await openSettings(page, '#aiSetupBtn');
  await page.click('#aiPasteToggle');
  await closeScreens(page);
}
const MEAL_ANSWER = '以下是結果：\n```csv\n名稱,克數,熱量(kcal),蛋白質(g),碳水(g),脂肪(g),全穀雜糧(份),豆魚蛋肉(份),蔬菜(份),水果(份),乳品(份),油脂與堅果種子(份)\n白飯,200,280,5,62,0.5,4,0,0,0,0,0\n滷排骨,120,330,22,8,23,0,3,0,0,0,2\n```';

test('沒有 Key：設定開「用自己的 AI App」→ 拍一餐 → 分享給 AI App（照片＋說明）→ 貼回答 → 拆成一樣一樣記下來', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fakeShare(page);
  const calls = await mockGemini(page, () => ({ status: 500, body: '' }));
  await openApp(page);
  await expect(page.locator('#aiTile')).toBeHidden();
  await openSettings(page, '#aiSetupBtn');
  await page.click('#aiPasteToggle');
  await expect(page.locator('#aiPasteState')).toContainText('已開啟');
  await closeScreens(page);
  await page.click('#aiTile');
  await expect(page.locator('#aiGoBtn')).toHaveText('📤 傳給我的 AI App');
  await expect(page.locator('#aiPrivacyNote')).toContainText('由你自己傳給你選的 AI App');
  await page.setInputFiles('#aiPhotoInput', photo);
  await page.click('#aiGoBtn');
  await expect(page.locator('#aiPasteWrap')).toBeVisible();
  const shared = await page.evaluate(() => window.__shared);
  expect(shared).toHaveLength(1);
  expect(shared[0].files[0]).toMatch(/^照片\.jpg:image\//);
  expect(shared[0].text).toContain('名稱,克數,熱量(kcal)');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('名稱,克數,熱量(kcal)');
  await expect(page.locator('#aiPhotoSaveBtn')).toBeHidden();
  await page.fill('#aiPasteText', '我沒辦法看');
  await page.click('#aiPasteReadBtn');
  await expect(page.locator('#aiStatus')).toContainText('讀不到 AI 的回答');
  await page.fill('#aiPasteText', MEAL_ANSWER);
  await page.click('#aiPasteReadBtn');
  await expect(page.locator('#aiResults .pick-row')).toHaveCount(2);
  await page.click('#aiAddBtn');
  await page.click('#foodCartSaveBtn');
  const day = (await appState(page)).logs[await page.evaluate(() => window.__dietApp.ui.date)];
  expect(day.map(e => [e.name, e.kcal, e.ai])).toEqual([['白飯 200g', 280, 'photo'], ['滷排骨 120g', 330, 'photo']]);
  expect(calls).toHaveLength(0);   // 沒有 Key：App 不會自己連 Gemini
  expect((await appState(page)).meta.aiPaste).toBe(true);
});

test('不能分享的裝置（電腦）：說明複製好，提示自己打開 AI 網站，可以下載照片', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fakeShare(page, { canShareFiles: false });
  await openApp(page);
  await enablePaste(page);
  await page.click('#aiTile');
  await page.setInputFiles('#aiPhotoInput', photo);
  await page.click('#aiGoBtn');
  await expect(page.locator('#aiPasteHint')).toContainText('說明已經複製好了');
  await expect(page.locator('#aiPhotoSaveBtn')).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#aiPhotoSaveBtn')]);
  expect(dl.suggestedFilename()).toMatch(/^照片_.*\.jpg$/);
});

test('拍營養標示：傳給自己的 AI App → 貼回答 → 填好標示和熱量', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fakeShare(page);
  await openApp(page);
  await enablePaste(page);
  await page.click('[data-screen=scr-manual]');
  await page.click('#add-lb summary');
  await expect(page.locator('[data-lb-photo=add]')).toContainText('可以傳給你的 AI App 讀');
  await page.setInputFiles('#add-lb-file', photo);
  await expect(page.locator('#add-lb-paste')).toBeVisible();
  await page.click('[data-lb-share=add]');
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  expect((await page.evaluate(() => window.__shared[0].text))).toContain('名稱,每份克數,本包裝份數');
  await page.fill('#add-lb-pastetext', '```csv\n名稱,每份克數,本包裝份數,熱量(kcal),千焦耳(kJ),蛋白質(g),脂肪(g),碳水(g),糖(g),鈉(mg)\n燕麥片,30,10,115,,3.5,2,20,1,45\n```');
  await page.click('[data-lb-pasteread=add]');
  await expect(page.locator('#add-lb-g')).toHaveValue('30');
  await expect(page.locator('#foodKcalInput')).toHaveValue('115');
  await expect(page.locator('#foodNameInput')).toHaveValue('燕麥片');
  await expect(page.locator('#add-lb-paste')).toBeHidden();
});

test('有 Key 但次數用完：可以改用自己的 AI App', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fakeShare(page);
  await mockGemini(page, (body) => body.contents[0].parts[0].text.includes('{"ok": true}') ? reply({ ok: true })
    : { status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }) });
  await openApp(page);
  await enableAi(page);
  await page.click('#aiTile');
  await expect(page.locator('#aiGoBtn')).toHaveText('請 AI 幫我認');
  await page.fill('#aiText', '一碗白飯、一塊滷排骨');
  await page.click('#aiGoBtn');
  await page.click('#aiPasteFallbackBtn');
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  expect(await page.evaluate(() => window.__shared[0].text)).toContain('我的描述：一碗白飯、一塊滷排骨');
  await page.fill('#aiPasteText', MEAL_ANSWER);
  await page.click('#aiPasteReadBtn');
  await expect(page.locator('#aiResults .pick-row')).toHaveCount(2);
});
