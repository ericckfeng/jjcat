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

test('第二批：清空在最下面、沒記錄時不出現；自己輸入不知道熱量 → 帶著名稱換到拍照記；其他選項收起來', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#clearDayBtn')).toBeHidden();
  await page.click('[data-screen=scr-manual]');
  await expect(page.locator('#kjDetails')).toBeHidden();          // 收在「更多選項」裡
  await expect(page.locator('#extSearchInput')).toBeHidden();
  await page.fill('#foodNameInput', '巷口滷味');
  await page.click('[data-screen-swap=scr-photo]');
  await expect(page.locator('#scr-photo')).toBeVisible();
  await expect(page.locator('#scr-manual')).toBeHidden();
  await expect(page.locator('#photoQuickName')).toHaveValue('巷口滷味');
  await page.click('#photoQuickSave');
  await expect(page.locator('#clearDayBtn')).toBeVisible();
  await expect(page.locator('#clearDayBtn')).toHaveText('清空這一天的飲食記錄');
});

test('小成就：新得到的小芽恭喜一次；點「連續 N 天」打開小成就頁；報告分頁也有入口', async ({ page }) => {
  await openApp(page);
  // 前 6 天都有記錄（測試直接放資料）
  await page.evaluate(() => {
    const a = window.__dietApp; const t = a.ui.date;
    const d = (n) => new Date(Date.parse(t + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
    for (let i = 1; i <= 6; i++) a.state.logs[d(i)] = [{ id: 'it' + i, name: '飯', kcal: 300, meal: 'lunch', time: '12:00', multiplier: 1, updatedAt: 1 }];
  });
  await page.click('[data-screen=scr-manual]');
  await page.fill('#foodNameInput', '香蕉'); await page.fill('#foodKcalInput', '90');
  await page.click('#scr-manual [form=addFoodForm]');
  // 今天剛好連續 7 天 → 小芽第一句恭喜
  await expect(page.locator('#mascotMsg')).toContainText('得到新的小成就：🔥 連續記錄 7 天');
  const seen = await page.evaluate(() => window.__dietApp.state.meta.badgesSeen);
  expect(seen).toContain('streak-7');
  await page.click('#mascotChips >> text=連續 7 天');
  await expect(page.locator('#scr-badges')).toBeVisible();
  await expect(page.locator('#badgeSummary')).toContainText('現在連續記錄 7 天');
  await expect(page.locator('[data-badge=streak-7]')).toContainText('得到');
  await expect(page.locator('[data-badge-next=streak-14]')).toContainText('再 7 天');
  await closeScreens(page);
  // 報告分頁也有入口
  await page.click('.mobile-nav-tab[data-tab=report]');
  await expect(page.locator('#badgeTileSub')).toContainText('已經得到');
});
