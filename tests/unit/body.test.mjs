// BMI、身體尺寸、睡眠計算（js/body.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcBmi, bmiCategory, healthyWeightRange, waistRisk, waistHipRatio, sleepMinutes, fmtDuration, daySleep } from '../../js/body.js';

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
