// BMI、身體尺寸、睡眠計算（js/body.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcBmi, bmiCategory, healthyWeightRange, waistRisk, waistHipRatio, sleepMinutes, fmtDuration, daySleep, rollingAverage, weightAvgChange } from '../../js/body.js';

test('BMI 計算', () => {
  assert.equal(calcBmi(70.6, 168), 25);
  assert.equal(calcBmi(null, 168), null);
  assert.equal(calcBmi(70, null), null);
});
test('BMI 分級（國健署）', () => {
  assert.equal(bmiCategory(18.4).label, '體重過輕');
  assert.equal(bmiCategory(18.5).label, '健康體位');
  assert.equal(bmiCategory(23.9).label, '健康體位');
  assert.equal(bmiCategory(24).label, '過重');
  assert.equal(bmiCategory(27).label, '輕度肥胖');
  assert.equal(bmiCategory(30).label, '中度肥胖');
  assert.equal(bmiCategory(35).label, '重度肥胖');
});
test('健康體重範圍', () => {
  assert.deepEqual(healthyWeightRange(168), { min: 52.2, max: 67.7 });
});
test('腰圍標準：男 90、女 80', () => {
  assert.equal(waistRisk(90, 'm').high, true);
  assert.equal(waistRisk(89.9, 'm').high, false);
  assert.equal(waistRisk(80, 'f').high, true);
  assert.equal(waistRisk(85, null), null);
});
test('腰臀比', () => {
  assert.equal(waistHipRatio(91, 100, 'm').high, true);
  assert.equal(waistHipRatio(85, 100, 'f').high, false);
});
test('睡眠時數（跨午夜、凌晨才睡）', () => {
  assert.equal(sleepMinutes('23:30', '07:00'), 450);
  assert.equal(sleepMinutes('03:00', '05:00'), 120);
  assert.equal(sleepMinutes('22:00', '06:00'), 480);
  assert.equal(sleepMinutes('', '06:00'), null);
  assert.equal(fmtDuration(450), '7 小時 30 分');
  assert.equal(fmtDuration(45), '45 分');
});
test('一天的總睡眠＝昨晚＋補眠；欄位不存在也不會出錯', () => {
  assert.deepEqual(daySleep({ sleepMin: 450, sleepQ: 4, naps: [{ min: 30 }, { min: 20 }] }), { night: 450, nap: 50, total: 500, quality: 4 });
  assert.deepEqual(daySleep(undefined), { night: 0, nap: 0, total: 0, quality: null });
});

test('7 日移動平均：取這天和前 6 天有記錄的值，不用每天量', () => {
  const days = {
    '2026-11-01': { weight: 70 },
    '2026-11-03': { weight: 69 },
    '2026-11-04': { weight: 71.5 },
    '2026-11-08': { weight: 68 },
    '2026-11-10': { weight: '' }, // 清空過的欄位
    '2026-11-20': { waist: 80 }
  };
  const dates = ['2026-11-01', '2026-11-02', '2026-11-04', '2026-11-07', '2026-11-08', '2026-11-10', '2026-11-12', '2026-11-20'];
  assert.deepEqual(rollingAverage(days, 'weight', dates), [
    70,          // 只有自己
    70,          // 11/1
    70.2,        // 11/1, 3, 4 → 210.5 / 3
    70.2,        // 11/1–7 一樣三筆
    69.5,        // 11/2–8：69, 71.5, 68
    69.8,        // 11/4–10：71.5, 68
    68,          // 11/6–12：68
    null         // 11/14–20 沒有體重
  ]);
});

test('7 日移動平均：視窗可以跨月、跨年，也可以換天數', () => {
  const days = { '2025-12-28': { weight: 60 }, '2026-01-02': { weight: 62 } };
  assert.deepEqual(rollingAverage(days, 'weight', ['2026-01-02', '2026-01-04']), [61, 62]);
  assert.deepEqual(rollingAverage(days, 'weight', ['2026-01-02'], 3), [62]);
  assert.deepEqual(rollingAverage(undefined, 'weight', ['2026-01-02']), [null]);
});

test('期間體重變化看 7 天平均的頭尾；量不到 2 次就不算', () => {
  const days = { '2026-11-01': { weight: 71 }, '2026-11-02': { weight: 70 }, '2026-11-05': { weight: 71.2 }, '2026-11-07': { weight: 69.4 } };
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
  // 11/2 平均 (71+70)/2=70.5；11/7 平均 (71+70+71.2+69.4)/4=70.4
  assert.deepEqual(weightAvgChange(days, dates), { first: 70.5, last: 70.4, delta: -0.1 });
  assert.equal(weightAvgChange(days, ['2026-11-07']), null);
  assert.equal(weightAvgChange({}, dates), null);
});
