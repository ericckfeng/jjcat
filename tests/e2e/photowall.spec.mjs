// 餐點照片牆：報告分頁 → 一週七天的照片（最近的在上面）→ 上一週 → 點照片看大圖 → 修正那一筆（會切到那天）
import { test, expect } from '@playwright/test';
import { openApp } from './helpers.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAAMBgEB1JqCEwAAAABJRU5ErkJggg==';
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const today = ymd(new Date());
const weekAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return ymd(d); })();

async function seed(page) {
  await page.addInitScript(({ today, weekAgo }) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({
      logs: {
        [today]: [
          { id: 'p_din', name: '滷肉飯', kcal: 520, meal: 'dinner', time: '18:00', hasPhoto: true, updatedAt: 1 },
          { id: 'p_lun', name: '雞腿便當', kcal: 780, meal: 'lunch', time: '12:00', hasPhoto: true, pending: true, updatedAt: 1 },
          { id: 'n_snk', name: '蘋果', kcal: 80, meal: 'snack', time: '15:00', updatedAt: 1 }
        ],
        [weekAgo]: [{ id: 'p_old', name: '牛肉麵', kcal: 650, meal: 'lunch', time: '12:00', hasPhoto: true, updatedAt: 1 }]
      },
      days: {}, quickItems: [], tomb: {}, meta: { welcomed: true, fontSize: 'xl' }
    }));
  }, { today, weekAgo });
}
async function putPhotos(page, ids) {
  await page.evaluate(({ ids, src }) => new Promise((resolve, reject) => {
    const req = indexedDB.open('diet-tracker');
    req.onsuccess = () => {
      const tx = req.result.transaction('photos', 'readwrite');
      ids.forEach(id => tx.objectStore('photos').put(src, id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }), { ids, src: PNG });
}

test('照片牆：這週有照片的記錄照餐別排；上一週；點照片看大圖、修正那一筆（手機特大字不橫移）', async ({ page }) => {
  const errors = [];
  await page.setViewportSize({ width: 375, height: 800 });
  await seed(page);
  await openApp(page, { errors });
  await putPhotos(page, ['p_din', 'p_lun', 'p_old']);
  await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('#tab-report [data-screen=scr-photowall]');
  await expect(page.locator('#wallSummary')).toContainText('這週有 2 筆附照片的記錄');
  await expect(page.locator('#wallNext')).toBeDisabled();
  const todayCells = page.locator(`[data-wall^="${today}|"]`);
  await expect(todayCells).toHaveCount(2);
  await expect(todayCells.nth(0)).toContainText('午餐・待查');   // 午餐在晚餐前面
  await expect(todayCells.nth(1)).toContainText('520 大卡');
  await expect(page.locator('#wallDays section').first()).toContainText('共 1380 大卡・記了 3 筆');
  await expect(todayCells.nth(0).locator('img')).toHaveAttribute('src', /^data:image\/png/);
  // 只看照片牆自己（後面的報告分頁在測試裡沒有 Tailwind 的預設樣式，日期框會比較寬）
  expect(await page.locator('#scr-photowall .scr-body').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

  await page.click('#wallPrev');
  await expect(page.locator('#wallNext')).toBeEnabled();
  await page.click(`[data-wall="${weekAgo}|p_old"]`);
  await expect(page.locator('#photoLightboxModal')).toBeVisible();
  await expect(page.locator('#lightboxFoodTitle')).toHaveText('牛肉麵');
  await expect(page.locator('#lightboxImgs img')).toHaveCount(1);
  await page.click('#lightboxEditEntryBtn');
  await expect(page.locator('#editLogNameInput')).toHaveValue('牛肉麵');
  expect(await page.evaluate(() => window.__dietApp.ui.date)).toBe(weekAgo);
  expect(errors).toEqual([]);
});
