// 餐點照片牆（js/photowall.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallDays, wallPhotoCount } from '../../js/photowall.js';

const ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];
test('每天只列有照片的記錄，照餐別、時間排；合計和筆數算全部的', () => {
  const logs = {
    '2026-11-23': [
      { id: 'd', meal: 'dinner', time: '18:30', kcal: 600, hasPhoto: true },
      { id: 'l2', meal: 'lunch', time: '12:40', kcal: 100, hasPhoto: true },
      { id: 'n', meal: 'snack', kcal: 150 },
      { id: 'l1', meal: 'lunch', time: '12:10', kcal: 500.4, hasPhoto: true }
    ]
  };
  const days = wallDays(logs, ['2026-11-23', '2026-11-24'], ORDER);
  assert.deepEqual(days[0].items.map(i => i.id), ['l1', 'l2', 'd']);
  assert.equal(days[0].count, 4);
  assert.equal(days[0].kcal, 1350);
  assert.deepEqual(days[1], { date: '2026-11-24', items: [], count: 0, kcal: 0 });
  assert.equal(wallPhotoCount(days), 3);
});
