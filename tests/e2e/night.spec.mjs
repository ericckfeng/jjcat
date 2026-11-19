// 夜間進食：只記錄給營養師看；補記的不算
import { test, expect } from '@playwright/test';
import { openApp, appState } from './helpers.mjs';

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };

test('報告：夜間進食的天數、筆數、熱量，每日總表一欄；早餐和補記的不算；不放進本週重點', async ({ page }) => {
  const errors = [];
  await page.addInitScript(({ logs }) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ logs, days: {}, quickItems: [], tomb: {}, meta: { welcomed: true }, targets: { kcal: 1800, ex: {} }, targetsAt: 1 }));
  }, { logs: {
    [ago(3)]: [{ id: 'a', name: '鹹酥雞', kcal: 450, meal: 'snack', time: '23:10', updatedAt: 1 }, { id: 'b', name: '便當', kcal: 700, meal: 'dinner', time: '18:30', updatedAt: 1 }],
    [ago(2)]: [{ id: 'c', name: '便當', kcal: 700, meal: 'dinner', time: '23:40', backfill: true, updatedAt: 1 }, { id: 'd', name: '吐司', kcal: 200, meal: 'breakfast', time: '06:20', updatedAt: 1 }],
    [ago(1)]: [{ id: 'e', name: '泡麵', kcal: 400, meal: 'snack', time: '00:30', updatedAt: 1 }]
  } });
  await openApp(page, { errors });
  await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('[data-days="7"]');
  await page.click('#genReportBtn');
  const area = page.locator('#reportArea');
  await expect(area.locator('.stats').first()).toContainText('夜間進食');
  await expect(area.locator('.stats').first()).toContainText('2 天');
  await expect(area.locator('.stats').first()).toContainText('2 筆・共 850 kcal');
  await expect(area.locator('thead')).toContainText('夜間(kcal)');
  await expect(area.locator('.hl')).not.toContainText('夜間');
  const text = await page.evaluate(() => window.__dietApp.lastReportText());
  expect(text).toContain('夜間進食（22:00～07:00）2 天、2 筆、共 850 kcal');
  expect(errors).toEqual([]);
});

test('沒有夜間進食時，報告不出現這一格和這一欄', async ({ page }) => {
  await page.addInitScript(({ logs }) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ logs, days: {}, quickItems: [], tomb: {}, meta: { welcomed: true }, targets: { kcal: 1800, ex: {} }, targetsAt: 1 }));
  }, { logs: { [ago(1)]: [{ id: 'a', name: '便當', kcal: 700, meal: 'lunch', time: '12:00', updatedAt: 1 }] } });
  await openApp(page);
  await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('[data-days="7"]');
  await page.click('#genReportBtn');
  await expect(page.locator('#reportArea')).not.toContainText('夜間');
});

async function addManual(page, meal, name, kcal) {
  await page.click('[data-screen=scr-manual]');
  await page.click(`#scr-manual [data-meal=${meal}]`);
  await page.fill('#foodNameInput', name);
  await page.fill('#foodKcalInput', String(kcal));
  await page.click('[form=addFoodForm][type=submit]');
}

test('晚上記的會問是不是現在吃的；不是就選大約幾點，記錄時間改成吃的時間', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 19, 23, 15) });
  await openApp(page);
  await addManual(page, 'dinner', '雞腿便當', 750);
  await expect(page.locator('#whenModal')).toBeVisible();
  await expect(page.locator('#whenMsg')).toContainText('晚餐・雞腿便當（現在 23:15）');
  await page.click('#whenEarlierBtn');
  await expect(page.locator('#whenChips [data-when]')).toHaveCount(6);
  await page.click('#whenChips [data-when="19:00"]');
  await page.click('#whenOkBtn');
  await expect(page.locator('#whenModal')).toBeHidden();
  let it = (await appState(page)).logs['2026-11-19'].find(x => x.name === '雞腿便當');
  expect(it.time).toBe('19:00');
  expect(it.backfill).toBeUndefined();
  // 宵夜：選「是，現在吃的」→ 時間不變
  await addManual(page, 'snack', '泡麵', 400);
  await expect(page.locator('#whenModal')).toBeVisible();
  await expect(page.locator('#toast')).toBeHidden();       // 提示先收起來，不擋按鈕
  await page.click('#whenNowBtn');
  await expect(page.locator('#toastMsg')).toContainText('已加入「泡麵」');
  it = (await appState(page)).logs['2026-11-19'].find(x => x.name === '泡麵');
  expect(it.time).toBe('23:15');
  // 記到過去的日期：不問，自動標補記
  await page.click('#prevDayBtn');
  await addManual(page, 'dinner', '牛肉麵', 650);
  await expect(page.locator('#whenModal')).toBeHidden();
  expect((await appState(page)).logs['2026-11-18'][0].backfill).toBe(true);
});

test('過了午夜補記前一天的晚餐：選了晚上的時間就搬回前一天', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 20, 0, 30) });
  await openApp(page);
  await addManual(page, 'dinner', '滷肉飯', 600);
  await page.click('#whenEarlierBtn');
  await page.fill('#whenTime', '19:30');
  await page.click('#whenOkBtn');
  await expect(page.locator('#toastMsg')).toContainText('已記到 11/19 晚餐（19:30）');
  const st = await appState(page);
  expect(st.logs['2026-11-20']).toBeUndefined();
  expect(st.logs['2026-11-19'].find(x => x.name === '滷肉飯').time).toBe('19:30');
});

test('白天記的不問', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 19, 12, 30) });
  await openApp(page);
  await addManual(page, 'lunch', '便當', 700);
  await expect(page.locator('#whenModal')).toBeHidden();
});
