// 和昨天一樣：前一天記過、今天還沒記的餐別，一鍵記一樣的
import { test, expect } from '@playwright/test';
import { openApp, appState } from './helpers.mjs';

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

test('記一樣的早餐：複製昨天的早餐（同組仍同組、不帶照片），可以復原', async ({ page }) => {
  const errors = [];
  const now = new Date();
  const today = ymd(now);
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const yesterday = ymd(y);
  await page.addInitScript(({ yesterday, today }) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({
      logs: {
        [yesterday]: [
          { id: 'item_a', name: '白飯 150g', kcal: 273, meal: 'breakfast', time: '07:30', groupId: 'grp_1', grams: 150, foodId: 'X1', p: 4, c: 60, f: 0.5, updatedAt: 1 },
          { id: 'item_b', name: '荷包蛋', kcal: 90, meal: 'breakfast', time: '07:30', groupId: 'grp_1', hasPhoto: true, photoKey: 'item_b', updatedAt: 1 },
          { id: 'item_c', name: '便當', kcal: 750, meal: 'lunch', time: '12:00', updatedAt: 1 }
        ],
        [today]: [{ id: 'item_d', name: '雞腿便當', kcal: 800, meal: 'lunch', time: '12:00', updatedAt: 1 }]
      },
      days: {}, quickItems: [], tomb: {}, meta: { welcomed: true }
    }));
  }, { yesterday, today });
  await openApp(page, { errors });
  const box = page.locator('#copyMealBox');
  await expect(box).toContainText('和昨天一樣的早餐');
  await expect(box).toContainText('2 樣・363 kcal');
  await expect(box.locator('[data-copy-meal=lunch]')).toHaveCount(0); // 今天午餐已經記了
  await box.locator('[data-copy-meal=breakfast]').click();
  await expect(page.locator('#copyMealBox')).toHaveCount(0);
  let list = (await appState(page)).logs[today];
  const copied = list.filter(x => x.meal === 'breakfast');
  expect(copied).toHaveLength(2);
  expect(copied[0].groupId).toBe(copied[1].groupId);
  expect(copied[0].groupId).not.toBe('grp_1');
  expect(copied.find(x => x.name === '荷包蛋')).toMatchObject({ hasPhoto: false });
  expect(copied.find(x => x.name === '荷包蛋').photoKey).toBeUndefined();
  expect(copied.find(x => x.grams === 150)).toMatchObject({ foodId: 'X1', time: '07:30' });

  await page.click('#toastAction'); // 復原
  const st = await appState(page);
  expect(st.logs[today]).toHaveLength(1);
  copied.forEach(c => expect(st.tomb['e:' + c.id]).toBeGreaterThan(0));
  await expect(page.locator('#copyMealBox')).toContainText('和昨天一樣的早餐');
  expect(errors).toEqual([]);
});
