// 公測邀請碼（js/invite.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInvite, gateState, needCheck, waitSeconds, addFail, inviteMessage, CHECK_EVERY, MAX_TRIES } from '../../js/invite.js';

test('邀請碼：有沒有 JJ-、大小寫、全形數字都認得；不是 4 位數字就不算', () => {
  for (const s of ['JJ-4821', 'jj4821', '4821', ' JJ 4821 ', '４８２１']) assert.equal(normalizeInvite(s), 'JJ-4821');
  for (const s of ['', '482', '48211', 'JJ-ABCD']) assert.equal(normalizeInvite(s), '');
});

test('要不要擋：沒設網址＝關閉；有記錄或連了雲端的舊裝置放行；新裝置要輸入；停用的要重新輸入', () => {
  const url = 'https://script.google.com/x';
  assert.equal(gateState({ url: '', invite: null, hasData: false }), 'off');
  assert.equal(gateState({ url, invite: null, hasData: true }), 'legacy');
  assert.equal(gateState({ url, invite: null, hasData: false, linked: true }), 'legacy');
  assert.equal(gateState({ url, invite: null, hasData: false, linked: false }), 'new');
  assert.equal(gateState({ url, invite: { legacy: true } }), 'open');
  assert.equal(gateState({ url, invite: { code: 'JJ-4821' } }), 'open');
  assert.equal(gateState({ url, invite: { code: 'JJ-4821', locked: true } }), 'locked');
});

test('每天問一次有沒有被停用；舊裝置、已經停用的不問', () => {
  const now = 10 * CHECK_EVERY;
  assert.equal(needCheck({ code: 'JJ-4821', lastCheck: now - CHECK_EVERY - 1 }, now), true);
  assert.equal(needCheck({ code: 'JJ-4821', lastCheck: now - 1000 }, now), false);
  assert.equal(needCheck({ code: 'JJ-4821' }, now), true);
  assert.equal(needCheck({ legacy: true }, now), false);
  assert.equal(needCheck({ code: 'JJ-4821', locked: true }, now), false);
});

test('連續輸錯 5 次要等 1 分鐘；等完重新算', () => {
  let f = null;
  for (let i = 1; i < MAX_TRIES; i++) { f = addFail(f, 0); assert.equal(waitSeconds(f, 0), 0); }
  f = addFail(f, 0);
  assert.equal(waitSeconds(f, 0), 60);
  assert.equal(waitSeconds(f, 59500), 1);
  assert.equal(waitSeconds(f, 60000), 0);
  f = addFail(f, 61000);
  assert.deepEqual(f, { n: 1 });
});

test('原因 → 給使用者看的話', () => {
  assert.match(inviteMessage('disabled'), /停用/);
  assert.match(inviteMessage('full'), /3 台/);
  assert.match(inviteMessage('???'), /稍後再試/);
});
