// 跨模組提醒（js/insights.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights } from '../../js/insights.js';

const day = (o = {}) => ({ weight: null, bowel: null, water: null, kcal: 0, count: 0, veg: 0, exItems: 0, ...o });
const keys = (ctx) => buildInsights({ isToday: true, targetKcal: 1800, lastNightMin: null, ...ctx }).map(x => x.key);
const text = (ctx, key) => buildInsights({ isToday: true, targetKcal: 1800, lastNightMin: null, ...ctx }).find(x => x.key === key).text;

test('沒有資料就什麼都不說', () => {
  assert.deepEqual(keys({ d: [day(), day(), day()] }), []);
  assert.deepEqual(keys({}), []);
});

/* ---- 水分滯留 ---- */
test('昨天吃超過目標 10%、今天體重比前一次多 0.5 公斤以上：說明是水分', () => {
  const ctx = { d: [day({ weight: 70.6 }), day({ weight: 70, kcal: 2100, count: 3 }), day()] };
  assert.deepEqual(keys(ctx), ['water-retention']);
  assert.match(text(ctx, 'water-retention'), /多了 0.6 公斤.*昨天吃多.*不是真的胖/);
});
test('前一天沒量，就和前兩天比', () => {
  assert.deepEqual(keys({ d: [day({ weight: 70.5 }), day({ kcal: 2100, count: 3 }), day({ weight: 70 })] }), ['water-retention']);
});
test('體重沒升 0.5、昨天沒吃多、昨天沒記、今天沒量：都不說', () => {
  assert.deepEqual(keys({ d: [day({ weight: 70.4 }), day({ weight: 70, kcal: 2100, count: 3 }), day()] }), []);
  assert.deepEqual(keys({ d: [day({ weight: 71 }), day({ weight: 70, kcal: 1980, count: 3 }), day()] }), []);
  assert.deepEqual(keys({ d: [day({ weight: 71 }), day({ weight: 70 }), day()] }), []);
  assert.deepEqual(keys({ d: [day(), day({ weight: 70, kcal: 2500, count: 3 }), day()] }), []);
  assert.deepEqual(keys({ d: [day({ weight: 71 }), day({ kcal: 2500, count: 3 }), day()] }), [], '找不到前一次體重');
});
test('看過去的日期時說「前一天」', () => {
  const ins = buildInsights({ isToday: false, targetKcal: 1500, d: [day({ weight: 61 }), day({ weight: 60, kcal: 1700, count: 2 }), day()] });
  assert.match(ins[0].text, /前一天吃多/);
});

/* ---- 睡太少 ---- */
test('昨晚睡不到 6 小時：提醒蛋白質、青菜、多喝一杯水（只在今天）', () => {
  const ctx = { d: [day(), day(), day()], lastNightMin: 330 };
  assert.deepEqual(keys(ctx), ['short-sleep']);
  assert.match(text(ctx, 'short-sleep'), /只睡 5.5 小時.*蛋白質和青菜.*200ml/);
  assert.deepEqual(keys({ ...ctx, lastNightMin: 360 }), []);
  assert.deepEqual(buildInsights({ isToday: false, targetKcal: 1800, d: ctx.d, lastNightMin: 300 }), []);
});

/* ---- 排便 ---- */
test('連兩天沒排便：青菜和水都少，兩個都提', () => {
  const ctx = { d: [day({ bowel: 0, veg: 1.5, exItems: 2, water: 800 }), day({ bowel: 0, veg: 2, exItems: 3, water: 1000 }), day()] };
  assert.deepEqual(keys(ctx), ['constipation']);
  assert.match(text(ctx, 'constipation'), /青菜平均 1.8 份.*水平均 900 ml/);
});
test('這天還沒記排便：改看前兩天', () => {
  const ctx = { d: [day(), day({ bowel: 0 }), day({ bowel: 0 })] };
  assert.deepEqual(keys(ctx), ['constipation']);
  assert.match(text(ctx, 'constipation'), /多吃青菜水果、多喝水/, '沒有份數和喝水資料時給一般建議');
});
test('青菜份數不明（有一天沒填六大類）就不說青菜；青菜和水都夠時給一般建議', () => {
  const unknownVeg = { d: [day({ bowel: 0, veg: 0, exItems: 0, water: 2000 }), day({ bowel: 0, veg: 1, exItems: 1, water: 1800 }), day()] };
  assert.doesNotMatch(text(unknownVeg, 'constipation'), /青菜平均/);
  const enough = { d: [day({ bowel: 0, veg: 3, exItems: 2, water: 2000 }), day({ bowel: 0, veg: 4, exItems: 2, water: 1800 }), day()] };
  assert.match(text(enough, 'constipation'), /多吃青菜水果/);
});
test('只有一天沒排便、或有排便：不說', () => {
  assert.deepEqual(keys({ d: [day({ bowel: 0 }), day({ bowel: 1 }), day({ bowel: 0 })] }), []);
  assert.deepEqual(keys({ d: [day({ bowel: 1 }), day({ bowel: 0 }), day({ bowel: 0 })] }), [], '今天有排便就不提');
  assert.deepEqual(keys({ d: [day({ bowel: 0 }), day(), day({ bowel: 0 })] }), []);
});
