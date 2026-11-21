// 吃到飽・聚餐速記（js/party.js；Rev. 43 起只用來救回舊版沒記下來的速記）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARTY_TEMPLATES, partyTemplate, startCounts, partyEntries, partyTotals } from '../../js/party.js';

const dim = partyTemplate('dimsum');

test('範本：代碼不重複、營養素齊全；D0 整餐固定 1 次', () => {
  PARTY_TEMPLATES.forEach(t => {
    const codes = t.items.map(it => it.code);
    assert.equal(new Set(codes).size, codes.length);
    t.items.forEach(it => ['kcal', 'p', 'c', 'f'].forEach(k => assert.equal(typeof it[k], 'number', it.code + k)));
  });
  assert.equal(dim.items.length, 13);
  assert.deepEqual(startCounts(dim), { D0: 1 });
  assert.equal(partyTemplate('沒有這個').id, 'dimsum');
});

test('數量 → 記錄與合計', () => {
  const e = partyEntries(dim, { A1: 6, C3: 1, D0: 1, A2: 0 });
  assert.deepEqual(e.map(x => x.name), ['港式點心・純海鮮蒸點 6顆', '港式點心・酥皮・牛油 1個', '港式點心・隱形油醬・勾芡 1餐']);
  assert.deepEqual(e[0], { name: '港式點心・純海鮮蒸點 6顆', kcal: 300, p: 27, c: 36, f: 6, ex: null, party: { tpl: 'dimsum', code: 'A1', n: 6, unit: '顆', kcal1: 50 } });
  // 秤重模式：一顆的重量存進記錄，之後校正用；不合理的重量不存
  const w = partyEntries(dim, { A1: 2, B1: 3 }, { A1: '28', B1: '-5' });
  assert.equal(w[0].party.g, 28);
  assert.equal(w[1].party.g, undefined);
  assert.equal(w[1].name, '港式點心・高脂蒸籠 3塊');
  assert.deepEqual(partyTotals(dim, { A1: 6, C3: 1, D0: 1 }), { kcal: 770, p: 31, c: 74, f: 39 });
  assert.deepEqual(partyTotals(dim, {}), { kcal: 0, p: 0, c: 0, f: 0 });
});
