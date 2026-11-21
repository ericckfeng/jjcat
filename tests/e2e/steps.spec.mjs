// 走路步數：醫生、營養師給的每天步數下限 → 運動頁記步數 → 首頁、報告、CSV
import { test, expect } from '@playwright/test';
import { openApp, appState, openSettings, closeScreens } from './helpers.mjs';

test('設定步數下限 → 運動頁填步數，顯示還差幾步／達到了 → 首頁、報告、CSV 都有', async ({ page }) => {
  const errors = [];
  await openApp(page, { errors });
  // 還沒設下限：運動頁說明可以去哪裡設
  await page.click('[data-screen=scr-exercise]');
  await expect(page.locator('#stepsGoalText')).toContainText('每日目標');
  await closeScreens(page);

  await openSettings(page, '[data-screen=scr-targets]');
  await page.fill('#tgt-steps', '100');
  await page.click('#saveTargetBtn');
  await expect(page.locator('#toastMsg')).toContainText('步數下限請填 500～50000');
  await page.click('#toastAction');
  await page.fill('#tgt-steps', '6000');
  await page.click('#saveTargetBtn');
  expect((await appState(page)).targets.steps).toBe(6000);
  await closeScreens(page);
  await expect(page.locator('#tileExercise')).toHaveText('目標 6,000 步');

  await page.click('[data-screen=scr-exercise]');
  await expect(page.locator('#stepsGoalText')).toHaveText('每天至少走 6,000 步');
  await page.fill('#daySteps', '4800');
  await expect(page.locator('#stepsGoalText')).toContainText('還差 1,200 步');
  await page.fill('#daySteps', '6500');
  await expect(page.locator('#stepsGoalText')).toContainText('達到每天 6,000 步了');
  await page.click('[data-ex-preset=散步]');
  await page.click('#scr-exercise .scr-foot button');
  const st = await appState(page);
  const today = await page.evaluate(() => window.__dietApp.ui.date);
  expect(st.days[today].steps).toBe(6500);
  expect(st.days[today]._t.steps).toBeGreaterThan(0);   // 每日欄位有時間戳，同步逐欄位合併
  await expect(page.locator('#tileExercise')).toHaveText('6,500 步 ✓・散步');

  // 報告：統計、每日表格有步數
  await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('#genReportBtn');
  await expect(page.locator('#reportArea')).toContainText('平均步數');
  await expect(page.locator('#reportArea')).toContainText('下限 6,000 步・達到 1 天');
  await expect(page.locator('#reportArea th', { hasText: '步數' })).toHaveCount(1);

  // CSV 最後一欄是步數
  await openSettings(page, '#setDataRow');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportDaysCsvBtn')]);
  const csv = Buffer.concat(await (await dl.createReadStream()).toArray()).toString();
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  expect(lines[0].endsWith(',步數')).toBe(true);
  expect(lines.find(l => l.startsWith(today)).endsWith(',6500')).toBe(true);
  expect(errors).toEqual([]);
});
