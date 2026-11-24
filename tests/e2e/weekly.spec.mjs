// 小芽週報：首頁卡片、週報畫面、看過就收起來、分享文字
import { test, expect } from '@playwright/test';
import { openApp, closeScreens, openSettings } from './helpers.mjs';
import { lastWeek } from '../../js/highlights.js';

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const wk = lastWeek(ymd(new Date()));
const dayOf = (n) => { const [y, m, d] = wk.from.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };

async function seed(page, loggedDays) {
  const logs = {};
  for (let i = 0; i < loggedDays; i++) logs[dayOf(i)] = [{ id: 'e' + i, name: '便當', kcal: 1750, meal: 'lunch', time: '12:00', p: 50, c: 230, f: 55, updatedAt: 1 }];
  await page.addInitScript(({ logs, days }) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({
      logs, days, quickItems: [], tomb: {}, meta: { welcomed: true },
      targets: { kcal: 1800, p: 80, c: null, f: null, ex: {}, weight: null }, targetsAt: 1, profile: { name: '小明' }, profileAt: 1
    }));
  }, { logs, days: { [dayOf(1)]: { exMin: 40 }, [dayOf(3)]: { exMin: 30 } } });
}

test('上週有記：首頁出現週報卡片，打開看到做得好的事和下週可以試的一件事；看過就收起來', async ({ page, context }) => {
  const errors = [];
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seed(page, 6);
  await openApp(page, { errors });
  await expect(page.locator('#weeklyCard')).toBeVisible();
  await page.click('#weeklyCard');
  await expect(page.locator('#scr-weekly')).toBeVisible();
  const good = page.locator('#weeklyGood li');
  await expect(good).toHaveCount(3);
  await expect(good.nth(0)).toContainText('這週記錄了 6 天，很用心');
  await expect(good.nth(1)).toContainText('有 6 天吃得剛剛好');
  await expect(good.nth(2)).toContainText('運動了 2 天，共 70 分鐘');
  await expect(page.locator('#weeklyTry')).toContainText('每餐加一份蛋白質');
  // 分享（沒有系統分享時複製到剪貼簿）
  await page.evaluate(() => { delete navigator.share; });
  await page.click('#weeklyShareBtn');
  await expect(page.locator('#toastMsg')).toHaveText('已複製週報，貼到 LINE 即可');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^🌱 小芽週報（小明）/);
  expect(text).toContain('👉 每餐加一份蛋白質');
  await page.click('#scr-weekly .scr-foot [data-back]');
  await expect(page.locator('#weeklyCard')).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  await expect(page.locator('#weeklyCard')).toBeHidden();
  // 報告頁隨時可以打開
  await closeScreens(page); await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('#tab-report [data-screen=scr-weekly]');
  await expect(page.locator('#weeklyGood li')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('上週記不到 3 天：首頁不出現卡片；完全沒記時週報畫面說明', async ({ page }) => {
  await seed(page, 2);
  await openApp(page);
  await expect(page.locator('#weeklyCard')).toBeHidden();
  await closeScreens(page); await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('#tab-report [data-screen=scr-weekly]');
  await expect(page.locator('#weeklyTry')).toContainText('每天至少記一餐');
});

test('上週完全沒記：週報畫面顯示說明，不顯示分享', async ({ page }) => {
  await seed(page, 0);
  await openApp(page);
  await closeScreens(page); await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('#tab-report [data-screen=scr-weekly]');
  await expect(page.locator('#weeklyEmpty')).toBeVisible();
  await expect(page.locator('#weeklyShareBtn')).toBeHidden();
});

test('請我的 AI 看看這週：沒在用 AI 的人看不到；開了「用自己的 AI App」→ 摘要＋每天吃了什麼一起分享出去', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    window.__shared = [];
    navigator.share = async (d) => { window.__shared.push(d.text); };
  });
  await seed(page, 4);
  await openApp(page);
  await page.click('#weeklyCard');
  await expect(page.locator('#weeklyAiBtn')).toBeHidden();
  await closeScreens(page);
  await openSettings(page, '#aiSetupBtn');
  await page.click('#aiPasteToggle');
  await closeScreens(page);
  await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('#tab-report [data-screen=scr-weekly]');
  await page.click('#weeklyAiBtn');
  await expect(page.locator('#weeklyAiNote')).toContainText('傳好了');
  const [text] = await page.evaluate(() => window.__shared);
  expect(text).toContain('不要叫我改目標');
  expect(text).toContain('【飲食記錄摘要】小明');
  expect(text).toContain('午餐 便當 1750｜共 1750 kcal');
  expect(text).toContain('沒有記錄');   // 第 5～7 天沒記
  // 不能分享（電腦）：複製好，說明怎麼貼
  await page.evaluate(() => { delete navigator.share; });
  await page.click('#weeklyAiBtn');
  await expect(page.locator('#weeklyAiNote')).toContainText('已經複製好了');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('【每天吃了什麼】');
});
