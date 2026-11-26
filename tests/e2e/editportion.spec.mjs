// 修改記錄時改份量：看得到原本一份多少，改克數／份數熱量和營養素自動換算
import { test, expect } from '@playwright/test';
import { openApp, appState } from './helpers.mjs';

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function seed(page, items, customFoods = []) {
  const today = ymd(new Date());
  return page.addInitScript(({ today, items, customFoods }) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({
      logs: { [today]: items }, customFoods, days: {}, quickItems: [], tomb: {}, meta: { welcomed: true }
    }));
  }, { today, items, customFoods }).then(() => today);
}

test('我的食物記的克數：顯示一份多少，改克數自動換算、名稱跟著改', async ({ page }) => {
  const today = await seed(page,
    [{ id: 'item_a', name: '雞胸肉 150g', kcal: 240, meal: 'lunch', time: '12:00', p: 31, c: 0, f: 3.3, ex: { prot: 4 }, fiber: 1, grams: 150, customFoodId: 'cf_1', updatedAt: 1 }],
    [{ id: 'cf_1', name: '雞胸肉', per100g: { kcal: 160, p: 20.7, c: 0, f: 2.2 }, serving: { g: 100 }, updatedAt: 1 }]);
  await openApp(page);
  await page.click('[data-edit-id=item_a]');
  await expect(page.locator('#editPortion')).toBeVisible();
  await expect(page.locator('#editPortionInput')).toHaveValue('150');
  await expect(page.locator('#editPortionRef')).toContainText('一份 100 g');
  await expect(page.locator('#editPortionRef')).toContainText('每 100 g 約 160 kcal');
  await page.fill('#editPortionInput', '200');
  await expect(page.locator('#editLogKcalInput')).toHaveValue('320');
  await expect(page.locator('#edit-p')).toHaveValue('41.3');
  await expect(page.locator('#editLogNameInput')).toHaveValue('雞胸肉 200g');
  await page.click('#editPortionChips [data-portion-set="50"]');   // 半份
  await expect(page.locator('#editLogKcalInput')).toHaveValue('80');
  await page.click('#editLogForm [type=submit]');
  const it = (await appState(page)).logs[today][0];
  expect(it).toMatchObject({ name: '雞胸肉 50g', kcal: 80, p: 10.3, f: 1.1, grams: 50, ex: { prot: 1.3 }, fiber: 0.3 });
});

test('以份計的、自己輸入的都能改份數；自己改了熱量之後照新的數字換算', async ({ page }) => {
  const today = await seed(page, [
    { id: 'item_s', name: '茶葉蛋 1 份', kcal: 75, meal: 'breakfast', time: '08:00', p: 7, c: 0.5, f: 5, servings: 1, updatedAt: 1 },
    { id: 'item_m', name: '滷肉飯', kcal: 500, meal: 'lunch', time: '12:00', p: null, c: null, f: null, multiplier: 1, updatedAt: 1 }
  ]);
  await openApp(page);
  await page.click('[data-edit-id=item_s]');
  await expect(page.locator('#editPortionUnit')).toHaveText('份');
  await page.click('#editPortionChips [data-portion-set="2"]');
  await expect(page.locator('#editLogKcalInput')).toHaveValue('150');
  await expect(page.locator('#editLogNameInput')).toHaveValue('茶葉蛋 2 份');
  await page.click('#editLogForm [type=submit]');
  await page.click('[data-edit-id=item_m]');
  await page.fill('#editLogKcalInput', '600');   // 自己改：一份其實 600
  await page.fill('#editPortionInput', '0.5');
  await expect(page.locator('#editLogKcalInput')).toHaveValue('300');
  await page.click('#editLogForm [type=submit]');
  const logs = (await appState(page)).logs[today];
  expect(logs.find(x => x.id === 'item_s')).toMatchObject({ kcal: 150, p: 14, servings: 2 });
  expect(logs.find(x => x.id === 'item_m')).toMatchObject({ name: '滷肉飯', kcal: 300, multiplier: 0.5 });
});

test('拍照待查還沒有熱量的不顯示份量', async ({ page }) => {
  await seed(page, [{ id: 'item_q', name: '午餐拍照待查', kcal: 0, meal: 'lunch', time: '12:00', pending: true, updatedAt: 1 }]);
  await openApp(page);
  await page.click('[data-edit-id=item_q]');
  await expect(page.locator('#editPortion')).toBeHidden();
});
