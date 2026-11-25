// 公測邀請碼：新裝置要輸入（錯了會說明、錯太多要等）→ 填姓名 → 開始用；舊裝置直接放行；
// 號碼被停用：每天檢查時發現 → 要重新輸入（記錄還在）；連不上不擋人；同一組的第二台帶出姓名
import { test, expect } from '@playwright/test';
import { openApp, appState, openSettings, closeScreens } from './helpers.mjs';

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
    else if (req.action === 'feedback') { (sheet.feedback = sheet.feedback || []).push(req); res = sheet.fbReason ? { ok: false, reason: sheet.fbReason } : { ok: true }; }
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

// ---- 意見回饋（設定 → 關於 → 💬 意見回饋）----
async function openFeedback(page) {
  await openSettings(page, '[data-screen="scr-about"]');
  await page.click('#scr-about [data-screen="scr-feedback"]');
  await expect(page.locator('#scr-feedback')).toBeVisible();
}

test('意見回饋：選類型、寫字 → 送到試算表（附版本、裝置，不附記錄）；沒寫字會提醒；一天太多則會說明', async ({ page }) => {
  const errors = [];
  const sheet = { codes: { 'JJ-4821': { issued: true, name: '王美華' } } };
  await fakeSheet(page, sheet);
  await seed(page, { logs: { '2026-11-20': [{ id: 'a', name: '便當', kcal: 700, meal: 'lunch', updatedAt: 1 }] }, meta: { welcomed: true, invite: { code: 'JJ-4821', name: '王美華', at: 1, rev: 66, lastCheck: Date.now() } } });
  await openApp(page, { errors, inviteUrl: URL_ });
  await openFeedback(page);
  await expect(page.locator('#fbForm')).toBeVisible();
  await expect(page.locator('#fbWhat')).toContainText('不會送出你的飲食記錄');
  await page.click('#fbSendBtn');
  await expect(page.locator('#fbNote')).toContainText('請先寫下想說的話');
  await page.click('[data-fb-kind="wish"]');
  await expect(page.locator('[data-fb-kind="wish"]')).toHaveAttribute('aria-pressed', 'true');
  await page.fill('#fbText', '希望可以記咖啡');
  await expect(page.locator('#fbCount')).toContainText('7／500');
  await page.click('#fbSendBtn');
  await expect(page.locator('#fbNote')).toContainText('謝謝你');
  await expect(page.locator('#fbText')).toHaveValue('');
  const sent = sheet.feedback[0];
  expect(sent).toMatchObject({ action: 'feedback', code: 'JJ-4821', kind: 'wish', text: '希望可以記咖啡' });
  expect(sent.ver).toMatch(/Rev\. \d+/);
  expect(Object.keys(sent).sort()).toEqual(['action', 'code', 'deviceId', 'deviceName', 'kind', 'text', 'ver']);   // 只送這些
  sheet.fbReason = 'limit';
  await page.fill('#fbText', '再一則');
  await page.click('#fbSendBtn');
  await expect(page.locator('#fbNote')).toContainText('明天再送');
  await expect(page.locator('#fbText')).toHaveValue('再一則');   // 沒送出去的字留著
  expect(errors).toEqual([]);
});

test('意見回饋：沒有邀請碼的舊用戶只看到「用聊天 App 告訴我們」；分享的文字帶版本和裝置', async ({ page }) => {
  await fakeSheet(page, { codes: {} });
  await seed(page, { logs: { '2026-11-20': [{ id: 'a', name: '便當', kcal: 700, meal: 'lunch', updatedAt: 1 }] }, meta: { welcomed: true, invite: { legacy: true, at: 1, rev: 63 } } });
  await page.addInitScript(() => { window.__shared = []; navigator.share = async (d) => { window.__shared.push(d); }; });
  await openApp(page, { inviteUrl: URL_ });
  await openFeedback(page);
  await expect(page.locator('#fbForm')).toBeHidden();
  await expect(page.locator('#fbChatTitle')).toContainText('用聊天 App 告訴我們');
  await expect(page.locator('#fbChatText')).toContainText('LINE、Messenger、Teams、Email 都可以');
  await page.click('#fbShareBtn');
  const shared = await page.evaluate(() => window.__shared);
  expect(shared[0].text).toMatch(/版本：.*Rev\. \d+/);
  expect(shared[0].text).toContain('裝置：');
  expect(shared[0].text).not.toContain('邀請碼');
});

// ---- 共用資料庫（管理者發佈，App 自動下載更新）----
const packFile = (n, extra = {}) => ({ app: 'diet-tracker-foods', version: 1, pack: { id: 'pk_eatout', name: '外食店家營養資料庫', org: '飲控隨身記', edition: '第 ' + n + ' 版', askBy: 'serving' },
  foods: [{ id: 'pf_1', name: '大麥克', brand: '麥當勞', perServing: { kcal: 530, p: 25, f: 28, c: 45 } }, ...(n > 1 ? [{ id: 'pf_2', name: '麥香雞', brand: '麥當勞', perServing: { kcal: 380 } }] : [])], ...extra });
const libraryFile = () => ({ app: 'diet-tracker-foods', version: 1, pack: { id: 'pk_lib', name: '外食圖書館', org: '飲控隨身記', askBy: 'serving' }, foods: [
  { id: 'l1', name: '大麥克', brand: '台灣麥當勞', group: '🍔 速食・炸雞・披薩', perServing: { kcal: 530 } },
  { id: 'l2', name: '咔啦雞腿堡', brand: '台灣肯德基', group: '🍔 速食・炸雞・披薩', perServing: { kcal: 560 } },
  { id: 'l3', name: '珍珠奶茶(大杯/無糖)', brand: '50嵐', group: '🧋 手搖飲', perServing: { kcal: 340 } }] });
async function fakeShared(page, sheet, shared) {
  await page.route(URL_, async (r) => {
    const req = JSON.parse(r.request().postData() || '{}');
    if (req.action !== 'packs' && req.action !== 'pack') return r.fallback();
    (shared.calls = shared.calls || []).push(req);
    const res = req.action === 'packs' ? { ok: true, packs: shared.list.map(x => ({ key: x.key, version: x.version })) }
      : (shared.list.find(x => x.key === req.key) ? { ok: true, file: shared.list.find(x => x.key === req.key).file } : { ok: false, reason: 'gone' });
    return r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(res) });
  });
}
const member = { meta: { welcomed: true, invite: { code: 'JJ-4821', name: '王美華', at: 1, rev: 68, lastCheck: Date.now() } } };

test('共用資料庫：登記過的裝置打開 App 自動下載，查食物找得到、資料庫清單標「共用」；不進同步檔', async ({ page }) => {
  const errors = [];
  const sheet = { codes: { 'JJ-4821': { issued: true, name: '王美華' } } };
  await fakeSheet(page, sheet);
  const shared = { list: [{ key: 'f1', version: 100, file: packFile(1) }] };
  await fakeShared(page, sheet, shared);
  await seed(page, member);
  await openApp(page, { errors, inviteUrl: URL_ });
  await expect(page.locator('#toastMsg')).toContainText('已加入「外食店家營養資料庫」（1 樣）', { timeout: 10000 });
  await page.click('[data-food-open=all]');
  await page.fill('#foodSearch', '大麥克');
  await expect(page.locator('#foodPacks')).toContainText('大麥克');
  await closeScreens(page);
  await page.click('.mobile-nav-tab[data-tab=library]');
  await expect(page.locator('#packList')).toContainText('共用・會自動更新');
  await expect(page.locator('#packList [data-pack-del]')).toHaveCount(0);   // 共用的不能刪、不能分享
  const s = await appState(page);
  expect(s.meta.shared.files.f1).toMatchObject({ version: 100, id: 'pk_eatout', n: 1 });
  expect(s.foodPacks || []).toEqual([]);
  const payload = await page.evaluate(() => window.__dietApp.exportPayload());
  expect(JSON.stringify(payload)).not.toContain('大麥克');
  // 重開：從這台讀，不用再下載（半天內不再問）
  shared.calls = [];
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  await page.waitForTimeout(3500);
  expect(shared.calls).toEqual([]);
  await page.click('[data-food-open=all]');
  await page.fill('#foodSearch', '大麥克');
  await expect(page.locator('#foodPacks')).toContainText('大麥克');
  expect(errors).toEqual([]);
});

test('共用資料庫：管理者換新版 → 自動更新；不再發佈 → 拿掉', async ({ page }) => {
  const sheet = { codes: { 'JJ-4821': { issued: true, name: '王美華' } } };
  await fakeSheet(page, sheet);
  const shared = { list: [{ key: 'f1', version: 100, file: packFile(1) }] };
  await fakeShared(page, sheet, shared);
  await seed(page, member);
  await openApp(page, { inviteUrl: URL_, ownClock: true });
  await expect.poll(async () => ((await appState(page)).meta.shared || {}).files?.f1?.version, { timeout: 10000 }).toBe(100);
  shared.list = [{ key: 'f1', version: 200, file: packFile(2) }];
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('diet_tracker_v2')); s.meta.shared.checkedAt = 0; localStorage.setItem('diet_tracker_v2', JSON.stringify(s)); });
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  await expect(page.locator('#toastMsg')).toContainText('已更新「外食店家營養資料庫」（2 樣）', { timeout: 10000 });
  shared.list = [];
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('diet_tracker_v2')); s.meta.shared.checkedAt = 0; localStorage.setItem('diet_tracker_v2', JSON.stringify(s)); });
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  await expect.poll(async () => Object.keys((await appState(page)).meta.shared.files).length, { timeout: 10000 }).toBe(0);
  await page.click('.mobile-nav-tab[data-tab=library]');
  await expect(page.locator('#packList')).not.toContainText('外食店家營養資料庫');
});

test('共用資料庫：沒有邀請碼的舊用戶不會去下載', async ({ page }) => {
  const shared = { list: [{ key: 'f1', version: 100, file: packFile(1) }] };
  await fakeSheet(page, { codes: {} });
  await fakeShared(page, {}, shared);
  await seed(page, { logs: { '2026-11-20': [{ id: 'a', name: '便當', kcal: 700, meal: 'lunch', updatedAt: 1 }] }, meta: { welcomed: true, invite: { legacy: true, at: 1, rev: 63 } } });
  await openApp(page, { inviteUrl: URL_ });
  await page.waitForTimeout(3500);
  expect(shared.calls || []).toEqual([]);
});

test('外食圖書館：預設全部勾選；取消一家查不到、整類全不選、再勾回來；勾選會同步', async ({ page }) => {
  const errors = [];
  await fakeSheet(page, { codes: { 'JJ-4821': { issued: true, name: '王美華' } } });
  await fakeShared(page, {}, { list: [{ key: 'lib', version: 1, file: libraryFile() }] });
  await seed(page, member);
  await openApp(page, { errors, inviteUrl: URL_ });
  await expect(page.locator('#toastMsg')).toContainText('外食圖書館', { timeout: 10000 });
  await page.click('.mobile-nav-tab[data-tab=library]');
  await expect(page.locator('#packList')).toContainText('已選 3／3 家');
  await page.click('#packList [data-screen="scr-library"]');
  await expect(page.locator('#libList')).toContainText('🧋 手搖飲');
  await page.click('[data-lib-shop="台灣麥當勞"]');
  await expect(page.locator('#libSummary')).toHaveText('已選 2／3 家');
  await expect(page.locator('[data-lib-shop="台灣麥當勞"]')).toHaveAttribute('aria-pressed', 'false');
  expect((await appState(page)).libraryOff.brands).toEqual(['台灣麥當勞']);
  const payload = await page.evaluate(() => window.__dietApp.exportPayload());
  expect(payload.libraryOff.brands).toEqual(['台灣麥當勞']);   // 會同步到自己的其他裝置
  await closeScreens(page);
  await page.click('.mobile-nav-tab[data-tab=log]');
  await page.click('[data-food-open=all]');
  await page.fill('#foodSearch', '大麥克');
  await expect(page.locator('#foodPacks')).not.toContainText('大麥克');
  await page.fill('#foodSearch', '珍珠奶茶');
  await expect(page.locator('#foodPacks')).toContainText('珍珠奶茶');
  await closeScreens(page);
  await page.click('.mobile-nav-tab[data-tab=library]');
  await page.click('#packList [data-screen="scr-library"]');
  await page.click('[data-lib-group="0"]');   // 速食：全選
  await expect(page.locator('#libSummary')).toHaveText('已選 3／3 家');
  await page.click('[data-lib-group="1"]');   // 手搖飲：全不選
  await expect(page.locator('#libSummary')).toHaveText('已選 2／3 家');
  expect((await appState(page)).libraryOff.brands).toEqual(['50嵐']);
  expect(errors).toEqual([]);
});

// ---- 投稿：我的食物推薦給外食圖書館（一定要附照片）----
test('投稿：我的食物 → 推薦給外食圖書館 → 沒照片不能送 → 附照片、店家 → 送出（只送這些）', async ({ page }) => {
  const errors = [];
  const sheet = { codes: { 'JJ-4821': { issued: true, name: '王美華' } } };
  await fakeSheet(page, sheet);
  const contribs = [];
  await page.route(URL_, async (r) => {
    const req = JSON.parse(r.request().postData() || '{}');
    if (req.action !== 'contrib') return r.fallback();
    contribs.push(req);
    return r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true }) });
  });
  await seed(page, { ...member, customFoods: [{ id: 'cf_g', name: '韭菜鍋貼', serving: { label: '10 顆' }, perServing: { kcal: 520, p: 20, f: 25, c: 50 }, updatedAt: 1 }] });
  await openApp(page, { errors, inviteUrl: URL_ });
  await page.click('.mobile-nav-tab[data-tab=library]');
  await page.click('[data-mf-edit=cf_g]');
  await page.click('#mf-contrib');
  await expect(page.locator('#scr-contrib')).toBeVisible();
  await expect(page.locator('#ctSummary')).toContainText('熱量 520 大卡');
  await page.click('#ctSendBtn');
  await expect(page.locator('#ctNote')).toContainText('請填店家');
  await page.fill('#ctBrand', '八方雲集');
  await page.click('#ctSendBtn');
  await expect(page.locator('#ctNote')).toContainText('至少附 1 張照片');
  await page.setInputFiles('#ctPhotoInput', new URL('../fixtures/label.jpg', import.meta.url).pathname);
  await expect(page.locator('#ctPhotos img')).toHaveCount(1);
  await page.fill('#ctWhere', '店家官網');
  await page.click('#ctSendBtn');
  await expect(page.locator('#toastMsg')).toContainText('已經送給管理者');
  const c = contribs[0];
  expect(Object.keys(c).sort()).toEqual(['action', 'brand', 'code', 'deviceId', 'deviceName', 'food', 'group', 'photos', 'ver', 'where']);
  expect(c).toMatchObject({ brand: '八方雲集', where: '店家官網', food: { name: '韭菜鍋貼', serving: '10 顆', kcal: 520, p: 20 } });
  expect(c.photos).toHaveLength(1);
  expect(c.photos[0]).toMatch(/^data:image\/jpeg;base64,/);
  expect((await appState(page)).meta.contribs.cf_g).toBeGreaterThan(0);
  await expect(page.locator('#scr-myfood')).toBeVisible();   // 回到這樣食物的頁面
  await expect(page.locator('#mf-contrib')).toContainText('已推薦過');
  expect(errors).toEqual([]);
});

test('投稿：沒有邀請碼的舊用戶看不到推薦按鈕', async ({ page }) => {
  await fakeSheet(page, { codes: {} });
  await seed(page, { logs: { '2026-11-20': [{ id: 'a', name: '便當', kcal: 700, meal: 'lunch', updatedAt: 1 }] }, meta: { welcomed: true, invite: { legacy: true, at: 1, rev: 63 } },
    customFoods: [{ id: 'cf_g', name: '韭菜鍋貼', serving: { label: '10 顆' }, perServing: { kcal: 520 }, updatedAt: 1 }] });
  await openApp(page, { inviteUrl: URL_ });
  await page.click('.mobile-nav-tab[data-tab=library]');
  await page.click('[data-mf-edit=cf_g]');
  await expect(page.locator('#mf-contrib')).toBeHidden();
});

test('舊用戶裝置：雲端已經有同一個人的邀請碼 → 自動用它登記這台，下載外食圖書館', async ({ page }) => {
  const sheet = { codes: { 'JJ-4821': { issued: true, name: '王美華' } } };
  const calls = await fakeSheet(page, sheet);
  await fakeShared(page, sheet, { list: [{ key: 'lib', version: 1, file: libraryFile() }] });
  await seed(page, { logs: { '2026-11-20': [{ id: 'a', name: '便當', kcal: 700, meal: 'lunch', updatedAt: 1 }] },
    betaInvite: { code: 'JJ-4821', name: '王美華', updatedAt: 5 }, meta: { welcomed: true, invite: { legacy: true, at: 1, rev: 63 } } });
  await openApp(page, { inviteUrl: URL_ });
  await expect(page.locator('#toastMsg')).toContainText('外食圖書館', { timeout: 10000 });
  expect(calls.find(c => c.action === 'register')).toMatchObject({ code: 'JJ-4821', name: '王美華' });
  expect((await appState(page)).meta.invite).toMatchObject({ code: 'JJ-4821', from: 'legacy' });
});

test('舊用戶裝置、沒有雲端的邀請碼：外食圖書館那裡按「我有邀請碼」→ 可以先不要 → 輸入後下載', async ({ page }) => {
  const sheet = { codes: { 'JJ-4821': { issued: true, name: '王美華' } } };
  await fakeSheet(page, sheet);
  await fakeShared(page, sheet, { list: [{ key: 'lib', version: 1, file: libraryFile() }] });
  await seed(page, { logs: { '2026-11-20': [{ id: 'a', name: '便當', kcal: 700, meal: 'lunch', updatedAt: 1 }] }, meta: { welcomed: true, invite: { legacy: true, at: 1, rev: 63 } } });
  await openApp(page, { inviteUrl: URL_ });
  await page.click('.mobile-nav-tab[data-tab=library]');
  await expect(page.locator('#packList')).toContainText('還沒有邀請碼');
  await page.click('[data-invite-join]');
  await expect(page.locator('#inviteGate')).toBeVisible();
  await page.click('#inviteCloseBtn');
  await expect(page.locator('#inviteGate')).toBeHidden();
  expect((await appState(page)).meta.invite).toMatchObject({ legacy: true });
  await page.click('[data-invite-join]');
  await page.fill('#inviteCode', '4821');
  await page.click('#inviteCodeBtn');
  await page.click('#inviteNameBtn');
  await expect(page.locator('#inviteGate')).toBeHidden();
  await expect(page.locator('#toastMsg')).toContainText('外食圖書館', { timeout: 10000 });
  await expect(page.locator('#packList')).toContainText('已選 3／3 家');
});
