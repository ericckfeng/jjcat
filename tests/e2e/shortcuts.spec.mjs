// 桌面捷徑：manifest 的 shortcuts 與 ?go= 網址參數
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { stubCdn } from './helpers.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../manifest.webmanifest', import.meta.url), 'utf8'));
const SCREEN = { quick: 'scr-quick', photo: 'scr-photo', water: 'scr-water', weight: 'scr-weight' };

async function seed(page, meta = {}) {
  await page.addInitScript((meta) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ logs: {}, days: {}, quickItems: [], tomb: {}, meta: { welcomed: true, ...meta } }));
  }, meta);
}
async function open(page, path) {
  await stubCdn(page);
  await page.goto(path);
  await page.waitForFunction(() => window.__dietApp);
}

test('manifest 的每個捷徑都有圖示，打開後直接到那一頁', async ({ page }) => {
  expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(4);
  for (const s of manifest.shortcuts) {
    expect(existsSync(new URL('../../' + s.icons[0].src, import.meta.url))).toBe(true);
    const go = new URL(s.url, 'https://x/jjcat/').searchParams.get('go');
    expect(SCREEN[go]).toBeTruthy();
  }
  await seed(page);
  for (const s of manifest.shortcuts) {
    const go = new URL(s.url, 'https://x/').searchParams.get('go');
    await open(page, '/' + s.url.replace('./', ''));
    await expect(page.locator('#' + SCREEN[go])).toBeVisible();
  }
});

test('打開後網址的參數拿掉；按返回回到首頁；重新整理不會再打開', async ({ page }) => {
  await seed(page);
  await open(page, '/?go=water');
  await expect(page.locator('#scr-water')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  await page.goBack();
  await expect(page.locator('#scr-water')).toBeHidden();
  await expect(page.locator('#tab-log')).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  await expect(page.locator('#scr-water')).toBeHidden();
});

test('不認得的參數、沒開 AI 時的 ?go=ai：停在首頁', async ({ page }) => {
  await seed(page);
  await open(page, '/?go=nope');
  await expect(page.locator('.screen:not(.hidden)')).toHaveCount(0);
  await open(page, '/?go=ai');
  await expect(page.locator('#scr-ai')).toBeHidden();
});

test('新裝置：先顯示歡迎畫面，不直接打開捷徑的頁面', async ({ page }) => {
  await open(page, '/?go=water');
  await expect(page.locator('#scr-welcome')).toBeVisible();
  await expect(page.locator('#scr-water')).toBeHidden();
});
