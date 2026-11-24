// 功能開關＋血壓血糖：設定裡關掉不是飲食的功能（首頁不顯示、全關整區不見）；打開血壓、血糖 → 記錄、危險數字提醒 → 報告
import { test, expect } from '@playwright/test';
import { openApp, appState, closeScreens, openSettings } from './helpers.mjs';

const todayOf = (page) => page.evaluate(() => window.__dietApp.ui.date);
async function seed(page, profile = {}) {
  await page.addInitScript((profile) => {
    if (!localStorage.getItem('diet_tracker_v2')) localStorage.setItem('diet_tracker_v2', JSON.stringify({ quickItems: [], tomb: {}, meta: { welcomed: true, fontSize: 'xl' }, profile, profileAt: 1 }));
  }, profile);
}
const tile = (page, key) => page.locator(`#bodySection [data-feature=${key}]`);

test('功能開關：血壓血糖預設關；關掉睡眠、喝水首頁就不顯示；全部關掉「記錄身體」整區不見；會存在基本資料（同步）', async ({ page }) => {
  const errors = [];
  await seed(page);
  await openApp(page, { errors });
  await expect(tile(page, 'sleep')).toBeVisible();
  await expect(tile(page, 'bp')).toBeHidden();
  await expect(tile(page, 'glucose')).toBeHidden();
  await openSettings(page, '[data-screen=scr-features]');
  await page.uncheck('[data-feature-toggle=sleep]');
  await page.uncheck('[data-feature-toggle=water]');
  await page.check('[data-feature-toggle=bp]');
  await closeScreens(page);
  await expect(tile(page, 'sleep')).toBeHidden();
  await expect(tile(page, 'water')).toBeHidden();
  await expect(tile(page, 'bp')).toBeVisible();
  const s = await appState(page);
  expect(s.profile.features).toEqual({ sleep: false, water: false, bp: true });
  expect(s.profileAt).toBeGreaterThan(1);
  // 全部關掉
  await openSettings(page, '[data-screen=scr-features]');
  for (const k of ['weight', 'exercise', 'note', 'bodycomp', 'bp']) await page.uncheck(`[data-feature-toggle=${k}]`);
  await closeScreens(page);
  await expect(page.locator('#bodySection')).toBeHidden();
  expect(errors).toEqual([]);
});

test('控制血糖的人：血糖預設打開', async ({ page }) => {
  await seed(page, { sugarCare: true });
  await openApp(page);
  await expect(tile(page, 'glucose')).toBeVisible();
  await expect(tile(page, 'bp')).toBeHidden();
});

test('血壓：記好幾次、不合理會說明、很高會提醒、可以刪；血糖：選什麼時候量、低血糖提醒；報告列平均（手機特大字不橫移）', async ({ page }) => {
  const errors = [];
  await page.setViewportSize({ width: 375, height: 800 });
  await seed(page, { features: { bp: true, glucose: true } });
  await openApp(page, { errors });
  await tile(page, 'bp').click();
  await expect(page.locator('#bpTime')).toHaveValue(/^\d\d:\d\d$/);
  expect(await page.locator('#scr-bp .scr-body').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  await page.fill('#bpSys', '80');
  await page.fill('#bpDia', '120');
  await page.click('#bpAddBtn');
  await expect(page.locator('#bpNote')).toContainText('上面的數字（收縮壓）要比下面的大');
  await page.fill('#bpSys', '135');
  await page.fill('#bpDia', '85');
  await page.fill('#bpPulse', '72');
  await page.fill('#bpTime', '07:30');
  await page.click('#bpAddBtn');
  await expect(page.locator('#bpNote')).toContainText('記下來了：135/85');
  await expect(page.locator('#bpNote')).toContainText('比 130/80 高');
  await page.fill('#bpSys', '185');
  await page.fill('#bpDia', '100');
  await page.fill('#bpTime', '21:00');
  await page.click('#bpAddBtn');
  await expect(page.locator('#bpNote')).toContainText('請馬上就醫');
  await expect(page.locator('#bpList [data-bp-del]')).toHaveCount(2);
  await expect(page.locator('#bpList')).toContainText('07:30 135/85 脈搏72');
  await page.locator('#bpList [data-bp-del]').nth(1).click();
  await expect(page.locator('#bpList [data-bp-del]')).toHaveCount(1);
  await closeScreens(page);
  await expect(page.locator('#tileBp')).toHaveText('135/85');

  await tile(page, 'glucose').click();
  await page.click('[data-gl-kind=after]');
  await page.fill('#glValue', '62');
  await page.click('#glAddBtn');
  await expect(page.locator('#glNote')).toContainText('低血糖');
  await page.click('[data-gl-kind=fasting]');
  await page.fill('#glValue', '108');
  await page.fill('#glTime', '06:30');
  await page.click('#glAddBtn');
  await expect(page.locator('#glList')).toContainText('06:30 空腹 108');
  await closeScreens(page);
  const day = (await appState(page)).days[await todayOf(page)];
  expect(day.bp).toEqual([expect.objectContaining({ t: '07:30', sys: 135, dia: 85, pulse: 72 })]);
  expect(day.glucose.map(g => [g.kind, g.v])).toEqual([['fasting', 108], ['after', 62]]);

  await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('[data-days="7"]');
  await page.click('#genReportBtn');
  await expect(page.locator('#reportArea')).toContainText('血壓平均 135/85（量了 1 次）');
  await expect(page.locator('#reportArea')).toContainText('血糖・空腹：平均 108 mg/dL');
  expect(await page.evaluate(() => window.__dietApp.lastReportText())).toContain('血糖：空腹平均 108（1 次）、飯後 2 小時平均 62（1 次）');
  expect(errors).toEqual([]);
});
