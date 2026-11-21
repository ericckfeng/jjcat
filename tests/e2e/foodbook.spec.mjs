// AI 建檔小工具：照片 → AI（測試用假的 Gemini）→ 校對 → 資料庫檔；額度用完停下、重新打開接著做
import { test, expect } from '@playwright/test';
import { stubCdn } from './helpers.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const photo = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
const PAGE1 = {
  rotation: 90,
  items: [
    { name: '牛肉麵', weight_g: 600, serving_label: '1 碗', kcal: 540, protein: 30, fat: 18, carbs: 64, exchanges: { grain: 4.2, protein: 2.4, oil: 2 }, exchanges_from_chart: true, printed_kcal_per_g: 1.6, has_soup: true },
    { name: '滷肉飯', weight_g: 250, kcal: 450, protein: 12, fat: 15, carbs: 66, printed_kcal_per_g: 1.4 }
  ]
};
const PAGE2 = { rotation: 0, items: [{ name: '白飯', weight_g: 40, serving_label: '1/4 碗', kcal: 70, carbs: 15 }] };
const reply = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }] });

async function mockGemini(page, answers) {
  const prompts = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (r) => {
    const body = JSON.parse(r.request().postData());
    prompts.push(body.contents[0].parts[0].text);
    const a = answers.shift();
    if (a === 429) return r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply(a)) });
  });
  return prompts;
}
async function openTool(page) {
  await stubCdn(page);
  await page.route('https://cdnjs.cloudflare.com/**', r => r.abort());
  await page.goto('/tools/foodbook.html?gap=0');
}
const readDownload = async (dl) => Buffer.concat(await (await dl.createReadStream()).toArray()).toString();

test('照片 → AI 讀 → 依章節定份數 → 額度用完停下 → 繼續 → 校對 → 匯出；重新打開接著做', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openTool(page);
  const prompts = await mockGemini(page, [PAGE1, 429, PAGE2]);
  await page.fill('#aiKey', 'AIzaTEST');
  await page.setInputFiles('#photoInput', [photo('p1.png'), photo('p2.png')]);
  await expect(page.locator('#addNote')).toContainText('加入 2 頁');
  await page.fill('#catFrom', '2'); await page.fill('#catTo', '2');
  await page.selectOption('#catPick', 'grain');
  await page.click('#catApplyBtn');
  await expect(page.locator('[data-page-cat] >> nth=1')).toHaveValue('grain');

  await page.click('#runBtn');
  await expect(page.locator('#runNote')).toContainText('今天的免費次數用完了');
  await expect(page.locator('#pageRows')).toContainText('完成，2 樣');
  await expect(page.locator('#runBtn')).toHaveText('繼續 AI 辨識（還有 1 頁）');
  expect(prompts[0]).not.toContain('這一章');
  expect(prompts[1]).toContain('這一章每一樣的重量就是「全穀雜糧」1 份');

  await page.click('#runBtn');
  await expect(page.locator('#runNote')).toContainText('這次辨識了 1 頁');
  await expect(page.locator('#reviewSummary')).toContainText('共 3 樣，已校對 0 樣，有提醒 2 樣');

  // 校對：牛肉麵的提醒（有湯→只提示；長條圖→請校對），滷肉飯熱量÷重量對不上
  const noodle = page.locator('[data-item]', { has: page.locator('input[value="牛肉麵"]') });
  await expect(noodle.locator('[data-flags]')).toContainText('有湯汁，對不上是正常的');
  await expect(noodle.locator('[data-flags]')).toContainText('從長條圖估讀');
  await expect(noodle.locator('img')).toHaveAttribute('style', /rotate\(90deg\)/);
  await noodle.locator('[data-ex=grain]').fill('4');   // 改過份數 → 不再提醒長條圖
  await expect(noodle.locator('[data-flags]')).not.toContainText('從長條圖估讀');
  await noodle.locator('[data-check]').click();
  const rice = page.locator('[data-item]', { has: page.locator('input[value="滷肉飯"]') });
  await expect(rice.locator('[data-flags]')).toContainText('熱量÷重量＝1.8，書上印 1.4：有湯汁，或可能讀錯');
  await rice.locator('[data-f=kcal]').fill('350');
  await expect(rice.locator('[data-flags]')).not.toContainText('熱量÷重量');
  const white = page.locator('[data-item]', { has: page.locator('input[value="白飯"]') });
  await expect(white.locator('[data-ex=grain]')).toHaveValue('1');
  await page.click('[data-filter=todo]');
  await expect(page.locator('#itemList [data-item]')).toHaveCount(2);

  // 匯出：還有沒校對的要先勾「還是要匯出」
  await page.fill('#pkName', '外食圖鑑');
  await page.fill('#pkEdition', '2024');
  await expect(page.locator('#outWarn')).toContainText('還有 2 樣沒校對');
  await page.click('#dlJson');
  await expect(page.locator('#outNote')).toContainText('還有沒校對的');
  await page.check('#outForce');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlJson')]);
  expect(dl.suggestedFilename()).toBe('食物資料_外食圖鑑_2024.json');
  const file = JSON.parse(await readDownload(dl));
  expect(file).toMatchObject({ app: 'diet-tracker-foods', pack: { name: '外食圖鑑', edition: '2024', askBy: 'grams' } });
  expect(file.foods.map(f => f.name).sort()).toEqual(['滷肉飯', '牛肉麵', '白飯']);
  const n = file.foods.find(f => f.name === '牛肉麵');
  expect(n).toMatchObject({ serving: { g: 600, label: '1 碗' }, per100g: { kcal: 90 } });
  expect(n.exPer100g.grain).toBe(0.67);
  expect(file.foods.find(f => f.name === '白飯')).toMatchObject({ category: '全穀雜糧', exPer100g: { grain: 2.5 } });
  expect(file.foods.find(f => f.name === '滷肉飯').per100g.kcal).toBe(140);

  // 重新打開：接著做
  await page.waitForTimeout(500);   // 等進度存好
  await page.reload();
  await expect(page.locator('#resumeText')).toContainText('2 頁（辨識好 2 頁）、3 樣（校對好 1 樣），「外食圖鑑」');
  await page.click('#resumeBtn');
  await expect(page.locator('#reviewSummary')).toContainText('共 3 樣，已校對 1 樣');
  await expect(page.locator('#aiKey')).toHaveValue('AIzaTEST');
  await expect(page.locator('#pkName')).toHaveValue('外食圖鑑');
  // 刪掉一樣、重新開始
  await page.click('[data-filter=all]');
  await page.locator('[data-item] [data-remove] >> nth=0').click();
  await expect(page.locator('#reviewSummary')).toContainText('共 2 樣');
  await page.reload();
  await page.click('#resetBtn');
  await expect(page.locator('#resumeBox')).toBeHidden();   // 清完才收起來
  await page.reload();
  await expect(page.locator('#resumeBox')).toBeHidden();
  expect(errors).toEqual([]);
});

test('沒有 Key、Key 不對會說明；沒熱量的不能按校對好', async ({ page }) => {
  await openTool(page);
  await page.route('https://generativelanguage.googleapis.com/**', r => r.fulfill({ status: 400, contentType: 'application/json',
    body: JSON.stringify({ error: { code: 400, message: 'API key not valid', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }) }));
  await page.setInputFiles('#photoInput', [photo('p1.png')]);
  await page.click('#runBtn');
  await expect(page.locator('#runNote')).toContainText('請先在第 1 步貼上');
  await page.fill('#aiKey', 'bad');
  await page.click('#runBtn');
  await expect(page.locator('#runNote')).toContainText('API Key 不對');
  await expect(page.locator('#pageRows')).toContainText('失敗');

  await page.unroute('https://generativelanguage.googleapis.com/**');
  await mockGemini(page, [{ items: [{ name: '綠豆湯', serving_label: '1 碗' }] }]);
  await page.click('[data-page-redo]');
  await page.click('#runBtn');
  await expect(page.locator('#reviewSummary')).toContainText('共 1 樣');
  await expect(page.locator('[data-flags]')).toContainText('沒有熱量，不能匯出');
  await page.click('[data-check]');
  await expect(page.locator('[data-flags]')).toContainText('還沒有熱量，不能算校對好');
  await page.fill('[data-f=kcal]', '180');
  await page.click('[data-check]');
  await expect(page.locator('#reviewSummary')).toContainText('已校對 1 樣');
});

test('用自己的 AI：提示詞帶章節份數 → 貼回答 → 依頁碼對回照片；找不到照片的也收；接在後面', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openTool(page);
  await page.setInputFiles('#photoInput', [photo('p1.png'), photo('p2.png')]);
  await page.fill('#catFrom', '2'); await page.fill('#catTo', '2');
  await page.selectOption('#catPick', 'grain');
  await page.click('#catApplyBtn');
  await expect(page.locator('#pageRows')).toContainText('第 1 張照片・p1.png');
  await page.click('#copyPromptBtn');
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain('頁碼,名稱,份量說明,重量(g)');
  expect(prompt).toContain('第 2 頁每一樣的重量就是「全穀雜糧」1 份');
  const head = '頁碼,名稱,份量說明,重量(g),熱量(kcal),蛋白質(g),脂肪(g),醣類(g),糖(g),鈉(mg),膳食纖維(g),全穀雜糧(份),豆魚蛋肉(份),蔬菜(份),水果(份),乳品(份),油脂與堅果種子(份),書上熱量每公克,書上醣類每公克,有湯汁,份數從圖估讀,備註';
  await page.fill('#pasteText', '以下是結果\n```csv\n' + head + '\n1,牛肉麵,1 碗,600,540,30,18,64,,,,4.2,2.4,,,,2,1.6,,是,是,牛腱\n2,白飯,1/4 碗,40,70,,,15,,,,,,,,,,,,,,\n```');
  await page.click('#pasteLoadBtn');
  await expect(page.locator('#pasteNote')).toContainText('讀入 2 樣。往下對照照片校對');
  await expect(page.locator('#pageRows')).toContainText('完成，1 樣');
  await expect(page.locator('#reviewSummary')).toContainText('共 2 樣');
  const noodle = page.locator('[data-item]', { has: page.locator('input[value="牛肉麵"]') });
  await expect(noodle).toContainText('第 1 頁');
  await expect(noodle.locator('[data-flags]')).toContainText('從長條圖估讀');
  await expect(noodle.locator('[data-ex=prot]')).toHaveValue('2.5');
  const rice = page.locator('[data-item]', { has: page.locator('input[value="白飯"]') });
  await expect(rice.locator('[data-ex=grain]')).toHaveValue('1');
  // 說了「繼續」後的下一段沒有欄位名稱那一列（照提示詞的規則）；第 5 頁沒照片也收
  await page.fill('#pasteText', '```csv\n5,滷肉飯,,250,450,12,15,66,,,,,,,,,,1.4,,,,\n```');
  await page.click('#pasteAppendBtn');
  await expect(page.locator('#pasteNote')).toContainText('接上 1 樣。其中 1 樣找不到對應的照片');
  await expect(page.locator('#pageRows')).toContainText('第 5 頁（沒有照片）');
  await expect(page.locator('#reviewSummary')).toContainText('共 3 樣');
  // 讀入（換掉）同一頁：不會重複
  await page.fill('#pasteText', '```csv\n' + head + '\n1,牛肉麵,1 碗,600,550,30,18,64,,,,4,2.5,,,,2,,,是,,牛腱\n```');
  await page.click('#pasteLoadBtn');
  await expect(page.locator('#reviewSummary')).toContainText('共 3 樣');
  await expect(page.locator('input[value="牛肉麵"]')).toHaveCount(1);
  // 有 Key 時「繼續辨識」不會去辨識沒照片的那一頁
  await expect(page.locator('#runBtn')).toHaveText('✔ 全部辨識好了');
});
