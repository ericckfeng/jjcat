/**
 * 飲控隨身記 公測邀請碼（Google Apps Script，綁在「飲控隨身記 公測邀請碼」試算表上）
 *
 * App 第一次打開時輸入邀請碼 → 這裡檢查「已發出、可用、裝置還沒滿」→ 請對方填姓名 → 記到「裝置」分頁。
 * App 每天第一次連網打開時再問一次：號碼被改成「停用」的，那台就要重新輸入邀請碼（記錄不會刪）。
 *
 * 部署：擴充功能 → Apps Script → 貼上這個檔案 → 部署 → 新增部署作業 → 網頁應用程式
 *       （執行身分：我；誰可以存取：所有人）→ 把網址貼到 App 的 js/config.js 的 INVITE_URL。
 * 改了這個檔案要「管理部署作業 → 編輯 → 版本：新版本」，網址才不會變。
 * 步驟和說明見 docs/INVITE.md。
 */
const MAX_DEVICES = 3;           // 一組號碼最多幾台裝置
const CODES = '邀請碼';
const DEVICES = '裝置';
const FAIL_LIMIT = 30;           // 10 分鐘內錯幾次就暫停（防止有人一組一組猜）

function onOpen() {
  SpreadsheetApp.getUi().createMenu('公測邀請碼')
    .addItem('產生 20 組號碼', 'generate20')
    .addToUi();
}

// 4 位數字，避開好猜的（1234、1111、1122、年份 1900～2099）
function isWeak_(s) {
  const d = s.split('').map(Number);
  if (new Set(d).size <= 2) return true;
  if ([0, 1, 2].every(i => d[i + 1] - d[i] === 1) || [0, 1, 2].every(i => d[i] - d[i + 1] === 1)) return true;
  const n = Number(s);
  return (n >= 1900 && n <= 2099) || s.slice(0, 2) === s.slice(2);
}
function generate20() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CODES);
  const last = sh.getLastRow();
  const have = new Set(last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0])) : []);
  const rows = [];
  while (rows.length < 20) {
    const s = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const code = 'JJ-' + s;
    if (isWeak_(s) || have.has(code)) continue;
    have.add(code);
    const r = last + rows.length + 1;
    rows.push([code, '', false, '可用', '',
      '=IF(G' + r + '=0,"",MINIFS(\'' + DEVICES + '\'!D:D,\'' + DEVICES + '\'!A:A,A' + r + '))',
      '=COUNTIF(\'' + DEVICES + '\'!A:A,A' + r + ')',
      '=IF(G' + r + '=0,"",MAXIFS(\'' + DEVICES + '\'!E:E,\'' + DEVICES + '\'!A:A,A' + r + '))', '']);
  }
  sh.getRange(last + 1, 1, rows.length, rows[0].length).setValues(rows);
  SpreadsheetApp.getActive().toast('產生了 20 組新號碼。發給誰就寫在「發給誰」，再打勾「已發出」。');
}

// App 打來的：POST（text/plain 的 JSON），回傳 JSON
function doPost(e) {
  let req = {};
  try { req = JSON.parse(e.postData.contents || '{}'); } catch (err) { return out_({ ok: false, reason: 'bad' }); }
  try { return out_(handle_(req)); } catch (err) { return out_({ ok: false, reason: 'error' }); }
}
function doGet() { return out_({ ok: true, app: 'jjcat-invite' }); }
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function normCode_(code) {
  const d = String(code || '').replace(/\D/g, '');
  return d.length === 4 ? 'JJ-' + d : '';
}
function tooManyFails_() {
  const c = CacheService.getScriptCache();
  return Number(c.get('fails') || 0) >= FAIL_LIMIT;
}
function addFail_() {
  const c = CacheService.getScriptCache();
  c.put('fails', String(Number(c.get('fails') || 0) + 1), 600);
}

function handle_(req) {
  const code = normCode_(req.code);
  const deviceId = String(req.deviceId || '').slice(0, 64);
  if (tooManyFails_()) return { ok: false, reason: 'busy' };
  const ss = SpreadsheetApp.getActive();
  const codes = ss.getSheetByName(CODES);
  const devs = ss.getSheetByName(DEVICES);
  const n = codes.getLastRow() - 1;
  const rows = n > 0 ? codes.getRange(2, 1, n, 5).getValues() : [];
  const idx = rows.findIndex(r => String(r[0]) === code);
  // 沒這組號碼、還沒打勾發出的：一樣回「不對」，不透露是哪一種
  if (!code || idx < 0 || rows[idx][2] !== true) { addFail_(); return { ok: false, reason: 'unknown' }; }
  if (String(rows[idx][3]) === '停用') return { ok: false, reason: 'disabled' };
  const name = String(rows[idx][4] || '');
  const dn = devs.getLastRow() - 1;
  const drows = dn > 0 ? devs.getRange(2, 1, dn, 2).getValues() : [];
  const mine = drows.map((r, i) => ({ code: String(r[0]), id: String(r[1]), row: i + 2 })).filter(r => r.code === code);
  const here = deviceId && mine.find(r => r.id === deviceId);

  if (req.action === 'check') {
    if (!here && mine.length >= MAX_DEVICES) return { ok: false, reason: 'full' };
    return { ok: true, name, known: Boolean(here) };
  }
  if (req.action === 'register' || req.action === 'ping') {
    if (!deviceId) return { ok: false, reason: 'bad' };
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const now = new Date();
      if (here) {
        devs.getRange(here.row, 5).setValue(now);
        if (req.deviceName) devs.getRange(here.row, 3).setValue(String(req.deviceName).slice(0, 40));
      } else {
        if (mine.length >= MAX_DEVICES) return { ok: false, reason: 'full' };
        const who = String(req.name || name || '').trim().slice(0, 30);
        if (req.action === 'register' && !who) return { ok: false, reason: 'name' };
        devs.appendRow([code, deviceId, String(req.deviceName || '').slice(0, 40), now, now, who]);
        if (!name && who) codes.getRange(idx + 2, 5).setValue(who);
      }
      return { ok: true, name: name || String(req.name || '') };
    } finally {
      lock.releaseLock();
    }
  }
  return { ok: false, reason: 'bad' };
}
