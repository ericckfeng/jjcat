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
    else if (row.full) res = { ok: false, reason: 'full' };
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
  await expect(page.locator('#inviteStepChoice')).toBeVisible();   // 先選用 Google 或只用這台
  await page.click('#inviteLocalBtn');
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
  await page.click('#inviteLocalBtn');
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
  await page.click('#inviteLocalBtn');
  await page.fill('#inviteCode', '4821');
  await page.click('#inviteCodeBtn');
  await expect(page.locator('#inviteNote')).toContainText('登記的是「王美華」');
  await expect(page.locator('#inviteName')).toHaveValue('王美華');
  await page.click('#inviteNameBtn');
  await expect(page.locator('#inviteGate')).toBeHidden();
});

// ---- 用 Google 帳號登入（邀請碼存在雲端的同步資料 betaInvite）----
// 假的 Google 登入頁：直接帶 token 跳回 App
async function mockGoogleLogin(page) {
  await page.route('https://accounts.google.com/**', (route) => {
    const u = new URL(route.request().url());
    const back = new URLSearchParams({ state: u.searchParams.get('state'), access_token: 'tok', expires_in: '3600', scope: 'https://www.googleapis.com/auth/drive.file' });
    return route.fulfill({ status: 302, headers: { location: u.searchParams.get('redirect_uri') + '#' + back } });
  });
}
// 假的雲端硬碟：drive.data 是雲端的同步檔（null＝還沒有），上傳的內容記在 drive.uploads
async function mockDrive(page, drive) {
  drive.uploads = [];
  await page.route(/https:\/\/www\.googleapis\.com\/.*/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (o) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (url.pathname.endsWith('/about')) return json({ user: { emailAddress: 'me@example.com' } });
    if (url.pathname.startsWith('/upload/')) {
      const body = req.postData() || '';
      const parts = body.split(/\r\n--diet[a-z0-9]+/);
      const content = parts[1] ? parts[1].slice(parts[1].indexOf('\r\n\r\n') + 4) : '{}';
      drive.data = JSON.parse(content);
      drive.uploads.push(drive.data);
      return json({ id: 'data', modifiedTime: new Date(Date.now() + drive.uploads.length * 1000).toISOString() });
    }
    if (url.searchParams.get('alt') === 'media') return json(drive.data);
    if (url.pathname.endsWith('/files') && req.method() === 'GET') {
      const q = url.searchParams.get('q') || '';
      if (q.includes("name='飲控隨身記'")) return json({ files: [{ id: 'root' }] });
      if (q.includes("name='照片'")) return json({ files: [{ id: 'photos' }] });
      if (q.includes("name='飲控隨身記備份.json'")) return json({ files: drive.data ? [{ id: 'data', modifiedTime: '2026-11-20T00:00:00Z' }] : [] });
      return json({ files: [] });
    }
    return json({ id: 'x' });
  });
}
const cloudFile = (extra) => ({ app: 'diet-tracker', version: 3, logs: { '2026-11-20': [{ id: 'a', name: '便當', kcal: 700, meal: 'lunch', updatedAt: 1 }] }, days: {}, quickItems: [], tomb: {}, ...extra });

test('刪掉 App 重裝：選「用 Google 帳號登入」→ 取回記錄，雲端記著邀請碼 → 自動登記這台，不用再輸入', async ({ page }) => {
  const errors = [];
  const sheet = { codes: { 'JJ-4821': { issued: true, name: '王美華' } } };
  const calls = await fakeSheet(page, sheet);
  await mockGoogleLogin(page);
  const drive = { data: cloudFile({ betaInvite: { code: 'JJ-4821', name: '王美華', updatedAt: 5 } }) };
  await mockDrive(page, drive);
  await openApp(page, { errors, keepWelcome: true, inviteUrl: URL_ });
  await expect(page.locator('#inviteStepChoice')).toBeVisible();
  await page.click('#inviteGoogleBtn');
  await expect(page.locator('#inviteGate')).toBeHidden();
  await expect(page.locator('#toastMsg')).toContainText('歡迎回來，王美華');
  await expect(page.locator('#scr-welcome')).toBeHidden();
  const s = await appState(page);
  expect(s.meta.invite).toMatchObject({ code: 'JJ-4821', name: '王美華' });
  expect(s.meta.cloud.linked).toBe(true);
  expect(s.logs['2026-11-20']).toHaveLength(1);
  const reg = calls.find(c => c.action === 'register');
  expect(reg).toMatchObject({ code: 'JJ-4821', name: '王美華' });
  expect(reg.deviceName).toBeTruthy();
  // 再打開：不用再輸入
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  await expect(page.locator('#inviteGate')).toBeHidden();
  expect(errors).toEqual([]);
});

test('雲端記著的邀請碼已經停用：要輸入新的（已經連好 Google，直接輸入）', async ({ page }) => {
  await fakeSheet(page, { codes: { 'JJ-4821': { issued: true, name: '王美華', disabled: true } } });
  await mockGoogleLogin(page);
  await mockDrive(page, { data: cloudFile({ betaInvite: { code: 'JJ-4821', name: '王美華', updatedAt: 5 } }) });
  await openApp(page, { keepWelcome: true, inviteUrl: URL_ });
  await page.click('#inviteGoogleBtn');
  await expect(page.locator('#inviteStepCode')).toBeVisible();
  await expect(page.locator('#inviteNote')).toContainText('已經停用了');
  await expect(page.locator('#inviteToChoiceBtn')).toBeHidden();
});

test('邀請碼之前就在用的舊用戶：Google 登入取回記錄就放行，雲端記成舊用戶', async ({ page }) => {
  const calls = await fakeSheet(page, { codes: {} });
  await mockGoogleLogin(page);
  const drive = { data: cloudFile() };
  await mockDrive(page, drive);
  await openApp(page, { keepWelcome: true, inviteUrl: URL_ });
  await page.click('#inviteGoogleBtn');
  await expect(page.locator('#toastMsg')).toContainText('記錄已經取回');
  await expect(page.locator('#inviteGate')).toBeHidden();
  const s = await appState(page);
  expect(s.meta.invite).toMatchObject({ legacy: true });
  expect(s.logs['2026-11-20']).toHaveLength(1);
  expect(calls).toEqual([]);
  await expect.poll(() => drive.data.betaInvite && drive.data.betaInvite.legacy, { timeout: 15000 }).toBe(true);
});

test('Google 雲端是空的（新用戶）：輸入一次邀請碼，邀請碼存進雲端；重開不用再輸入', async ({ page }) => {
  const sheet = { codes: { 'JJ-4821': { issued: true } } };
  await fakeSheet(page, sheet);
  await mockGoogleLogin(page);
  const drive = { data: null };
  await mockDrive(page, drive);
  await openApp(page, { keepWelcome: true, inviteUrl: URL_ });
  await page.click('#inviteGoogleBtn');
  await expect(page.locator('#inviteStepCode')).toBeVisible();
  await expect(page.locator('#inviteLead')).toContainText('已連好 Google 雲端');
  await page.fill('#inviteCode', '4821');
  await page.click('#inviteCodeBtn');
  await page.fill('#inviteName', '陳小明');
  await page.click('#inviteNameBtn');
  await expect(page.locator('#inviteGate')).toBeHidden();
  expect((await appState(page)).betaInvite).toMatchObject({ code: 'JJ-4821', name: '陳小明' });
  await expect.poll(() => drive.data && drive.data.betaInvite && drive.data.betaInvite.code, { timeout: 15000 }).toBe('JJ-4821');
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  await expect(page.locator('#inviteGate')).toBeHidden();
});

test('只連了 Google、還沒輸入邀請碼就關掉：重開還是要輸入（不會因為連了雲端就放行）', async ({ page }) => {
  await fakeSheet(page, { codes: {} });
  await seed(page, { meta: { welcomed: true, cloud: { linked: true, auto: false, email: 'me@example.com' } } });
  await openApp(page, { inviteUrl: URL_ });
  await expect(page.locator('#inviteGate')).toBeVisible();
  await expect(page.locator('#inviteStepCode')).toBeVisible();
});

test('Rev. 63～65 加入的裝置：打開時把邀請碼補存進同步資料', async ({ page }) => {
  await fakeSheet(page, { codes: { 'JJ-4821': { issued: true } } });
  await seed(page, { meta: { welcomed: true, invite: { code: 'JJ-4821', name: '王美華', at: 1, rev: 63, lastCheck: Date.now() } } });
  await openApp(page, { inviteUrl: URL_ });
  await expect(page.locator('#inviteGate')).toBeHidden();
  expect((await appState(page)).betaInvite).toMatchObject({ code: 'JJ-4821', name: '王美華' });
});
