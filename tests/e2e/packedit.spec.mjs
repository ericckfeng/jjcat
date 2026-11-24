// 資料庫可以加東西：我的食物勾選 → 移到資料庫（我的食物清單變短）；資料庫裡新增、修改原本的（原本的藏起來）、
// 移回我的食物；外食怎麼點「這家有新菜」；分享資料庫含自己加的；刪掉資料庫，自己加的回到我的食物
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, appState, closeScreens } from './helpers.mjs';

const PACK = {
  id: 'pk_out', name: '外食連鎖店', org: '自己整理', askBy: 'serving', updatedAt: 1,
  foods: [
    { id: 'pf_gt', name: '招牌鍋貼', base: '招牌鍋貼', brand: '八方雲集', category: '鍋貼', serving: { label: '10顆' }, perServing: { kcal: 550, p: 20 } },
    { id: 'pf_sl', name: '酸辣湯', base: '酸辣湯', brand: '八方雲集', category: '湯品', serving: { label: '1碗' }, perServing: { kcal: 120, p: 6 } },
    { id: 'pf_bm', name: '大麥克', base: '大麥克', brand: '台灣麥當勞', category: '主餐', serving: { label: '1份' }, perServing: { kcal: 530, p: 25 } }
  ]
};
const MINE = [
  { id: 'cf_curry', name: '咖哩雞肉鍋貼', serving: { label: '10顆' }, perServing: { kcal: 600, p: 22 }, updatedAt: 1 },
  { id: 'cf_nut', name: '堅果包', serving: { g: 35, label: '1 包' }, per100g: { kcal: 285.71 }, updatedAt: 1 }
];

async function seed(page) {
  await page.addInitScript(({ pack, mine }) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({
      logs: {}, days: {}, quickItems: [], tomb: {}, foodPacks: [pack], customFoods: mine,
      meta: { welcomed: true, fontSize: 'xl' }, targets: { kcal: 1800, p: 80, c: null, f: null, ex: {}, weight: null }, targetsAt: 1
    }));
  }, { pack: PACK, mine: MINE });
}
const library = (page) => page.click('.mobile-nav-tab[data-tab=library]');
// 手機特大字：這一頁的內容不會比畫面寬
const noSideScroll = async (page, id) => expect(await page.locator('#' + id + ' .scr-body').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

test('我的食物勾選 → 移到資料庫（八方雲集）→ 我的食物清單變短；查食物、外食怎麼點找得到；記錄帶來源；可以復原', async ({ page }) => {
  const errors = [];
  await page.setViewportSize({ width: 375, height: 800 });
  await seed(page);
  await openApp(page, { errors });
  await library(page);
  await expect(page.locator('#myFoodList')).toContainText('咖哩雞肉鍋貼');
  await page.click('#myFoodSelectBtn');
  await page.click('[data-mf-sel=cf_curry]');
  await expect(page.locator('#myFoodSelectText')).toHaveText('已選 1 樣');
  await page.click('#myFoodMoveBtn');
  await expect(page.locator('#moveWhat')).toContainText('咖哩雞肉鍋貼');
  await noSideScroll(page, 'scr-move');
  await expect(page.locator('[data-move-to=pk_out]')).toHaveAttribute('aria-pressed', 'true');
  await page.fill('#moveBrand', '八方雲集');
  await page.click('#moveSaveBtn');
  await expect(page.locator('#toastMsg')).toContainText('已把 1 樣移到「外食連鎖店」');
  await expect(page.locator('#myFoodList')).not.toContainText('咖哩雞肉鍋貼');
  await expect(page.locator('#myFoodList')).toContainText('堅果包');
  await expect(page.locator('#packList')).toContainText('我加了 1 樣');
  const cf = (await appState(page)).customFoods.find(f => f.id === 'cf_curry');
  expect(cf).toMatchObject({ packId: 'pk_out', brand: '八方雲集', base: '咖哩雞肉鍋貼' });
  expect(cf.updatedAt).toBeGreaterThan(1);

  // 查食物：在資料庫那一區（不在我的食物）；記下來帶 customFoodId 和資料庫來源
  await page.click('.mobile-nav-tab[data-tab=log]');
  await page.click('[data-food-open=all] >> nth=0');
  await page.fill('#foodSearch', '咖哩雞肉鍋貼');
  await expect(page.locator('#foodPacks')).toContainText('咖哩雞肉鍋貼');
  await expect(page.locator('#foodMine')).not.toContainText('咖哩雞肉鍋貼');
  await page.click('#foodPacks [data-pack-group]');
  await page.click('#gramsSaveBtn');
  await page.click('#foodCartSaveBtn');
  const entry = Object.values((await appState(page)).logs).flat()[0];
  expect(entry).toMatchObject({ customFoodId: 'cf_curry', src: 'pk_out', srcName: '外食連鎖店', kcal: 600 });

  // 外食怎麼點：八方雲集多一樣
  await page.click('[data-food-open=all] >> nth=0');
  await page.click('#eatoutOpenBtn');
  await expect(page.locator('[data-eo-brand="八方雲集"]')).toContainText('3 樣');
  await closeScreens(page);

  // 復原：回到我的食物
  await library(page);
  await page.click('#myFoodSelectBtn');
  await page.click('[data-mf-sel=cf_nut]');
  await page.click('#myFoodMoveBtn');
  await page.click('[data-move-to=new]');
  await page.click('#moveSaveBtn');
  await expect(page.locator('#moveNote')).toContainText('請填新資料庫的名稱');
  await page.fill('#moveNewName', '常吃的零食');
  await page.click('#moveSaveBtn');
  await expect(page.locator('#packList')).toContainText('常吃的零食');
  await expect(page.locator('#myFoodList')).not.toContainText('堅果包');
  await page.click('#toastAction');
  await expect(page.locator('#myFoodList')).toContainText('堅果包');
  await expect(page.locator('#packList')).not.toContainText('常吃的零食');
  const s = await appState(page);
  expect(s.customFoods.find(f => f.id === 'cf_nut').packId).toBeUndefined();
  expect(s.foodPacks.map(p => p.name)).toEqual(['外食連鎖店']);
  expect(errors).toEqual([]);
});

test('資料庫頁：新增到這一家；改原本的一樣（原本的藏起來）→ 恢復原本的；自己加的移回我的食物', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await seed(page);
  await openApp(page);
  await library(page);
  await page.click('[data-pack-open=pk_out]');
  await noSideScroll(page, 'scr-pack');
  await expect(page.locator('#packTitle')).toHaveText('📚 外食連鎖店');
  await page.fill('#packSearch', '八方雲集');
  await expect(page.locator('#packFoods [data-pf]')).toHaveCount(2);
  // 新增：正在看八方雲集，店家先填好
  await page.click('#packAddBtn');
  await expect(page.locator('#myFoodTitle')).toHaveText('🏪 新增到「外食連鎖店」');
  await expect(page.locator('#mf-brand')).toHaveValue('八方雲集');
  await noSideScroll(page, 'scr-myfood');
  await page.fill('#mf-name', '韓式泡菜鍋貼');
  await page.fill('#mf-servingLabel', '10顆');
  await page.fill('#mf-kcal', '580');
  await page.click('#mf-save');
  await expect(page.locator('#toastMsg')).toContainText('已存到「外食連鎖店」：「韓式泡菜鍋貼」');
  await expect(page.locator('#packFoods')).toContainText('韓式泡菜鍋貼我加的');
  // 同一家同名不行
  await page.click('#packAddBtn');
  await page.fill('#mf-name', '韓式泡菜鍋貼');
  await page.fill('#mf-kcal', '1');
  await page.click('#mf-save');
  await expect(page.locator('#mf-note')).toContainText('已經有「韓式泡菜鍋貼」了');
  await page.goBack();

  // 改原本的：數字換成自己的，原本的藏起來
  await page.click('[data-pf=pf_gt]');
  await expect(page.locator('#myFoodTitle')).toHaveText('🏪 修改資料庫的食物');
  await expect(page.locator('#mf-kcal')).toHaveValue('550');
  await page.fill('#mf-kcal', '520');
  await page.click('#mf-save');
  await expect(page.locator('#packFoods')).toContainText('招牌鍋貼改過');
  await expect(page.locator('#packFoods [data-pf=pf_gt]')).toHaveCount(0);
  let s = await appState(page);
  const fix = s.customFoods.find(f => f.replaces === 'pf_gt');
  expect(fix).toMatchObject({ name: '招牌鍋貼', packId: 'pk_out', brand: '八方雲集', perServing: { kcal: 520 } });
  expect(s.foodPacks[0].foods.find(f => f.id === 'pf_gt').perServing.kcal).toBe(550);   // 原本的資料庫不動
  // 恢復原本的
  await page.click(`[data-pf=${fix.id}]`);
  await expect(page.locator('#mf-delete')).toHaveText('不要我改的，恢復原本的');
  await page.click('#mf-delete');
  await page.click('#confirmOkBtn');
  await expect(page.locator('#packFoods [data-pf=pf_gt]')).toHaveCount(1);

  // 自己加的移回我的食物
  const added = (await appState(page)).customFoods.find(f => f.name === '韓式泡菜鍋貼');
  await page.click(`[data-pf=${added.id}]`);
  await page.click('#mf-unpack');
  await expect(page.locator('#packFoods')).not.toContainText('韓式泡菜鍋貼');
  await closeScreens(page);
  await expect(page.locator('#myFoodList')).toContainText('韓式泡菜鍋貼');
  s = await appState(page);
  expect(s.customFoods.find(f => f.id === added.id).packId).toBeUndefined();
});

test('外食怎麼點「這家有新菜」→ 存進資料庫、店家先填好；分享資料庫含自己加的；刪掉資料庫，自己加的回到我的食物', async ({ page }) => {
  await page.addInitScript(() => { delete Navigator.prototype.canShare; });   // 測下載
  await seed(page);
  await openApp(page);
  await page.click('[data-food-open=all] >> nth=0');
  await page.click('#eatoutOpenBtn');
  await page.click('[data-eo-brand="八方雲集"]');
  await page.click('#eoAddBtn');
  await expect(page.locator('#mf-brand')).toHaveValue('八方雲集');
  await page.fill('#mf-name', '鮮蝦鍋貼');
  await page.fill('#mf-kcal', '500');
  await page.fill('#mf-p', '30');
  await page.click('#mf-save');
  await expect(page.locator('#scr-eatout')).toBeVisible();
  await expect(page.locator('#eoList')).toContainText('鮮蝦鍋貼');   // 馬上算進建議
  await closeScreens(page);

  await library(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-pack-share=pk_out]')]);
  const file = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  expect(file.pack).toMatchObject({ id: 'pk_out', name: '外食連鎖店' });
  expect(file.foods.map(f => f.name)).toEqual(['招牌鍋貼', '酸辣湯', '大麥克', '鮮蝦鍋貼']);
  expect(file.foods[3]).toMatchObject({ brand: '八方雲集', perServing: { kcal: 500, p: 30 } });
  expect(file.foods[3].packId).toBeUndefined();

  await page.click('[data-pack-del=pk_out]');
  await expect(page.locator('#confirmMessage')).toContainText('你加的 1 樣會回到我的食物');
  await page.click('#confirmOkBtn');
  await expect(page.locator('#myFoodList')).toContainText('鮮蝦鍋貼');
});
