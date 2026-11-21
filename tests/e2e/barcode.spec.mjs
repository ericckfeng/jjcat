// 掃商品條碼：我的食物 → 食物資料庫 → Open Food Facts → 查不到就照包裝填（存成我的食物並記下條碼）
import { test, expect } from '@playwright/test';
import { openApp, appState } from './helpers.mjs';

const NUTELLA = { status: 1, product: { product_name: 'Nutella', brands: 'Ferrero', nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, fat_100g: 30.9, carbohydrates_100g: 57.5, sodium_100g: 0.0428 } } };
// 1×1 PNG（給假的 BarcodeDetector 用）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function mockOff(page) {
  const asked = [];
  await page.route('https://world.openfoodfacts.org/**', r => {
    const url = r.request().url();
    asked.push(url);
    if (url.includes('/3017620422003.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NUTELLA) });
    return r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ status: 0, status_verbose: 'product not found' }) });
  });
  return asked;
}
async function openScan(page) {
  await page.click('[data-food-open=all]');
  await page.click('#scanOpenBtn');
  await expect(page.locator('#scr-scan')).toBeVisible();
}
const todayOf = (page) => page.evaluate(() => window.__dietApp.ui.date);

test('查不到 → 照包裝填存成我的食物（帶條碼）→ 直接填吃了多少；下次掃同一個條碼直接找到，不再上網查', async ({ page }) => {
  const errors = [];
  await openApp(page, { errors });
  const asked = await mockOff(page);
  await openScan(page);
  await page.fill('#scanInput', '4710088412393');
  await page.click('#scanLookupBtn');
  await expect(page.locator('#scanResult')).toContainText('查不到這個條碼');
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain('/product/4710088412393.json');
  await expect(page.locator('[data-scan-ai]')).toHaveCount(0);   // 沒開 AI 不出現
  await page.click('[data-scan-fill]');
  await expect(page.locator('#scr-myfood')).toBeVisible();
  await expect(page.locator('#mf-barcode')).toHaveValue('4710088412393');
  await expect(page.locator('#mf-more')).toHaveAttribute('open', '');
  await page.fill('#mf-name', '義美無糖豆漿');
  await page.fill('#mf-servingG', '250');
  await page.fill('#mf-kcal', '100');
  await page.click('#mf-save');
  await expect(page.locator('#scr-grams')).toBeVisible();
  await expect(page.locator('#gramsInput')).toHaveValue('250');
  await page.click('#gramsSaveBtn');
  await page.click('#foodCartSaveBtn');
  const st = await appState(page);
  expect(st.customFoods[0]).toMatchObject({ name: '義美無糖豆漿', barcode: '4710088412393' });
  expect(st.customFoods[0].source).toBeUndefined();
  expect(st.logs[await todayOf(page)][0]).toMatchObject({ kcal: 100, customFoodId: st.customFoods[0].id });

  await openScan(page);
  await page.fill('#scanInput', '4710088412393');
  await page.click('#scanLookupBtn');
  await expect(page.locator('#scr-grams')).toBeVisible();
  await expect(page.locator('#gramsFoodName')).toHaveText('義美無糖豆漿');
  expect(asked).toHaveLength(1);
  // 存好回到查食物頁（不是掃條碼頁）
  await page.click('#gramsSaveBtn');
  await expect(page.locator('#scr-food')).toBeVisible();
  await expect(page.locator('#scr-scan')).toBeHidden();
  // Open Food Facts 查不到時回 404，瀏覽器會在主控台記一行，不是 App 的錯
  expect(errors.filter(e => !/status of 404/.test(e))).toEqual([]);
});

test('Open Food Facts 查得到：先給看數字，存成我的食物時帶來源；號碼打錯會說明', async ({ page }) => {
  await openApp(page);
  await mockOff(page);
  await openScan(page);
  await page.fill('#scanInput', '3017620422004');
  await page.click('#scanLookupBtn');
  await expect(page.locator('#scanResult')).toContainText('好像少了或打錯一個數字');
  await page.fill('#scanInput', '3017620422003');
  await page.press('#scanInput', 'Enter');
  await expect(page.locator('#scanResult')).toContainText('Ferrero Nutella');
  await expect(page.locator('#scanResult')).toContainText('一份 100 g：539 kcal');
  await page.click('[data-scan-fill]');
  await expect(page.locator('#mf-kcal')).toHaveValue('539');
  await expect(page.locator('#mf-na')).toHaveValue('43');
  await expect(page.locator('#mf-note')).toContainText('Open Food Facts');
  await page.fill('#mf-servingG', '15');   // 改成一份 15 g（一湯匙）
  await page.fill('#mf-kcal', '81');
  await page.click('#mf-save');
  await expect(page.locator('#scr-grams')).toBeVisible();
  const f = (await appState(page)).customFoods[0];
  expect(f).toMatchObject({ name: 'Ferrero Nutella', barcode: '3017620422003', source: 'off', serving: { g: 15 } });
});

test('拍條碼：照片辨識出號碼就查；認不出來說明怎麼拍', async ({ page }) => {
  await page.addInitScript(() => {
    window.__fakeCode = '3017620422003';
    window.BarcodeDetector = class { async detect() { return window.__fakeCode ? [{ rawValue: window.__fakeCode }] : []; } };
  });
  await openApp(page);
  await mockOff(page);
  await openScan(page);
  await page.setInputFiles('#scanFile', { name: 'code.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('#scanResult')).toContainText('Ferrero Nutella');
  await expect(page.locator('#scanInput')).toHaveValue('3017620422003');
  // 認不出來：BarcodeDetector 沒結果 → 改用 ZXing；測試環境離線載入失敗 → 請輸入號碼
  await page.route('https://cdn.jsdelivr.net/**', r => r.abort());
  await page.evaluate(() => { window.__fakeCode = ''; });
  await page.setInputFiles('#scanFile', { name: 'blur.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('#scanResult')).toContainText('請直接輸入條碼下面的數字');
});

test('食物資料庫裡有條碼的也找得到；我的食物的條碼可以手動改、重複會說明；開了 AI 可以拍標示', async ({ page }) => {
  await openApp(page);
  await mockOff(page);
  await page.evaluate(() => {
    const s = window.__dietApp.state;
    s.foodPacks = [{ id: 'pk_1', name: '超商', foods: [{ id: 'pf_1', name: '茶葉蛋', base: '茶葉蛋', brand: '7-ELEVEN', barcode: '96385074', perServing: { kcal: 75 } }], updatedAt: 1 }];
    s.customFoods = [{ id: 'cf_1', name: '堅果包', barcode: '4710000000004', serving: { g: 35 }, per100g: { kcal: 285 }, updatedAt: 1 },
      { id: 'cf_2', name: '豆干', serving: { g: 40 }, per100g: { kcal: 190 }, updatedAt: 1 }];
    s.meta.ai = { key: 'AIzaTEST' };
  });
  await openScan(page);
  await page.fill('#scanInput', '96385074');
  await page.click('#scanLookupBtn');
  await expect(page.locator('#gramsFoodName')).toHaveText('7-ELEVEN 茶葉蛋');
  await expect(page.locator('#gramsFoodNote')).toContainText('資料來源：超商');
  await page.goBack();
  await page.click('#scanOpenBtn');
  await page.fill('#scanInput', '4710088412393');
  await page.click('#scanLookupBtn');
  await page.click('[data-scan-ai]');
  await expect(page.locator('#scr-manual')).toBeVisible();
  await expect(page.locator('#add-lb-note')).toContainText('條碼 4710088412393');
  await expect(page.locator('#saveMineCheck')).toBeChecked();

  // 我的食物頁：豆干改成堅果包的條碼 → 說明重複
  await page.goBack(); await page.goBack();
  await page.click('.mobile-nav-tab[data-tab=library]');
  await page.fill('#myFoodSearch', '豆干');   // 重畫清單（狀態是測試直接放進去的）
  await page.click('[data-mf-edit=cf_2]');
  await page.click('#mf-more summary');   // 條碼在「更多」裡
  await page.fill('#mf-barcode', '4710000000004');
  await page.click('#mf-save');
  await expect(page.locator('#mf-note')).toContainText('「堅果包」已經用這個條碼了');
  await page.fill('#mf-barcode', '123');
  await page.click('#mf-save');
  await expect(page.locator('#mf-note')).toContainText('8～14 位數字');
  await page.fill('#mf-barcode', '4710 0000 00011');
  await page.click('#mf-save');
  await expect(page.locator('#scr-myfood')).toBeHidden();
  expect((await appState(page)).customFoods.find(f => f.id === 'cf_2').barcode).toBe('4710000000011');
});
