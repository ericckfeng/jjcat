// 食物資料庫：克數換算、生熟重、六大類份數、搜尋（js/foods.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  nutrientsFor, baseGrams, cookConversion, exchangeGroup, exchangesFor,
  normalize, expandQuery, baseName, searchFoods, isBreakfastTime, energyDensity, densityApplies, isGlutinous
} from '../../js/foods.js';

const foods = JSON.parse(readFileSync(new URL('../../tfda_foods.json', import.meta.url), 'utf8')).foods;
const byName = (n) => { const f = foods.find(x => x.name === n); assert.ok(f, '資料庫找不到 ' + n); return f; };
const top = (q, opts) => searchFoods(foods, q, opts).map(r => r.food.name);

/* ---- 克數換算 ---- */
const demo = { id: 'x', name: '測試肉', category: '肉類', state: 'raw', per100g: { kcal: 100, p: 20, f: 2, c: 0, na: 50 } };

test('依克數等比例換算，熱量取整數、營養素取一位小數', () => {
  const n = nutrientsFor(demo, 135);
  assert.equal(n.kcal, 135);
  assert.equal(n.p, 27); assert.equal(n.f, 2.7); assert.equal(n.c, 0); assert.equal(n.na, 68);
  assert.equal(n.sugar, null, '資料庫沒有的值維持 null，不當成 0');
});
test('克數不合理時回傳 0', () => {
  assert.equal(nutrientsFor(demo, 0).kcal, 0);
  assert.equal(nutrientsFor(demo, -5).kcal, 0);
  assert.equal(nutrientsFor(demo, 'abc').kcal, 0);
  assert.equal(nutrientsFor(demo, 0).ex, null);
});
test('生肉秤熟重：熟 135 g ≈ 生 180 g', () => {
  assert.equal(cookConversion(demo).factor, 0.75);
  assert.equal(baseGrams(demo, 135, 'cooked'), 180);
  assert.equal(nutrientsFor(demo, 135, 'cooked').kcal, 180);
});
test('生米秤熟重（飯）：飯 220 g ≈ 生米 100 g', () => {
  const rice = byName('稉米平均值');
  assert.equal(cookConversion(rice).factor, 2.2);
  assert.ok(Math.abs(baseGrams(rice, 220, 'cooked') - 100) < 1e-9);
});
test('沒有定義換算的食物，選熟重也不會改變克數', () => {
  for (const n of ['白飯', '花椰菜', '小米', '米胚芽', '玉米粉']) {
    const f = foods.find(x => x.name === n);
    if (!f) continue;
    assert.equal(cookConversion(f), null, n);
    assert.equal(baseGrams(f, 150, 'cooked'), 150, n);
  }
});

/* ---- 六大類份數 ---- */
test('六大類份數依代換表換算', () => {
  assert.deepEqual(nutrientsFor(byName('白飯'), 200).ex, { grain: 5.5 });   // 碳水 82 g ÷ 15
  assert.deepEqual(nutrientsFor(byName('里肌肉(肉雞)'), 135).ex, { prot: 4.6 }); // 蛋白質 32 g ÷ 7
  assert.deepEqual(nutrientsFor(byName('花椰菜'), 160).ex, { veg: 1.6 });   // 生重 100 g ＝ 1 份
  assert.deepEqual(nutrientsFor(byName('橄欖油'), 15).ex, { oil: 3 });      // 脂肪 15 g ÷ 5
  assert.ok(nutrientsFor(byName('奇異果'), 100).ex.fruit > 0);
  assert.ok(nutrientsFor(byName('全脂鮮乳平均值'), 240).ex.dairy > 0.8);
});
test('分類規則：豆製品、豆類、豆莢、乾貨蔬菜', () => {
  for (const n of ['傳統豆腐', '五香豆干', '豆漿', '黃豆', '毛豆仁']) assert.equal(exchangeGroup(byName(n)), 'prot', n);
  for (const n of ['紅豆', '綠豆', '豌豆仁']) assert.equal(exchangeGroup(byName(n)), 'grain', n);
  assert.equal(exchangeGroup(byName('敏豆莢')), 'veg');
  // 乾貨不能用「100 g ＝ 1 份」，否則 100 g 乾木耳會變成 1 份
  const dry = foods.find(f => f.category === '菇類' && /乾/.test(f.note || ''));
  assert.ok(exchangesFor(dry, 100).veg > 2);
});
test('混合食物（加工、糕餅、飲料）不猜份數', () => {
  const cake = foods.find(f => f.category === '糕餅點心類');
  assert.equal(exchangesFor(cake, 100), null);
  assert.equal(exchangeGroup({ category: '調味料及香辛料類', name: '醬油', per100g: {} }), null);
});

/* ---- 搜尋 ---- */
test('寫法統一：全形、空白、臺／台、蕃／番、藷／薯', () => {
  assert.equal(normalize(' 臺灣 蕃茄 '), '台灣番茄');
  assert.equal(normalize('ＡＢＣ'), 'abc');
  assert.equal(normalize('甘藷'), normalize('甘薯'));
});
test('同義詞展開不會重複套用（「雞蛋」不會變成「雞雞蛋」）', () => {
  const t = expandQuery('雞蛋').map(x => x.term);
  assert.ok(t.includes('蛋'));
  assert.ok(!t.some(x => x.includes('雞雞')));
  assert.deepEqual(expandQuery(''), []);
});
test('多次取樣合成一組，代表項是平均值', () => {
  assert.equal(baseName('北蕉(2月取樣)'), '北蕉');
  assert.equal(baseName('北蕉平均值'), '北蕉');
  const r = searchFoods(foods, '香蕉')[0];
  assert.equal(r.food.name, '北蕉平均值');
  assert.ok(r.variants.length >= 3);
});
test('常見說法找得到對的食物（排第一）', () => {
  const cases = {
    '地瓜': /甘藷/, '芭樂': /芭樂|番石榴/, '花椰菜': /花椰菜|青花菜/, '豆奶': /^豆漿/,
    '雞胸肉': /里肌肉|清肉|胸/, '鮮奶': /鮮乳/, '高麗菜': /甘藍/, '蛋': /^雞蛋/, '白飯': /^白飯$/,
    '起司': /乾酪/, '番茄': /番茄/, '蕃茄': /番茄/, '豆腐': /豆腐$/
  };
  for (const [q, re] of Object.entries(cases)) assert.match(top(q)[0] || '(無)', re, '搜尋「' + q + '」');
});
test('名稱主體在結尾：「鮮奶」不會先出現鮮奶可可、「豆腐」不會先出現豆腐皮', () => {
  assert.ok(!/可可|布丁/.test(top('鮮奶')[0]));
  assert.notEqual(top('豆腐')[0], '豆腐皮');
});
test('已被 TFDA 刪除的品項不出現在搜尋', () => {
  const list = [{ id: 'a', name: '測試蛋', category: '蛋類', per100g: { kcal: 1 }, removed: '2026' }, { id: 'b', name: '測試蛋糕', category: '糕餅點心類', per100g: { kcal: 1 } }];
  assert.deepEqual(searchFoods(list, '測試蛋').map(r => r.food.id), ['b']);
});
test('早上 05:00–10:30 把早餐食材往前排', () => {
  assert.equal(isBreakfastTime(new Date(2026, 0, 1, 5, 0)), true);
  assert.equal(isBreakfastTime(new Date(2026, 0, 1, 10, 30)), true);
  assert.equal(isBreakfastTime(new Date(2026, 0, 1, 10, 31)), false);
  assert.equal(isBreakfastTime(null), false);
  const list = [
    { id: 'a', name: '黑糖糕', category: '糕餅點心類', per100g: { kcal: 1 } },
    { id: 'b', name: '黑糖饅頭', category: '糕餅點心類', per100g: { kcal: 1 } }
  ];
  assert.equal(searchFoods(list, '黑糖', { now: new Date(2026, 0, 1, 15, 0) })[0].food.id, 'a');
  assert.equal(searchFoods(list, '黑糖', { now: new Date(2026, 0, 1, 7, 0) })[0].food.id, 'b');
});
test('全部 2,000 多筆搜尋一次夠快（每次打字都會搜）', () => {
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) searchFoods(foods, '雞');
  assert.ok((performance.now() - t0) / 20 < 30, '每次搜尋超過 30 ms');
});

/* ---- 熱量密度 ---- */

test('熱量密度：每公克 3 大卡以上算高（油炸、糕餅、堅果、果乾、油）', () => {
  assert.deepEqual(energyDensity({ name: '炸雞', category: '加工調理食品及其他類', per100g: { kcal: 320 } }), { perG: 3.2, high: true });
  assert.deepEqual(energyDensity({ name: '白飯', category: '穀物類', state: 'cooked', per100g: { kcal: 182 } }), { perG: 1.8, high: false });
  const real = (n) => energyDensity(byName(n));
  assert.equal(real('芒果乾').high, true, '直接吃的果乾要標');
  assert.equal(real('白皮甘藷'), null, '生的根莖類沒煮不標');
});

test('不直接吃的乾料不標：麵粉、生米、奶粉、沖泡包、香料粉', () => {
  for (const n of ['中筋麵粉', '小米', '全脂奶粉', '咖啡沖泡包(三合一)', '黑胡椒粉']) {
    assert.equal(densityApplies(byName(n)), false, n);
    assert.equal(energyDensity(byName(n)), null, n);
  }
});

test('熱量密度用實際吃的重量算；AI 估的品項（沒有分類）也能算', () => {
  const ai = { name: '鹹酥雞', per100g: { kcal: 330 } };
  assert.equal(energyDensity(ai).high, true);
  assert.deepEqual(energyDensity(ai, 1.5), { perG: 1.5, high: false });
  assert.equal(energyDensity({ name: 'x', per100g: { kcal: 0 } }), null);
});

/* ---- 糯米類 ---- */
test('糯米類：衛福部資料（名稱、別名、備註）', () => {
  for (const n of ['肉粽', '鹼粽', '筒仔米糕', '豬血糕', '鹹麻糬', '冷凍芝麻湯圓', '冷藏甜年糕', '黑秈糯糙米', '糯米飯糰', '糯米漿', '芝麻糊沖泡包', '糯玉米(紫色)']) {
    assert.equal(isGlutinous(byName(n)), true, n);
  }
  for (const n of ['糯米椒', '糯米醋', '冷藏寧波年糕', '冷藏廣式蘿蔔糕', '冷藏廣式芋頭粿', '粉粿', '米粄條', '粿仔條', '白飯']) {
    assert.equal(isGlutinous(byName(n)), false, n);
  }
});
test('糯米類：書上和 AI 的小吃名稱', () => {
  for (const n of ['蓮子肉粽', '粿粽', '油飯', '草仔粿', '紅龜粿', '客家湯圓', '艾草粄', '紅豆粄', '草莓大福', '黑糖米糕', '紅豆麻糬', '甜粿']) {
    assert.equal(isGlutinous({ name: n }), true, n);
  }
  for (const n of ['碗粿', '鼎邊銼', '客家粄條', '湯粄條', '蘿蔔糕', '黑糖發糕', '紅豆芋圓', '滷肉飯']) {
    assert.equal(isGlutinous({ name: n }), false, n);
  }
  assert.equal(isGlutinous(null), false);
});
