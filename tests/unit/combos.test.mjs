// 套餐（js/combos.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotOf, comboFromCart, resolveCombo, comboTotals, comboSummary, searchCombos, sortCombos } from '../../js/combos.js';
import { mergeData } from '../../js/sync.js';

const rice = { id: 'A0100201', name: '白米', category: '穀物類', state: 'raw', aliases: ['米'], per100g: { kcal: 350, p: 7, f: 1, c: 78 } };
const chicken = { id: 'D0100101', name: '雞胸肉', category: '肉類', state: 'raw', per100g: { kcal: 100, p: 22, f: 1, c: 0 } };
const nuts = { id: 'cf_n', name: '堅果包', serving: { g: 35, label: '1 包' }, per100g: { kcal: 285.71, p: 8.57, f: 28.57 }, exPer100g: { oil: 5.71 }, updatedAt: 1 };
const noodle = { id: 'cf_m', name: '牛肉麵', serving: { label: '1 碗' }, perServing: { kcal: 650, p: 30 }, exPerServing: { grain: 4, prot: 2 }, updatedAt: 1 };
const aiFood = { name: '滷蛋', per100g: { kcal: 140, p: 12 }, ai: 'photo' };
const mineIds = new Set(['cf_n', 'cf_m']);
const mine = (f) => mineIds.has(f.id);

const cart = [
  { food: rice, grams: 150, weighed: 'cooked' },
  { food: chicken, grams: 100, weighed: 'asis' },
  { food: nuts, grams: 35, weighed: 'asis' },
  { food: noodle, grams: 1, weighed: 'asis' },
  { food: aiFood, grams: 50, weighed: 'asis' }
];

test('購物車存成套餐：每樣記 id 和 snapshot，AI 估的沒有 id', () => {
  const { combo } = comboFromCart(cart, { id: 'cb_1', name: ' 午餐便當 ', now: 9, mine });
  assert.equal(combo.name, '午餐便當');
  assert.equal(combo.updatedAt, 9);
  assert.deepEqual(combo.items.map(i => [i.foodId, i.customFoodId, i.grams, i.weighed]), [
    ['A0100201', undefined, 150, 'cooked'], ['D0100101', undefined, 100, 'asis'],
    [undefined, 'cf_n', 35, 'asis'], [undefined, 'cf_m', 1, 'asis'], [undefined, undefined, 50, 'asis']
  ]);
  assert.equal(combo.items[0].snapshot.aliases, undefined, '只留算營養要用的欄位');
  assert.equal(combo.items[4].snapshot.ai, 'photo');
  assert.equal(comboFromCart(cart, { id: 'x', name: ' ', now: 1 }).error, '請幫套餐取個名字');
  assert.equal(comboFromCart([], { id: 'x', name: 'a', now: 1 }).error, '購物車裡沒有東西');
});

test('snapshot 是複本：之後改原本的食物不會改到套餐', () => {
  const f = JSON.parse(JSON.stringify(nuts));
  const s = snapshotOf(f);
  f.per100g.kcal = 1;
  assert.equal(s.per100g.kcal, 285.71);
});

test('選套餐：找得到就用現在的資料，找不到（刪掉、AI 估的）用 snapshot', () => {
  const { combo } = comboFromCart(cart, { id: 'cb_1', name: '便當', now: 9, mine });
  const newNuts = { ...nuts, per100g: { kcal: 300 } };
  const r = resolveCombo(combo, { tfda: [rice], mine: [newNuts] });
  assert.equal(r[0].food, rice);
  assert.equal(r[0].weighed, 'cooked');
  assert.equal(r[1].fromSnapshot, true, '雞胸肉不在資料庫 → snapshot');
  assert.equal(r[1].food.id, 'D0100101', 'TFDA 的照樣帶 id（記錄的 foodId）');
  assert.equal(r[2].food, newNuts, '我的食物改過 → 用新的');
  assert.equal(r[3].fromSnapshot, true, '牛肉麵刪掉了 → snapshot');
  assert.equal(r[3].food.id, undefined, '刪掉的我的食物不再連到它');
  assert.equal(r[3].food.perServing.kcal, 650);
  assert.equal(r[4].food.ai, 'photo');
  // 資料庫還沒載入：一律用 snapshot
  assert.ok(resolveCombo(combo, { tfda: null, mine: [] }).every(x => x.fromSnapshot));
});

test('我的食物從以份計改成以克計：填的數字意思不同，用 snapshot', () => {
  const { combo } = comboFromCart([{ food: noodle, grams: 2 }], { id: 'cb', name: 'a', now: 1, mine });
  const changed = { id: 'cf_m', name: '牛肉麵', serving: { g: 600 }, per100g: { kcal: 100 } };
  const [r] = resolveCombo(combo, { mine: [changed] });
  assert.equal(r.fromSnapshot, true);
  assert.equal(r.food.perServing.kcal, 650);
  assert.equal(r.grams, 2);
});

test('熟重：資料庫沒有生熟換算的食物不會變成熟重', () => {
  const combo = { items: [{ foodId: 'X', snapshot: { name: '豆漿', per100g: { kcal: 50 } }, grams: 200, weighed: 'cooked' }] };
  assert.equal(resolveCombo(combo)[0].weighed, 'asis');
});

test('合計、摘要、搜尋', () => {
  const { combo } = comboFromCart(cart.slice(1, 4), { id: 'cb_1', name: '健身餐', now: 9, mine });
  const t = comboTotals(combo);
  assert.equal(t.kcal, 100 + 100 + 650);
  assert.deepEqual(t.ex, { prot: 5.1, oil: 2, grain: 4 });
  assert.equal(comboSummary(combo), '雞胸肉、堅果包、牛肉麵');
  assert.equal(comboSummary(combo, 2), '雞胸肉、堅果包…等 3 樣');
  assert.deepEqual(searchCombos([combo], '健身').map(c => c.id), ['cb_1']);
  assert.deepEqual(searchCombos([combo], '牛肉'), [combo], '也找裡面的食物');
  assert.deepEqual(searchCombos([combo], '披薩'), []);
});

test('排序：最近記過的在前，沒記過的看修改時間', () => {
  const a = { id: 'a', updatedAt: 1 }, b = { id: 'b', updatedAt: 3 }, c = { id: 'c', updatedAt: 2 };
  const logs = { '2026-11-20': [{ comboId: 'a' }], '2026-11-19': [{ comboId: 'c' }] };
  assert.deepEqual(sortCombos([a, b, c], logs).map(x => x.id), ['a', 'c', 'b']);
});

test('同步：combos 以 id＋updatedAt 合併，刪除用 tomb combos:<id>', () => {
  const T = Date.now();
  const base = { targets: {}, logs: {}, days: {}, quickItems: [] };
  const local = { ...base, combos: [{ id: 'a', name: 'A', items: [], updatedAt: T + 2 }, { id: 'b', name: 'B', items: [], updatedAt: T + 1 }], tomb: {} };
  const remote = { ...base, combos: [{ id: 'a', name: 'A2', items: [], updatedAt: T + 3 }, { id: 'c', name: 'C', items: [], updatedAt: T + 1 }], tomb: { 'combos:b': T + 5 } };
  const m = mergeData(local, remote);
  assert.deepEqual(m.combos.map(c => c.name), ['A2', 'C']);
});

test('食物資料庫的食物：記 src＋packFoodId；資料庫還在就用現在的、刪掉了用 snapshot', () => {
  const burger = { id: 'pf_1', name: '漢堡', brand: '麥當勞', base: '漢堡', serving: { g: 102 }, perServing: { kcal: 260 } };
  const { combo } = comboFromCart([{ food: burger, grams: 2 }], { id: 'cb', name: '速食', now: 1, packOf: (f) => (f === burger ? 'pk_a' : null) });
  assert.deepEqual([combo.items[0].src, combo.items[0].packFoodId, combo.items[0].foodId], ['pk_a', 'pf_1', undefined]);
  assert.equal(combo.items[0].snapshot.brand, '麥當勞');
  const newer = { ...burger, perServing: { kcal: 270 } };
  assert.equal(resolveCombo(combo, { packs: [{ id: 'pk_a', foods: [newer] }] })[0].food, newer);
  const gone = resolveCombo(combo, { packs: [] })[0];
  assert.equal(gone.fromSnapshot, true);
  assert.equal(gone.food.perServing.kcal, 260);
  assert.equal(gone.food.id, undefined);
});
