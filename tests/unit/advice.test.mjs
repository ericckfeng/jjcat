// 營養師的叮嚀（js/advice.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAdvice, activeAdvice, todaysAdvice, adviceStats, toggleDone } from '../../js/advice.js';

test('貼上的話拆成一條一條：去掉編號、符號，招呼語和太短的不要', () => {
  const text = '您好！\n1. 午餐便當多一份青菜\n2）晚餐飯吃半碗就好\n・每天喝水 2000 ml\n- 少喝含糖飲料，改無糖茶\n三、一週量兩次體重\n\n加油\nOK';
  assert.deepEqual(splitAdvice(text), ['午餐便當多一份青菜', '晚餐飯吃半碗就好', '每天喝水 2000 ml', '少喝含糖飲料，改無糖茶', '一週量兩次體重']);
  assert.deepEqual(splitAdvice(''), []);
});

test('還在提醒的：新的在前；按了「不用再提醒」的不列', () => {
  const list = [{ id: 'a', text: '多吃青菜', date: '2026-11-01' }, { id: 'b', text: '少喝飲料', date: '2026-11-20' }, { id: 'c', text: '早睡', date: '2026-11-21', active: false }];
  assert.deepEqual(activeAdvice(list).map(a => a.id), ['b', 'a']);
});

test('今天放 2 條：不超過 2 條就全放；超過就每天輪流，同一天都一樣', () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, text: id + '一二三', date: '2026-11-0' + (9 - i) }));
  assert.equal(todaysAdvice(list.slice(0, 2), '2026-11-24').length, 2);
  const d1 = todaysAdvice(list, '2026-11-24').map(a => a.id);
  assert.deepEqual(todaysAdvice(list, '2026-11-24').map(a => a.id), d1);
  const d2 = todaysAdvice(list, '2026-11-25').map(a => a.id);
  assert.notDeepEqual(d1, d2);
  // 連續幾天每一條都會輪到
  const seen = new Set();
  for (let i = 20; i < 25; i++) todaysAdvice(list, '2026-11-' + i).forEach(a => seen.add(a.id));
  assert.equal(seen.size, 5);
});

test('做到幾天：只算叮嚀給了之後的日子', () => {
  const list = [{ id: 'a', text: '多吃青菜', date: '2026-11-20' }, { id: 'b', text: '少喝飲料', date: '2026-11-23' }];
  const days = { '2026-11-21': { adviceDone: ['a'] }, '2026-11-23': { adviceDone: ['a', 'b'] }, '2026-11-24': {} };
  const dates = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24'];
  assert.deepEqual(adviceStats(list, days, dates).map(s => [s.advice.id, s.done, s.days]), [['b', 1, 2], ['a', 2, 5]]);
  assert.deepEqual(adviceStats(list, days, ['2026-11-19']).map(s => s.advice.id), []);   // 還沒給的不列
});

test('做到了／取消', () => {
  assert.deepEqual(toggleDone(undefined, 'a'), ['a']);
  assert.deepEqual(toggleDone(['a', 'b'], 'a'), ['b']);
});
