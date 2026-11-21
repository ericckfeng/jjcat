// 待查：手掌法粗估、待查表 CSV 匯出與回填（js/lookup.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateLookup, sizeText, amountText, cleanAmount, buildLookupCsv, parseCsv, readFilledCsv, CSV_HEAD } from '../../js/lookup.js';

test('粗估：飯 1 拳頭＝1 碗＝4 份全穀 280 大卡；半個拳頭 × 2 也一樣', () => {
  assert.deepEqual(estimateLookup({ cat: 'grain', ref: 'fist', amt: 1 }), { kcal: 280, p: 8, c: 60, f: 0, ex: { grain: 4 } });
  assert.equal(estimateLookup({ cat: 'grain', ref: 'fist', amt: 0.5, n: 2 }).kcal, 280);
});
test('粗估：肉 1 手掌＝3 份中脂肉；油 1 大拇指＝1 份油脂', () => {
  const m = estimateLookup({ cat: 'prot', ref: 'palm', amt: 1 });
  assert.equal(m.kcal, 225);
  assert.deepEqual(m.ex, { prot: 3 });
  const o = estimateLookup({ cat: 'oil', ref: 'thumb', amt: 1 });
  assert.equal(o.kcal, 45);
  assert.deepEqual(o.ex, { oil: 1 });
  assert.equal(estimateLookup({ cat: 'fried', ref: 'fist', amt: 1 / 3 }).ex, null);   // 混合的不猜六大類
});
test('粗估：缺類別、大小或數量不合理就不估', () => {
  assert.equal(estimateLookup({ ref: 'fist', amt: 1 }), null);
  assert.equal(estimateLookup({ cat: 'grain', amt: 1 }), null);
  assert.equal(estimateLookup({ cat: 'grain', ref: 'fist', amt: 0 }), null);
  assert.equal(estimateLookup({ cat: 'grain', ref: 'fist', amt: 1, n: 0 }), null);
  assert.equal(estimateLookup(null), null);
});
test('大小的寫法', () => {
  assert.equal(amountText(1 / 3), '1/3');
  assert.equal(amountText(0.333), '1/3');
  assert.equal(amountText(3), '3');
  assert.equal(sizeText({ ref: 'fist', amt: 0.5, n: 2 }), '拳頭 1/2 × 2');
  assert.equal(sizeText({ ref: 'thumb', amt: 1, n: 1 }), '大拇指 1');
  assert.equal(sizeText({ n: 3 }), '× 3');
  assert.equal(cleanAmount('abc'), null);
  assert.equal(cleanAmount(21), null);
});

test('待查表：匯出有 BOM 和標題，名稱有逗號、引號時加引號', () => {
  const csv = buildLookupCsv([{ id: 'item_a', date: '2026-11-21', meal: '午餐', name: '炸"春捲",大', lookup: { ref: 'fist', amt: 0.5, n: 2, cat: 'fried' }, kcal: 270, photos: ['item_a_1.jpg', 'item_a_2.jpg'] }]);
  assert.ok(csv.startsWith('﻿編號,日期'));
  const rows = parseCsv(csv);
  assert.deepEqual(rows[0], CSV_HEAD);
  assert.deepEqual(rows[1].slice(0, 8), ['item_a', '2026-11-21', '午餐', '炸"春捲",大', '拳頭 1/2 × 2', '炸物・酥皮・肥肉', '270', 'item_a_1.jpg item_a_2.jpg']);
});

test('回填：讀 AI 填好的表（包在 ``` 裡、欄名稍微不同、數字帶單位）', () => {
  const text = [
    '好的，以下是填好的表格：',
    '```csv',
    '編號,日期,餐別,名稱,大小,類別,目前粗估(大卡),照片,查到的名稱,熱量（大卡）,蛋白質 g,脂肪(克),碳水(克),備註',
    'item_a,2026-11-21,午餐,待查,拳頭 1/2 × 2,炸物,270,a.jpg,春捲,"360 kcal",8,20.55,38,"兩條, 每條 180"',
    'item_b,2026-11-21,午餐,待查,手掌 1,,,b.jpg,,,,,,看不出來',
    ',,,,,,,,,100,,,,',
    '```'
  ].join('\n');
  const r = readFilledCsv(text);
  assert.equal(r.error, '');
  assert.deepEqual(r.items, [{ id: 'item_a', kcal: 360, name: '春捲', p: 8, f: 20.6, c: 38 }]);
});
test('回填：不是待查表就說明原因', () => {
  assert.match(readFilledCsv('a,b\n1,2').error, /編號/);
  assert.match(readFilledCsv('編號,名稱\nitem_a,x').error, /熱量/);
  assert.match(readFilledCsv('編號,熱量(大卡)\nitem_a,').error, /沒有填好/);
});
