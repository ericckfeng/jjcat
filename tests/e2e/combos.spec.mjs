// 套餐（combos）：購物車存成套餐 → 選套餐整組放進購物車 → 改克數、拿掉 → 記到某餐
import { test, expect } from '@playwright/test';
import { openApp, appState, closeScreens } from './helpers.mjs';

const todayOf = (page) => page.evaluate(() => window.__dietApp.ui.date);

async function addFood(page, query, grams) {
  await page.fill('#foodSearch', query);
  await page.click('#foodResults [data-food-id] >> nth=0');
  await page.fill('#gramsInput', String(grams));
  await page.click('#gramsSaveBtn');
}

test('存成套餐 → 選套餐、改克數、拿掉一樣 → 記到早餐；記錄帶 comboId', async ({ page }) => {
  const errors = [];
  await openApp(page, { errors });
  await page.click('[data-food-open=all]');
  await addFood(page, '雞胸', 100);
  await expect(page.locator('[data-cart-combo]')).toHaveCount(0);   // 一樣不用存成套餐
  await addFood(page, '甘藷', 150);
  await page.click('[data-cart-combo]');
  await expect(page.locator('#comboItems li')).toHaveCount(2);
  await page.click('#comboSaveBtn');
  await expect(page.locator('#comboNote')).toContainText('取個名字');
  await page.fill('#comboName', '健身早餐');
  await page.click('#comboSaveBtn');
  await expect(page.locator('#scr-combo')).toBeHidden();
  const [combo] = (await appState(page)).combos;
  expect(combo).toMatchObject({ name: '健身早餐' });
  expect(combo.items.map(i => i.grams)).toEqual([100, 150]);
  expect(combo.items.every(i => i.foodId && i.snapshot.per100g)).toBe(true);
  // 存成套餐不會記下來；購物車還在
  await page.click('#scr-food [data-meal=lunch]');
  await page.click('#foodCartSaveBtn');
  expect((await appState(page)).logs[await todayOf(page)]).toHaveLength(2);

  // 我的食物：最上面是套餐
  await closeScreens(page);
  await page.click('[data-food-open=mine] >> nth=0');
  await expect(page.locator('#foodMine')).toContainText('🍱 我的套餐');
  await page.click('#foodMine [data-combo-pick]');
  await expect(page.locator('#foodCart li')).toHaveCount(2);
  await page.click('#foodCart [data-cart-edit] >> nth=0');
  await expect(page.locator('#gramsInput')).toHaveValue('100');
  await page.fill('#gramsInput', '120');
  await page.click('#gramsSaveBtn');
  await page.click('#foodCart [data-cart-del] >> nth=1');
  await page.click('#scr-food [data-meal=breakfast]');
  await page.click('#foodCartSaveBtn');
  const breakfast = (await appState(page)).logs[await todayOf(page)].filter(e => e.meal === 'breakfast');
  expect(breakfast).toHaveLength(1);
  expect(breakfast[0]).toMatchObject({ grams: 120, comboId: combo.id });
  expect(errors).toEqual([]);
});

test('同名再存一次＝更新套餐；查食物打字也找得到套餐', async ({ page }) => {
  await openApp(page);
  await page.click('[data-food-open=all]');
  await addFood(page, '雞胸', 100);
  await addFood(page, '甘藷', 150);
  await page.click('[data-cart-combo]');
  await page.fill('#comboName', '便當');
  await page.click('#comboSaveBtn');
  await addFood(page, '高麗菜', 80);
  await page.click('[data-cart-combo]');
  await expect(page.locator('#comboName')).toHaveValue('便當');   // 預填剛才的套餐名稱
  await page.click('#comboSaveBtn');
  await expect(page.locator('#confirmMessage')).toContainText('3 樣');
  await page.click('#confirmOkBtn');
  const st = await appState(page);
  expect(st.combos).toHaveLength(1);
  expect(st.combos[0].items).toHaveLength(3);

  await page.click('#foodCartSaveBtn');
  await closeScreens(page);
  await page.click('[data-food-open=all]');
  await page.fill('#foodSearch', '便當');
  await expect(page.locator('#foodMine [data-combo-pick]')).toContainText('便當');
  await page.fill('#foodSearch', '高麗菜');   // 裡面的食物也算
  await expect(page.locator('#foodMine [data-combo-pick]')).toHaveCount(1);
});

test('我的食物分頁：改名、拿掉一樣、刪除後可以復原', async ({ page }) => {
  await openApp(page);
  await page.click('[data-food-open=all]');
  await addFood(page, '雞胸', 100);
  await addFood(page, '甘藷', 150);
  await page.click('[data-cart-combo]');
  await page.fill('#comboName', '午餐');
  await page.click('#comboSaveBtn');
  await page.click('#foodCartSaveBtn');
  await closeScreens(page);

  await page.click('.mobile-nav-tab[data-tab=library]');
  await page.click('#comboList [data-combo-edit]');
  await expect(page.locator('#comboTitle')).toHaveText('🍱 修改套餐');
  await page.fill('#comboName', '健身午餐');
  await page.click('#comboItems [data-combo-del="1"]');
  await expect(page.locator('#comboItems [data-combo-del]')).toHaveCount(0);   // 剩一樣不能再拿掉
  await page.click('#comboSaveBtn');
  let st = await appState(page);
  expect(st.combos[0]).toMatchObject({ name: '健身午餐' });
  expect(st.combos[0].items).toHaveLength(1);

  await page.click('#comboList [data-combo-edit]');
  await page.click('#comboDelete');
  await page.click('#confirmOkBtn');
  st = await appState(page);
  expect(st.combos).toHaveLength(0);
  expect(Object.keys(st.tomb).some(k => k.startsWith('combos:'))).toBe(true);
  await page.click('#toastAction');
  st = await appState(page);
  expect(st.combos).toHaveLength(1);
  expect(Object.keys(st.tomb).some(k => k.startsWith('combos:'))).toBe(false);
});
