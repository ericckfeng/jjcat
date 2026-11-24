// 營養師的叮嚀：貼上營養師說的話 → 拆成一條一條（可以改、拿掉）→ 存起來 → 首頁卡片每天 2 條、按「做到了」
// → 報告列出每一條做到幾天；「不用再提醒」後不出現在首頁
import { test, expect } from '@playwright/test';
import { openApp, appState, closeScreens } from './helpers.mjs';

const todayOf = (page) => page.evaluate(() => window.__dietApp.ui.date);

test('貼上 → 整理 → 存起來 → 首頁做到了 → 報告做到幾天 → 不用再提醒（手機特大字不橫移）', async ({ page }) => {
  const errors = [];
  await page.setViewportSize({ width: 375, height: 800 });
  await page.addInitScript(() => {
    if (!localStorage.getItem('diet_tracker_v2')) localStorage.setItem('diet_tracker_v2', JSON.stringify({ quickItems: [], tomb: {}, meta: { welcomed: true, fontSize: 'xl' } }));
  });
  await openApp(page, { errors });
  await expect(page.locator('#adviceCard')).toBeHidden();   // 還沒有叮嚀

  await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('#tab-report [data-screen=scr-advice]');
  await expect(page.locator('#adviceList')).toContainText('還沒有');
  await page.fill('#advicePaste', '您好！\n1. 午餐便當多一份青菜\n2. 晚餐飯吃半碗\n3. 少喝含糖飲料，改無糖茶\n加油');
  await page.fill('#adviceFrom', '王營養師');
  await page.click('#adviceSplitBtn');
  await expect(page.locator('[data-advice-edit]')).toHaveCount(3);
  await page.fill('[data-advice-edit="1"]', '晚餐飯吃半碗就好');
  await page.click('[data-advice-drop="2"]');
  await expect(page.locator('#adviceSaveBtn')).toHaveText('存起來（2 條）');
  expect(await page.locator('#scr-advice .scr-body').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  await page.click('#adviceSaveBtn');
  await expect(page.locator('#adviceNote')).toContainText('存好了 2 條');
  await expect(page.locator('#adviceList')).toContainText('晚餐飯吃半碗就好');
  await expect(page.locator('#adviceList')).toContainText('王營養師');
  let s = await appState(page);
  expect(s.advice.map(a => a.text).sort()).toEqual(['午餐便當多一份青菜', '晚餐飯吃半碗就好']);
  expect(s.advice[0]).toMatchObject({ from: '王營養師', date: await todayOf(page), active: true });
  // 同樣的再存一次不會重複
  await page.fill('#advicePaste', '午餐便當多一份青菜');
  await page.click('#adviceSplitBtn');
  await page.click('#adviceSaveBtn');
  await expect(page.locator('#adviceNote')).toContainText('存好了 0 條（1 條已經有了）');
  await closeScreens(page);

  // 首頁：兩條都在，按做到了
  await page.click('.mobile-nav-tab[data-tab=log]');
  await expect(page.locator('#adviceCard')).toBeVisible();
  await expect(page.locator('#adviceToday li')).toHaveCount(2);
  const veg = s.advice.find(a => a.text.startsWith('午餐')).id;
  await page.click(`[data-advice-done="${veg}"]`);
  await expect(page.locator(`[data-advice-done="${veg}"]`)).toHaveText('✓ 做到了');
  s = await appState(page);
  expect(s.days[await todayOf(page)].adviceDone).toEqual([veg]);

  // 報告：做到幾天
  await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('[data-days="7"]');
  await page.click('#genReportBtn');
  await expect(page.locator('#reportArea')).toContainText('營養師的叮嚀・做到幾天');
  await expect(page.locator('#reportArea')).toContainText('午餐便當多一份青菜　1 / 1 天');
  expect(await page.evaluate(() => window.__dietApp.lastReportText())).toContain('・晚餐飯吃半碗就好 0/1 天');

  // 不用再提醒：首頁只剩一條；可以再提醒
  await page.click('#tab-report [data-screen=scr-advice]');
  await page.click(`[data-advice-off="${veg}"]`);
  await expect(page.locator('#adviceOff')).toBeVisible();
  await closeScreens(page);
  await page.click('.mobile-nav-tab[data-tab=log]');
  await expect(page.locator('#adviceToday li')).toHaveCount(1);
  expect(errors).toEqual([]);
});
