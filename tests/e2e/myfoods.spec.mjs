// 我的食物（customFoods）取代「常吃的」：新增／修改／刪除，記的時候和查食物同一套流程
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, appState, openSettings, closeScreens } from './helpers.mjs';

const todayOf = (page) => page.evaluate(() => window.__dietApp.ui.date);

async function newFood(page, f) {
  for (const [k, v] of Object.entries(f)) {
    if (['sugar', 'na', 'fiber'].includes(k) && !(await page.locator('#mf-more').getAttribute('open'))) await page.click('#mf-more summary');
    await page.fill('#mf-' + k, String(v));
  }
  await page.click('#mf-save');
  await expect(page.locator('#scr-myfood')).toBeHidden();
}

test('首頁「我的食物」：還沒有時說明怎麼建；新增以克計的食物 → 預填一份的克數 → 改 7 克 → 記到午餐', async ({ page }) => {
  const errors = [];
  await openApp(page, { errors });
  await page.click('[data-food-open=mine] >> nth=0');
  await expect(page.locator('#foodTitle')).toHaveText('⭐ 我的食物');
  await expect(page.locator('#foodMine')).toContainText('還沒有我的食物');
  await page.click('#foodMine [data-mf-new]');
  await newFood(page, { name: '堅果包', servingG: 35, servingLabel: '1 包', kcal: 100, p: 3, f: 10, fiber: 1.4 });
  await expect(page.locator('#foodMine [data-cf-id]')).toHaveCount(1);
  await expect(page.locator('#foodMine')).toContainText('一份 1 包 35 g　100 kcal');
  await page.click('#foodMine [data-cf-id]');
  await expect(page.locator('#gramsInput')).toHaveValue('35');
  await expect(page.locator('#gramsPresets')).toContainText('1 份 35g');
  await page.fill('#gramsInput', '7');
  await expect(page.locator('#gramsResult')).toContainText('20');
  await page.click('#gramsSaveBtn');
  await page.click('#scr-food [data-meal=lunch]');
  await page.click('#foodCartSaveBtn');
  const [it] = (await appState(page)).logs[await todayOf(page)];
  const cf = (await appState(page)).customFoods[0];
  expect(it).toMatchObject({ name: '堅果包 7g', kcal: 20, f: 2, p: 0.6, fiber: 0.3, grams: 7, customFoodId: cf.id, meal: 'lunch' });
  expect(it.foodId).toBeUndefined();
  expect(cf).toMatchObject({ name: '堅果包', serving: { g: 35, label: '1 包' }, per100g: { kcal: 285.71 } });
  expect(errors).toEqual([]);
});

test('以份計的食物（不知道幾克）：問吃了幾份', async ({ page }) => {
  await openApp(page);
  await page.click('[data-food-open=mine] >> nth=0');
  await page.click('#foodMine [data-mf-new]');
  await newFood(page, { name: '巷口牛肉麵', servingLabel: '1 碗', kcal: 650, p: 30, f: 22, c: 80 });
  await page.click('#foodMine [data-cf-id]');
  await expect(page.locator('#gramsLabel')).toHaveText('吃了幾份');
  await expect(page.locator('#gramsInput')).toHaveValue('1');
  await page.click('[data-grams-set="1.5"]');
  await expect(page.locator('#gramsResult')).toContainText('975');
  await page.click('#gramsSaveBtn');
  await page.click('#foodCartSaveBtn');
  const [it] = (await appState(page)).logs[await todayOf(page)];
  expect(it).toMatchObject({ name: '巷口牛肉麵 1.5 份', kcal: 975, p: 45, servings: 1.5 });
  expect(it.grams).toBeUndefined();
});

test('查食物：我的食物排在衛福部資料前面、標「我的」；找不到可以直接新增成我的食物', async ({ page }) => {
  await openApp(page);
  await page.click('[data-food-open=mine] >> nth=0');
  await page.click('#foodMine [data-mf-new]');
  await newFood(page, { name: '全家烤地瓜', servingG: 150, kcal: 190 });
  await closeScreens(page);
  await page.click('[data-food-open=all]');
  await expect(page.locator('#foodTitle')).toHaveText('🔍 查食物');
  await expect(page.locator('#foodMine')).toBeEmpty();   // 沒打字時只有查食物的說明
  await page.fill('#foodSearch', '甘藷');                   // 同義詞也找得到
  await expect(page.locator('#foodMine [data-cf-id]')).toContainText('我的全家烤地瓜');
  await expect(page.locator('#foodResults')).toContainText('衛福部食品資料庫');
  await page.fill('#foodSearch', '阿嬤的油飯');
  await expect(page.locator('#foodResults')).toContainText('找不到');
  await page.click('#foodResults [data-mf-new]');
  await expect(page.locator('#mf-name')).toHaveValue('阿嬤的油飯');   // 帶入打的字
});

test('新增：沒填熱量、名稱重複會說明', async ({ page }) => {
  await openApp(page);
  await page.click('.mobile-nav-tab[data-tab=library]');
  await page.click('#myFoodAddBtn');
  await page.fill('#mf-name', '豆漿');
  await page.click('#mf-save');
  await expect(page.locator('#mf-note')).toContainText('熱量');
  await page.fill('#mf-kcal', '120');
  await page.click('#mf-save');
  await expect(page.locator('#scr-myfood')).toBeHidden();
  await page.click('#myFoodAddBtn');
  await page.fill('#mf-name', '豆漿');
  await page.fill('#mf-kcal', '80');
  await page.click('#mf-save');
  await expect(page.locator('#mf-note')).toContainText('已經有「豆漿」');
});

test('「我的食物」分頁：最常記的在前；修改、刪除（刪除標記）、復原；已經記的記錄不受影響', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    const d = new Date(); d.setHours(12);
    const t = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    localStorage.setItem('diet_tracker_v2', JSON.stringify({
      meta: { welcomed: true },
      customFoods: [
        { id: 'cf_a', name: '茶葉蛋', serving: { g: 55 }, per100g: { kcal: 136.36 }, updatedAt: 3 },
        { id: 'cf_b', name: '無糖豆漿', serving: { label: '1 杯' }, perServing: { kcal: 120, p: 11 }, updatedAt: 1 }
      ],
      logs: { [t]: [{ id: 'item_1', name: '無糖豆漿 1 份', kcal: 120, meal: 'breakfast', multiplier: 1, customFoodId: 'cf_b', servings: 1, updatedAt: 1 }] }
    }));
  });
  await openApp(page);
  await page.click('.mobile-nav-tab[data-tab=library]');
  await expect(page.locator('#myFoodList [data-mf-edit]')).toHaveText([/無糖豆漿/, /茶葉蛋/]);
  await page.click('[data-mf-edit=cf_a]');
  await expect(page.locator('#mf-servingG')).toHaveValue('55');
  await expect(page.locator('#mf-kcal')).toHaveValue('75');
  await page.fill('#mf-kcal', '80');
  await page.click('#mf-save');
  let s = await appState(page);
  expect(s.customFoods.find(f => f.id === 'cf_a')).toMatchObject({ per100g: { kcal: 145.45 } });
  expect(s.customFoods.find(f => f.id === 'cf_a').updatedAt).toBeGreaterThan(3);

  await page.click('[data-mf-edit=cf_b]');
  await page.click('#mf-delete');
  await page.click('#confirmOkBtn');
  s = await appState(page);
  expect(s.customFoods.map(f => f.id)).toEqual(['cf_a']);
  expect(s.tomb['customFoods:cf_b']).toBeGreaterThan(0);
  expect(Object.values(s.logs)[0][0]).toMatchObject({ customFoodId: 'cf_b', kcal: 120 });
  await page.click('#toastAction');
  s = await appState(page);
  expect(s.customFoods.map(f => f.id).sort()).toEqual(['cf_a', 'cf_b']);
  expect(s.tomb['customFoods:cf_b']).toBeUndefined();
});

test('自己輸入：勾「也存到我的食物」——照標示算過的存以克計，沒有的存以份計', async ({ page }) => {
  await openApp(page);
  await page.click('[data-screen=scr-manual]');
  await page.fill('#foodNameInput', '洋芋片');
  await page.click('#add-lb summary');
  await page.fill('#add-lb-g', '30');
  await page.fill('#add-lb-kcal', '160');
  await page.fill('#add-lb-f', '10');
  await page.fill('#add-lb-eat', '45');
  await page.check('#saveMineCheck');
  await page.click('#scr-manual .scr-foot button');
  await expect(page.locator('#scr-manual')).toBeHidden();
  await page.click('[data-screen=scr-manual]');
  await page.fill('#foodNameInput', '雞腿便當');
  await page.fill('#foodKcalInput', '780');
  await page.check('#saveMineCheck');
  await page.click('#scr-manual .scr-foot button');
  await expect(page.locator('#scr-manual')).toBeHidden();
  const s = await appState(page);
  const chips = s.customFoods.find(f => f.name === '洋芋片');
  expect(chips).toMatchObject({ serving: { g: 45 }, per100g: { kcal: 533.33, f: 33.33 } });
  expect(s.customFoods.find(f => f.name === '雞腿便當')).toMatchObject({ perServing: { kcal: 780 } });
  expect(s.quickItems).toEqual([]);   // 不再寫進舊的常吃清單
});

test('自己輸入：沒填名稱不能存成我的食物（不會出現「午餐拍照待查」這種名字）', async ({ page }) => {
  await openApp(page);
  await page.click('[data-screen=scr-manual]');
  await page.fill('#foodKcalInput', '300');
  await page.check('#saveMineCheck');
  await page.click('#scr-manual .scr-foot button');
  await expect(page.locator('#toast')).toContainText('請先在最上面填名稱');
  await expect(page.locator('#scr-manual')).toBeVisible();
  expect((await appState(page)).customFoods || []).toEqual([]);
  await page.click('#toastAction');
  await page.fill('#foodNameInput', '鮭魚飯糰');
  await page.click('#scr-manual .scr-foot button');
  await expect(page.locator('#scr-manual')).toBeHidden();
  expect((await appState(page)).customFoods.map(f => f.name)).toEqual(['鮭魚飯糰']);
});

test('首頁「我的食物」：每一樣旁邊可以直接修改名稱，改完回到清單（手機特大字不會橫移）', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.addInitScript(() => {
    if (!localStorage.getItem('diet_tracker_v2')) localStorage.setItem('diet_tracker_v2', JSON.stringify({ quickItems: [], tomb: {}, meta: { welcomed: true, fontSize: 'xl' } }));
  });
  await openApp(page);
  await page.click('[data-food-open=mine] >> nth=0');
  await page.click('#foodMine [data-mf-new]');
  await newFood(page, { name: '午餐拍照待查', servingLabel: '1 份', kcal: 450 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.click('#foodMine .mine-edit');
  await expect(page.locator('#myFoodTitle')).toHaveText('⭐ 修改我的食物');
  await expect(page.locator('#mf-name')).toHaveValue('午餐拍照待查');
  await page.fill('#mf-name', '雞腿便當');
  await page.click('#mf-save');
  await expect(page.locator('#scr-myfood')).toBeHidden();
  await expect(page.locator('#scr-food')).toBeVisible();
  await expect(page.locator('#foodMine [data-cf-id]')).toContainText('雞腿便當');
  const s = await appState(page);
  expect(s.customFoods.map(f => f.name)).toEqual(['雞腿便當']);
  expect(s.logs[await todayOf(page)] || []).toEqual([]);   // 修改不會記一筆
});

test('舊的「常吃的」清單：不顯示，但資料原樣保留、會備份；舊捷徑 ?go=quick 打開我的食物', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({
      meta: { welcomed: true }, customFoods: [{ id: 'cf_a', name: '茶葉蛋', perServing: { kcal: 75 }, updatedAt: 1 }],
      quickItems: [{ id: 'qi_old', name: '我的老快選', kcal: 300, cat: 'fav', isFav: true, updatedAt: 1 }]
    }));
  });
  await openApp(page);
  await expect(page.locator('#scr-quick')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('我的老快選');
  await openSettings(page, '#setDataRow');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportJsonBtn')]);
  const out = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(out.quickItems.map(q => q.id)).toEqual(['qi_old']);
  expect(out.customFoods.map(f => f.id)).toEqual(['cf_a']);
  await page.goto('/?go=quick');
  await page.waitForFunction(() => window.__dietApp);
  await expect(page.locator('#scr-food')).toBeVisible();
  await expect(page.locator('#foodTitle')).toHaveText('⭐ 我的食物');
  await expect(page.locator('#foodMine')).toContainText('茶葉蛋');
});
