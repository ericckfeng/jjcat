/**
 * 飲控隨身記 公測邀請碼（Google Apps Script，綁在「飲控隨身記 公測邀請碼」試算表上）
 *
 * App 第一次打開時輸入邀請碼 → 這裡檢查「已發出、可用、裝置還沒滿」→ 請對方填姓名 → 記到「裝置」分頁。
 * 同一台重新安裝（裝置 ID 換了）：同號碼＋同裝置名稱＋同姓名就改寫原本那一筆，不多算一台。
 * 共用資料庫（action: packs／pack）：「共用資料庫」分頁打勾發佈的資料庫檔，登記過的裝置自動下載更新。
 * 管理者（action: adminRows／adminSaveRows／adminPublish，要發佈密碼）：整理工具讀寫「外食圖書館總表」、直接發佈資料庫檔（不用下載上傳）。
 * 投稿（action: contrib）：登記過的裝置推薦一樣食物，一定要附 1～3 張 JPEG 照片（存到雲端硬碟「飲控隨身記 投稿照片」），
 *   寫到「投稿」分頁；管理者看照片打勾「通過」→ 選單「整理通過的投稿」→ 複製到外食圖書館試算表 → 打勾「已併入」。
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
const CONTRIB = '投稿';
const CONTRIB_PER_DAY = 10;      // 一台裝置一天最多推薦幾樣
const PHOTO_FOLDER = '飲控隨身記 投稿照片';   // 管理者雲端硬碟裡的資料夾（不公開）
const MASTER = '外食圖書館總表';   // 外食圖書館的原始資料（一列一樣食物）：整理工具「從試算表讀總表」→ 檢查 →「發佈給大家」
const SHARED_FOLDER = '飲控隨身記 共用資料庫';   // 發佈的資料庫檔放這裡（不公開，程式自己管）
// 和外食圖書館試算表一樣的欄位：「整理通過的投稿」排好，複製貼上就好
const LIB_HEAD = ['提供者(餐廳店家)', '店家分類', '餐點分類', '品項名稱', '份量規格', '熱量(kcal)', '蛋白質(g)', '脂肪(g)', '飽和脂肪(g)', '反式脂肪(g)', '碳水化合物(g)', '糖(g)', '鈉(mg)', '資料來源說明'];
const SHARED = '共用資料庫';     // A 資料庫檔網址、B 發佈（打勾）、C 名稱、D 樣數、E 檔案更新時間、F 檢查結果、G 備註

function onOpen() {
  SpreadsheetApp.getUi().createMenu('公測邀請碼')
    .addItem('產生 20 組號碼', 'generate20')
    .addItem('檢查共用資料庫', 'checkShared')
    .addItem('併入通過的投稿', 'mergeApproved')
    .addItem('設定發佈密碼', 'setAdminKey')
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
  try { return out_(handle_(req)); } catch (err) {
    // 管理者（整理工具）看得到錯誤原因，方便知道是不是要授權雲端硬碟；一般使用者只回 error
    return out_({ ok: false, reason: 'error', detail: /^admin/.test(String(req.action || '')) ? String(err && err.message || err).slice(0, 300) : undefined });
  }
}
const VERSION = '2026-11-25f';    // 改了這個檔案就改日期：打開網頁應用程式網址看得到，確認部署的是新版
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
  if (/^admin/.test(String(req.action || ''))) return admin_(req);
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
  if (req.action === 'contrib') return contrib_(req, code, name, here);
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

// ---- 投稿：推薦一樣食物給外食圖書館（一定要有照片，管理者人工審核）----
const CONTRIB_HEAD = ['時間', '邀請碼', '姓名', '裝置名稱', '版本', '店家', '店家分類', '品名', '份量', '熱量(kcal)', '蛋白質(g)', '脂肪(g)', '飽和脂肪(g)', '反式脂肪(g)', '碳水(g)', '糖(g)', '鈉(mg)', '膳食纖維(g)', '在哪裡看到的', '照片', '通過', '已併入', '備註', '裝置ID'];
function num_(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 10) / 10 : '';
}
// 只收 JPEG（App 縮好的照片）：data URL 格式對、檔頭是 FF D8 FF、不超過 3 MB
function jpeg_(p) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(p || ''));
  if (!m) return null;
  let bytes;
  try { bytes = Utilities.base64Decode(m[1]); } catch (err) { return null; }
  if (bytes.length < 100 || bytes.length > 3e6 || bytes[0] !== -1 || bytes[1] !== -40 || bytes[2] !== -1) return null;
  return bytes;
}
function contrib_(req, code, name, here) {
  if (!here) return { ok: false, reason: 'device' };
  const f = req.food || {};
  const fname = plain_(f.name, 60);
  const kcal = num_(f.kcal);
  if (!fname || kcal === '') return { ok: false, reason: 'bad' };
  const brand = plain_(req.brand, 40);
  if (!brand) return { ok: false, reason: 'brand' };
  const photos = Array.isArray(req.photos) ? req.photos.slice(0, 3) : [];
  if (!photos.length) return { ok: false, reason: 'photo' };
  const imgs = photos.map(jpeg_);
  if (imgs.some(b => !b)) return { ok: false, reason: 'photo' };
  const ss = SpreadsheetApp.getActive();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let sh = ss.getSheetByName(CONTRIB);
    if (!sh) {
      sh = ss.insertSheet(CONTRIB);
      sh.appendRow(CONTRIB_HEAD);
      sh.setFrozenRows(1);
      sh.setColumnWidth(20, 260);
    }
    const now = new Date();
    const today = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd');
    const n = sh.getLastRow() - 1;
    const rows = n > 0 ? sh.getRange(2, 1, n, CONTRIB_HEAD.length).getValues() : [];
    const sent = rows.filter(r => String(r[23]) === here.id && r[0] instanceof Date && Utilities.formatDate(r[0], 'Asia/Taipei', 'yyyy-MM-dd') === today).length;
    if (sent >= CONTRIB_PER_DAY) return { ok: false, reason: 'limit' };
    const it = DriveApp.getFoldersByName(PHOTO_FOLDER);
    const folder = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER);
    const safe = (brand + '_' + fname).replace(/^'/, '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
    const urls = imgs.map((b, i) => folder.createFile(Utilities.newBlob(b, 'image/jpeg', today + '_' + safe + '_' + (i + 1) + '.jpg')).getUrl());
    sh.appendRow([now, code, plain_(name || here.who, 30), here.dev, plain_(req.ver, 40), brand, plain_(req.group, 30), fname, plain_(f.serving, 40),
      kcal, num_(f.p), num_(f.f), num_(f.sfa), num_(f.tfa), num_(f.c), num_(f.sugar), num_(f.na), num_(f.fiber), plain_(req.where, 60), urls.join('\n'), false, false, '', here.id]);
    sh.getRange(sh.getLastRow(), 21, 1, 2).insertCheckboxes();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}
// 選單「併入通過的投稿」：打勾「通過」、還沒「已併入」的，加到「外食圖書館總表」最下面，並打勾「已併入」
function mergeApproved() {
  const ss = SpreadsheetApp.getActive();
  const master = ss.getSheetByName(MASTER);
  if (!master) { ss.toast('還沒有「' + MASTER + '」分頁：先在整理工具讀入外食圖書館的表，按「存成試算表總表」。'); return; }
  const sh = ss.getSheetByName(CONTRIB);
  const n = sh ? sh.getLastRow() - 1 : 0;
  const rows = n > 0 ? sh.getRange(2, 1, n, CONTRIB_HEAD.length).getValues() : [];
  const head = master.getRange(1, 1, 1, master.getLastColumn()).getDisplayValues()[0];
  const picked = rows.map((r, i) => [r, i + 2]).filter(([r]) => r[20] === true && r[21] !== true);
  if (!picked.length) { ss.toast('沒有「通過」又還沒「已併入」的投稿。'); return; }
  const out = picked.map(([r]) => {
    const lib = [r[5], r[6], '', r[7], r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15], r[16], '使用者投稿' + (r[18] ? '：' + r[18] : '')];
    return head.map(h => { const k = LIB_HEAD.indexOf(h); return k < 0 ? '' : lib[k]; });
  });
  master.getRange(master.getLastRow() + 1, 1, out.length, head.length).setValues(out);
  picked.forEach(([, row]) => sh.getRange(row, 22).setValue(true));
  ss.toast('已把 ' + out.length + ' 樣加到「' + MASTER + '」最下面。到整理工具「從試算表讀總表」→ 檢查 →「發佈給大家」。');
}

// ---- 管理者：整理工具（公開網頁）用發佈密碼讀寫總表、發佈資料庫檔 ----
// 選單「設定發佈密碼」：產生一組新的（舊的立刻失效），只顯示給管理者看
function setAdminKey() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let key = '';
  for (let i = 0; i < 12; i++) key += abc.charAt(Math.floor(Math.random() * abc.length));
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', key);
  SpreadsheetApp.getUi().alert('發佈密碼：' + key + '\n\n在整理工具「管理者」區塊輸入一次，那台電腦就會記住。不要給別人；重新設定會讓舊的失效。');
}
function admin_(req) {
  const key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!key) return { ok: false, reason: 'nokey' };
  if (tooManyFails_()) return { ok: false, reason: 'busy' };
  if (String(req.key || '') !== key) { addFail_(); return { ok: false, reason: 'key' }; }
  const ss = SpreadsheetApp.getActive();
  if (req.action === 'adminRows') {
    const sh = ss.getSheetByName(MASTER);
    if (!sh || sh.getLastRow() < 2) return { ok: false, reason: 'nomaster' };
    return { ok: true, rows: sh.getDataRange().getDisplayValues() };
  }
  if (req.action === 'adminSaveRows') {
    const rows = Array.isArray(req.rows) ? req.rows : [];
    const w = rows.length ? rows[0].length : 0;
    if (rows.length < 2 || rows.length > 20000 || !w || w > 40 || rows.some(r => !Array.isArray(r) || r.length !== w)) return { ok: false, reason: 'bad' };
    // 開頭是 = + @ 的當文字（不會變成公式）；負號開頭的數字照常
    const clean = rows.map(r => r.map(c => { const t = String(c == null ? '' : c).slice(0, 500); return /^[=+@]/.test(t) ? "'" + t : t; }));
    const sh = ss.getSheetByName(MASTER) || ss.insertSheet(MASTER);
    sh.clear();
    sh.getRange(1, 1, clean.length, w).setValues(clean);
    sh.setFrozenRows(1);
    return { ok: true, n: clean.length - 1 };
  }
  if (req.action === 'adminPublish') {
    const data = req.file;
    if (!data || data.app !== 'diet-tracker-foods' || !data.pack || !data.pack.id || !data.pack.name || !Array.isArray(data.foods) || !data.foods.length) return { ok: false, reason: 'bad' };
    const json = JSON.stringify(data);
    if (json.length > 20e6) return { ok: false, reason: 'big' };
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const it = DriveApp.getFoldersByName(SHARED_FOLDER);
      const folder = it.hasNext() ? it.next() : DriveApp.createFolder(SHARED_FOLDER);
      const fname = String(data.pack.id).replace(/[^\w-]/g, '') + '.json';
      const found = folder.getFilesByName(fname);
      let file;
      if (found.hasNext()) { file = found.next(); file.setContent(json); } else file = folder.createFile(fname, json, 'application/json');
      // 「共用資料庫」分頁：同一個檔案就更新那一列，沒有就加一列並打勾發佈
      const sh = sharedSheet_();
      const n = sh.getLastRow() - 1;
      const urls = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(r => fileIdOf_(r[0])) : [];
      let row = urls.indexOf(file.getId()) + 2;
      const isNew = row < 2;
      if (isNew) {
        const empty = urls.indexOf('');   // 預先放了勾選框的空白列：用第一個空的，不要加到最下面
        row = empty >= 0 ? empty + 2 : sh.getLastRow() + 1;
        sh.getRange(row, 1).setValue(file.getUrl());
        sh.getRange(row, 2).insertCheckboxes().setValue(true);
      }
      sh.getRange(row, 3, 1, 4).setValues([[data.pack.name, data.foods.length, new Date(), sh.getRange(row, 2).getValue() === true ? 'OK，發佈中（整理工具發佈）' : 'OK（還沒打勾發佈）']]);
      return { ok: true, name: data.pack.name, n: data.foods.length, isNew, on: sh.getRange(row, 2).getValue() === true };
    } finally {
      lock.releaseLock();
    }
  }
  return { ok: false, reason: 'bad' };
}

// 在 Apps Script 編輯器選這個函式按「執行」：一步一步試發佈要用到的東西，跳出結果（測試檔案會丟到垃圾桶）
function diagnose() {
  const log = [];
  const step = (name, fn) => {
    try { const v = fn(); log.push('✅ ' + name + (typeof v === 'string' ? '：' + v : '')); return v; } catch (e) { log.push('❌ ' + name + '：' + (e && e.message || e)); return null; }
  };
  step('程式版本', () => VERSION);
  step('發佈密碼', () => PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') ? '已設定' : '還沒設定');
  step('鎖', () => { const l = LockService.getScriptLock(); l.waitLock(5000); l.releaseLock(); return '正常'; });
  const folder = step('雲端硬碟資料夾「' + SHARED_FOLDER + '」', () => { const it = DriveApp.getFoldersByName(SHARED_FOLDER); return it.hasNext() ? it.next() : DriveApp.createFolder(SHARED_FOLDER); });
  const f = folder && step('建立測試檔', () => folder.createFile('diagnose.json', '{"ok":true}', 'application/json'));
  if (f) step('改測試檔內容', () => { f.setContent('{"ok":2}'); return '正常'; });
  if (f) step('丟掉測試檔', () => { f.setTrashed(true); return '正常'; });
  step('「共用資料庫」分頁', () => sharedSheet_().getName());
  step('「外食圖書館總表」分頁', () => { const sh = SpreadsheetApp.getActive().getSheetByName(MASTER); return sh ? (sh.getLastRow() - 1) + ' 列' : '沒有'; });
  SpreadsheetApp.getUi().alert('診斷結果\n\n' + log.join('\n'));
}
