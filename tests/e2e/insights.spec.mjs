// 跨模組提醒：小芽依飲食、體重、睡眠、排便給說明
import { test, expect } from '@playwright/test';
import { openApp } from './helpers.mjs';

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };

async function seed(page, data) {
  await page.addInitScript((data) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ quickItems: [], tomb: {}, meta: { welcomed: true }, ...data }));
  }, data);
}
// 小芽一次說一句，點牠換下一句；收集全部
async function mascotTexts(page) {
  return page.evaluate(() => {
    const out = new Set();
    for (let i = 0; i < 30; i++) { out.add(document.getElementById('mascotMsg').textContent); document.getElementById('mascotBtn').click(); }
    return [...out];
  });
}

test('昨天吃多、今天體重上升：小芽最先說明是水分', async ({ page }) => {
  const errors = [];
  await seed(page, {
    targets: { kcal: 1800, ex: {} },
    logs: { [ago(1)]: [{ id: 'a', name: '火鍋', kcal: 2300, meal: 'dinner', time: '19:00', updatedAt: 1 }] },
    days: { [ago(1)]: { weight: 70 }, [ago(0)]: { weight: 70.8 } }
  });
  await openApp(page, { errors });
  await expect(page.locator('#mascotMsg')).toContainText('多了 0.8 公斤');
  await expect(page.locator('#mascotMsg')).toContainText('不是真的胖');
  expect(errors).toEqual([]);
});

test('昨晚睡太少、連兩天沒排便：兩個提醒都在小芽的話裡', async ({ page }) => {
  await seed(page, {
    targets: { kcal: 1800, ex: {} },
    logs: {
      [ago(1)]: [{ id: 'a', name: '便當', kcal: 700, meal: 'lunch', time: '12:00', ex: { grain: 3, prot: 2, veg: 1 }, updatedAt: 1 }],
      [ago(0)]: [{ id: 'b', name: '饅頭', kcal: 280, meal: 'breakfast', time: '07:00', ex: { grain: 4 }, updatedAt: 1 }]
    },
    days: { [ago(1)]: { bowel: 0, water: 900 }, [ago(0)]: { bowel: 0, sleepMin: 300, sleepBed: '01:00', sleepWake: '06:00' } }
  });
  await openApp(page);
  const texts = await mascotTexts(page);
  expect(texts.some(t => t.includes('昨晚只睡 5 小時') && t.includes('200ml'))).toBe(true);
  expect(texts.some(t => t.includes('兩天沒排便') && t.includes('青菜平均 0.5 份') && t.includes('水平均 900 ml'))).toBe(true);
  expect(texts.filter(t => t.includes('只睡'))).toHaveLength(1); // 舊的睡太少訊息不再重複出現
});
