// 份數、營養素可以有小數：自動算出的 0.7 份記錄要能修改，自己輸入也能填 0.3 份
import { test, expect } from '@playwright/test';
import { openApp, appState } from './helpers.mjs';

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

test('有小數份數的記錄可以修改並儲存', async ({ page }) => {
  const today = ymd(new Date());
  await page.addInitScript((today) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({
      logs: { [today]: [{ id: 'item_a', name: '鮭魚 30g', kcal: 60, meal: 'lunch', time: '12:00', p: 6.3, c: 0, f: 4.1, ex: { prot: 0.7 }, grams: 30, updatedAt: 1 }] },
      days: {}, quickItems: [], tomb: {}, meta: { welcomed: true }
    }));
  }, today);
  await openApp(page);
  await page.click('[data-edit-id=item_a]');
  await expect(page.locator('#edit-ex-prot')).toHaveValue('0.7');
  await page.fill('#editLogNameInput', '鮭魚 30g（午餐）');
  await page.fill('#edit-ex-veg', '0.3');
  await page.fill('#edit-p', '6.25');
  await page.click('#editLogForm [type=submit]');
  const it = (await appState(page)).logs[today][0];
  expect(it).toMatchObject({ name: '鮭魚 30g（午餐）', p: 6.25, ex: { prot: 0.7, veg: 0.3 } });
});

test('自己輸入可以填小數份數', async ({ page }) => {
  await openApp(page);
  const today = await page.evaluate(() => window.__dietApp.ui.date);
  await page.click('[data-screen=scr-manual]');
  await page.fill('#foodNameInput', '燙青菜');
  await page.fill('#foodKcalInput', '30');
  await page.click('#addMore summary');
  await page.click('#addNutrDetails summary');
  await page.fill('#add-ex-veg', '0.8');
  await page.fill('#add-ex-oil', '0.3');
  await page.click('[form=addFoodForm][type=submit]');
  const it = (await appState(page)).logs[today].find(x => x.name === '燙青菜');
  expect(it).toMatchObject({ kcal: 30, ex: { veg: 0.8, oil: 0.3 } });
});

test('營養素、份數、目標、克數欄位都接受任意小數', async ({ page }) => {
  await openApp(page);
  const bad = await page.evaluate(() => {
    const ids = ['add-p', 'add-ex-veg', 'edit-c', 'edit-ex-prot', 'mf-servingG', 'mf-kcal', 'mf-f', 'mf-na', 'mf-ex-grain', 'tgt-ex-veg', 'tgt-p', 'gramsInput'];
    return ids.filter(id => { const el = document.getElementById(id); el.value = '1.37'; return !el.checkValidity(); });
  });
  expect(bad).toEqual([]);
});
