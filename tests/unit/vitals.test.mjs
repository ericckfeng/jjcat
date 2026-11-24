// 功能開關（js/features.js）、血壓血糖（js/vitals.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureOn, featuresOff } from '../../js/features.js';
import { bpReading, glucoseReading, bpAlert, glucoseAlert, vitalsSummary, bpText, glucoseText } from '../../js/vitals.js';

test('功能開關：沒設過照預設；血壓血糖預設關；控制血糖的人血糖預設開；設過就照設的', () => {
  assert.equal(featureOn({}, 'sleep'), true);
  assert.equal(featureOn({}, 'bp'), false);
  assert.equal(featureOn({ sugarCare: true }, 'glucose'), true);
  assert.equal(featureOn({ sugarCare: true, features: { glucose: false } }, 'glucose'), false);
  assert.equal(featureOn({ features: { sleep: false, bp: true } }, 'bp'), true);
  assert.deepEqual(featuresOff({ features: { sleep: false } }), ['sleep', 'bp', 'glucose']);
});

test('血壓：上下兩個數字都要合理；上面要比下面大；脈搏可以空著', () => {
  assert.deepEqual(bpReading({ sys: '128', dia: '82', pulse: '', t: '08:00' }, 'b1'), { reading: { id: 'b1', t: '08:00', sys: 128, dia: 82 } });
  assert.equal(bpReading({ sys: '128', dia: '82', pulse: '70' }, 'b1').reading.pulse, 70);
  assert.match(bpReading({ sys: '', dia: '82' }, 'b').error, /兩個數字/);
  assert.match(bpReading({ sys: '80', dia: '120' }, 'b').error, /比下面的大/);
});

test('血糖：20～600；種類不認得就算其他', () => {
  assert.deepEqual(glucoseReading({ kind: 'fasting', v: '98', t: '07:00' }, 'g1'), { reading: { id: 'g1', t: '07:00', kind: 'fasting', v: 98 } });
  assert.equal(glucoseReading({ kind: 'x', v: 150 }, 'g').reading.kind, 'other');
  assert.match(glucoseReading({ v: '5' }, 'g').error, /20～600/);
});

test('只提醒明顯危險的數字', () => {
  assert.equal(bpAlert({ sys: 118, dia: 76 }), null);
  assert.equal(bpAlert({ sys: 135, dia: 85 }).level, 'high');
  assert.equal(bpAlert({ sys: 185, dia: 100 }).level, 'urgent');
  assert.equal(glucoseAlert({ v: 110 }), null);
  assert.match(glucoseAlert({ v: 62 }).text, /低血糖/);
  assert.equal(glucoseAlert({ v: 320 }).level, 'urgent');
});

test('期間摘要和一天的寫法', () => {
  const days = {
    '2026-11-23': { bp: [{ sys: 130, dia: 85, t: '07:00' }, { sys: 120, dia: 80, t: '21:00', pulse: 72 }], glucose: [{ kind: 'fasting', v: 100 }, { kind: 'after', v: 160 }] },
    '2026-11-24': { bp: [{ sys: 142, dia: 90 }], glucose: [{ kind: 'fasting', v: 110 }] }
  };
  const s = vitalsSummary(days, ['2026-11-23', '2026-11-24', '2026-11-25']);
  assert.deepEqual({ n: s.bp.n, sys: s.bp.sys, dia: s.bp.dia, max: s.bp.max.sys }, { n: 3, sys: 131, dia: 85, max: 142 });
  assert.deepEqual(s.glucose.map(g => [g.label, g.n, g.avg]), [['空腹', 2, 105], ['飯後 2 小時', 1, 160]]);
  assert.deepEqual(vitalsSummary({}, ['2026-11-23']), { bp: null, glucose: [] });
  assert.equal(bpText(days['2026-11-23'].bp), '07:00 130/85；21:00 120/80 脈搏72');
  assert.equal(glucoseText(days['2026-11-23'].glucose), '空腹 100；飯後 2 小時 160');
});
