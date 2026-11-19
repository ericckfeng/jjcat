// 版本：有新版會提示更新；雲端資料要求較新版時暫停同步；關於頁列出每台裝置的版本
import { test, expect } from '@playwright/test';
import { openApp, appState, openSettings } from './helpers.mjs';

const appRev = (page) => page.evaluate(async () => (await import('./js/version.js')).APP_REV);

async function mockLatest(page, latest) {
  await page.route('**/version.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(latest) }));
}

// 假的 Google 雲端硬碟：只有「飲控隨身記」資料夾、照片資料夾、一個同步檔
async function mockDrive(page, remote) {
  const drive = { data: remote, uploads: [] };
  await page.route('https://www.googleapis.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (o) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (req.method() === 'GET' && url.pathname.endsWith('/files')) {
      const q = url.searchParams.get('q') || '';
      if (q.includes("name='飲控隨身記'")) return json({ files: [{ id: 'root' }] });
      if (q.includes("name='照片'")) return json({ files: [{ id: 'photos' }] });
      if (q.includes('飲控隨身記備份.json')) return json({ files: drive.data ? [{ id: 'data', modifiedTime: '2026-11-19T00:00:00Z' }] : [] });
      return json({ files: [] });
    }
    if (req.method() === 'GET' && url.pathname.endsWith('/files/data')) return json(drive.data);
    if (url.pathname.includes('/upload/')) {
      const body = req.postData() || '';
      const m = body.match(/\{"app":"diet-tracker"[\s\S]*\}(?=\r\n--)/);
      drive.uploads.push(m ? JSON.parse(m[0]) : null);
      return json({ id: 'data', modifiedTime: new Date().toISOString() });
    }
    return json({});
  });
  return drive;
}
// 開 App 前先當作已經連結 Google 雲端（關掉自動同步，由測試按「立即同步」）
async function linkCloud(page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_gdrive_token', JSON.stringify({ token: 't', exp: Date.now() + 3600e3 }));
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ meta: { welcomed: true, cloud: { linked: true, auto: false } } }));
  });
}

test('網站上有新版：首頁提示更新，關於頁也顯示；一樣新就顯示已是最新', async ({ page }) => {
  await mockLatest(page, { rev: 9999, ver: '2099.01.01-1' });
  await openApp(page);
  await expect(page.locator('#updateBanner')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#updateBannerText')).toContainText('2099.01.01-1');
  await openSettings(page);
  await page.click('[data-screen=scr-about]');
  await expect(page.locator('#appLatestText')).toContainText('有新版本：2099.01.01-1（Rev. 9999）');
  await expect(page.locator('#aboutUpdateBtn')).toBeVisible();
});

test('已經是最新版：不提示', async ({ page }) => {
  await page.route('**/version.json', async r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ rev: 1, ver: '' }) }));
  await openApp(page);
  const rev = await appRev(page);
  await page.unroute('**/version.json');
  await mockLatest(page, { rev, ver: 'x' });
  await openSettings(page);
  await page.click('[data-screen=scr-about]');
  await expect(page.locator('#appLatestText')).toHaveText('✓ 已經是最新版');
  await expect(page.locator('#updateBanner')).toBeHidden();
});

test('同步：記下這台的版本，關於頁列出裝置；雲端要求較新版時暫停同步、不上傳', async ({ page }) => {
  await mockLatest(page, { rev: 1, ver: '' });
  const drive = await mockDrive(page, {
    app: 'diet-tracker', version: 3, logs: {}, days: {}, quickItems: [], tomb: {},
    devices: [{ id: 'dev_other', rev: 30, ver: '', name: '家裡電腦', updatedAt: Date.now() - 3 * 86400000 }]
  });
  await linkCloud(page);
  await openApp(page);
  const rev = await appRev(page);
  await openSettings(page);
  await page.click('[data-screen=scr-data]');
  await page.click('#cloudSyncBtn');
  await expect.poll(() => drive.uploads.length).toBe(1);
  const up = drive.uploads[0];
  const me = (await appState(page)).meta.deviceId;
  expect(up.devices.map(d => d.id).sort()).toEqual(['dev_other', me].sort());
  expect(up.devices.find(d => d.id === me).rev).toBe(rev);

  await page.unroute('**/version.json');
  await mockLatest(page, { rev, ver: 'x' });
  await page.click('#scr-data [data-back]');
  await page.click('[data-screen=scr-about]');
  await expect(page.locator('#devicesList > div')).toHaveCount(2);
  await expect(page.locator('#devicesList > div').first()).toContainText('這台');
  await expect(page.locator('#devicesList > div').nth(1)).toContainText('家裡電腦');
  await expect(page.locator('#devicesList > div').nth(1)).toContainText('⚠ 要更新');
  await page.fill('#deviceNameInput', '媽媽的手機');
  await page.locator('#deviceNameInput').blur();
  await expect(page.locator('#devicesList > div').first()).toContainText('媽媽的手機');

  // 雲端是更新版 App 寫的：不合併、不上傳，提示更新
  drive.data = { ...up, minRev: { rev: rev + 1, updatedAt: Date.now() } };
  await page.evaluate(() => { window.__dietApp.state.meta.cloud.knownModified = 'old'; });
  await page.click('#scr-about [data-back]');
  await page.click('[data-screen=scr-data]');
  await page.click('#cloudSyncBtn');
  await expect(page.locator('#cloudStatus')).toContainText('需要較新版的 App');
  expect(drive.uploads.length).toBe(1);
  expect((await appState(page)).minRev).toBeUndefined();
  await page.click('#scr-data [data-back]');
  await page.click('#scr-settings [data-back]');
  await expect(page.locator('#updateBannerText')).toContainText('要更新才能繼續同步');
});

test('匯入較新版 App 做的備份檔：請先更新，不匯入', async ({ page }) => {
  await openApp(page);
  const rev = await appRev(page);
  await openSettings(page);
  await page.click('[data-screen=scr-data]');
  await page.setInputFiles('#importJsonInput', {
    name: 'new.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'diet-tracker', version: 3, minRev: { rev: rev + 1, updatedAt: 1 }, logs: { '2026-11-01': [{ id: 'e1', name: '飯', kcal: 280, meal: 'lunch' }] } }))
  });
  await expect(page.locator('#toastMsg')).toContainText('請先更新 App');
  expect((await appState(page)).logs['2026-11-01']).toBeUndefined();
});
