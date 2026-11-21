// 查食物・秤克數：搜尋衛福部資料庫、輸入克數、存成一筆飲食記錄
import { test, expect } from '@playwright/test';
import { openApp, appState, closeScreens, openSettings } from './helpers.mjs';

async function openFood(page) {
  await page.click('[data-food-open=all]');
  await expect(page.locator('#scr-food')).toBeVisible();
}

test('搜尋「地瓜」→ 輸入 110 g → 加入 → 記到早餐（含克數、營養素、六大類）', async ({ page }) => {
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
  await expect(page.locator('#gramsSaveBtn')).toHaveText('加入這一餐');
  await page.fill('#gramsInput', '110');
  await expect(page.locator('#gramsResult')).toContainText('125');
  await page.click('#gramsSaveBtn');
  await expect(page.locator('#scr-food')).toBeVisible();
  await expect(page.locator('#foodSearch')).toHaveValue('');
  await expect(page.locator('#foodCart')).toContainText('白皮甘藷 110g');
  await expect(page.locator('#foodCartSaveBtn')).toHaveText('記到早餐（1 樣）');
  await page.click('#foodCartSaveBtn');
  await expect(page.locator('#scr-food')).toBeHidden();
  const it = (await appState(page)).logs[today].find(x => x.foodId === 'B0400101');
  expect(it).toMatchObject({ name: '白皮甘藷 110g', kcal: 125, grams: 110, meal: 'breakfast', p: 1.4, c: 30.3, ex: { grain: 2 } });
  expect(it.weighed).toBeUndefined();
  expect(it.groupId).toBeUndefined(); // 只有一樣就不用分組
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
  await page.click('#foodCartSaveBtn');
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

test('購物車：選三樣、修改一樣、拿掉一樣，一次記到午餐（同一組）', async ({ page }) => {
  const errors = [];
  await openApp(page, { errors });
  const today = await page.evaluate(() => window.__dietApp.ui.date);
  await openFood(page);
  await page.click('#scr-food [data-meal=lunch]');
  const add = async (q, g) => {
    await page.fill('#foodSearch', q);
    await page.locator('#foodResults .pick-row').first().click();
    await page.fill('#gramsInput', String(g));
    await page.click('#gramsSaveBtn');
    await expect(page.locator('#scr-food')).toBeVisible();
  };
  await add('白飯', 200);
  await add('地瓜', 110);
  await add('鮭魚', 100);
  await expect(page.locator('#foodCart li')).toHaveCount(3);
  await expect(page.locator('#foodCartSaveBtn')).toHaveText('記到午餐（3 樣）');
  // 白飯改成 150 g
  await page.locator('#foodCart li', { hasText: '200g' }).locator('[data-cart-edit]').click();
  await expect(page.locator('#gramsInput')).toHaveValue('200');
  await expect(page.locator('#gramsSaveBtn')).toHaveText('改好了');
  await page.fill('#gramsInput', '150');
  await page.click('#gramsSaveBtn');
  await expect(page.locator('#foodCart')).toContainText('150g');
  await expect(page.locator('#foodCart li')).toHaveCount(3);
  // 拿掉地瓜
  await page.locator('#foodCart li', { hasText: '甘藷' }).locator('[data-cart-del]').click();
  await expect(page.locator('#foodCart li')).toHaveCount(2);
  await expect(page.locator('#foodCart')).toContainText('合計');
  await page.click('#foodCartSaveBtn');
  const list = (await appState(page)).logs[today];
  expect(list).toHaveLength(2);
  expect(list.every(x => x.meal === 'lunch' && x.foodId && x.groupId)).toBe(true);
  expect(list[0].groupId).toBe(list[1].groupId);
  expect(list.some(x => x.grams === 150)).toBe(true);
  // 再打開，購物車是空的
  await openFood(page);
  await expect(page.locator('#foodCart')).toBeHidden();
  await expect(page.locator('#foodDoneBtn')).toBeVisible();
  expect(errors).toEqual([]);
});

test('購物車還有東西就離開：會問要不要記；選「不要了」就清掉', async ({ page }) => {
  await openApp(page);
  const today = await page.evaluate(() => window.__dietApp.ui.date);
  await openFood(page);
  await page.click('#scr-food [data-meal=dinner]');
  await page.fill('#foodSearch', '白飯');
  await page.locator('#foodResults .pick-row').first().click();
  await page.click('#gramsSaveBtn');
  await page.goBack(); // 手機返回鍵
  await expect(page.locator('#confirmModal')).toBeVisible();
  await expect(page.locator('#confirmOkBtn')).toHaveText('記到晚餐');
  await page.click('#confirmOkBtn');
  expect((await appState(page)).logs[today]).toHaveLength(1);

  await openFood(page);
  await page.fill('#foodSearch', '地瓜');
  await page.locator('#foodResults .pick-row').first().click();
  await page.click('#gramsSaveBtn');
  await page.click('#scr-food .scr-back');
  await expect(page.locator('#confirmCancelBtn')).toHaveText('不要了');
  await page.click('#confirmCancelBtn');
  expect((await appState(page)).logs[today]).toHaveLength(1);
  await openFood(page);
  await expect(page.locator('#foodCart')).toBeHidden();
});

test('熱量密度高的食物有標示；麵粉這類乾料不標；秤克數頁也提醒', async ({ page }) => {
  await openApp(page);
  await openFood(page);
  await page.fill('#foodSearch', '芒果乾');
  const row = page.locator('#foodResults .pick-row', { hasText: '芒果乾' }).first();
  await expect(row.locator('[data-density]')).toContainText('熱量密度高・每公克 3.3 大卡');
  await page.fill('#foodSearch', '中筋麵粉');
  await expect(page.locator('#foodResults .pick-row', { hasText: '中筋麵粉' }).first()).toBeVisible();
  await expect(page.locator('#foodResults .pick-row', { hasText: '中筋麵粉' }).first().locator('[data-density]')).toHaveCount(0);
  await page.fill('#foodSearch', '芒果乾');
  await row.click();
  await expect(page.locator('#gramsResult [data-density]')).toContainText('一小份熱量就很多');
  // 白飯：不標
  await page.click('#scr-grams [data-back]');
  await page.fill('#foodSearch', '白飯');
  await page.locator('#foodResults .pick-row').first().click();
  await expect(page.locator('#gramsResult [data-density]')).toHaveCount(0);
});

test('糯米類提醒：預設不顯示；打開「我在控制血糖」後，選到粽子會提醒，滷肉飯不會', async ({ page }) => {
  await openApp(page);
  await openFood(page);
  await page.fill('#foodSearch', '肉粽');
  await expect(page.locator('#foodResults .pick-row', { hasText: '肉粽' }).first()).toBeVisible();
  await expect(page.locator('#foodResults [data-glutinous]')).toHaveCount(0);
  await page.click('#scr-food .scr-foot [data-back]');
  await openSettings(page, '[data-screen=scr-profile]');
  await page.check('#sugarCareToggle');
  await page.click('#profileSaveBtn');
  expect((await appState(page)).profile.sugarCare).toBe(true);
  await closeScreens(page);
  await openFood(page);
  await page.fill('#foodSearch', '肉粽');
  const row = page.locator('#foodResults .pick-row', { hasText: '肉粽' }).first();
  await expect(row.locator('[data-glutinous]')).toContainText('糯米類');
  await row.click();
  await expect(page.locator('#gramsResult [data-glutinous]')).toContainText('血糖上升比較快');
  await page.click('#scr-grams [data-back]');
  await page.fill('#foodSearch', '糯米椒');
  await expect(page.locator('#foodResults .pick-row', { hasText: '糯米椒' }).first().locator('[data-glutinous]')).toHaveCount(0);
  // 關掉
  await page.click('#scr-food .scr-foot [data-back]');
  await openSettings(page, '[data-screen=scr-profile]');
  await page.uncheck('#sugarCareToggle');
  await page.click('#profileSaveBtn');
  expect((await appState(page)).profile.sugarCare).toBeUndefined();
});
