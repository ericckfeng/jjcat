// 備份提醒：沒連雲端、記了幾天沒備份 → 首頁提醒（大字）→「晚點」3 天不再出現（重開也一樣）；7 天沒備份 → 去備份；
// 連了雲端但登入過期 → 重新連結（不能晚點）。連了雲端但 7 天沒同步成功、要先更新的判斷在 tests/unit/backup.test.mjs
import { test, expect } from '@playwright/test';
import { openApp } from './helpers.mjs';

const DAY = 86400000;
async function seed(page, meta = {}) {
  await page.addInitScript((meta) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    const logs = {};
    for (let i = 0; i < 3; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      logs[k] = [{ id: 'e' + i, name: '便當', kcal: 700, meal: 'lunch', time: '12:00', updatedAt: 1 }];
    }
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ logs, days: {}, quickItems: [], tomb: {}, meta: { welcomed: true, ...meta } }));
  }, meta);
}

test('從沒備份過：提醒資料只在這支手機；按「晚點」就收起來，重開 App 也不出現', async ({ page }) => {
  await seed(page);
  await openApp(page);
  await expect(page.locator('#backupBanner')).toBeVisible();
  await expect(page.locator('#backupBannerText')).toContainText('資料只存在這支手機');
  await page.click('#snoozeBackupBtn');
  await expect(page.locator('#backupBanner')).toBeHidden();
  await expect(page.locator('#toastMsg')).toContainText('3 天後再提醒你');
  const until = await page.evaluate(() => window.__dietApp.state.meta.backupSnoozeUntil);
  expect(until - Date.now()).toBeGreaterThan(2.9 * DAY);
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  await expect(page.locator('#backupBanner')).toBeHidden();
});

test('8 天沒備份：說幾天了，按「去備份」打開資料與備份', async ({ page }) => {
  await seed(page, { lastBackup: Date.now() - 8 * DAY });
  await openApp(page);
  await expect(page.locator('#backupBannerText')).toContainText(/已經 \d+ 天沒備份了/);   // 測試把網頁時鐘固定在中午，天數可能差一天
  await expect(page.locator('#goBackupBtn')).toHaveText('去備份');
  await page.click('#goBackupBtn');
  await expect(page.locator('#scr-data')).toBeVisible();
});

test('剛備份過不提醒', async ({ page }) => {
  await seed(page, { lastBackup: Date.now() - 2 * DAY });
  await openApp(page);
  await expect(page.locator('#backupBanner')).toBeHidden();
});

// 連了雲端的測試都關掉自動同步：不然一打開就會去 Google 登入
test('連了雲端但登入過期：提醒重新連結，不能按晚點', async ({ page }) => {
  await seed(page, { cloud: { linked: true, email: 'a@example.com', auto: false, lastSync: Date.now() - DAY, needAuth: true } });
  await openApp(page);
  await expect(page.locator('#goBackupBtn')).toHaveText('重新連結');
  await expect(page.locator('#snoozeBackupBtn')).toBeHidden();
});

test('連了雲端但很久沒同步成功：提醒立即同步，可以晚點', async ({ page }) => {
  await seed(page, { cloud: { linked: true, email: 'a@example.com', auto: false, lastSync: Date.now() - 10 * DAY } });
  await openApp(page);
  await expect(page.locator('#backupBannerText')).toContainText(/已經 \d+ 天沒有同步到雲端了/);
  await expect(page.locator('#goBackupBtn')).toHaveText('立即同步');
  await expect(page.locator('#snoozeBackupBtn')).toBeVisible();
});
