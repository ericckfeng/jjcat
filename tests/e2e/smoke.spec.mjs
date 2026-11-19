// 主要流程：每個全螢幕輸入頁都能存資料，報告能產生，沒有任何 JS 錯誤
import { test, expect } from '@playwright/test';
import { openApp, appState, closeScreens, openSettings } from './helpers.mjs';

test('記錄吃的、身體、睡眠，並產生報告', async ({ page }) => {
  const errors = [];
  await openApp(page, { errors });
  const today = await page.evaluate(() => window.__dietApp.ui.date);

  await page.click('[data-screen=scr-manual]');
  await page.click('#scr-manual [data-meal=lunch]');
  await page.fill('#foodNameInput', '雞腿便當');
  await page.fill('#foodKcalInput', '400');
  await page.click('[data-portion="2"]');
  await page.click('#scr-manual .scr-foot button');

  await page.click('[data-screen=scr-quick]');
  await page.click('#quickPickList .pick-row >> nth=0');
  await page.click('#scr-quick .scr-foot [data-back]');

  await page.click('[data-screen=scr-est]');
  for (const id of ['grain', 'grain', 'protMid', 'veg']) await page.click(`[data-est=${id}]`);
  await page.click('#applyEstimateBtn');

  await page.click('[data-screen=scr-weight]');
  await page.fill('#profHeight', '168');
  await page.fill('#dayWeight', '70.6');
  await expect(page.locator('#bmiCard')).toContainText('25');
  await page.click('#scr-weight .scr-foot [data-back]');

  await page.click('[data-screen=scr-sleep]');
  await page.fill('#sleepBed', '23:30');
  await page.fill('#sleepWake', '07:00');
  await page.locator('#sleepWake').blur();
  await expect(page.locator('#sleepDur')).toHaveText('7 小時 30 分');
  await page.click('[data-nap="30"]');
  await page.click('#scr-sleep .scr-foot [data-back]');

  const s = await appState(page);
  const kcals = s.logs[today].map(i => i.kcal);
  expect(kcals).toContain(800);
  expect(s.days[today]).toMatchObject({ weight: 70.6, sleepMin: 450 });
  expect(s.days[today].naps).toHaveLength(1);
  expect(s.days[today]._t.sleepMin).toBeGreaterThan(0);
  expect(s.logs[today].every(i => i.updatedAt > 0)).toBe(true);

  await closeScreens(page); await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('#genReportBtn');
  await expect(page.locator('#reportArea')).toContainText('每日總表');
  expect(errors).toEqual([]);
});

test('刪除會留下刪除標記，復原會移除', async ({ page }) => {
  await openApp(page);
  const today = await page.evaluate(() => window.__dietApp.ui.date);
  await page.click('[data-screen=scr-quick]');
  await page.click('#quickPickList .pick-row >> nth=0');
  await page.click('#scr-quick .scr-foot [data-back]');
  const id = (await appState(page)).logs[today][0].id;
  await page.click(`[data-del-id="${id}"]`);
  expect((await appState(page)).tomb['e:' + id]).toBeGreaterThan(0);
  await page.click('#toastAction');
  const s = await appState(page);
  expect(s.tomb['e:' + id]).toBeUndefined();
  expect(s.logs[today]).toHaveLength(1);
});
