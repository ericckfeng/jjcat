// 一整餐的計算：購物車合計、複製某一餐（js/meals.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumNutr, copyEntries, mealEntries } from '../../js/meals.js';

test('合計熱量、營養素與六大類份數', () => {
  const t = sumNutr([
    { kcal: 125, p: 1.4, c: 30.3, f: 0.2, ex: { grain: 2 } },
    { kcal: 192.4, p: 40.1, c: 0, f: 2.2, ex: { prot: 4.7 } },
    { kcal: 30, p: null, c: null, f: null, ex: null }
  ]);
  assert.deepEqual(t, { kcal: 347, p: 41.5, c: 30.3, f: 2.4, ex: { grain: 2, prot: 4.7 } });
});

test('全部品項都沒有營養素時是 null，不是 0', () => {
  assert.deepEqual(sumNutr([{ kcal: 100 }, { kcal: 50, ex: {} }]), { kcal: 150, p: null, c: null, f: null, ex: null });
  assert.deepEqual(sumNutr([]), { kcal: 0, p: null, c: null, f: null, ex: null });
});

test('複製記錄：新 id、新時間、不帶照片，其他欄位（含未知欄位）保留', () => {
  let n = 0;
  const makeId = (p) => p + '_' + (++n);
  const src = [{ id: 'item_a', name: '白飯 200g', kcal: 364, meal: 'lunch', time: '12:10', hasPhoto: true, photoKey: 'item_a-1', grams: 200, foodId: 'A01', updatedAt: 5, future: 'x' }];
  const [c] = copyEntries(src, { makeId, at: 99 });
  assert.equal(c.id, 'item_1');
  assert.equal(c.updatedAt, 99);
  assert.equal(c.hasPhoto, false);
  assert.equal('photoKey' in c, false);
  assert.equal(c.grams, 200); assert.equal(c.foodId, 'A01'); assert.equal(c.future, 'x'); assert.equal(c.time, '12:10');
  assert.equal(src[0].id, 'item_a', '不改到原本的記錄');
  assert.equal(src[0].photoKey, 'item_a-1');
});

test('同一組的品項複製後仍同組，但換成新的 groupId；可指定餐別', () => {
  let n = 0;
  const makeId = (p) => p + '_' + (++n);
  const out = copyEntries([
    { id: 'a', groupId: 'grp_x', meal: 'lunch' },
    { id: 'b', groupId: 'grp_x', meal: 'lunch' },
    { id: 'c', meal: 'lunch' }
  ], { makeId, at: 1, meal: 'dinner' });
  assert.equal(out[0].groupId, out[1].groupId);
  assert.notEqual(out[0].groupId, 'grp_x');
  assert.equal(out[2].groupId, undefined);
  assert.ok(out.every(e => e.meal === 'dinner'));
});

test('取出某天某一餐，依時間排序', () => {
  const logs = { '2026-11-18': [
    { id: '1', meal: 'lunch', time: '12:30' }, { id: '2', meal: 'dinner', time: '18:00' }, { id: '3', meal: 'lunch', time: '12:00' }
  ] };
  assert.deepEqual(mealEntries(logs, '2026-11-18', 'lunch').map(e => e.id), ['3', '1']);
  assert.deepEqual(mealEntries(logs, '2026-11-17', 'lunch'), []);
  assert.deepEqual(mealEntries(undefined, '2026-11-17', 'lunch'), []);
});
