// Google 登入過期（1 小時）：沒有正在輸入的東西時，自動跳去 Google 換新的再回來，不用使用者按
import { test, expect } from '@playwright/test';
import { openApp, appState, openSettings } from './helpers.mjs';

// 假的 Google 登入頁：prompt=none 時直接帶 token（ok）或錯誤（fail）跳回 App
async function mockGoogleLogin(page, result) {
  const seen = [];
  await page.route('https://accounts.google.com/**', (route) => {
    const u = new URL(route.request().url());
    seen.push(Object.fromEntries(u.searchParams));
    const back = new URLSearchParams({ state: u.searchParams.get('state') });
    if (result === 'ok') {
      back.set('access_token', 'new-token'); back.set('expires_in', '3600');
      back.set('scope', 'https://www.googleapis.com/auth/drive.file');
    } else back.set('error', 'interaction_required');
    return route.fulfill({ status: 302, headers: { location: u.searchParams.get('redirect_uri') + '#' + back } });
  });
  return seen;
}
async function mockDrive(page) {
  await page.route('https://www.googleapis.com/**', (route) => {
    const url = new URL(route.request().url());
    const json = (o) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (url.pathname.endsWith('/files')) {
      const q = url.searchParams.get('q') || '';
      if (q.includes("name='飲控隨身記'")) return json({ files: [{ id: 'root' }] });
      if (q.includes("name='照片'")) return json({ files: [{ id: 'photos' }] });
      return json({ files: [] });
    }
    return json({ id: 'data', modifiedTime: new Date().toISOString() });
  });
}
// 已連結雲端、開著自動同步，但登入已經過期
async function linkedExpired(page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_gdrive_token', JSON.stringify({ token: 'old', exp: 1 }));
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ meta: { welcomed: true, cloud: { linked: true, auto: true, email: 'me@example.com' } } }));
  });
}
// 跳轉中讀不到頁面，先當作還沒換好
const tokenNow = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('diet_gdrive_token') || '{}').token).catch(() => null);
async function backToApp(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test('打開 App 時登入過期：自動換新的、不跳出登入畫面，接著同步', async ({ page }) => {
  await linkedExpired(page);
  const seen = await mockGoogleLogin(page, 'ok');
  await mockDrive(page);
  await openApp(page);
  await expect.poll(() => tokenNow(page)).toBe('new-token');
  expect(seen).toHaveLength(1);
  expect(seen[0].prompt).toBe('none');
  expect(seen[0].login_hint).toBe('me@example.com');
  await expect.poll(async () => (await appState(page)).meta.cloud.lastSync || 0).toBeGreaterThan(0);
  expect((await appState(page)).meta.cloud.needAuth).toBeFalsy();
});

test('App 一直開在背景（iPad）：切回來時也會自動換登入', async ({ page }) => {
  const seen = await mockGoogleLogin(page, 'ok');
  await mockDrive(page);
  await page.addInitScript(() => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_gdrive_token', JSON.stringify({ token: 'old', exp: Date.now() + 3 * 86400e3 }));
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ meta: { welcomed: true, cloud: { linked: true, auto: true, email: 'me@example.com' } } }));
  });
  await openApp(page);
  expect(seen).toHaveLength(0);
  // 過了一小時：登入過期，再切回 App
  await page.evaluate(() => localStorage.setItem('diet_gdrive_token', JSON.stringify({ token: 'old', exp: Date.now() - 1000 })));
  await backToApp(page);
  await expect.poll(() => tokenNow(page)).toBe('new-token');
  expect(seen).toHaveLength(1);
});

test('正在輸入時不跳轉（會弄丟輸入）：只顯示需要登入', async ({ page }) => {
  const seen = await mockGoogleLogin(page, 'ok');
  await mockDrive(page);
  await page.addInitScript(() => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_gdrive_token', JSON.stringify({ token: 'old', exp: Date.now() + 3 * 86400e3 }));
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ meta: { welcomed: true, cloud: { linked: true, auto: true, email: 'me@example.com' } } }));
  });
  await openApp(page);
  await openSettings(page);
  await page.evaluate(() => localStorage.setItem('diet_gdrive_token', JSON.stringify({ token: 'old', exp: Date.now() - 1000 })));
  await backToApp(page);
  await expect.poll(async () => (await appState(page)).meta.cloud.needAuth).toBe(true);
  expect(seen).toHaveLength(0);
});

test('Google 要求自己登入：顯示需要登入，6 小時內不再自動試', async ({ page }) => {
  await linkedExpired(page);
  const seen = await mockGoogleLogin(page, 'fail');
  await mockDrive(page);
  await openApp(page);
  await expect.poll(async () => (await appState(page)).meta.cloud.needAuth).toBe(true);
  expect(seen).toHaveLength(1);
  await page.evaluate(() => localStorage.removeItem('diet_silent_at'));
  await backToApp(page);
  await page.waitForTimeout(300);
  expect(seen).toHaveLength(1);
});
