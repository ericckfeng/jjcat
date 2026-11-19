// 這一餐還差什麼：每餐份數分配、首頁每一餐顯示、記完一餐的提示
import { test, expect } from '@playwright/test';
import { openApp, appState } from './helpers.mjs';

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

async function seed(page, targets, logs = {}) {
  await page.addInitScript(({ targets, logs }) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ logs, days: {}, quickItems: [], tomb: {}, meta: { welcomed: true }, targets, targetsAt: 1 }));
  }, { targets, logs });
}

test('設定每餐份數：可以照每日份數平均分，三餐加起來對照每日目標，儲存後同步到 targets', async ({ page }) => {
  const errors = [];
  await seed(page, { kcal: 1500, ex: { grain: 9, prot: 5, veg: 4, oil: 4, fruit: 2, dairy: 1 } });
  await openApp(page, { errors });
  await page.click('#openTargetBtn');
  await page.click('#openMealExBtn');
  await expect(page.locator('#scr-mealex')).toBeVisible();
  await page.click('#mealExSplitBtn');
  await expect(page.locator('[data-mealex="lunch:grain"]')).toHaveValue('3');
  await expect(page.locator('[data-mealex="breakfast:veg"]')).toHaveValue('1');
  await expect(page.locator('[data-mealex="lunch:veg"]')).toHaveValue('1.5');
  await expect(page.locator('#mealExSum')).toContainText('各餐加起來 9 份，每日目標 9 份 ✓');
  // 照營養師的單子改：乳品放早餐
  await page.fill('[data-mealex="breakfast:dairy"]', '1');
  await page.fill('[data-mealex="lunch:dairy"]', '');
  await page.fill('[data-mealex="dinner:dairy"]', '');
  await page.fill('[data-mealex="breakfast:oil"]', '0');
  await page.fill('[data-mealex="lunch:oil"]', '2');
  await page.fill('[data-mealex="dinner:oil"]', '2');
  await expect(page.locator('#mealExSum')).toContainText('乳品：各餐加起來 1 份');
  await page.click('#mealExSaveBtn');
  const t = (await appState(page)).targets;
  expect(t.mealEx.lunch).toEqual({ grain: 3, prot: 2, veg: 1.5, fruit: 1, oil: 2 });
  expect(t.mealEx.breakfast.dairy).toBe(1);
  expect(t.mealEx.snack).toBeUndefined();
  expect(t.kcal).toBe(1500);
  // 每日目標視窗存檔不會弄掉每餐份數
  await page.click('#openTargetBtn');
  await page.click('#saveTargetBtn');
  expect((await appState(page)).targets.mealEx.lunch.grain).toBe(3);
  expect(errors).toEqual([]);
});

test('首頁每一餐顯示還差什麼；多的溫和提醒；沒份數的註明', async ({ page }) => {
  const today = ymd(new Date());
  await seed(page,
    { kcal: 1500, ex: {}, mealEx: { lunch: { grain: 3, prot: 2, veg: 1.5, oil: 2 } } },
    { [today]: [
      { id: 'a', name: '大腸包小腸', kcal: 520, meal: 'lunch', time: '12:00', ex: { grain: 3, prot: 2, oil: 3 }, updatedAt: 1 },
      { id: 'b', name: '紅茶', kcal: 90, meal: 'lunch', time: '12:01', updatedAt: 1 },
      { id: 'c', name: '吐司', kcal: 200, meal: 'breakfast', time: '08:00', ex: { grain: 2 }, updatedAt: 1 }
    ] });
  await openApp(page);
  const row = page.locator('[data-meal-gap=lunch]');
  await expect(row).toContainText('全穀 3/3 ✓');
  await expect(row).toContainText('午餐還可以加：蔬菜 1.5 份（1 份約半碗煮熟的青菜）');
  await expect(row).toContainText('油脂多了 1 份，下一餐清淡一點就好');
  await expect(row).toContainText('有 1 筆沒有份數，沒算進來');
  await expect(row).toContainText('油脂 3/2');
  await expect(row).not.toContainText('油脂 3/2 ✓');   // 吃多了不打勾
  await expect(page.locator('[data-meal-gap=breakfast]')).toHaveCount(0); // 早餐沒設
});

test('記完一餐的提示附上還差什麼；份數都夠了就說夠了', async ({ page }) => {
  await seed(page, { kcal: 1500, ex: {}, mealEx: { breakfast: { grain: 2, veg: 1 } } });
  await openApp(page);
  await page.click('[data-screen=scr-food]');
  await page.click('#scr-food [data-meal=breakfast]');
  await page.fill('#foodSearch', '地瓜');
  await page.locator('#foodResults [data-food-id=B0400101]').click();
  await page.fill('#gramsInput', '110');   // 全穀 2 份
  await page.click('#gramsSaveBtn');
  await page.click('#foodCartSaveBtn');
  await expect(page.locator('#toastMsg')).toContainText('早餐還可以加：蔬菜 1 份');
  await expect(page.locator('[data-meal-gap=breakfast]')).toContainText('全穀 2/2 ✓');
});
