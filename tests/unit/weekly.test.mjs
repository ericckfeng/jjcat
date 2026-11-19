// 小芽週報（js/highlights.js 的 buildWeekly、lastWeek、weeklyText）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekly, lastWeek, weeklyText } from '../../js/highlights.js';

const base = { days: 7, loggedDays: 7, avgKcal: 1800, targetKcal: 1800, macroDays: 0, exDays: 0, avgEx: {}, targetEx: {}, goodKcalDays: 0, waterMetDays: 0, exercise: { totalMin: 0, days: 0 } };

test('上一個完整的週一～週日', () => {
  assert.deepEqual(lastWeek('2026-11-19'), { from: '2026-11-09', to: '2026-11-15' });  // 週四
  assert.deepEqual(lastWeek('2026-11-16'), { from: '2026-11-09', to: '2026-11-15' });  // 週一
  assert.deepEqual(lastWeek('2026-11-22'), { from: '2026-11-09', to: '2026-11-15' });  // 週日：這週還沒完
  assert.deepEqual(lastWeek('2026-01-01'), { from: '2025-12-22', to: '2025-12-28' });  // 跨年
});

test('做得好的事：最多 3 條，最重要的在前', () => {
  const w = buildWeekly({ ...base, weight: { first: 70.5, last: 70, delta: -0.5 }, targetWeight: 65, goodKcalDays: 5,
    exercise: { totalMin: 150, days: 4 }, waterMetDays: 5 });
  assert.deepEqual(w.good, ['7 天平均體重少了 0.5 公斤，往目標前進 🎉', '這週記錄了 7 天，很用心 📒', '有 5 天吃得剛剛好 👍']);
});

test('沒有好事可說時，給一句鼓勵', () => {
  assert.deepEqual(buildWeekly({ ...base, loggedDays: 1 }).good, ['願意打開 App 記錄，就是很好的開始 🌱']);
});

test('體重往反方向或沒有目標體重：不當成好事', () => {
  const t = (o) => buildWeekly({ ...base, ...o }).good.join();
  assert.doesNotMatch(t({ weight: { first: 60, last: 60.5, delta: 0.5 }, targetWeight: 55 }), /體重/);
  assert.doesNotMatch(t({ weight: { first: 60, last: 59.5, delta: -0.5 } }), /體重/);
  assert.match(t({ weight: { first: 45, last: 45.5, delta: 0.5 }, targetWeight: 50 }), /多了 0.5 公斤，往目標前進/);
});

test('下週可以試的一件事：依序挑最重要的一件', () => {
  const next = (o) => buildWeekly({ ...base, ...o }).tryNext;
  assert.match(next({ loggedDays: 2 }), /每天至少記一餐/);
  assert.match(next({ targetP: 80, macroDays: 5, avgP: 50, avgKcal: 2200 }), /蛋白質/, '蛋白質比熱量優先');
  assert.match(next({ avgKcal: 2100 }), /飯減半碗/);
  assert.match(next({ avgKcal: 1400 }), /三餐都要吃/);
  assert.match(next({ exDays: 4, avgEx: { veg: 1.5 } }), /青菜/);
  assert.match(next({ sleep: { avgMin: 330, days: 5, shortDays: 4 } }), /早 30 分鐘上床/);
  assert.match(next({ water: { avg: 900, goal: null } }), /喝一杯水/);
  assert.match(next({ exDays: 4, avgEx: { veg: 4, fruit: 0.5 }, targetEx: { veg: 4, fruit: 2 } }), /水果/);
  assert.match(next({}), /散步 10 分鐘/);
  assert.match(next({ exercise: { totalMin: 90, days: 3 } }), /保持這週的好習慣/);
});

test('傳 LINE 的文字', () => {
  const t = weeklyText({ from: '2026-11-09', to: '2026-11-15', good: ['A', 'B'], tryNext: 'C', name: '小明' }, (s) => s.slice(5).replace('-', '/'));
  assert.equal(t, '🌱 小芽週報（小明） 11/09～11/15\n這週做得好的事：\n✓ A\n✓ B\n下週可以試的一件事：\n👉 C');
});
