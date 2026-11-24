// 外食點餐小幫手（js/eatout.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleOf, portionOf, brandsOf, mealBudget, suggestMeals } from '../../js/eatout.js';

const F = (name, kcal, p, extra = {}) => ({ id: name, name, brand: '麥當勞', perServing: { kcal, p, ...(extra.n || {}) }, ...extra });

test('分類：先看分類欄，看不出來再看名稱；醬料不單獨推薦', () => {
  assert.equal(roleOf({ name: '大麥克', category: '主餐' }), 'main');
  assert.equal(roleOf({ name: '千島醬', category: '醬料' }), 'sauce');
  assert.equal(roleOf({ name: '珍珠奶茶(大杯/無糖)', base: '珍珠奶茶', category: '奶茶' }), 'drink');
  assert.equal(roleOf({ name: '雞肉潛艇堡' }), 'main');
  assert.equal(roleOf({ name: '無糖綠茶' }), 'drink');
  assert.equal(roleOf({ name: '凱撒沙拉' }), 'side');
});

test('一份：以份計直接用；以克計要有每份克數才算得出來', () => {
  assert.deepEqual(portionOf({ perServing: { kcal: 300, p: 10 } }), { amount: 1, byServing: true, n: { kcal: 300, p: 10 } });
  assert.deepEqual(portionOf({ per100g: { kcal: 200, p: 20 }, serving: { g: 150 } }), { amount: 150, byServing: false, n: { kcal: 300, p: 30 } });
  assert.equal(portionOf({ per100g: { kcal: 200 } }), null);
});

test('店家清單：品項多的在前；沒有店家或算不出一份的不列', () => {
  const packs = [{ foods: [F('漢堡', 260, 12), F('薯條', 330, 4), { name: '白飯', perServing: { kcal: 280 } }, { name: 'x', brand: '50嵐', perServing: { kcal: 340 } }] }];
  assert.deepEqual(brandsOf(packs), [{ brand: '麥當勞', count: 2 }, { brand: '50嵐', count: 1 }]);
});

test('這一餐的建議：照餐別分，不超過今天還剩的', () => {
  assert.deepEqual(mealBudget({ target: 1800, eaten: 400, meal: 'lunch' }), { budget: 630, left: 1400, share: 630 });
  assert.equal(mealBudget({ target: 1800, eaten: 1500, meal: 'dinner' }).budget, 300);
  assert.equal(mealBudget({ target: 1800, eaten: 2000, meal: 'dinner' }).budget, 0);
});

test('點法：主餐＋配餐＋飲料不超過建議，蛋白質多、糖少的在前，三組主餐不同', () => {
  const foods = [
    F('大麥克', 530, 25, { category: '主餐' }),
    F('麥香雞', 380, 14, { category: '主餐' }),
    F('烤雞沙拉', 150, 20, { category: '配餐' }),
    F('中薯', 330, 4, { category: '配餐' }),
    F('可樂(中)', 210, 0, { category: '飲料', n: { sugar: 52 } }),
    F('無糖綠茶', 0, 0, { category: '飲料' }),
    F('千島醬', 60, 0, { category: '醬料' }),
    F('雙層牛肉吉事堡', 800, 40, { category: '主餐' })
  ];
  const out = suggestMeals(foods, 700);
  assert.equal(out.length, 2);   // 只有兩個主餐放得進 700 大卡
  const names = out.map(c => c.items.map(i => i.food.name));
  assert.deepEqual(names[0], ['大麥克', '烤雞沙拉', '無糖綠茶']);
  assert.equal(out[0].total.kcal, 680);
  assert.equal(out[0].total.p, 45);
  assert.equal(out[0].total.c, null);   // 資料庫沒有碳水：不是 0 克
  assert.ok(out[0].notes.includes('飲料幾乎沒有熱量'));
  assert.equal(names[1][0], '麥香雞');
  assert.ok(out.every(c => c.total.kcal <= 700));
  assert.ok(!out.some(c => c.items.some(i => i.food.name === '千島醬')));
  assert.ok(!out.some(c => c.items.some(i => i.food.name === '可樂(中)')));   // 同樣放得下，糖多的排後面
});

test('看不出主餐的店（飲料店）：一樣或兩樣；預算太少就沒有建議', () => {
  const tea = [
    { name: '珍珠奶茶(大杯/無糖)', brand: '50嵐', category: '奶茶', perServing: { kcal: 340, sugar: 0 } },
    { name: '珍珠奶茶(大杯/正常糖)', brand: '50嵐', category: '奶茶', perServing: { kcal: 520, sugar: 45 } },
    { name: '四季春(無糖)', brand: '50嵐', category: '純茶', perServing: { kcal: 0 } }
  ];
  const out = suggestMeals(tea, 400);
  assert.ok(out.every(c => c.items.length === 1));   // 不會建議兩杯
  assert.deepEqual(out.map(c => c.items[0].food.name), ['四季春(無糖)', '珍珠奶茶(大杯/無糖)']);   // 熱量、糖少的在前；400 大卡放不下正常糖
  assert.equal(roleOf({ name: '四季春+珍波椰(大杯/無糖)', category: '找口感/特調' }), 'drink');
  assert.ok(out.every(c => c.total.kcal <= 400));
  assert.deepEqual(suggestMeals(tea, 0).map(c => c.total.kcal), [0]);   // 今天吃完了：飲料店還是可以喝無糖茶
});
