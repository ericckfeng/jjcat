// 查食物・秤克數：搜尋衛福部資料庫、輸入克數、存成一筆飲食記錄
import { test, expect } from '@playwright/test';
import { openApp, appState } from './helpers.mjs';

async function openFood(page) {
  await page.click('[data-screen=scr-food]');
  await expect(page.locator('#scr-food')).toBeVisible();
}

test('搜尋「地瓜」→ 輸入 110 g → 存成記錄（含克數、營養素、六大類）', async ({ page }) => {
  const errors = [];
  await openApp(page, { errors });
  const today = await page.evaluate(() => window.__dietApp.ui.date);
  await openFood(page);
  await page.click('#scr-food [data-meal=breakfast]');
  await page.fill('#foodSearch', '地瓜');
  await expect(page.locator('#foodResults .pick-row').first()).toContainText('甘藷');
  await page.locator('#foodResults [data-food-id=B0400101]').click();
  await expect(page.locator('#scr-grams')).toBeVisible();
  await expect(page.locator('#gramsCookWrap')).toBeHidden();
  await expect(page.locator('#gramsSaveBtn')).toHaveText('記到早餐');
  await page.fill('#gramsInput', '110');
  await expect(page.locator('#gramsResult')).toContainText('125');
  await page.click('#gramsSaveBtn');
  await expect(page.locator('#scr-food')).toBeVisible();
  await expect(page.locator('#foodSearch')).toHaveValue('');
  const it = (await appState(page)).logs[today].find(x => x.foodId === 'B0400101');
  expect(it).toMatchObject({ name: '白皮甘藷 110g', kcal: 125, grams: 110, meal: 'breakfast', p: 1.4, c: 30.3, ex: { grain: 2 } });
  expect(it.weighed).toBeUndefined();
  expect(errors).toEqual([]);
});

test('生肉可以切換「煮熟的」，以熟重換算', async ({ page }) => {
  await openApp(page);
  const today = await page.evaluate(() => window.__dietApp.ui.date);
  await openFood(page);
  await page.fill('#foodSearch', '雞胸肉');
  await page.locator('#foodResults .pick-row', { hasText: '里肌肉(肉雞)' }).first().click();
  await expect(page.locator('#gramsCookWrap')).toBeVisible();
  await page.fill('#gramsInput', '135');
  await expect(page.locator('#gramsResult')).toContainText('144');
  await page.click('#gramsCookedBtn');
  await expect(page.locator('#gramsResult')).toContainText('192');
  await expect(page.locator('#gramsResult')).toContainText('生重 180 g');
  await page.click('#gramsSaveBtn');
  const it = (await appState(page)).logs[today].find(x => x.grams === 135);
  expect(it).toMatchObject({ name: '里肌肉(肉雞) 135g（熟重）', kcal: 192, weighed: 'cooked' });
});

test('快捷克數鈕與找不到時的說明', async ({ page }) => {
  await openApp(page);
  await openFood(page);
  await page.fill('#foodSearch', '白飯');
  await page.locator('#foodResults .pick-row').first().click();
  await page.click('[data-grams-set="200"]');
  await expect(page.locator('#gramsInput')).toHaveValue('200');
  await expect(page.locator('#gramsResult')).toContainText('364');
  await page.click('[data-grams-add="10"]');
  await expect(page.locator('#gramsInput')).toHaveValue('210');
  await page.fill('#gramsInput', '');
  await expect(page.locator('#gramsSaveBtn')).toBeDisabled();
  await page.click('#scr-grams [data-back]');
  await page.fill('#foodSearch', '雞腿便當');
  await expect(page.locator('#foodResults')).toContainText('找不到');
});

test('常吃清單找不到時，可以直接到食物資料庫查', async ({ page }) => {
  await openApp(page);
  await page.click('[data-screen=scr-quick]');
  await page.fill('#quickPickSearch', '鮭魚');
  await page.click('[data-food-query]');
  await expect(page.locator('#scr-food')).toBeVisible();
  await expect(page.locator('#foodSearch')).toHaveValue('鮭魚');
  await expect(page.locator('#foodResults .pick-row').first()).toContainText('鮭魚');
  await page.click('#scr-food .scr-foot [data-back]');
  await expect(page.locator('#scr-quick')).toBeVisible();
  await expect(page.locator('#scr-food')).toBeHidden();
});
