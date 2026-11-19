// 吃到飽・聚餐速記（js/party.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARTY_TEMPLATES, partyTemplate, startCounts, parsePartyText, partyMemo, partyEntries, partyTotals } from '../../js/party.js';

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

test('貼上備忘錄：模板格式、全形、每輪相加、小數、沒填的不算、不認得的代碼列出', () => {
  const memo = `【港點進階速記】
-- A 蒸籠與點心類 (算顆/條) --
A1(純海鮮蒸點/蝦餃/帶子餃/顆): 3+3
A2(腸粉類/鮮蝦/牛肉/叉燒/條): 
A3(肉餡蒸餃/燒賣/小籠包/顆)：２
b2 1.5
C3=1
D0(隱形油醬勾芡/全餐固定): 1
Z9: 4`;
  const { counts, unknown } = parsePartyText(memo, dim);
  assert.deepEqual(counts, { A1: 6, A3: 2, B2: 1.5, C3: 1, D0: 1 });
  assert.deepEqual(unknown, ['Z9']);
  assert.deepEqual(parsePartyText('A1: 2\nA1: 1', dim).counts, { A1: 3 }, '同一代碼寫兩次會加起來');
});

test('空白速記格式可以再貼回來', () => {
  const memo = partyMemo(dim);
  assert.match(memo, /A1\(純海鮮蒸點\/顆\): \n/);
  assert.match(memo, /D0\(隱形油醬・勾芡\/餐\): 1$/);
  assert.deepEqual(parsePartyText(memo.replace('A1(純海鮮蒸點/顆): ', 'A1(純海鮮蒸點/顆): 4'), dim).counts, { A1: 4, D0: 1 });
});

test('數量 → 記錄與合計', () => {
  const e = partyEntries(dim, { A1: 6, C3: 1, D0: 1, A2: 0 });
  assert.deepEqual(e.map(x => x.name), ['港式點心・純海鮮蒸點 6顆', '港式點心・酥皮・牛油 1個', '港式點心・隱形油醬・勾芡 1餐']);
  assert.deepEqual(e[0], { name: '港式點心・純海鮮蒸點 6顆', kcal: 300, p: 27, c: 36, f: 6, ex: null });
  assert.deepEqual(partyTotals(dim, { A1: 6, C3: 1, D0: 1 }), { kcal: 770, p: 31, c: 74, f: 39 });
  assert.deepEqual(partyTotals(dim, {}), { kcal: 0, p: 0, c: 0, f: 0 });
});
