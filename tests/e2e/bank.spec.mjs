// 熱量銀行：設定開啟、首頁顯示本週進度與今天的建議
import { test, expect } from '@playwright/test';
import { openApp, appState } from './helpers.mjs';
import { weekOf } from '../../js/bank.js';

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const today = ymd(new Date());
const week = weekOf(today);
const before = week.filter(d => d < today);

async function seed(page, { bank, perDay }) {
  const logs = {};
  before.forEach((d, i) => { logs[d] = [{ id: 'e' + i, name: '便當', kcal: perDay, meal: 'lunch', time: '12:00', updatedAt: 1 }]; });
  await page.addInitScript(({ logs, bank }) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({
      logs, days: {}, quickItems: [], tomb: {}, meta: { welcomed: true },
      targets: { kcal: 1800, p: 90, c: 220, f: 60, ex: {}, ...(bank ? { bank: true } : {}) }, targetsAt: 1
    }));
  }, { logs, bank });
}

test('預設關閉：首頁不顯示熱量銀行，目標照舊', async ({ page }) => {
  await seed(page, { bank: false, perDay: 2100 });
  await openApp(page);
  await expect(page.locator('#bankBox')).toBeHidden();
  await expect(page.locator('#summaryTarget')).toHaveText('1,800');
});

test('開啟後：前幾天多吃，今天的目標下修，蛋白質不變', async ({ page }) => {
  await seed(page, { bank: true, perDay: 2100 });
  await openApp(page);
  await expect(page.locator('#bankBox')).toBeVisible();
  if (!before.length) {
    await expect(page.locator('#bankText')).toContainText('這週剛開始');
    await expect(page.locator('#summaryTarget')).toHaveText('1,800');
    return;
  }
  const over = before.length * 300;
  const left = 7 - before.length;
  const expected = Math.max(1200, Math.round(Math.round((12600 - before.length * 2100) / left) / 10) * 10);
  await expect(page.locator('#bankText')).toContainText('多吃了 ' + over.toLocaleString('en-US') + ' kcal');
  await expect(page.locator('#summaryTarget')).toHaveText(expected.toLocaleString('en-US'));
  await expect(page.locator('#headerTargetVal')).toHaveText('1,800'); // 設定的基準不變
  await expect(page.locator('#summaryNutr')).toContainText('90');      // 蛋白質目標不變
});

test('在「每日目標」打開／關閉熱量銀行', async ({ page }) => {
  await seed(page, { bank: false, perDay: 1800 });
  await openApp(page);
  await page.click('#openTargetBtn');
  await page.check('#bankToggle');
  await page.click('#saveTargetBtn');
  expect((await appState(page)).targets.bank).toBe(true);
  await expect(page.locator('#bankBox')).toBeVisible();
  await page.click('#openTargetBtn');
  await expect(page.locator('#bankToggle')).toBeChecked();
  await page.uncheck('#bankToggle');
  await page.click('#saveTargetBtn');
  expect((await appState(page)).targets.bank).toBeUndefined();
  await expect(page.locator('#bankBox')).toBeHidden();
});
