// 外食點餐小幫手：查食物 →「在外面吃，幫我配」→ 選店家 → 這一餐還能吃多少 → 3 組點法 → 放進購物車 → 記到午餐
import { test, expect } from '@playwright/test';
import { openApp, appState } from './helpers.mjs';

const todayOf = (page) => page.evaluate(() => window.__dietApp.ui.date);
const food = (id, name, category, kcal, p, extra = {}) => ({ id, name, base: name, brand: '台灣麥當勞', category, serving: { label: '1份' }, perServing: { kcal, p, ...extra } });
const PACK = {
  id: 'pk_out', name: '外食連鎖店', org: '自己整理', askBy: 'serving', updatedAt: 1,
  foods: [
    food('m1', '大麥克', '主餐', 530, 25, { c: 45, f: 28 }),
    food('m2', '麥香雞', '主餐', 380, 14),
    food('s1', '烤雞沙拉', '配餐', 150, 20),
    food('s2', '中薯', '配餐', 330, 4),
    food('d1', '可樂(中)', '飲料', 210, 0, { sugar: 52 }),
    food('d2', '無糖綠茶', '飲料', 0, 0),
    food('x1', '千島醬', '醬料', 60, 0),
    { id: 't1', name: '珍珠奶茶(大杯/無糖)', base: '珍珠奶茶', brand: '50嵐', category: '奶茶', perServing: { kcal: 340 } }
  ]
};

async function seed(page, { packs = [PACK], breakfast = 400 } = {}) {
  await page.addInitScript(({ packs, breakfast }) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    const d = new Date();
    const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    localStorage.setItem('diet_tracker_v2', JSON.stringify({
      logs: breakfast ? { [today]: [{ id: 'b1', name: '早餐', kcal: breakfast, meal: 'breakfast', time: '08:00', updatedAt: 1 }] } : {},
      days: {}, quickItems: [], tomb: {}, foodPacks: packs,
      meta: { welcomed: true, fontSize: 'xl' },
      targets: { kcal: 1800, p: 80, c: null, f: null, ex: {}, weight: null }, targetsAt: 1
    }));
  }, { packs, breakfast });
}

test('選麥當勞 → 午餐建議 630 大卡內 → 第 1 組放進購物車 → 記到午餐，記錄帶資料庫來源', async ({ page }) => {
  const errors = [];
  await page.setViewportSize({ width: 375, height: 800 });
  await seed(page);
  await openApp(page, { errors });
  await page.click('[data-food-open=all] >> nth=0');
  await page.click('#scr-food [data-meal=lunch]');
  await page.click('#eatoutOpenBtn');
  await expect(page.locator('#eoBrands [data-eo-brand]')).toHaveText([/台灣麥當勞[\s\S]*7 樣/, /50嵐[\s\S]*1 樣/]);
  await page.fill('#eoSearch', '50');
  await expect(page.locator('#eoBrands [data-eo-brand]')).toHaveCount(1);
  await page.fill('#eoSearch', '麥當勞');
  await page.click('[data-eo-brand="台灣麥當勞"]');
  await expect(page.locator('#eoBudgetText')).toContainText('午餐建議 630 大卡以內（今天目標 1800，已經吃了 400）');
  const first = page.locator('#eoList > div').first();
  // 蛋白質多的排前面：麥香雞＋烤雞沙拉＋無糖綠茶（蛋白質 34 克）比大麥克＋無糖綠茶（25 克）好
  await expect(first).toContainText('第 1 組・530 大卡');
  await expect(first).toContainText('麥香雞');
  await expect(first).toContainText('烤雞沙拉');
  await expect(first).toContainText('無糖綠茶');
  await expect(first).toContainText('蛋白質 34 克，比較有飽足感');
  await expect(page.locator('#eoList')).not.toContainText('千島醬');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // 多 50 大卡：大麥克＋烤雞沙拉＝680 放得下
  await page.click('[data-eo-adj="50"]');
  await page.click('[data-eo-adj="50"]');
  await expect(page.locator('#eoBudgetText')).toContainText('午餐建議 730 大卡以內');
  await expect(first).toContainText('第 1 組・680 大卡');
  await first.locator('[data-eo-use]').click();
  await expect(page.locator('#scr-eatout')).toBeHidden();
  await expect(page.locator('#foodCart')).toContainText('這一餐已選 3 樣');
  await expect(page.locator('#foodCart')).toContainText('合計 680 kcal');
  await page.click('#foodCartSaveBtn');
  const s = await appState(page);
  const lunch = s.logs[await todayOf(page)].filter(i => i.meal === 'lunch');
  expect(lunch.map(i => i.name)).toEqual(['台灣麥當勞 大麥克 1 份', '台灣麥當勞 烤雞沙拉 1 份', '台灣麥當勞 無糖綠茶 1 份']);
  expect(lunch[0]).toMatchObject({ kcal: 530, src: 'pk_out', packFoodId: 'm1' });
  expect(s.meta.eatoutRecent).toEqual(['台灣麥當勞']);
  expect(errors).toEqual([]);
});

test('再打開記得上次的店家；今天吃得差不多了只建議無糖茶、再少就說明', async ({ page }) => {
  await seed(page, { breakfast: 1700 });
  await openApp(page);
  await page.click('[data-food-open=all] >> nth=0');
  await page.click('#scr-food [data-meal=dinner]');
  await page.click('#eatoutOpenBtn');
  await page.click('[data-eo-brand="台灣麥當勞"]');
  await expect(page.locator('#eoBudgetText')).toContainText('晚餐建議 100 大卡以內');
  // 主餐都放不下：只建議喝無糖綠茶
  await expect(page.locator('#eoList > div')).toHaveCount(1);
  await expect(page.locator('#eoList')).toContainText('無糖綠茶');
  await page.click('[data-eo-adj="-50"]');
  await page.click('[data-eo-adj="-50"]');
  await expect(page.locator('#eoBudgetText')).toContainText('今天的熱量差不多用完了');
  await page.goBack();
  await page.click('#eatoutOpenBtn');
  await expect(page.locator('#eoPlan')).toBeVisible();
  await expect(page.locator('#eoBrand')).toHaveText('台灣麥當勞');
  await page.click('#eoChange');
  await expect(page.locator('#eoBrands [data-eo-brand]').first()).toContainText('最近去過');
});

test('沒有店家資料的食物資料庫：查食物頁不出現「在外面吃，幫我配」', async ({ page }) => {
  await seed(page, { packs: [{ ...PACK, foods: PACK.foods.map(({ brand, ...f }) => f) }] });
  await openApp(page);
  await page.click('[data-food-open=all] >> nth=0');
  await expect(page.locator('#foodSearch')).toBeVisible();
  await expect(page.locator('#eatoutOpenBtn')).toBeHidden();
});
