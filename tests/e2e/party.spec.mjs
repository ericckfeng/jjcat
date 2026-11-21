// 吃到飽速記 Rev. 43 拿掉：首頁沒有入口；舊版留在裝置上、還沒記下來的速記開 App 時問一次，不會默默丟掉
import { test, expect } from '@playwright/test';
import { openApp, appState } from './helpers.mjs';

// 昨天晚上 7 點開始的速記：蝦餃 3 顆＋隱形油醬 1 餐
async function seed(page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    const at = new Date(); at.setDate(at.getDate() - 1); at.setHours(19, 0, 0, 0);
    localStorage.setItem('diet_tracker_v2', JSON.stringify({
      meta: { welcomed: true, party: { tpl: 'dimsum', counts: { A1: 3, D0: 1 }, at: at.getTime() } },
      logs: {}
    }));
  });
}
const yesterday = (page) => page.evaluate(() => {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
});

test('首頁沒有吃到飽入口', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('[data-screen=scr-party]')).toHaveCount(0);
  await expect(page.locator('#scr-party')).toHaveCount(0);
});

test('舊的速記還沒記下來：問一次 → 記到開始那天的晚餐、同一組', async ({ page }) => {
  const errors = [];
  await seed(page);
  await openApp(page, { errors });
  await expect(page.locator('#confirmModal')).toBeVisible();
  await expect(page.locator('#confirmMessage')).toContainText('共 300 大卡（2 樣）');
  await expect(page.locator('#confirmMessage')).toContainText('晚餐');
  await page.click('#confirmOkBtn');
  await expect.poll(async () => (await appState(page)).meta.party).toBeUndefined();
  const st = await appState(page);
  const list = st.logs[await yesterday(page)];
  expect(list.map(x => [x.meal, x.kcal, x.party.code])).toEqual([['dinner', 150, 'A1'], ['dinner', 150, 'D0']]);
  expect(list[0].groupId).toBeTruthy();
  expect(list[0].groupId).toBe(list[1].groupId);
  // 現在看的還是今天
  expect(await page.evaluate(() => window.__dietApp.ui.date)).not.toBe(await yesterday(page));
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  await expect(page.locator('#confirmModal')).toBeHidden();
  expect(errors).toEqual([]);
});

test('舊的速記不要了：要再確認一次才刪；按「留著」下次還會問', async ({ page }) => {
  await seed(page);
  await openApp(page);
  await page.click('#confirmCancelBtn');
  await expect(page.locator('#confirmTitle')).toHaveText('不要這份速記？');
  await page.click('#confirmCancelBtn');
  expect((await appState(page)).meta.party).toBeTruthy();
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  await expect(page.locator('#confirmModal')).toBeVisible();
  await page.click('#confirmCancelBtn');
  await page.click('#confirmOkBtn');
  await expect.poll(async () => (await appState(page)).meta.party).toBeUndefined();
  expect(Object.values((await appState(page)).logs).flat()).toEqual([]);
});
