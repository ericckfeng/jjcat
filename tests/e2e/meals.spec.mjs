// 吃的和前幾天一樣？：選餐別（預設是現在該記的那一餐），左右滑前 7 天同一餐的卡片，按一下整餐放進來
import { test, expect } from '@playwright/test';
import { openApp, appState } from './helpers.mjs';

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const wd = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return '星期' + WD[d.getDay()]; };

async function seed(page, logs, meta = {}) {
  await page.addInitScript(({ logs, meta }) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ logs, days: {}, quickItems: [], tomb: {}, meta: { welcomed: true, ...meta } }));
  }, { logs, meta });
}

test('中午預設午餐：前幾天的午餐一天一張卡，昨天在最前面；按一下整餐放進來（同組仍同組、不帶照片），可以復原', async ({ page }) => {
  const errors = [];
  await seed(page, {
    [ago(1)]: [
      { id: 'a', name: '白飯 150g', kcal: 273, meal: 'lunch', time: '12:30', groupId: 'grp_1', grams: 150, foodId: 'X1', p: 4, c: 60, f: 0.5, updatedAt: 1 },
      { id: 'b', name: '荷包蛋', kcal: 90, meal: 'lunch', time: '12:30', groupId: 'grp_1', hasPhoto: true, photoKey: 'b', updatedAt: 1 },
      { id: 'c', name: '吐司', kcal: 200, meal: 'breakfast', time: '07:00', updatedAt: 1 }
    ],
    [ago(3)]: [{ id: 'd', name: '牛肉麵', kcal: 650, meal: 'lunch', time: '12:00', updatedAt: 1 }],
    [ago(8)]: [{ id: 'e', name: '太久以前的便當', kcal: 700, meal: 'lunch', updatedAt: 1 }]
  });
  await openApp(page, { errors });   // 時鐘固定在中午 12 點
  const box = page.locator('#copyMealBox');
  await expect(box.locator('.meal-btn.is-active')).toHaveText('午餐');
  const cards = box.locator('.copy-card');
  await expect(cards).toHaveCount(2);   // 第 8 天前的不算
  await expect(cards.nth(0)).toContainText('昨天・' + wd(1));
  await expect(cards.nth(0)).toContainText('2 樣・363 kcal');
  await expect(cards.nth(1)).toContainText(wd(3));
  await expect(cards.nth(1)).toContainText('牛肉麵');
  await expect(box).toContainText('左右滑看前幾天');

  await cards.nth(0).click();
  await expect(page.locator('#toast')).toContainText('多的或少的請到記錄區增加或刪除');
  const copied = (await appState(page)).logs[ago(0)];
  expect(copied).toHaveLength(2);
  expect(copied.every(x => x.meal === 'lunch')).toBe(true);
  expect(copied[0].groupId).toBe(copied[1].groupId);
  expect(copied[0].groupId).not.toBe('grp_1');
  expect(copied.find(x => x.name === '荷包蛋')).toMatchObject({ hasPhoto: false });
  expect(copied.find(x => x.name === '荷包蛋').photoKey).toBeUndefined();
  expect(copied.find(x => x.grams === 150)).toMatchObject({ foodId: 'X1', time: '12:30' });
  // 已經記了午餐還是可以再放（加在後面），會提醒
  await expect(box).toContainText('這一餐已經有記錄');

  await page.click('#toastAction'); // 復原
  const st = await appState(page);
  expect(st.logs[ago(0)]).toHaveLength(0);
  expect(Object.keys(st.tomb).filter(k => k.startsWith('e:'))).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('可以改選別的餐：換早餐就列前幾天的早餐，放進來記成早餐；沒有的餐會說前 7 天沒有', async ({ page }) => {
  await seed(page, {
    [ago(2)]: [{ id: 'c', name: '蛋餅', kcal: 300, meal: 'breakfast', updatedAt: 1 }, { id: 'l', name: '便當', kcal: 700, meal: 'lunch', updatedAt: 1 }]
  });
  await openApp(page);
  const box = page.locator('#copyMealBox');
  await box.locator('[data-meal=snack]').click();
  await expect(box).toContainText('前 7 天沒有記點心');
  await box.locator('[data-meal=breakfast]').click();
  await expect(box.locator('.meal-btn.is-active')).toHaveText('早餐');
  await expect(box.locator('.copy-card')).toHaveCount(1);
  await expect(box.locator('.copy-card')).toContainText(wd(2));
  await box.locator('.copy-card').click();
  const list = (await appState(page)).logs[ago(0)];
  expect(list.map(x => [x.name, x.meal])).toEqual([['蛋餅', 'breakfast']]);
});

test('卡片左右滑：手機特大字也不會讓整頁橫移；前 7 天都沒記錄就不顯示', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const logs = {};
  for (let i = 1; i <= 7; i++) logs[ago(i)] = [{ id: 'l' + i, name: '一個名字非常非常長的午餐便當加滷蛋加青菜 ' + i, kcal: 600, meal: 'lunch', updatedAt: 1 }];
  await seed(page, logs, { fontSize: 'xl' });
  await openApp(page);
  await expect(page.locator('#copyMealBox .copy-card')).toHaveCount(7);
  expect(await page.locator('.copy-strip').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('前 7 天都沒有記錄：不顯示', async ({ page }) => {
  await seed(page, { [ago(9)]: [{ id: 'x', name: '便當', kcal: 700, meal: 'lunch', updatedAt: 1 }] });
  await openApp(page);
  await expect(page.locator('#copyMealBox')).toHaveCount(0);
});
