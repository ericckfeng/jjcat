// 食物資料庫：整理工具（試算表 → 資料庫檔）→ App 匯入 → 查食物收成一列、選店選規格 → 記下來帶來源
import { test, expect } from '@playwright/test';
import { openApp, appState, closeScreens, stubCdn, openSettings } from './helpers.mjs';

const CSV = [
  '提供者(餐廳店家),餐點分類,品項名稱,份量規格,熱量(kcal),蛋白質(g),脂肪(g),飽和脂肪(g),反式脂肪(g),碳水化合物(g),糖(g),鈉(mg),資料來源說明',
  '台灣麥當勞,主餐,漢堡,1份 (102g),260.0,12.2,9.5,,,30.6,,500.0,麥當勞官方',
  '台灣麥當勞,主餐,漢 堡,1份 (102g),260,12.2,9.5,3.1,0.2,30.6,6,500,麥當勞官方',
  '50嵐,奶茶,珍珠奶茶(大杯/無糖),1杯 (L/700ml),340,,,,,,0,,50嵐官方',
  '50嵐,奶茶,珍珠奶茶(大杯/正常糖),1杯 (L/700ml),520,,,,,,45,,50嵐官方',
  '清心福全,奶茶,珍珠奶茶（大杯/無糖）,1杯,360,,,,,,0,,清心官方',
  '拿坡里,披薩,地中海漁夫披薩(大),1片,238,12,18,,,30,,,',
  '台灣SUBWAY,醬料,義大利油醋醬,1份,60,0,6,,,1,,,SUBWAY官方',
  '台灣SUBWAY,醬料,千島醬,1份,60,0,6,,,1,,,SUBWAY官方'
].join('\r\n');

async function makePack(page) {
  await stubCdn(page);
  await page.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.goto('/tools/foodpack.html');
  await page.setInputFiles('#fileInput', { name: '外食表.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + CSV) });
  await expect(page.locator('#loadNote')).toContainText('讀到 8 列');
  return page;
}

test('整理工具：自動對欄位、合併同店同名、標出要確認的、勾掉可能重複的 → 下載資料庫檔', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await makePack(page);
  await expect(page.locator('#pkName')).toHaveValue('外食表');
  await expect(page.locator('[data-askby=serving]')).toHaveClass(/is-active/);
  await expect(page.locator('#checkSummary')).toContainText('收 7 樣、合併重複 1 樣、要確認 1 樣');
  await expect(page.locator('#checkBody')).toContainText('地中海漁夫披薩(大)」熱量 238，用三大營養素算是 330');
  await expect(page.locator('#checkBody')).toContainText('珍珠奶茶：50嵐、清心福全');
  await page.check('[data-drop] >> nth=1');
  await expect(page.locator('#checkSummary')).toContainText('收 6 樣');
  await page.fill('#pkEdition', '2026-11');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlJson')]);
  expect(dl.suggestedFilename()).toBe('食物資料_外食表_2026-11.json');
  const file = JSON.parse(await (await dl.createReadStream()).toArray().then(b => Buffer.concat(b).toString()));
  expect(file).toMatchObject({ app: 'diet-tracker-foods', pack: { name: '外食表', edition: '2026-11', askBy: 'serving' } });
  expect(file.foods).toHaveLength(6);
  expect(file.foods.find(f => f.name === '漢 堡').perServing).toMatchObject({ kcal: 260, sfa: 3.1 });
  // 欄位改錯會說明
  await page.selectOption('[data-map="4"]', '');
  await expect(page.locator('#checkSummary')).toContainText('「名稱」和「熱量(kcal)」');
  expect(errors).toEqual([]);
});

const PACK = {
  app: 'diet-tracker-foods', version: 1, exportedAt: '2026-11-21T00:00:00.000Z',
  pack: { id: 'pk_test', name: '外食連鎖店', org: '自己整理', edition: '2026', askBy: 'serving' },
  foods: [
    { id: 'pf_b1', name: '漢堡', base: '漢堡', brand: '台灣麥當勞', serving: { g: 102, label: '1份' }, perServing: { kcal: 260, p: 12.2, f: 9.5, c: 30.6, sfa: 3.1 }, source: '麥當勞官方' },
    { id: 'pf_t1', name: '珍珠奶茶(大杯/無糖)', base: '珍珠奶茶', variant: '大杯/無糖', brand: '50嵐', serving: { ml: 700, label: '1杯' }, perServing: { kcal: 340, sugar: 0 } },
    { id: 'pf_t2', name: '珍珠奶茶(大杯/正常糖)', base: '珍珠奶茶', variant: '大杯/正常糖', brand: '50嵐', serving: { ml: 700, label: '1杯' }, perServing: { kcal: 520, sugar: 45 } },
    { id: 'pf_t3', name: '珍珠奶茶（大杯/無糖）', base: '珍珠奶茶', variant: '大杯/無糖', brand: '清心福全', serving: { label: '1杯' }, perServing: { kcal: 360 } }
  ]
};
const packFile = (p = PACK) => ({ name: 'pack.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(p)) });

async function importPackFile(page, p) {
  await closeScreens(page);
  await page.click('.mobile-nav-tab[data-tab=library]');
  await page.setInputFiles('#packImportInput', packFile(p));
}

test('App：匯入資料庫 → 查「珍珠奶茶」收成一列 → 選店選規格 → 記幾份，記錄帶來源；篩選只查某一個', async ({ page }) => {
  const errors = [];
  await openApp(page, { errors });
  await importPackFile(page);
  await expect(page.locator('#confirmMessage')).toContainText('「外食連鎖店」（自己整理・2026），共 4 樣');
  await page.click('#confirmOkBtn');
  await expect(page.locator('#packList')).toContainText('外食連鎖店');
  expect((await appState(page)).foodPacks[0]).toMatchObject({ id: 'pk_test', name: '外食連鎖店' });

  await page.click('.mobile-nav-tab[data-tab=log]');
  await page.click('[data-food-open=all]');
  await expect(page.locator('#foodFilter [data-food-filter]')).toHaveText(['全部', '我的', '外食連鎖店', '衛福部']);
  await page.fill('#foodSearch', '珍珠奶茶');
  await expect(page.locator('#foodPacks [data-pack-group]')).toHaveCount(1);
  await expect(page.locator('#foodPacks')).toContainText('2 家：50嵐、清心福全');
  await expect(page.locator('#foodPacks')).toContainText('340～520 kcal');
  await page.click('#foodPacks [data-pack-group]');
  await expect(page.locator('#pickTitle')).toHaveText('珍珠奶茶');
  await expect(page.locator('#pickList .sec-title')).toHaveText(['50嵐', '清心福全']);
  await page.click('#pickList [data-pick-hit="1"]');
  await expect(page.locator('#scr-pick')).toBeHidden();
  await expect(page.locator('#gramsLabel')).toHaveText('吃了幾份');
  await expect(page.locator('#gramsFoodName')).toHaveText('50嵐 珍珠奶茶(大杯/正常糖)');
  await page.click('#gramsSaveBtn');
  await expect(page.locator('#scr-food')).toBeVisible();

  // 店名也找得到；只有一樣的直接進幾份
  await page.fill('#foodSearch', '麥當勞');
  await page.click('#foodPacks [data-pack-group]');
  await expect(page.locator('#gramsFoodNote')).toContainText('一份 1份（102 g） 260 kcal');
  await expect(page.locator('#gramsFoodNote')).toContainText('資料來源：麥當勞官方');
  await page.click('#gramsSaveBtn');
  await page.click('#foodCartSaveBtn');
  const logs = (await appState(page)).logs[await page.evaluate(() => window.__dietApp.ui.date)];
  expect(logs.find(e => e.packFoodId === 'pf_t2')).toMatchObject({ name: '50嵐 珍珠奶茶(大杯/正常糖) 1 份', kcal: 520, servings: 1, src: 'pk_test', srcName: '外食連鎖店' });
  expect(logs.find(e => e.packFoodId === 'pf_b1')).toMatchObject({ srcName: '外食連鎖店・麥當勞官方', p: 12.2 });
  expect(logs.every(e => e.customFoodId === undefined && e.foodId === undefined)).toBe(true);
  await closeScreens(page);
  await expect(page.locator('body')).toContainText('資料來源：外食連鎖店・麥當勞官方');

  // 篩選：只查衛福部 → 不列資料庫；只查外食連鎖店 → 不列衛福部
  await closeScreens(page);
  await page.click('[data-food-open=all]');
  await page.fill('#foodSearch', '漢堡');
  await page.click('[data-food-filter=tfda]');
  await expect(page.locator('#foodPacks')).toBeEmpty();
  await page.click('[data-food-filter=pk_test]');
  await expect(page.locator('#foodPacks [data-pack-group]')).toHaveCount(1);
  await expect(page.locator('#foodResults [data-food-id]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('App：同一個資料庫再匯入問換成新版／保留舊版；刪除可以復原；備份的匯入也認得資料庫檔', async ({ page }) => {
  await openApp(page);
  await importPackFile(page);
  await page.click('#confirmOkBtn');
  const v2 = { ...PACK, pack: { ...PACK.pack, edition: '2027' }, foods: PACK.foods.slice(0, 2) };
  await importPackFile(page, v2);
  await expect(page.locator('#confirmMessage')).toContainText('目前的：2026・4 樣；新的：2027・2 樣');
  await page.click('#confirmCancelBtn');
  expect((await appState(page)).foodPacks[0].foods).toHaveLength(4);
  await importPackFile(page, v2);
  await page.click('#confirmOkBtn');
  expect((await appState(page)).foodPacks[0]).toMatchObject({ edition: '2027' });

  await page.click('[data-pack-del=pk_test]');
  await page.click('#confirmOkBtn');
  let st = await appState(page);
  expect(st.foodPacks).toHaveLength(0);
  expect(st.tomb['foodPacks:pk_test']).toBeGreaterThan(0);
  await page.click('#toastAction');
  st = await appState(page);
  expect(st.foodPacks).toHaveLength(1);
  expect(st.tomb['foodPacks:pk_test']).toBeUndefined();

  await openSettings(page, '#setDataRow');
  await page.setInputFiles('#importJsonInput', packFile({ ...PACK, pack: { ...PACK.pack, id: 'pk_other', name: '另一個' } }));
  await expect(page.locator('#confirmTitle')).toHaveText('加入食物資料庫');
  await page.click('#confirmOkBtn');
  expect((await appState(page)).foodPacks.map(p => p.id)).toEqual(['pk_test', 'pk_other']);
});

test('套餐裡有資料庫的食物：選套餐時記錄照樣帶來源', async ({ page }) => {
  await openApp(page);
  await importPackFile(page);
  await page.click('#confirmOkBtn');
  await page.click('.mobile-nav-tab[data-tab=log]');
  await page.click('[data-food-open=all]');
  for (const q of ['麥當勞', '清心']) {
    await page.fill('#foodSearch', q);
    await page.click('#foodPacks [data-pack-group] >> nth=0');
    if (await page.isVisible('#scr-pick')) await page.click('#pickList [data-pick-hit] >> nth=0');
    await page.click('#gramsSaveBtn');
  }
  await page.click('[data-cart-combo]');
  await page.fill('#comboName', '速食');
  await page.click('#comboSaveBtn');
  const combo = (await appState(page)).combos[0];
  expect(combo.items.map(i => [i.src, i.packFoodId])).toEqual([['pk_test', 'pf_b1'], ['pk_test', 'pf_t3']]);
  await page.click('#foodCartSaveBtn');
  await closeScreens(page);
  await page.click('[data-food-open=mine] >> nth=0');
  await page.click('#foodMine [data-combo-pick]');
  await page.click('#foodCartSaveBtn');
  const logs = (await appState(page)).logs[await page.evaluate(() => window.__dietApp.ui.date)];
  expect(logs.filter(e => e.comboId === combo.id).map(e => e.src)).toEqual(['pk_test', 'pk_test']);
});
