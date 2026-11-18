// 新裝置第一次打開：歡迎畫面讓使用者選「取回雲端資料／匯入備份檔／直接開始」
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, appState } from './helpers.mjs';

const fx = (name) => new URL('../fixtures/' + name, import.meta.url).pathname;

test('全新裝置會看到歡迎畫面；選「直接開始」後就不再出現', async ({ page }) => {
  const errors = [];
  await openApp(page, { errors, keepWelcome: true });
  await expect(page.locator('#scr-welcome')).toBeVisible();
  await page.click('#welcomeStartBtn');
  await expect(page.locator('#scr-welcome')).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  await expect(page.locator('#scr-welcome')).toBeHidden();
  expect(errors).toEqual([]);
});

test('已經有資料的裝置不會看到歡迎畫面', async ({ page }) => {
  const v1 = readFileSync(fx('backup-v1-single-file.json'), 'utf8');
  await page.addInitScript((data) => {
    if (!localStorage.getItem('diet_tracker_v2')) localStorage.setItem('daily_calorie_tracker_v1', data);
  }, v1);
  await openApp(page, { keepWelcome: true });
  await expect(page.locator('#scr-welcome')).toBeHidden();
});

test('「我有備份檔」：選檔匯入後資料進來，停在備份區', async ({ page }) => {
  await openApp(page, { keepWelcome: true });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#welcomeImportBtn')]);
  await expect(page.locator('#scr-welcome')).toBeHidden();
  await chooser.setFiles(fx('backup-v3-sync.json'));
  await page.click('#confirmOkBtn');
  await page.waitForFunction(() => /匯入完成/.test(document.getElementById('toastMsg').textContent));
  expect((await appState(page)).logs['2026-11-12']).toHaveLength(2);
  await expect(page.locator('#backupSection')).toBeVisible();
});

test('「我在別的手機／電腦用過」：前往 Google 登入', async ({ page }) => {
  await page.route('https://accounts.google.com/**', r => r.fulfill({ contentType: 'text/html', body: 'google' }));
  await openApp(page, { keepWelcome: true });
  await Promise.all([page.waitForURL(/accounts\.google\.com/), page.click('#welcomeCloudBtn')]);
  expect(page.url()).toContain('drive.file');
});

test.describe('LINE 內建瀏覽器', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Line/14.0.0' });
  test('按「用過」會說明要改用 Safari／Chrome，不會跳去 Google', async ({ page }) => {
    await openApp(page, { keepWelcome: true });
    await page.click('#welcomeCloudBtn');
    await expect(page.locator('#welcomeInAppWarn')).toBeVisible();
    await expect(page.locator('#scr-welcome')).toBeVisible();
    expect(page.url()).not.toContain('google');
  });
});
