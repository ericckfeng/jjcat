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

test('記錄：補記過去的日期自動標補記；晚上記晚餐會問是不是現在吃的', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 19, 23, 15) });
  await openApp(page);
  // 晚上 11 點記晚餐 → 問
  await page.click('[data-screen=scr-manual]');
  await page.click('#scr-manual [data-meal=dinner]');
  await page.fill('#foodNameInput', '雞腿便當');
  await page.fill('#foodKcalInput', '750');
  await page.click('[form=addFoodForm][type=submit]');
  await expect(page.locator('#confirmModal')).toBeVisible();
  await expect(page.locator('#confirmTitle')).toHaveText('晚餐是現在吃的嗎？');
  await page.click('#confirmOkBtn');   // 之前吃的（補記）
  let list = (await appState(page)).logs['2026-11-19'];
  expect(list.find(x => x.name === '雞腿便當').backfill).toBe(true);
  // 晚上記點心（宵夜）不問
  await page.click('[data-screen=scr-manual]');
  await page.click('#scr-manual [data-meal=snack]');
  await page.fill('#foodNameInput', '泡麵');
  await page.fill('#foodKcalInput', '400');
  await page.click('[form=addFoodForm][type=submit]');
  await expect(page.locator('#confirmModal')).toBeHidden();
  list = (await appState(page)).logs['2026-11-19'];
  expect(list.find(x => x.name === '泡麵').backfill).toBeUndefined();
  // 記到前一天 → 自動標補記，不問
  await page.click('#prevDayBtn');
  await page.click('[data-screen=scr-manual]');
  await page.click('#scr-manual [data-meal=dinner]');
  await page.fill('#foodNameInput', '牛肉麵');
  await page.fill('#foodKcalInput', '650');
  await page.click('[form=addFoodForm][type=submit]');
  await expect(page.locator('#confirmModal')).toBeHidden();
  expect((await appState(page)).logs['2026-11-18'][0].backfill).toBe(true);
});
