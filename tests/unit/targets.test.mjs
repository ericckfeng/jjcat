// 依體重試算目標（js/targets.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcBmr, calcTargets, ageFrom, waterGoal, recalcHint, latestInbodyBmr, katchBmr, latestBodyComp, targetWeightFromBodyFat } from '../../js/targets.js';

test('基礎代謝 Mifflin-St Jeor', () => {
  assert.equal(calcBmr({ sex: 'm', weight: 80, height: 172, age: 45 }), 1655);   // 800+1075-225+5
  assert.equal(calcBmr({ sex: 'f', weight: 68, height: 158, age: 66 }), 1177);   // 680+987.5-330-161
  assert.equal(calcBmr({ sex: null, weight: 68, height: 158, age: 66 }), null, '沒選性別不能算');
  assert.equal(calcBmr({ sex: 'f', weight: 68, height: null, age: 66 }), null);
  assert.equal(calcBmr({ sex: 'f', weight: 68, height: 158, age: null }), null);
});

test('年齡由出生年推算；不合理的出生年不算', () => {
  const now = new Date(2026, 10, 19);
  assert.equal(ageFrom(1960, now), 66);
  assert.equal(ageFrom('1960', now), 66);
  assert.equal(ageFrom(2020, now), null);
  assert.equal(ageFrom(1900, now), null);
  assert.equal(ageFrom('', now), null);
});

test('一般情況：消耗 − 赤字，蛋白質 1.6、脂肪 0.8 g/kg，碳水回推', () => {
  const t = calcTargets({ sex: 'm', weight: 80, height: 172, age: 45, activity: 'light', goal: 'lose', protein: 1.6 });
  assert.deepEqual(t, { bmr: 1655, bmrSource: 'formula', tdee: 2276, kcal: 1780, p: 128, c: 173, f: 64, water: 2800, floored: false, adjusted: false });
  assert.ok(Math.abs(t.p * 4 + t.c * 4 + t.f * 9 - t.kcal) <= 4, '三大營養素加起來等於熱量');
});

test('熱量不低於基礎代謝和 1200 kcal', () => {
  const t = calcTargets({ sex: 'f', weight: 68, height: 158, age: 66, activity: 'low', goal: 'lose' });
  assert.equal(t.kcal, 1200);
  assert.equal(t.floored, true);
  const big = calcTargets({ sex: 'm', weight: 70, height: 170, age: 30, activity: 'low', goal: 'lose' });
  assert.ok(big.kcal >= big.bmr, '基礎代謝高於 1200 時以基礎代謝為底線');
  assert.equal(big.floored, true);
});

test('蛋白質＋脂肪太多時，先減脂肪、再減蛋白質，碳水至少留 100 g', () => {
  const t = calcTargets({ sex: 'f', weight: 95, height: 155, age: 70, activity: 'low', goal: 'lose', protein: 2.0 });
  assert.equal(t.adjusted, true);
  assert.ok(t.c >= 100);
  assert.equal(t.f, 48);           // 脂肪降到 0.5 g/kg
  assert.ok(t.p >= 95 && t.p < 190);
  assert.ok(Math.abs(t.p * 4 + t.c * 4 + t.f * 9 - t.kcal) <= 13);
});

test('喝水 35 ml/kg，取到 50 ml，最多 3000 ml', () => {
  assert.equal(calcTargets({ sex: 'f', weight: 50, height: 155, age: 30, activity: 'active', goal: 'keep' }).water, 1750);
  assert.equal(calcTargets({ sex: 'f', weight: 95, height: 155, age: 70 }).water, 3000);
});

test('維持體重：熱量＝每日消耗（取到 10）', () => {
  const t = calcTargets({ sex: 'f', weight: 50, height: 155, age: 30, activity: 'active', goal: 'keep' });
  assert.equal(t.kcal, 1800);  // 1158 × 1.55 = 1795 → 1800
});

test('資料不夠就回傳 null', () => {
  assert.equal(calcTargets({ sex: 'f', weight: null, height: 158, age: 60 }), null);
});

test('這天的喝水目標：運動每 30 分鐘 +250 ml', () => {
  assert.equal(waterGoal(2000, 0), 2000);
  assert.equal(waterGoal(2000, 29), 2000);
  assert.equal(waterGoal(2000, 60), 2500);
  assert.equal(waterGoal(2000, null), 2000);
  assert.equal(waterGoal(null, 60), null, '沒設喝水目標就沒有');
});

test('7 天平均體重和試算時差 2 公斤以上才提醒重算', () => {
  assert.equal(recalcHint({ weight: 70 }, 68.1), null);
  assert.equal(recalcHint({ weight: 70 }, 68), -2);
  assert.equal(recalcHint({ weight: 70 }, 72.4), 2.4);
  assert.equal(recalcHint(null, 60), null);
  assert.equal(recalcHint({ weight: 70 }, null), null);
});

test('有 InBody 基礎代謝就用它，不需要性別、身高、年齡', () => {
  const t = calcTargets({ weight: 80, activity: 'light', goal: 'lose', protein: 1.6, measuredBmr: 1720 });
  assert.equal(t.bmr, 1720);
  assert.equal(t.bmrSource, 'inbody');
  assert.equal(t.tdee, 2365);          // 1720 × 1.375
  assert.equal(t.kcal, 1870);          // 2365 − 500 → 1870
  assert.equal(calcTargets({ measuredBmr: 1720 }), null, '還是要體重');
  const f = calcTargets({ sex: 'm', weight: 80, height: 172, age: 45, measuredBmr: '' });
  assert.equal(f.bmrSource, 'formula', '空白就用公式');
});

test('最近一次 InBody 基礎代謝：90 天內才算', () => {
  const days = { '2026-07-01': { bmr: 1200 }, '2026-09-01': { bmr: 1250 }, '2026-11-10': { bmr: 1262.4, weight: 68 }, '2026-11-20': { bmr: 1300 } };
  assert.deepEqual(latestInbodyBmr(days, '2026-11-19'), { value: 1262, date: '2026-11-10' });
  assert.deepEqual(latestInbodyBmr({ '2026-09-01': { bmr: 1250 } }, '2026-11-19'), { value: 1250, date: '2026-09-01' });
  assert.equal(latestInbodyBmr({ '2026-08-20': { bmr: 1250 } }, '2026-11-19'), null);
  assert.equal(latestInbodyBmr({}, '2026-11-19'), null);
});

test('用去脂體重算基礎代謝（Katch-McArdle）', () => {
  assert.equal(katchBmr(50), 1450);
  assert.equal(katchBmr(46.2), 1368);
  assert.equal(katchBmr(null), null);
  const t = calcTargets({ weight: 68, measuredBmr: katchBmr(46.2), measuredSource: 'ffm' });
  assert.equal(t.bmr, 1368);
  assert.equal(t.bmrSource, 'ffm');
});

test('最近一次同一天有體重和體脂率 → 去脂體重', () => {
  const days = { '2026-10-01': { weight: 70, bodyFat: 35 }, '2026-11-10': { weight: 68, bodyFat: 32 }, '2026-11-12': { bodyFat: 31 }, '2026-11-15': { weight: 67.5 } };
  assert.deepEqual(latestBodyComp(days, '2026-11-19'), { date: '2026-11-10', weight: 68, bodyFat: 32, ffm: 46.2 });
  assert.equal(latestBodyComp({ '2026-08-01': { weight: 70, bodyFat: 30 } }, '2026-11-19'), null, '超過 90 天');
  assert.equal(latestBodyComp({}, '2026-11-19'), null);
});

test('用目標體脂率算目標體重（去脂體重不變）', () => {
  assert.equal(targetWeightFromBodyFat(50, 28), 69.4);
  assert.equal(targetWeightFromBodyFat(46.2, 30), 66);
  assert.equal(targetWeightFromBodyFat(50, 2), null);
  assert.equal(targetWeightFromBodyFat(50, 60), null);
  assert.equal(targetWeightFromBodyFat(null, 28), null);
});
