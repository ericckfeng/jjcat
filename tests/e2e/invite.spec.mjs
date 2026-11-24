// 公測邀請碼：新裝置要輸入（錯了會說明、錯太多要等）→ 填姓名 → 開始用；舊裝置直接放行；
// 號碼被停用：每天檢查時發現 → 要重新輸入（記錄還在）；連不上不擋人；同一組的第二台帶出姓名
import { test, expect } from '@playwright/test';
import { openApp, appState } from './helpers.mjs';

const URL_ = 'https://invite.test/exec';
// 模擬管理者的試算表（tools/invite/Code.gs 的回應）
async function fakeSheet(page, sheet) {
  const calls = [];
  await page.route(URL_, async (r) => {
    const req = JSON.parse(r.request().postData() || '{}');
    calls.push(req);
    if (sheet.down) return r.abort();
    const row = sheet.codes[req.code];
    let res;
    if (!row || !row.issued) res = { ok: false, reason: 'unknown' };
    else if (row.disabled) res = { ok: false, reason: 'disabled' };
    else if (req.action === 'check') res = { ok: true, name: row.name || '' };
    else { if (!row.name) row.name = req.name; (row.devices = row.devices || []).push(req.deviceId); res = { ok: true, name: row.name }; }
    return r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(res) });
  });
  return calls;
}
async function seed(page, data) {
  await page.addInitScript((data) => {
    if (!localStorage.getItem('diet_tracker_v2')) localStorage.setItem('diet_tracker_v2', JSON.stringify({ quickItems: [], tomb: {}, ...data }));
  }, data);
}

test('新裝置：輸入錯的會說明 → 對的 → 填姓名（說明會送出什麼）→ 開始用，記下哪個碼、哪一版加入；之後才是歡迎畫面', async ({ page }) => {
  const errors = [];
  const sheet = { codes: { 'JJ-4821': { issued: true }, 'JJ-7777': { issued: false } } };
  const calls = await fakeSheet(page, sheet);
  await openApp(page, { errors, keepWelcome: true, inviteUrl: URL_ });
  await expect(page.locator('#inviteGate')).toBeVisible();
  await page.fill('#inviteCode', '12');
  await page.click('#inviteCodeBtn');
  await expect(page.locator('#inviteNote')).toContainText('邀請碼是 4 個數字');
  await page.fill('#inviteCode', '7777');   // 還沒打勾「已發出」的
  await page.click('#inviteCodeBtn');
  await expect(page.locator('#inviteNote')).toContainText('這組邀請碼不對');
  await page.fill('#inviteCode', 'jj-4821');
  await page.click('#inviteCodeBtn');
  await expect(page.locator('#inviteStepName')).toBeVisible();
  await expect(page.locator('#inviteStepName')).toContainText('你的飲食記錄不會送出去');
  await page.click('#inviteNameBtn');
  await expect(page.locator('#inviteNote')).toContainText('請填你的姓名');
  await page.fill('#inviteName', '王美華');
  await page.click('#inviteNameBtn');
  await expect(page.locator('#inviteGate')).toBeHidden();
  await expect(page.locator('#toastMsg')).toContainText('歡迎加入公測，王美華');
  await expect(page.locator('#scr-welcome')).toBeVisible();
  const inv = (await appState(page)).meta.invite;
  expect(inv).toMatchObject({ code: 'JJ-4821', name: '王美華' });
  expect(inv.rev).toBeGreaterThan(60);
  const reg = calls.find(c => c.action === 'register');
  expect(Object.keys(reg).sort()).toEqual(['action', 'code', 'deviceId', 'deviceName', 'name']);   // 只送這些
  expect(sheet.codes['JJ-4821'].name).toBe('王美華');
  expect(errors).toEqual([]);
});

test('輸錯 5 次要等 1 分鐘', async ({ page }) => {
  await fakeSheet(page, { codes: {} });
  await openApp(page, { keepWelcome: true, inviteUrl: URL_ });
  for (let i = 0; i < 5; i++) {
    await page.fill('#inviteCode', String(1000 + i));
    await page.click('#inviteCodeBtn');
    await expect(page.locator('#inviteNote')).toContainText('不對');
  }
  await page.click('#inviteCodeBtn');
  await expect(page.locator('#inviteNote')).toContainText(/輸錯太多次了，請 \d+ 秒後再試/);
});

test('有邀請碼之前就在用的裝置（有記錄）：直接放行，記成舊裝置，不會去問', async ({ page }) => {
  const calls = await fakeSheet(page, { codes: {} });
  await seed(page, { logs: { '2026-11-20': [{ id: 'a', name: '便當', kcal: 700, meal: 'lunch', updatedAt: 1 }] }, meta: { welcomed: true } });
  await openApp(page, { inviteUrl: URL_ });
  await expect(page.locator('#inviteGate')).toBeHidden();
  expect((await appState(page)).meta.invite).toMatchObject({ legacy: true });
  expect(calls).toEqual([]);
});

test('號碼被停用：每天檢查時發現 → 要重新輸入，記錄還在；輸入新的就能繼續用', async ({ page }) => {
  const sheet = { codes: { 'JJ-4821': { issued: true, name: '王美華', disabled: true }, 'JJ-5229': { issued: true } } };
  await fakeSheet(page, sheet);
  await seed(page, { logs: { '2026-11-20': [{ id: 'a', name: '便當', kcal: 700, meal: 'lunch', updatedAt: 1 }] }, meta: { welcomed: true, invite: { code: 'JJ-4821', name: '王美華', at: 1, rev: 63, lastCheck: 1 } } });
  await openApp(page, { inviteUrl: URL_ });
  await expect(page.locator('#inviteGate')).toBeVisible();
  await expect(page.locator('#inviteNote')).toContainText('已經停用了');
  let s = await appState(page);
  expect(s.meta.invite).toMatchObject({ locked: true, reason: 'disabled' });
  expect(s.logs['2026-11-20']).toHaveLength(1);
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  await expect(page.locator('#inviteGate')).toBeVisible();   // 重開也一樣
  await page.fill('#inviteCode', '5229');
  await page.click('#inviteCodeBtn');
  await page.fill('#inviteName', '王美華');
  await page.click('#inviteNameBtn');
  await expect(page.locator('#inviteGate')).toBeHidden();
  s = await appState(page);
  expect(s.meta.invite).toMatchObject({ code: 'JJ-5229' });
  expect(s.meta.invite.locked).toBeUndefined();
});

test('連不上管理者的試算表：不擋人，下次再問', async ({ page }) => {
  await fakeSheet(page, { down: true, codes: {} });
  await seed(page, { meta: { welcomed: true, invite: { code: 'JJ-4821', name: '王美華', at: 1, rev: 63, lastCheck: 1 } } });
  await openApp(page, { inviteUrl: URL_ });
  await page.waitForTimeout(300);
  await expect(page.locator('#inviteGate')).toBeHidden();
  expect((await appState(page)).meta.invite.locked).toBeUndefined();
});

test('同一組的第二台：帶出登記的姓名，直接開始用', async ({ page }) => {
  await fakeSheet(page, { codes: { 'JJ-4821': { issued: true, name: '王美華' } } });
  await openApp(page, { keepWelcome: true, inviteUrl: URL_ });
  await page.fill('#inviteCode', '4821');
  await page.click('#inviteCodeBtn');
  await expect(page.locator('#inviteNote')).toContainText('登記的是「王美華」');
  await expect(page.locator('#inviteName')).toHaveValue('王美華');
  await page.click('#inviteNameBtn');
  await expect(page.locator('#inviteGate')).toBeHidden();
});
