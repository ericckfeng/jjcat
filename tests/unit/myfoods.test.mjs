// 我的食物（js/myfoods.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  customFoodFromForm, formFromCustomFood, servingNutrients, servingKcal, servingText,
  searchMine, sortByUse, isPerServing, formFromManual
} from '../../js/myfoods.js';
import { nutrientsFor } from '../../js/foods.js';

const opts = { id: 'cf_1', now: 5 };

test('以克計：一份 35 克 100 大卡 → 存每 100 g，換回來還是一份的數字', () => {
  const { food } = customFoodFromForm({ name: ' 堅果包 ', servingG: '35', servingLabel: '1 包', kcal: '100', p: '3', f: '10', c: '', fiber: '1.4', ex: { oil: '2' } }, opts);
  assert.deepEqual(food, {
    id: 'cf_1', name: '堅果包', updatedAt: 5, serving: { g: 35, label: '1 包' },
    per100g: { kcal: 285.71, p: 8.57, f: 28.57, fiber: 4 }, exPer100g: { oil: 5.71 }
  });
  assert.equal(isPerServing(food), false);
  const back = formFromCustomFood(food);
  assert.deepEqual(back, { name: '堅果包', servingG: 35, servingLabel: '1 包', kcal: 100, p: 3, f: 10, c: '', sugar: '', na: '', fiber: 1.4, ex: { oil: 2 } });
  // 和 TFDA 食物用同一套換算：吃 7 克
  assert.deepEqual(nutrientsFor(food, 7), { kcal: 20, p: 0.6, f: 2, c: null, sugar: null, na: null, fiber: 0.3, ex: { oil: 0.4 } });
  assert.equal(servingKcal(food), 100);
  assert.equal(servingText(food), '1 包 35 g');
});

test('以份計：不知道幾克 → 存每份，問幾份', () => {
  const { food } = customFoodFromForm({ name: '牛肉麵', servingLabel: '1 碗', kcal: 650, p: 30, f: 22, c: 80, ex: { grain: 4, prot: 2, oil: 3 } }, opts);
  assert.deepEqual(food, {
    id: 'cf_1', name: '牛肉麵', updatedAt: 5, serving: { label: '1 碗' },
    perServing: { kcal: 650, p: 30, f: 22, c: 80 }, exPerServing: { grain: 4, prot: 2, oil: 3 }
  });
  assert.equal(isPerServing(food), true);
  assert.deepEqual(servingNutrients(food, 1.5), { kcal: 975, p: 45, f: 33, c: 120, sugar: null, na: null, fiber: null, ex: { grain: 6, prot: 3, oil: 4.5 } });
  assert.equal(servingKcal(food), 650);
  assert.equal(servingText(food), '1 碗');
  assert.equal(formFromCustomFood(food).servingG, '');
});

test('新增：名稱、熱量一定要填；克數要合理', () => {
  assert.match(customFoodFromForm({ name: '', kcal: 1 }, opts).error, /名稱/);
  assert.match(customFoodFromForm({ name: 'a', kcal: '' }, opts).error, /熱量/);
  assert.match(customFoodFromForm({ name: 'a', kcal: 1, servingG: -1 }, opts).error, /克數/);
  assert.equal(customFoodFromForm({ name: 'a', kcal: 0 }, opts).food.perServing.kcal, 0);
});

test('搜尋我的食物：名稱、別名、同義詞', () => {
  const foods = [{ id: 'a', name: '全家地瓜' }, { id: 'b', name: '早餐蛋餅', aliases: ['蔥抓餅加蛋'] }, { id: 'c', name: '無糖豆漿' }];
  assert.deepEqual(searchMine(foods, '甘藷').map(f => f.id), ['a']);
  assert.deepEqual(searchMine(foods, '蔥抓').map(f => f.id), ['b']);
  assert.deepEqual(searchMine(foods, '豆奶').map(f => f.id), ['c']);
  assert.deepEqual(searchMine(foods, ''), []);
});

test('依常用排序：記最多次的在前，一樣多看最近記的', () => {
  const foods = [{ id: 'a', updatedAt: 3 }, { id: 'b', updatedAt: 2 }, { id: 'c', updatedAt: 1 }, { id: 'd', updatedAt: 9 }];
  const logs = {
    '2026-11-20': [{ customFoodId: 'b' }, { customFoodId: 'c' }],
    '2026-11-21': [{ customFoodId: 'b' }, { customFoodId: 'a' }, { foodId: 'X' }]
  };
  assert.deepEqual(sortByUse(foods, logs).map(f => f.id), ['b', 'a', 'c', 'd']);
});

test('自己輸入順便存：有照標示算就存以克計（一份＝一份吃的克數）；沒有就以份計', () => {
  const withLabel = formFromManual({ name: '洋芋片', nutr: { kcal: 240 }, label: { g: 30, kcal: 160, f: 10 }, grams: 90, mult: 2 });
  assert.deepEqual(withLabel, { name: '洋芋片', servingG: 45, servingLabel: '', kcal: 240, p: '', f: 15, c: '', ex: {} });
  const plain = formFromManual({ name: '便當', nutr: { kcal: 750, p: 30, ex: { grain: 4 } } });
  assert.deepEqual(plain, { name: '便當', servingG: '', servingLabel: '', kcal: 750, p: 30, f: '', c: '', ex: { grain: 4 } });
});
