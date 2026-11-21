// 首頁角色：小芽＋小貓一起；做得不夠時營養師出來提醒（一天最多 2 次）；設定裡複選
import { test, expect } from '@playwright/test';
import { openApp, appState, openSettings, closeScreens } from './helpers.mjs';

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
async function seed(page, data) {
  await page.addInitScript((data) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ quickItems: [], tomb: {}, meta: { welcomed: true }, ...data }));
  }, data);
}
// 昨晚睡 5 小時＋連兩天沒排便：兩個提醒
const twoReminders = {
  targets: { kcal: 1800, ex: {} },
  logs: { [ago(0)]: [{ id: 'b', name: '饅頭', kcal: 280, meal: 'breakfast', time: '07:00', updatedAt: 1 }] },
  days: { [ago(1)]: { bowel: 0 }, [ago(0)]: { bowel: 0, sleepMin: 300, sleepBed: '01:00', sleepWake: '06:00' } }
};

test('做得不夠：營養師站前面說提醒，小芽、小貓在旁邊；點一下換下一句，說過的記下來', async ({ page }) => {
  const errors = [];
  await seed(page, twoReminders);
  await openApp(page, { errors });
  const card = page.locator('#mascotCard');
  await expect(card).toHaveClass(/mascot-doc/);
  await expect(page.locator('#mascotWho')).toHaveText('營養師：');
  await expect(page.locator('#mascotBtn .pal')).toHaveCount(3);
  await expect(page.locator('#mascotBtn .pal-sm')).toHaveCount(2);
  await page.click('#mascotBtn');
  await expect(page.locator('#mascotWho')).toHaveText('營養師：');
  await expect(page.locator('#mascotBtn')).toHaveClass(/pal-tap/);
  const seen = (await appState(page)).meta.docSeen;
  expect(seen.keys.sort()).toEqual(['constipation', 'short-sleep']);
  // 再點：換成小芽和小貓說鼓勵的話
  await page.click('#mascotBtn');
  await expect(page.locator('#mascotWho')).toHaveText('');
  await expect(card).not.toHaveClass(/mascot-doc/);
  await expect(page.locator('#mascotBtn .pal:not(.pal-sm)')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('營養師今天已經出來 2 次：新的提醒改由小芽和小貓說', async ({ page }) => {
  await seed(page, { ...twoReminders, meta: { welcomed: true, docSeen: { date: ago(0), keys: ['water-retention', 'recalc'] } } });
  await openApp(page);
  await expect(page.locator('#mascotMsg')).toContainText('只睡 5 小時');
  await expect(page.locator('#mascotWho')).toHaveText('');
  await expect(page.locator('#mascotCard')).not.toHaveClass(/mascot-doc/);
});

test('設定：三個角色可以複選；以前關掉小芽的人，小貓和營養師也是關的', async ({ page }) => {
  await seed(page, { ...twoReminders, meta: { welcomed: true, mascot: false } });
  await openApp(page);
  await expect(page.locator('#mascotCard')).toBeHidden();
  await expect(page.locator('#tipsCard')).toBeVisible();
  await openSettings(page, '[data-screen=scr-features]');
  await expect(page.locator('#mascotToggle')).not.toBeChecked();
  await expect(page.locator('#catToggle')).not.toBeChecked();
  await expect(page.locator('#docToggle')).not.toBeChecked();
  // 只勾營養師：首頁只有她說提醒
  await page.check('#docToggle');
  expect((await appState(page)).meta).toMatchObject({ mascot: false, cat: false, doc: true });
  await closeScreens(page);
  await expect(page.locator('#mascotCard')).toBeVisible();
  await expect(page.locator('#mascotWho')).toHaveText('營養師：');
  await expect(page.locator('#mascotBtn .pal')).toHaveCount(1);
  // 只勾小貓
  await openSettings(page, '[data-screen=scr-features]');
  await page.uncheck('#docToggle');
  await page.check('#catToggle');
  await closeScreens(page);
  await expect(page.locator('#mascotWho')).toHaveText('');
  await expect(page.locator('#mascotBtn .pal')).toHaveCount(1);
  await expect(page.locator('#mascotCard')).not.toHaveClass(/mascot-multi/);
});

test('手機特大字：三個角色一起出現也不會讓整頁橫移', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await seed(page, { ...twoReminders, meta: { welcomed: true, fontSize: 'xl' } });
  await openApp(page);
  await expect(page.locator('#mascotBtn .pal')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
