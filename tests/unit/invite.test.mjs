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

test('意見回饋：有邀請碼（沒停用）才能直接送；聊天 App 的開頭帶版本、裝置、邀請碼', async () => {
  const { canSendFeedback, feedbackInfo, feedbackMessage } = await import('../../js/invite.js');
  assert.equal(canSendFeedback({ code: 'JJ-4821' }), true);
  assert.equal(canSendFeedback({ code: 'JJ-4821', locked: true }), false);
  assert.equal(canSendFeedback({ legacy: true }), false);
  assert.equal(canSendFeedback(null), false);
  const t = feedbackInfo({ label: '2026.11.25-3（Rev. 67）', device: 'iPad', invite: { code: 'JJ-4821', name: '王美華' } });
  assert.match(t, /版本：2026\.11\.25-3（Rev\. 67）/);
  assert.match(t, /裝置：iPad/);
  assert.match(t, /邀請碼：JJ-4821（王美華）/);
  assert.doesNotMatch(feedbackInfo({ label: 'x', device: 'iPad', invite: { legacy: true } }), /邀請碼/);
  assert.match(feedbackMessage('limit'), /聊天 App/);
  assert.match(feedbackMessage('whatever'), /稍後再試/);
});

test('共用資料庫：新的、換版的要下載；不再發佈的拿掉；自己匯入的同一份用共用的', async () => {
  const { sharedPlan, withShared } = await import('../../js/packs.js');
  const files = { a: { version: 1 }, b: { version: 5 }, c: { version: 2 } };
  assert.deepEqual(sharedPlan(files, [{ key: 'a', version: 1 }, { key: 'b', version: 6 }, { key: 'd', version: 1 }]), { fetch: ['b', 'd'], drop: ['c'] });
  assert.deepEqual(sharedPlan(undefined, [{ key: 'a', version: 1 }]), { fetch: ['a'], drop: [] });
  assert.deepEqual(sharedPlan(files, []), { fetch: [], drop: ['a', 'b', 'c'] });
  const shared = [{ id: 'pk_1', name: '共用', shared: true }];
  assert.deepEqual(withShared(shared, [{ id: 'pk_1', name: '舊的' }, { id: 'pk_2', name: '自己的' }]).map(p => p.name), ['共用', '自己的']);
  assert.deepEqual(withShared([], [{ id: 'pk_2' }]).map(p => p.id), ['pk_2']);
});

test('外食圖書館：依店家分類列店、沒勾的店不列、全選全不選；表頭「店家分類」對得到', async () => {
  const { libraryShops, pickShared, toggleShops, guessMapping, rowsToFoods } = await import('../../js/packs.js');
  const shared = [{ id: 'pk', foods: [
    { id: '1', name: '大麥克', brand: '麥當勞', group: '🍔 速食' }, { id: '2', name: '麥香雞', brand: '麥當勞', group: '🍔 速食' },
    { id: '3', name: '珍奶', brand: '50嵐', group: '🧋 手搖飲' }, { id: '4', name: '白飯', brand: '自助餐' }] }];
  assert.deepEqual(libraryShops(shared), [
    { group: '🍔 速食', shops: [{ brand: '麥當勞', n: 2 }] }, { group: '🧋 手搖飲', shops: [{ brand: '50嵐', n: 1 }] }, { group: '其他', shops: [{ brand: '自助餐', n: 1 }] }]);
  assert.deepEqual(pickShared(shared, ['麥當勞'])[0].foods.map(f => f.id), ['3', '4']);
  assert.equal(pickShared(shared, []), shared);
  assert.deepEqual(toggleShops(['50嵐'], ['麥當勞', '50嵐'], false), ['50嵐', '麥當勞']);
  assert.deepEqual(toggleShops(['50嵐', '麥當勞'], ['50嵐'], true), ['麥當勞']);
  const map = guessMapping(['提供者(餐廳店家)', '店家分類', '餐點分類', '品項名稱', '份量規格', '熱量(kcal)']);
  assert.deepEqual(map, ['brand', 'group', 'category', 'name', 'serving', 'kcal']);
  assert.deepEqual(guessMapping(['店家分類', '提供者(餐廳店家)', '品項名稱', '熱量(kcal)']).slice(0, 2), ['group', 'brand']);
  const { foods } = rowsToFoods([['麥當勞', '🍔 速食', '主餐', '大麥克', '1份', '530']], map);
  assert.equal(foods[0].group, '🍔 速食');
});
