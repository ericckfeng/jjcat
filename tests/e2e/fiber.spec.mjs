// 營養師報告的膳食纖維：只算有纖維資料的記錄，說明涵蓋多少
import { test, expect } from '@playwright/test';
import { openApp, closeScreens } from './helpers.mjs';

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const e = (id, kcal, fiber) => ({ id, name: id, kcal, p: 5, c: 20, f: 3, meal: 'lunch', time: '12:00', updatedAt: 1, ...(fiber != null ? { fiber } : {}) });

async function report(page, logs) {
  await page.addInitScript(({ logs }) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ logs, days: {}, quickItems: [], tomb: {}, meta: { welcomed: true }, targets: { kcal: 1800, ex: {} }, targetsAt: 1 }));
  }, { logs });
  await openApp(page);
  await closeScreens(page); await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('[data-days="7"]');
  await page.click('#genReportBtn');
}

test('報告：平均膳食纖維＝有纖維資料的天數平均，說明只算幾成的記錄', async ({ page }) => {
  await report(page, {
    [ago(2)]: [e('糙米飯', 300, 4.5), e('地瓜葉', 50, 3.5)],
    [ago(1)]: [e('燕麥', 200, 6), e('便當', 700)]
  });
  const area = page.locator('#reportArea');
  await expect(area).toContainText('平均膳食纖維');
  await expect(area).toContainText('7 g');
  await expect(area).toContainText('2 天有資料・只算 75% 的記錄，實際會更多');
  const text = await page.evaluate(() => window.__dietApp.lastReportText());
  expect(text).toContain('膳食纖維平均 7 g（2 天有資料・只算 75% 的記錄，實際會更多）');
});

test('沒有任何纖維資料：報告不出現膳食纖維', async ({ page }) => {
  await report(page, { [ago(1)]: [e('便當', 700)] });
  await expect(page.locator('#reportArea')).toContainText('每日總表');
  await expect(page.locator('#reportArea')).not.toContainText('膳食纖維');
  const text = await page.evaluate(() => window.__dietApp.lastReportText());
  expect(text).not.toContain('膳食纖維');
});
