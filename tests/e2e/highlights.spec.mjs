// 營養師報告頂端的本週重點
import { test, expect } from '@playwright/test';
import { openApp, closeScreens, openSettings } from './helpers.mjs';

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };

test('7 天報告最上面有「本週重點」，LINE 文字也有', async ({ page }) => {
  const errors = [];
  const logs = {};
  for (let i = 0; i < 7; i++) logs[ago(i)] = [{ id: 'e' + i, name: '便當', kcal: 2000, meal: 'lunch', time: '12:00', p: 60, c: 250, f: 70, updatedAt: 1 }];
  await page.addInitScript(({ logs, days }) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({
      logs, days, quickItems: [], tomb: {}, meta: { welcomed: true },
      targets: { kcal: 1800, p: 80, c: null, f: null, ex: {}, weight: 65 }, targetsAt: 1
    }));
  }, { logs, days: {
    [ago(8)]: { weight: 71 }, [ago(6)]: { weight: 70, question: '晚餐可以吃水果嗎？' }, [ago(0)]: { weight: 69.6, bowel: 0 }, [ago(1)]: { bowel: 0 }
  } });
  await openApp(page, { errors });
  await closeScreens(page); await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('[data-days="7"]');
  await page.click('#genReportBtn');
  const hl = page.locator('#reportArea .hl li');
  await expect(page.locator('#reportArea h2').first()).toHaveText('本週重點');
  await expect(hl).toHaveCount(5);
  await expect(hl.nth(0)).toHaveText('記錄 7/7 天，平均每天 2,000 kcal，比目標多 200；超過目標 7 天');
  await expect(hl.nth(0)).toHaveClass(/warn/);
  await expect(hl.nth(1)).toContainText('體重（7 天平均）70.5 → 69.8 kg（-0.7），目標 65 kg');
  await expect(hl.nth(1)).toHaveClass(/good/);
  await expect(hl.nth(2)).toHaveText('有 1 天寫了「想問營養師」，列在下方「想和營養師討論」');
  await expect(hl.nth(3)).toHaveText('蛋白質平均 60 g，目標 80 g（約 75%）');
  await expect(hl.nth(4)).toHaveText('有 2 天沒有排便');
  const text = await page.evaluate(() => window.__dietApp.lastReportText());
  expect(text).toContain('〔本週重點〕\n！記錄 7/7 天');
  expect(text).toContain('✓ 體重（7 天平均）');
  expect(text).toContain('〔明細〕');
  expect(errors).toEqual([]);
});
