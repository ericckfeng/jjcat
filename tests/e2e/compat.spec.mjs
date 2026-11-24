// 舊版資料相容性：每一種曾經存在過的備份格式都要能匯入，資料不能遺失
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, appState, photoBytes, importFile, closeScreens, openSettings } from './helpers.mjs';

const fx = (name) => new URL('../fixtures/' + name, import.meta.url).pathname;

test('v1（最早的單檔版）備份檔：記錄、照片、目標、常用清單都匯入', async ({ page }) => {
  const errors = [];
  await openApp(page, { errors });
  expect(await importFile(page, fx('backup-v1-single-file.json'))).toContain('匯入完成');
  const s = await appState(page);
  const list = s.logs['2026-10-01'];
  expect(list.map(i => i.name).sort()).toEqual(['茶葉蛋', '雞腿便當']);
  expect(list.find(i => i.id === 'item_1').hasPhoto).toBe(true);
  expect(list.find(i => i.id === 'item_1').photo).toBeUndefined();
  expect(await photoBytes(page, 'item_1')).toBeGreaterThan(100);
  expect(list.find(i => i.id === 'item_2').pending).toBe(true);
  expect(s.targets.kcal).toBe(1600);
  expect(s.quickItems.some(q => q.id === 'qi_old')).toBe(true);
  expect(errors).toEqual([]);
});

test('v2（PWA 初版）備份檔：營養素、照片、每日資料、目標都匯入', async ({ page }) => {
  await openApp(page);
  expect(await importFile(page, fx('backup-v2-pwa.json'))).toContain('新增 2 筆');
  const s = await appState(page);
  const a = s.logs['2026-11-10'].find(i => i.id === 'item_v2a');
  expect(a).toMatchObject({ kcal: 350, p: 15, c: 40, f: 12, hasPhoto: true, ex: { grain: 2, prot: 1 } });
  expect(await photoBytes(page, 'item_v2a')).toBeGreaterThan(100);
  expect(s.days['2026-11-10']).toMatchObject({ weight: 70.2, waist: 88, water: 750, question: '晚上嘴饞怎麼辦？' });
  expect(s.targets).toMatchObject({ kcal: 1500, p: 80, weight: 68 });
});

test('v3（同步版）備份檔：身體尺寸、睡眠、補眠、照片版本都匯入', async ({ page }) => {
  await openApp(page);
  await importFile(page, fx('backup-v3-sync.json'));
  const s = await appState(page);
  expect(s.days['2026-11-12']).toMatchObject({ hip: 100, arm: 31, bodyFat: 24.5, sleepMin: 450, sleepQ: 4, naps: [{ id: 'nap_1', min: 30 }] });
  expect(s.profile).toMatchObject({ height: 168, sex: 'm' });
  const a = s.logs['2026-11-12'].find(i => i.id === 'item_v3a');
  expect(a.photoKey).toBe('item_v3a-1794400100000');
  expect(s.meta.photoVer.item_v3a).toBe('item_v3a-1794400100000');
  expect(await photoBytes(page, 'item_v3a')).toBeGreaterThan(100);
});

test('同一個備份檔匯入兩次不會重複', async ({ page }) => {
  await openApp(page);
  await importFile(page, fx('backup-v2-pwa.json'));
  expect(await importFile(page, fx('backup-v2-pwa.json'))).toContain('新增 0 筆');
  expect((await appState(page)).logs['2026-11-10']).toHaveLength(2);
});

test('三個版本依序匯入可以並存，重新整理後資料和照片都還在', async ({ page }) => {
  await openApp(page);
  for (const f of ['backup-v1-single-file.json', 'backup-v2-pwa.json', 'backup-v3-sync.json']) await importFile(page, fx(f));
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  const s = await appState(page);
  expect(Object.keys(s.logs).sort()).toEqual(['2026-10-01', '2026-11-10', '2026-11-12']);
  expect(await photoBytes(page, 'item_1')).toBeGreaterThan(100);
  expect(await photoBytes(page, 'item_v3a')).toBeGreaterThan(100);
});

test('瀏覽器裡還留著最早單檔版的資料時，第一次開啟會自動搬過來', async ({ page }) => {
  const v1 = readFileSync(fx('backup-v1-single-file.json'), 'utf8');
  await page.addInitScript((data) => {
    if (!localStorage.getItem('diet_tracker_v2')) localStorage.setItem('daily_calorie_tracker_v1', data);
  }, v1);
  await openApp(page);
  const s = await appState(page);
  expect(s.logs['2026-10-01']).toHaveLength(2);
  expect(s.targets.kcal).toBe(1600);
});

test('含新版資料的備份檔：看不懂的最上層資料會保留，重新整理、再匯出都還在', async ({ page }) => {
  await openApp(page);
  await importFile(page, fx('backup-v3-extra-keys.json'));
  let s = await appState(page);
  expect(s.customFoods.map(x => x.id)).toEqual(['cf_1', 'cf_2']);
  expect(s.futureSettings).toMatchObject({ mode: 'auto' });
  // 記錄裡新版才有的欄位也要保留
  expect(s.logs['2026-11-12'].find(i => i.id === 'item_v3b')).toMatchObject({ grams: 135, foodId: 'I0410201', weighed: 'cooked', futureEntryField: 'x' });
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  s = await appState(page);
  expect(s.customFoods.map(x => x.id)).toEqual(['cf_1', 'cf_2']);
  await openSettings(page, '#setDataRow');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportJsonBtn')]);
  const out = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(out.customFoods.map(x => x.id)).toEqual(['cf_1', 'cf_2']);
  expect(out.futureSettings).toMatchObject({ mode: 'auto' });
  expect(out.meta).toBeUndefined();
});

test('最早單檔版的欄位（targetKcal）不會被當成新資料存起來', async ({ page }) => {
  await openApp(page);
  await importFile(page, fx('backup-v1-single-file.json'));
  const s = await appState(page);
  expect(s.targetKcal).toBeUndefined();
  // v1 的照片 data URL 和 baseKcal 不會留在記錄裡
  for (const it of s.logs['2026-10-01']) { expect(it.photo).toBeUndefined(); expect(it.baseKcal).toBeUndefined(); }
});

test('食物資料庫（foodPacks）備份檔：資料庫匯入、看不懂的欄位保留、記錄的資料來源照樣顯示、查得到', async ({ page }) => {
  await openApp(page);
  expect(await importFile(page, fx('backup-v3-foodpacks.json'))).toContain('匯入完成');
  const s = await appState(page);
  expect(s.foodPacks[0]).toMatchObject({ id: 'pk_fx', futureField: 1 });
  expect(s.foodPacks[0].foods[0].perServing.sfa).toBe(3.1);
  await closeScreens(page);
  await page.click('[data-food-open=all]');
  await page.fill('#foodSearch', '漢堡');
  await expect(page.locator('#foodPacks')).toContainText('台灣麥當勞');
});

test('資料庫裡自己加、改過的（customFoods 的 packId、replaces）備份檔：我的食物只列沒歸到資料庫的；查到的是改過的數字；資料庫刪掉的回到我的食物', async ({ page }) => {
  await openApp(page);
  expect(await importFile(page, fx('backup-v3-pack-additions.json'))).toContain('匯入完成');
  const s = await appState(page);
  expect(s.customFoods.find(f => f.id === 'cf_add')).toMatchObject({ packId: 'pk_fx2', futureField: 2 });
  await closeScreens(page);
  await page.click('.mobile-nav-tab[data-tab=library]');
  await expect(page.locator('#myFoodList')).toContainText('無糖豆漿');
  await expect(page.locator('#myFoodList')).toContainText('舊資料庫的蛋餅');
  await expect(page.locator('#myFoodList')).not.toContainText('嫩煎雞腿堡');
  await expect(page.locator('#packList')).toContainText('我加了 1 樣・改過 1 樣');
  await page.click('.mobile-nav-tab[data-tab=log]');
  await page.click('[data-food-open=all]');
  await page.fill('#foodSearch', '漢堡');
  await expect(page.locator('#foodPacks')).toContainText('250 kcal');
  await expect(page.locator('#foodPacks')).not.toContainText('260 kcal');
  await page.fill('#foodSearch', '麥當勞');
  await expect(page.locator('#foodPacks')).toContainText('嫩煎雞腿堡');
});

test('套餐（combos）備份檔：套餐都匯入、看不懂的欄位保留；資料庫找不到、刪掉、AI 估的品項用 snapshot 照樣能放進購物車', async ({ page }) => {
  await openApp(page);
  expect(await importFile(page, fx('backup-v3-combos.json'))).toContain('匯入完成');
  const s = await appState(page);
  expect(s.combos.map(c => c.id)).toEqual(['cb_morning', 'cb_future']);
  expect(s.combos[1]).toMatchObject({ futureField: { x: 1 } });
  await closeScreens(page);
  await page.click('[data-food-open=mine] >> nth=0');
  await page.click('#foodMine [data-combo-pick="cb_morning"]');
  await expect(page.locator('#foodCart li')).toHaveCount(4);
  await expect(page.locator('#foodCart')).toContainText('已下架的燕麥片 40g');
  await expect(page.locator('#foodCart')).toContainText('刪掉的豆漿 1 份');
  await page.click('#foodCartSaveBtn');
  const added = (await appState(page)).logs[await page.evaluate(() => window.__dietApp.ui.date)];
  expect(added.find(e => e.name.startsWith('已下架'))).toMatchObject({ kcal: 160, foodId: 'ZZ_REMOVED', comboId: 'cb_morning' });
  expect(added.find(e => e.name.startsWith('刪掉的豆漿')).customFoodId).toBeUndefined();
  expect(added.find(e => e.name.startsWith('滷蛋'))).toMatchObject({ kcal: 70, ai: 'photo' });
  expect(added.find(e => e.name.startsWith('堅果包'))).toMatchObject({ customFoodId: 'cf_nut', kcal: 100 });
});

test('我的食物（customFoods）備份檔：食物都匯入（和記錄一樣，匯入只加不刪）；看不懂的欄位保留；記錄連得回我的食物', async ({ page }) => {
  await openApp(page);
  expect(await importFile(page, fx('backup-v3-custom-foods.json'))).toContain('匯入完成');
  const s = await appState(page);
  expect(s.customFoods.map(f => f.id)).toEqual(['cf_nut', 'cf_noodle', 'cf_future']);
  expect(s.customFoods[2]).toMatchObject({ barcode: '4710000000000', futureField: { x: 1 } });
  expect(s.logs['2026-11-25'].find(i => i.id === 'item_cf2')).toMatchObject({ customFoodId: 'cf_noodle', servings: 1.5 });
  await closeScreens(page);
  await page.click('.mobile-nav-tab[data-tab=library]');
  await expect(page.locator('#myFoodList [data-mf-edit]')).toHaveCount(3);
});
