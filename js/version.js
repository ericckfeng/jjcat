// 版本（純函式，有單元測試）
// 給人看的版本＝「發佈日期-當天第幾次」，後面括號 Rev.＝第幾次發佈（從 v1 一路加上來，當紀念）。
// 比較新舊一律只看 Rev.（一定往上加）。
// APP_REV、APP_DATE、APP_SEQ 由 scripts/bump.py 自動改，不要手改。
export const APP_REV = 55;
export const APP_DATE = '2026.11.24';
export const APP_SEQ = 3;

// 雲端資料至少要哪一版 App 才能同步。
// 只有新功能會寫入「舊版看不懂、同步時會弄壞」的資料時才調高（調成那個功能發佈的 Rev.）。
// 低於這一版的 App 會暫停同步（不下載合併、不上傳），提示使用者更新；資料不會被刪。
export const DATA_MIN_REV = 45;

export const versionText = (date, seq) => date ? date + '-' + seq : '';
export function versionLabel(date = APP_DATE, seq = APP_SEQ, rev = APP_REV) {
  const v = versionText(date, seq);
  return v ? v + '（Rev. ' + rev + '）' : 'Rev. ' + rev;
}
export const APP_VER = versionText(APP_DATE, APP_SEQ);
export const APP_LABEL = versionLabel();

// 網站上的 version.json → { rev, ver }；看不懂的回傳 null
export function parseLatest(obj) {
  const rev = Number(obj && obj.rev);
  if (!Number.isInteger(rev) || rev <= 0) return null;
  return { rev, ver: typeof obj.ver === 'string' ? obj.ver : '' };
}

// 雲端資料（或備份檔）要求的最低 Rev.；這一版夠新就回傳 0
export function requiredRev(data, rev = APP_REV) {
  const need = Number(data && data.minRev && data.minRev.rev) || 0;
  return need > rev ? need : 0;
}

// 要不要把 DATA_MIN_REV 寫進同步資料（只會往上調）
export function minRevToWrite(current, minRev = DATA_MIN_REV, now = Date.now()) {
  const cur = Number(current && current.rev) || 0;
  return minRev > cur ? { rev: minRev, updatedAt: now } : null;
}

// ---- 我的裝置 ----
// 同步檔最上層 devices: [{ id, rev, ver, name, updatedAt }]，以 id 合併、較新的勝出（舊版 App 也照這個規則合併）。
// 每台只在「版本變了、名字變了、或超過 20 小時」時更新自己那一筆，避免每次同步都改到資料、兩台來回上傳。
export const DEVICE_REFRESH_MS = 20 * 3600 * 1000;

export function deviceName(ua = '') {
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return 'iPad';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android 手機' : 'Android 平板';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac 電腦';
  if (/Windows/.test(ua)) return 'Windows 電腦';
  return '電腦';
}

// 這台的記錄要不要更新；要的話回傳新的那一筆，不用回傳 null
export function deviceRecord(devices, { id, rev = APP_REV, ver = APP_VER, name, now = Date.now() }) {
  const list = Array.isArray(devices) ? devices : [];
  const cur = list.find(d => d && d.id === id);
  if (cur && cur.rev === rev && cur.ver === ver && cur.name === name && now - (Number(cur.updatedAt) || 0) < DEVICE_REFRESH_MS) return null;
  return { id, rev, ver, name, updatedAt: now };
}

export function upsertDevice(devices, rec) {
  const list = (Array.isArray(devices) ? devices : []).filter(d => d && d.id !== rec.id);
  return [...list, rec];
}

// 關於頁的裝置清單：這台排第一，其他照最後同步時間新到舊
// state：'ok'＝最新版、'old'＝有新版、'unknown'＝還不知道最新版是哪一版
export function deviceRows(devices, { myId, latestRev = null, now = Date.now() }) {
  const list = (Array.isArray(devices) ? devices : []).filter(d => d && d.id);
  return list
    .map(d => ({
      id: d.id, name: d.name || '裝置', ver: d.ver || '', rev: Number(d.rev) || 0, mine: d.id === myId,
      days: Math.max(0, Math.floor((now - (Number(d.updatedAt) || 0)) / 86400000)),
      state: latestRev ? ((Number(d.rev) || 0) >= latestRev ? 'ok' : 'old') : 'unknown'
    }))
    .sort((a, b) => (b.mine - a.mine) || (a.days - b.days));
}
