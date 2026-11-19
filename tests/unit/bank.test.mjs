// 熱量銀行（js/bank.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekOf, calorieBank, bankMacros } from '../../js/bank.js';

// 2026-11-16 是週一
const W = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
const eat = (map) => (d) => (d in map ? { kcal: map[d], count: 1 } : { kcal: 0, count: 0 });

test('一週是週一～週日', () => {
  assert.deepEqual(weekOf('2026-11-19'), W);
  assert.deepEqual(weekOf('2026-11-16'), W);
  assert.deepEqual(weekOf('2026-11-22'), W);
  assert.equal(weekOf('2026-01-01')[0], '2025-12-29');
});

test('週一：就是基準', () => {
  const b = calorieBank({ base: 1800, date: '2026-11-16', dayKcal: eat({ '2026-11-16': 2500 }) });
  assert.equal(b.todayTarget, 1800, '今天吃的不影響今天的建議');
  assert.equal(b.daysLeft, 7);
  assert.equal(b.budget, 12600);
});

test('前幾天多吃：差額平均攤到剩下的天數（含今天）', () => {
  // 週一～週三各多吃 300（共 900），週四起剩 4 天 → 每天少 225
  const b = calorieBank({ base: 1800, date: '2026-11-19', dayKcal: eat({ '2026-11-16': 2100, '2026-11-17': 2100, '2026-11-18': 2100 }) });
  assert.equal(b.usedBefore, 6300);
  assert.equal(b.balance, -900);
  assert.equal(b.daysLeft, 4);
  assert.equal(b.todayTarget, 1580);   // 1575 → 取到 10
  assert.equal(b.adjust, -220);
  assert.equal(b.floored, false);
});

test('沒記錄的日子當作吃了基準量', () => {
  const b = calorieBank({ base: 1800, date: '2026-11-19', dayKcal: eat({ '2026-11-17': 2400 }) });
  assert.equal(b.balance, -600);
  assert.equal(b.todayTarget, 1650);
});

test('不低於基礎代謝和 1200', () => {
  const big = { '2026-11-16': 3500, '2026-11-17': 3500, '2026-11-18': 3500, '2026-11-19': 3500, '2026-11-20': 3500 };
  const b = calorieBank({ base: 1800, date: '2026-11-21', dayKcal: eat(big) });
  assert.equal(b.todayTarget, 1200);
  assert.equal(b.floored, true);
  assert.equal(calorieBank({ base: 1800, date: '2026-11-21', dayKcal: eat(big), bmr: 1450 }).todayTarget, 1450);
});

test('營養師給的基準低於 1200：以基準為底，不往下扣', () => {
  const b = calorieBank({ base: 1100, date: '2026-11-19', dayKcal: eat({ '2026-11-16': 1600 }) });
  assert.equal(b.todayTarget, 1100);
  assert.equal(b.floored, true);
  assert.equal(calorieBank({ base: 1100, date: '2026-11-19', dayKcal: eat({}) }).todayTarget, 1100);
});

test('少吃存下來的，每天最多加回 300', () => {
  const b = calorieBank({ base: 1800, date: '2026-11-19', dayKcal: eat({ '2026-11-16': 1000, '2026-11-17': 1000, '2026-11-18': 1000 }) });
  assert.equal(b.balance, 2400);
  assert.equal(b.todayTarget, 2100);
  assert.equal(b.capped, true);
  const small = calorieBank({ base: 1800, date: '2026-11-19', dayKcal: eat({ '2026-11-16': 1600 }) });
  assert.equal(small.todayTarget, 1850);
  assert.equal(small.capped, false);
});

test('沒有基準就不算', () => {
  assert.equal(calorieBank({ base: 0, date: '2026-11-19', dayKcal: eat({}) }), null);
});

test('營養素：蛋白質不變，差額依碳水、油脂比例分攤', () => {
  const m = bankMacros({ kcal: 1800, p: 90, c: 220, f: 60 }, 1580);
  assert.equal(m.p, 90);
  // 碳水 880 kcal、油脂 540 kcal；少 220 → 碳水少 136 kcal（34 g）、油脂少 84 kcal（9 g）
  assert.equal(m.c, 186);
  assert.equal(m.f, 51);
  assert.deepEqual(bankMacros({ kcal: 1800, p: 90, c: 220, f: 60 }, 1800), { p: 90, c: 220, f: 60 });
  assert.deepEqual(bankMacros({ kcal: 1800, p: 90 }, 1500), { p: 90, c: null, f: null }, '沒設碳水、油脂就不調');
  assert.deepEqual(bankMacros({ kcal: 1800, p: 90, c: 200 }, 2000), { p: 90, c: 250, f: null });
});
