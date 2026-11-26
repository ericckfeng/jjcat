// 一整餐的計算：購物車合計、複製某一餐（js/meals.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumNutr, copyEntries, mealEntries, mealGap, splitDaily, gapMessage, inNightWindow, isNightEntry, shouldAskWhen, eatenAt, MEAL_TIME_CHIPS, nightSummary, entryPortion, scaleEntry, renamePortion } from '../../js/meals.js';

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
  const src = [{ id: 'item_a', name: '白飯 200g', kcal: 364, meal: 'lunch', time: '12:10', hasPhoto: true, photoKey: 'item_a-1', morePhotos: ['x_item_a_1'], label: { g: 100, kcal: 182 }, grams: 200, foodId: 'A01', updatedAt: 5, future: 'x' }];
  const [c] = copyEntries(src, { makeId, at: 99 });
  assert.equal(c.id, 'item_1');
  assert.equal(c.updatedAt, 99);
  assert.equal(c.hasPhoto, false);
  assert.equal('photoKey' in c, false);
  assert.equal('morePhotos' in c, false);
  assert.deepEqual(c.label, { g: 100, kcal: 182 });
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

/* ---- 這一餐還差什麼 ---- */

test('這一餐還差什麼：缺的、多的、沒份數的', () => {
  const g = mealGap([
    { ex: { grain: 3, prot: 2, oil: 3 } },          // 大腸包小腸
    { ex: { grain: 0.5 } },
    { name: '飲料', kcal: 120 }                       // 沒份數
  ], { grain: 3, prot: 2, veg: 1.5, oil: 2, fruit: 1 });
  assert.deepEqual(g.have, { grain: 3.5, prot: 2, veg: 0, fruit: 0, dairy: 0, oil: 3 });
  assert.deepEqual(g.short, [{ k: 'veg', need: 1.5 }, { k: 'fruit', need: 1 }]);
  assert.deepEqual(g.over, [{ k: 'grain', extra: 0.5 }, { k: 'oil', extra: 1 }]);
  assert.equal(g.unknown, 1);
  assert.equal(g.done, false);
});

test('差不到 0.3 份算剛好；蔬菜、水果、乳品多了不提；沒設目標回傳 null', () => {
  const g = mealGap([{ ex: { grain: 2.8, veg: 3, fruit: 2, dairy: 1 } }], { grain: 3, veg: 1 });
  assert.deepEqual(g.short, []);
  assert.deepEqual(g.over, []);
  assert.equal(g.done, true);
  assert.equal(mealGap([{ ex: { grain: 1 } }], {}), null);
  assert.equal(mealGap([{ ex: { grain: 1 } }], null), null);
  assert.equal(mealGap([], { grain: 3 }).short[0].need, 3);
});

test('每日份數平均分到三餐（0.5 份為單位，加起來不變）', () => {
  assert.deepEqual(splitDaily(9), [3, 3, 3]);
  assert.deepEqual(splitDaily(4), [1, 1.5, 1.5]);
  assert.deepEqual(splitDaily(5), [1.5, 2, 1.5]);
  assert.deepEqual(splitDaily(2), [0.5, 1, 0.5]);
  assert.deepEqual(splitDaily(0), [0, 0, 0]);
  [1, 2.5, 7, 12].forEach(t => assert.equal(splitDaily(t).reduce((a, b) => a + b, 0), t));
});

test('提示文字：缺的附生活份量，多的語氣溫和', () => {
  const g = mealGap([{ ex: { grain: 3, prot: 1, oil: 3 } }, { kcal: 50 }], { grain: 3, prot: 2, veg: 1.5, oil: 2 });
  const m = gapMessage(g, '午餐');
  assert.equal(m.short, '午餐還可以加：豆魚蛋肉 1 份（1 份約一顆蛋）、蔬菜 1.5 份（1 份約半碗煮熟的青菜）');
  assert.equal(m.over, '油脂多了 1 份，下一餐清淡一點就好');
  assert.equal(m.unknown, '有 1 筆沒有份數，沒算進來');
  const done = gapMessage(mealGap([{ ex: { grain: 3 } }], { grain: 3 }), '早餐');
  assert.equal(done.short, '早餐的份數都夠了 👍');
  assert.equal(gapMessage(null, '午餐'), null);
});

/* ---- 夜間進食 ---- */
test('夜間時段：晚上 10 點到早上 7 點', () => {
  for (const t of ['22:00', '23:59', '00:00', '03:15', '06:59']) assert.equal(inNightWindow(t), true, t);
  for (const t of ['07:00', '12:00', '21:59', '', null, '9:00']) assert.equal(inNightWindow(t), false, String(t));
});

test('夜間進食：早餐和補記的不算', () => {
  assert.equal(isNightEntry({ meal: 'snack', time: '23:10' }), true);
  assert.equal(isNightEntry({ meal: 'dinner', time: '22:30' }), true);
  assert.equal(isNightEntry({ meal: 'breakfast', time: '06:30' }), false);
  assert.equal(isNightEntry({ meal: 'dinner', time: '23:30', backfill: true }), false);
  assert.equal(isNightEntry({ meal: 'snack', time: '15:00' }), false);
});

test('什麼時候問「是現在吃的嗎」：晚上 10 點到清晨 5 點記的，每一餐都問', () => {
  for (const t of ['22:00', '23:30', '00:10', '04:59']) assert.equal(shouldAskWhen(t), true, t);
  for (const t of ['21:59', '05:00', '12:00', '', null]) assert.equal(shouldAskWhen(t), false, String(t));
});

test('選了吃的時間：過了午夜補記前一天的晚餐要搬到前一天', () => {
  assert.deepEqual(eatenAt('23:15', '19:00'), { time: '19:00', dayShift: 0 });
  assert.deepEqual(eatenAt('00:30', '19:00'), { time: '19:00', dayShift: -1 });
  assert.deepEqual(eatenAt('00:30', '00:10'), { time: '00:10', dayShift: 0 });
  assert.deepEqual(eatenAt('04:00', '23:00'), { time: '23:00', dayShift: -1 });
  assert.equal(MEAL_TIME_CHIPS.dinner.length, 6);
});

test('一段期間的夜間進食', () => {
  const logs = {
    '2026-11-16': [{ meal: 'snack', time: '23:00', kcal: 300 }, { meal: 'dinner', time: '18:30', kcal: 600 }],
    '2026-11-17': [{ meal: 'dinner', time: '23:30', kcal: 500, backfill: true }, { meal: 'breakfast', time: '06:00', kcal: 250 }],
    '2026-11-18': [{ meal: 'snack', time: '00:30', kcal: 150 }, { meal: 'snack', time: '22:15', kcal: 200 }]
  };
  assert.deepEqual(nightSummary(logs, ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']),
    { days: 2, entries: 3, kcal: 650, byDate: { '2026-11-16': 300, '2026-11-18': 350 } });
  assert.deepEqual(nightSummary({}, ['2026-11-16']), { days: 0, entries: 0, kcal: 0, byDate: {} });
});

test('修改記錄的份量：認得幾克、幾份、×幾份', () => {
  assert.deepEqual(entryPortion({ grams: 150 }), { field: 'grams', unit: 'g', amount: 150 });
  assert.deepEqual(entryPortion({ servings: 1.5, grams: 30 }), { field: 'servings', unit: 'serving', amount: 1.5 });
  assert.deepEqual(entryPortion({ multiplier: 2 }), { field: 'multiplier', unit: 'serving', amount: 2 });
  assert.deepEqual(entryPortion({}), { field: 'multiplier', unit: 'serving', amount: 1 });
});

test('改份量時熱量、營養素、六大類、纖維照比例換算，沒有值的維持沒有', () => {
  const n = { kcal: 240, p: 31, c: null, f: 3.3, ex: { prot: 4 }, fiber: 1 };
  assert.deepEqual(scaleEntry(n, 150, 200), { kcal: 320, p: 41.3, c: null, f: 4.4, ex: { prot: 5.3 }, fiber: 1.3 });
  assert.deepEqual(scaleEntry({ kcal: 100 }, 1, 0.5), { kcal: 50, p: null, c: null, f: null, ex: null });
  assert.equal(scaleEntry(n, 150, 0).kcal, 240);   // 份量不合理就不換算
});

test('名稱後面的份量跟著改', () => {
  assert.equal(renamePortion('雞胸肉 150g', 'grams', 200), '雞胸肉 200g');
  assert.equal(renamePortion('白飯 150g（熟重）', 'grams', 100), '白飯 100g（熟重）');
  assert.equal(renamePortion('義美 茶葉蛋 1 份', 'servings', 2.5), '義美 茶葉蛋 2.5 份');
  assert.equal(renamePortion('我改過的名字', 'grams', 200), '我改過的名字');
  assert.equal(renamePortion('滷肉飯', 'multiplier', 2), '滷肉飯');
});
