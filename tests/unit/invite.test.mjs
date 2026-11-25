// 公測邀請碼（js/invite.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInvite, gateState, cloudInviteFor, needCheck, waitSeconds, addFail, inviteMessage, CHECK_EVERY, MAX_TRIES } from '../../js/invite.js';

test('邀請碼：有沒有 JJ-、大小寫、全形數字都認得；不是 4 位數字就不算', () => {
  for (const s of ['JJ-4821', 'jj4821', '4821', ' JJ 4821 ', '４８２１']) assert.equal(normalizeInvite(s), 'JJ-4821');
  for (const s of ['', '482', '48211', 'JJ-ABCD']) assert.equal(normalizeInvite(s), '');
});

test('要不要擋：沒設網址＝關閉；有記錄的舊裝置放行；雲端有邀請碼的用它登記；只連了 Google 的一樣要輸入；停用的要重新輸入', () => {
  const url = 'https://script.google.com/x';
  assert.equal(gateState({ url: '', invite: null, hasData: false }), 'off');
  assert.equal(gateState({ url, invite: null, hasData: true }), 'legacy');
  assert.equal(gateState({ url, invite: null, hasData: false }), 'new');
  assert.equal(gateState({ url, invite: null, hasData: false, cloudInvite: { code: 'JJ-4821', name: '王美華' } }), 'restore');
  assert.equal(gateState({ url, invite: null, hasData: true, cloudInvite: { code: 'JJ-4821' } }), 'restore');
  assert.equal(gateState({ url, invite: null, hasData: false, cloudInvite: { legacy: true } }), 'legacy');
  assert.equal(gateState({ url, invite: { code: 'JJ-4821', locked: true }, cloudInvite: { code: 'JJ-5229' } }), 'locked');
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

test('寫進同步資料的邀請碼：新的才寫，雲端比較新的不蓋掉，停用的不寫', () => {
  const now = 5000;
  assert.deepEqual(cloudInviteFor({ code: 'JJ-4821', name: '王美華', at: 1 }, undefined, now), { code: 'JJ-4821', name: '王美華', updatedAt: now });
  assert.equal(cloudInviteFor({ code: 'JJ-4821', name: '王美華', at: 1 }, { code: 'JJ-4821', updatedAt: 2 }, now), null);
  assert.equal(cloudInviteFor({ code: 'JJ-4821', at: 1 }, { code: 'JJ-5229', updatedAt: 2 }, now), null);   // 別台後來換了新號碼
  assert.deepEqual(cloudInviteFor({ code: 'JJ-5229', at: 3 }, { code: 'JJ-4821', updatedAt: 2 }, now), { code: 'JJ-5229', name: '', updatedAt: now });
  assert.deepEqual(cloudInviteFor({ code: 'JJ-5229', at: 3 }, { legacy: true, updatedAt: 9 }, now), { code: 'JJ-5229', name: '', updatedAt: now });
  assert.deepEqual(cloudInviteFor({ legacy: true }, undefined, now), { legacy: true, updatedAt: now });
  assert.equal(cloudInviteFor({ legacy: true }, { code: 'JJ-4821' }, now), null);
  assert.equal(cloudInviteFor({ code: 'JJ-4821', locked: true }, undefined, now), null);
  assert.equal(cloudInviteFor(null, undefined, now), null);
});
