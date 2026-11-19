// 營養師報告的本週重點（js/highlights.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHighlights } from '../../js/highlights.js';

const base = { days: 7, loggedDays: 7, pending: 0, avgKcal: 1800, targetKcal: 1800, overDays: 0, macroDays: 0, exDays: 0, avgEx: {}, targetEx: {}, questions: 0, noBowelDays: 0, exercise: { totalMin: 0, days: 0 } };
const texts = (o, opts) => buildHighlights({ ...base, ...o }, opts).map(h => h.text);

test('沒有資料就沒有重點', () => {
  assert.deepEqual(buildHighlights({}), []);
  assert.deepEqual(buildHighlights(null), []);
});

test('熱量：接近、超過、少很多', () => {
  assert.match(texts({ avgKcal: 1820 })[0], /記錄 7\/7 天，平均每天 1,820 kcal，接近目標 1,800/);
  assert.match(texts({ avgKcal: 2050, overDays: 4 })[0], /比目標多 250；超過目標 4 天/);
  assert.match(texts({ avgKcal: 1300 })[0], /比目標少 500，可能吃得太少/);
  assert.match(texts({ avgKcal: 1650 })[0], /比目標少 150$/);
  assert.equal(buildHighlights({ ...base, avgKcal: 2050 })[0].tone, 'warn');
});

test('記錄天數太少要說明', () => {
  assert.ok(texts({ loggedDays: 4 }).includes('有 3 天沒有飲食記錄，平均數字僅供參考'));
});

test('體重：朝目標前進是 good，沒目標是 info', () => {
  const w = { first: 70.5, last: 70.1, delta: -0.4 };
  const h = buildHighlights({ ...base, weight: w, targetWeight: 65 });
  assert.equal(h[1].text, '體重（7 天平均）70.5 → 70.1 kg（-0.4），目標 65 kg');
  assert.equal(h[1].tone, 'good');
  assert.equal(buildHighlights({ ...base, weight: w }).find(x => /體重/.test(x.text)).tone, 'info');
  assert.equal(buildHighlights({ ...base, weight: { first: 60, last: 60.6, delta: 0.6 }, targetWeight: 55 }).find(x => /體重/.test(x.text)).tone, 'info');
});

test('蛋白質、六大類對照目標', () => {
  const t = texts({ macroDays: 5, avgP: 62, targetP: 80, exDays: 5,
    avgEx: { veg: 2.1, fruit: 0.5, prot: 5, oil: 6, grain: 10 }, targetEx: { veg: 4, fruit: 2, prot: 5, oil: 4, grain: 10 } }, { limit: 10 });
  assert.ok(t.includes('蛋白質平均 62 g，目標 80 g（約 78%）'));
  assert.ok(t.includes('偏少：蔬菜 2.1 份（目標 4）、水果 0.5 份（目標 2）'));
  assert.ok(t.includes('偏多：油脂 6 份（目標 4）'));
  assert.ok(texts({ exDays: 3, avgEx: { veg: 4 }, targetEx: { veg: 4 } }, { limit: 10 }).includes('六大類份數都接近目標'));
  assert.ok(!texts({ exDays: 1, avgEx: { veg: 1 }, targetEx: { veg: 4 } }, { limit: 10 }).some(x => /偏少/.test(x)), '只有 1 天不比較');
});

test('營養素填得少要說明', () => {
  assert.ok(texts({ macroDays: 2 }, { limit: 10 }).includes('只有 2 天有填營養素，蛋白質等數字不完整'));
});

test('睡眠、排便、喝水、暫估、運動', () => {
  const t = texts({
    sleep: { avgMin: 340, days: 6, shortDays: 3, kcalShort: 2100, kcalGood: 1750 },
    noBowelDays: 2, water: { avg: 1100, goal: 2000 }, pending: 2, exercise: { totalMin: 150, days: 4 }
  }, { limit: 10 });
  assert.ok(t.includes('平均睡 5.7 小時，不到 6 小時有 3 天；睡不夠的日子平均多吃 350 kcal'));
  assert.ok(t.includes('有 2 天沒有排便'));
  assert.ok(t.includes('喝水平均 1,100 ml，目標 2,000 ml'));
  assert.ok(t.includes('還有 2 筆「暫估待修」，熱量可能不準'));
  assert.ok(t.includes('運動 4 天，共 150 分鐘'));
  assert.ok(texts({ water: { avg: 1100, goal: null } }, { limit: 10 }).includes('喝水平均 1,100 ml，偏少'));
  assert.ok(!texts({ sleep: { avgMin: 420, days: 6, shortDays: 1 } }, { limit: 10 }).some(x => /睡/.test(x)), '睡得夠就不提');
  assert.ok(texts({}, { limit: 10 }).includes('這段期間沒有運動記錄'));
});

test('最多 5 條，熱量、體重、想問營養師排最前面', () => {
  const t = texts({
    avgKcal: 2050, overDays: 3, weight: { first: 70, last: 69.5, delta: -0.5 }, questions: 2,
    macroDays: 5, avgP: 50, targetP: 80, sleep: { avgMin: 330, days: 5, shortDays: 4 },
    noBowelDays: 3, water: { avg: 800 }, exercise: { totalMin: 60, days: 2 }
  });
  assert.equal(t.length, 5);
  assert.match(t[0], /熱量|kcal/);
  assert.match(t[1], /體重/);
  assert.match(t[2], /想問營養師/);
  assert.match(t[3], /蛋白質/);
  assert.match(t[4], /睡/);
});

test('骨骼肌：減掉的有肌肉要提醒營養師', () => {
  const t = texts({ muscle: { smm1: 24.1, smm2: 23.5, delta: -0.6, weightDelta: -2 } }, { limit: 10 });
  assert.ok(t.includes('骨骼肌 24.1 → 23.5 kg（-0.6），同期體重 -2 kg：減掉的有一部分是肌肉'));
  const g = buildHighlights({ ...base, muscle: { smm1: 24.1, smm2: 24.4, delta: 0.3, weightDelta: -1 } }, { limit: 10 }).find(h => /骨骼肌/.test(h.text));
  assert.equal(g.tone, 'good');
});
