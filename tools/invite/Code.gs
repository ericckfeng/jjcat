/**
 * 飲控隨身記 公測邀請碼（Google Apps Script，綁在「飲控隨身記 公測邀請碼」試算表上）
 *
 * App 第一次打開時輸入邀請碼 → 這裡檢查「已發出、可用、裝置還沒滿」→ 請對方填姓名 → 記到「裝置」分頁。
 * 同一台重新安裝（裝置 ID 換了）：同號碼＋同裝置名稱＋同姓名就改寫原本那一筆，不多算一台。
 * 共用資料庫（action: packs／pack）：「共用資料庫」分頁打勾發佈的資料庫檔，登記過的裝置自動下載更新。
 * 意見回饋（action: feedback）：登記過的裝置送文字到「回饋」分頁（第一次會自動建立），一台一天最多 5 則。
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
const FEEDBACK = '回饋';
const FEEDBACK_PER_DAY = 5;      // 一台裝置一天最多送幾則
const FEEDBACK_MAX = 500;        // 一則最多幾個字
const KINDS = { bug: '哪裡怪怪的', wish: '希望增加', other: '其他' };
const SHARED = '共用資料庫';     // A 資料庫檔網址、B 發佈（打勾）、C 名稱、D 樣數、E 檔案更新時間、F 檢查結果、G 備註

function onOpen() {
  SpreadsheetApp.getUi().createMenu('公測邀請碼')
    .addItem('產生 20 組號碼', 'generate20')
    .addItem('檢查共用資料庫', 'checkShared')
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

// ---- 共用資料庫：管理者把整理工具做的資料庫檔（.json）放在自己的雲端硬碟，網址貼到「共用資料庫」分頁、打勾發佈 ----
// 檔案不用分享給任何人：App 透過這裡下載（只給登記過的裝置）。更新＝雲端硬碟「管理版本 → 上傳新版本」（網址不變）
function fileIdOf_(url) {
  const m = String(url || '').match(/\/d\/([-\w]{20,})/) || String(url || '').match(/[?&]id=([-\w]{20,})/) || String(url || '').match(/^([-\w]{20,})$/);
  return m ? m[1] : '';
}
function sharedSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHARED);
  if (!sh) {
    sh = ss.insertSheet(SHARED);
    sh.appendRow(['資料庫檔網址（雲端硬碟）', '發佈', '名稱', '樣數', '檔案更新時間', '檢查結果', '備註']);
    sh.setFrozenRows(1);
    sh.getRange('B2:B50').insertCheckboxes();
    sh.setColumnWidth(1, 360);
    sh.setColumnWidth(6, 260);
  }
  return sh;
}
// 發佈中的：[{ key: 檔案 id, row }]
function sharedRows_() {
  const sh = sharedSheet_();
  const n = sh.getLastRow() - 1;
  const rows = n > 0 ? sh.getRange(2, 1, n, 2).getValues() : [];
  return rows.map((r, i) => ({ key: fileIdOf_(r[0]), on: r[1] === true, row: i + 2 })).filter(r => r.key && r.on);
}
function readPackFile_(key) {
  const data = JSON.parse(DriveApp.getFileById(key).getBlob().getDataAsString('UTF-8'));
  if (!data || data.app !== 'diet-tracker-foods' || !data.pack || !data.pack.id || !Array.isArray(data.foods) || !data.foods.length) throw new Error('這不是整理工具做的資料庫檔');
  return data;
}
// 選單「檢查共用資料庫」：讀每個檔案，填好名稱、樣數、更新時間、檢查結果（發佈前先檢查一次）
function checkShared() {
  const sh = sharedSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) { SpreadsheetApp.getActive().toast('在「' + SHARED + '」分頁 A 欄貼上資料庫檔的網址，B 欄打勾發佈，再檢查一次。'); return; }
  const rows = sh.getRange(2, 1, n, 2).getValues();
  rows.forEach((r, i) => {
    if (!r[0]) return;
    const key = fileIdOf_(r[0]);
    let out;
    try {
      if (!key) throw new Error('看不懂這個網址，請貼雲端硬碟檔案的「共用連結」或網址');
      const data = readPackFile_(key);
      out = [data.pack.name, data.foods.length, DriveApp.getFileById(key).getLastUpdated(), r[1] === true ? 'OK，發佈中' : 'OK（還沒打勾發佈）'];
    } catch (err) {
      out = ['', '', '', '有問題：' + (err && err.message || err)];
    }
    sh.getRange(i + 2, 3, 1, 4).setValues([out]);
  });
  SpreadsheetApp.getActive().toast('檢查好了，看 F 欄的結果。App 大約半天內會自動更新。');
}

// App 打來的：POST（text/plain 的 JSON），回傳 JSON
function doPost(e) {
  let req = {};
  try { req = JSON.parse(e.postData.contents || '{}'); } catch (err) { return out_({ ok: false, reason: 'bad' }); }
  try { return out_(handle_(req)); } catch (err) { return out_({ ok: false, reason: 'error' }); }
}
const VERSION = '2026-11-25c';    // 改了這個檔案就改日期：打開網頁應用程式網址看得到，確認部署的是新版
function doGet() { return out_({ ok: true, app: 'jjcat-invite', version: VERSION }); }
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

// 使用者打的字寫進試算表前：去掉控制字元、限制長度；開頭是 = + - @ 的加 ' 當成純文字（不會被當成公式執行）
function plain_(v, max) {
  const t = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

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

// 「Jian Kai FENG」「jian kai feng」「JianKaiFeng」算同一個名字
function sameName_(a, b) {
  const k = s => String(s || '').replace(/\s+/g, '').toLowerCase();
  return Boolean(k(a)) && k(a) === k(b);
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
  const drows = dn > 0 ? devs.getRange(2, 1, dn, 6).getValues() : [];
  const mine = drows.map((r, i) => ({ code: String(r[0]), id: String(r[1]), dev: String(r[2]), who: String(r[5]), row: i + 2 })).filter(r => r.code === code);
  const here = deviceId && mine.find(r => r.id === deviceId);
  // 同一台重新安裝（iPhone／iPad 刪掉 App、或 Safari 和主畫面各開一次）本機資料是空的，裝置 ID 會換新的：
  // 同一組號碼、同樣的裝置名稱、同樣的姓名，就當成同一台，改寫那一筆，不多算一台
  const devName = plain_(req.deviceName, 40);
  const sameKind = mine.filter(r => devName && r.dev === devName);

  if (req.action === 'check') {
    if (!here && mine.length >= MAX_DEVICES && !sameKind.length) return { ok: false, reason: 'full' };
    return { ok: true, name, known: Boolean(here) };
  }
  if (req.action === 'feedback') return feedback_(req, code, name, here);
  if (req.action === 'packs' || req.action === 'pack') {
    if (!here) return { ok: false, reason: 'device' };
    const live = sharedRows_();
    if (req.action === 'packs') {
      const packs = [];
      live.forEach(r => { try { packs.push({ key: r.key, version: DriveApp.getFileById(r.key).getLastUpdated().getTime() }); } catch (err) { /* 檔案不見了：不列 */ } });
      return { ok: true, packs };
    }
    const key = String(req.key || '');
    if (!live.some(r => r.key === key)) return { ok: false, reason: 'gone' };   // 只給發佈中的
    try { return { ok: true, file: readPackFile_(key) }; } catch (err) { return { ok: false, reason: 'error' }; }
  }
  if (req.action === 'register' || req.action === 'ping') {
    if (!deviceId) return { ok: false, reason: 'bad' };
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const now = new Date();
      const who = plain_(req.name || name, 30);
      const again = !here && sameKind.find(r => sameName_(r.who, who));
      if (here) {
        devs.getRange(here.row, 5).setValue(now);
        if (devName) devs.getRange(here.row, 3).setValue(devName);
      } else if (again) {
        // 重新輸入的換成新的 ID；舊的那邊（例如 Safari 和主畫面兩邊都還在用）每天檢查時只更新時間
        if (req.action === 'register') devs.getRange(again.row, 2).setValue(deviceId);
        devs.getRange(again.row, 5).setValue(now);
      } else {
        if (mine.length >= MAX_DEVICES) return { ok: false, reason: 'full' };
        if (req.action === 'register' && !who) return { ok: false, reason: 'name' };
        devs.appendRow([code, deviceId, devName, now, now, who]);
        if (!name && who) codes.getRange(idx + 2, 5).setValue(who);
      }
      return { ok: true, name: name || String(req.name || '') };
    } finally {
      lock.releaseLock();
    }
  }
  return { ok: false, reason: 'bad' };
}

// 意見回饋：只收這組號碼登記過的裝置（陌生人不能灌），一台一天最多 FEEDBACK_PER_DAY 則，只收文字
function feedback_(req, code, name, here) {
  if (!here) return { ok: false, reason: 'device' };
  const text = plain_(req.text, FEEDBACK_MAX);
  if (!text) return { ok: false, reason: 'empty' };
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(FEEDBACK);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (!sh) {
      sh = ss.insertSheet(FEEDBACK);
      sh.appendRow(['時間', '邀請碼', '姓名', '裝置名稱', '版本', '類型', '內容', '處理了', '備註', '裝置ID']);
      sh.setFrozenRows(1);
      sh.getRange('G:G').setWrap(true);
      sh.setColumnWidth(7, 420);
    }
    const now = new Date();
    const today = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd');
    const n = sh.getLastRow() - 1;
    const rows = n > 0 ? sh.getRange(2, 1, n, 10).getValues() : [];
    const sent = rows.filter(r => String(r[9]) === here.id && r[0] instanceof Date && Utilities.formatDate(r[0], 'Asia/Taipei', 'yyyy-MM-dd') === today).length;
    if (sent >= FEEDBACK_PER_DAY) return { ok: false, reason: 'limit' };
    sh.appendRow([now, code, plain_(name || here.who, 30), here.dev, plain_(req.ver, 40), KINDS[req.kind] || '其他', text, false, '', here.id]);
    sh.getRange(sh.getLastRow(), 8).insertCheckboxes();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}
