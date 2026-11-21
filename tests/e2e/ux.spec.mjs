// 給不太會用手機的人：提示訊息看得到、錯誤不會一下就不見、確認視窗不嚇人
import { test, expect } from '@playwright/test';
import { openApp, closeScreens } from './helpers.mjs';

test('一般提示停 5 秒、點一下就關；錯誤要按「知道了」才關', async ({ page }) => {
  await openApp(page);
  await page.click('[data-screen=scr-manual]');
  await page.click('#scr-manual [form=addFoodForm]');
  const toast = page.locator('#toast');
  await expect(toast).toBeVisible();
  await expect(toast).toHaveClass(/toast-err/);
  await expect(page.locator('#toastAction')).toHaveText('知道了');
  await page.clock.runFor(12000);
  await expect(toast).toBeVisible();            // 錯誤不會自己消失
  await page.click('#toastAction');
  await expect(toast).toBeHidden();

  await page.fill('#foodNameInput', '香蕉');
  await page.fill('#foodKcalInput', '90');
  await page.click('#scr-manual [form=addFoodForm]');
  await expect(toast).toBeVisible();
  await expect(toast).not.toHaveClass(/toast-err/);
  await page.clock.runFor(3000);
  await expect(toast).toBeVisible();            // 以前 2.4 秒就不見
  await page.clock.runFor(5000);
  await expect(toast).toBeHidden();
});

test('確認視窗：刪除用紅色，加入用綠色，按鈕夠大', async ({ page }) => {
  await openApp(page);
  await page.click('[data-screen=scr-manual]');
  await page.fill('#foodNameInput', '香蕉');
  await page.fill('#foodKcalInput', '90');
  await page.click('#scr-manual [form=addFoodForm]');
  await closeScreens(page);
  await page.click('#clearDayBtn');
  await expect(page.locator('#confirmOkBtn')).toHaveClass(/btn-danger/);
  const box = await page.locator('#confirmOkBtn').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await page.click('#confirmCancelBtn');
  await page.click('.mobile-nav-tab[data-tab=library]');
  await page.setInputFiles('#packImportInput', { name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    app: 'diet-tracker-foods', version: 1, pack: { id: 'pk_1', name: '外食' }, foods: [{ id: 'pf_1', name: '漢堡', perServing: { kcal: 260 } }] })) });
  await expect(page.locator('#confirmOkBtn')).toHaveText('加入');
  await expect(page.locator('#confirmOkBtn')).not.toHaveClass(/btn-danger/);
});

test('歡迎頁說明雲端在設定裡；報告的日期在特大字下看得完整', async ({ page }) => {
  await openApp(page, { keepWelcome: true });
  await expect(page.locator('#scr-welcome')).toContainText('⚙️ 設定 → 資料與備份');
  await page.click('#welcomeStartBtn');
  await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
  await page.click('.mobile-nav-tab[data-tab=report]');
  const w = await page.locator('#rptFrom').evaluate(el => el.getBoundingClientRect().width);
  expect(w).toBeGreaterThan(250);   // 上下排，一欄佔滿寬度
});
