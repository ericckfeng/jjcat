// 體重趨勢：每天的點＋7 天平均線，體重變化看平均
import { test, expect } from '@playwright/test';
import { openApp } from './helpers.mjs';

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };

test('體重顯示 7 天平均與平均的期間變化；其他指標不顯示平均', async ({ page }) => {
  const errors = [];
  // 7 天範圍（今天往前 6 天）＋範圍前的記錄也會算進第一天的平均
  const days = {
    [ago(8)]: { weight: 71 },
    [ago(6)]: { weight: 70, waist: 85 },
    [ago(3)]: { weight: 71.2 },   // 吃鹹水腫的一天
    [ago(1)]: { weight: 69.4 },
    [ago(0)]: { weight: 69.6, waist: 84 }
  };
  await page.addInitScript((days) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ logs: {}, days, quickItems: [], tomb: {}, meta: { welcomed: true } }));
  }, days);
  await openApp(page, { errors });
  await page.click('.mobile-nav-tab[data-tab=trends]');
  // 第一天平均 (71+70)/2 = 70.5；今天平均（前 6 天內）(70+71.2+69.4+69.6)/4 = 70.05 → 70.1
  await expect(page.locator('#bodyMetricSummary')).toHaveText('最新 69.6 kg・7 天平均 70.1 kg（期間 -0.4）');
  await expect(page.locator('#weightAvgNote')).toBeVisible();
  await expect(page.locator('#trendStats')).toContainText('體重變化（平均）');
  await expect(page.locator('#trendStats')).toContainText('-0.4 kg');
  await page.click('#bodyMetricGroup [data-metric=waist]');
  await expect(page.locator('#bodyMetricSummary')).toHaveText('最新 84 公分・期間 -1');
  await expect(page.locator('#weightAvgNote')).toBeHidden();
  expect(errors).toEqual([]);
});
