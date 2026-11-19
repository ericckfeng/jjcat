// ⚙️ 設定：各項設定集中在一起
import { test, expect } from '@playwright/test';
import { openApp, appState, openSettings, closeScreens } from './helpers.mjs';

test('設定首頁列出六項，副標題顯示目前的狀態與版本', async ({ page }) => {
  const errors = [];
  await page.addInitScript(() => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ logs: {}, days: {}, quickItems: [], tomb: {},
      profile: { name: '王小明', sex: 'm', height: 181, birthYear: 1968 }, profileAt: 1,
      targets: { kcal: 1500, ex: {}, bank: true, mealEx: { lunch: { grain: 3 } } }, targetsAt: 1, meta: { welcomed: true, fontSize: 'xl' } }));
  });
  await openApp(page, { errors });
  await openSettings(page);
  await expect(page.locator('#scr-settings .pick-row')).toHaveCount(6);
  await expect(page.locator('#setProfileSub')).toContainText('王小明・男');
  await expect(page.locator('#setProfileSub')).toContainText('181 公分');
  await expect(page.locator('#setTargetsSub')).toHaveText('每天 1,500 kcal・有每餐份數');
  await expect(page.locator('#setFeaturesSub')).toHaveText('字體 特大・小芽 開・熱量銀行 開');
  await expect(page.locator('#setAboutSub')).toContainText('（Rev. ');
  await page.click('#scr-settings [data-screen=scr-about]');
  await expect(page.locator('#appVersionText')).toHaveText(/^版本 \d{4}\.\d{2}\.\d{2}-\d+（Rev\. \d+）$/);
  expect(errors).toEqual([]);
});

test('基本資料：存檔後體重頁的身高、性別也一樣（同一份資料）；試算頁會帶入', async ({ page }) => {
  await openApp(page);
  await openSettings(page, '[data-screen=scr-profile]');
  await page.fill('#profileName', '王小明');
  await page.click('[data-pf-sex=m]');
  await page.fill('#pfBirthYear', '1968');
  await page.fill('#pfHeight', '181');
  await page.click('[data-pf-act=light]');
  await page.click('#profileSaveBtn');
  expect((await appState(page)).profile).toMatchObject({ name: '王小明', sex: 'm', birthYear: 1968, height: 181, activity: 'light' });
  await closeScreens(page);
  await page.click('[data-screen=scr-weight]');
  await expect(page.locator('#profHeight')).toHaveValue('181');
  await expect(page.locator('#sexGroup [data-sex=m]')).toHaveClass(/is-active/);
  await closeScreens(page);
  await page.click('#openTargetBtn');
  await page.click('#openCalcBtn');
  await expect(page.locator('#calcBirthYear')).toHaveValue('1968');
  await expect(page.locator('[data-calc-act=light]')).toHaveClass(/is-active/);
});

test('功能開關：字體、小芽按下去就生效', async ({ page }) => {
  await openApp(page);
  await openSettings(page, '[data-screen=scr-features]');
  await page.click('#fontSizeGroup [data-font=xl]');
  expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe('20px');
  await page.uncheck('#mascotToggle');
  expect((await appState(page)).meta.mascot).toBe(false);
  await closeScreens(page);
  await expect(page.locator('#mascotCard')).toBeHidden();
});

test('報告分頁只剩報告和週報；雲端同步、備份在設定的資料與備份', async ({ page }) => {
  await openApp(page);
  await page.click('.mobile-nav-tab[data-tab=report]');
  await expect(page.locator('#tab-report #backupSection')).toHaveCount(0);
  await expect(page.locator('#tab-report #genReportBtn')).toBeVisible();
  await openSettings(page, '#setDataRow');
  await expect(page.locator('#scr-data #backupSection')).toBeVisible();
  await expect(page.locator('#exportJsonBtn')).toBeVisible();
});
