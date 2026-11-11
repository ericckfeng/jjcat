// Google 雲端硬碟備份：每位使用者備份到自己的雲端硬碟
// 權限只用 drive.file（只能存取這個 App 自己建立的檔案）
// 登入用整頁跳轉（OAuth 2.0 用戶端流程），iPhone 加入主畫面後也能用
import { GOOGLE_CLIENT_ID } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_KEY = 'diet_gdrive_token';
const PENDING_KEY = 'diet_gdrive_pending';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ROOT_NAME = '飲控隨身記';
const PHOTO_FOLDER_NAME = '照片';
const DATA_NAME = '飲控隨身記備份.json';

export class AuthError extends Error {
  constructor() { super('需要重新登入 Google'); this.auth = true; }
}

export function isConfigured() { return Boolean(GOOGLE_CLIENT_ID); }

// LINE、Facebook 等 App 內建瀏覽器會被 Google 擋下登入
export function isBlockedInAppBrowser() {
  return /\bLine\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(navigator.userAgent);
}

function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export function getToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    if (t && t.token && t.exp > Date.now() + 60000) return t.token;
  } catch (e) { /* ignore */ }
  return null;
}
export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
}

// 跳轉到 Google 登入；回來後由 consumeRedirect() 接手繼續執行 action
export function signIn(action, loginHint) {
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(PENDING_KEY, JSON.stringify({ state, action, at: Date.now() }));
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state
  });
  if (loginHint) p.set('login_hint', loginHint);
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p.toString());
}

// 頁面載入時呼叫：若網址帶有 Google 回傳的 token，存起來並回傳原本要做的動作
export function consumeRedirect() {
  const hash = location.hash || '';
  if (!/access_token=|error=/.test(hash)) return null;
  const h = new URLSearchParams(hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch (e) { /* ignore */ }
  localStorage.removeItem(PENDING_KEY);
  if (!pending || h.get('state') !== pending.state) return { error: '登入狀態不符，請再試一次' };
  if (h.get('error')) {
    return { error: h.get('error') === 'access_denied' ? '已取消 Google 授權' : 'Google 授權失敗：' + h.get('error') };
  }
  const granted = h.get('scope') || '';
  if (!granted.includes('drive.file')) {
    return { error: '需要勾選「Google 雲端硬碟」權限才能備份，請再試一次' };
  }
  localStorage.setItem(TOKEN_KEY, JSON.stringify({
    token: h.get('access_token'),
    exp: Date.now() + (Number(h.get('expires_in')) || 3600) * 1000
  }));
  return { action: pending.action };
}

export async function revoke() {
  const t = getToken();
  clearToken();
  if (!t) return;
  try {
    await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  } catch (e) { /* ignore */ }
}

/* ---------- Drive API ---------- */
async function api(url, opts = {}) {
  const token = getToken();
  if (!token) throw new AuthError();
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
  if (res.status === 401) { clearToken(); throw new AuthError(); }
  if (!res.ok) {
    let msg = String(res.status);
    try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch (e) { /* ignore */ }
    if (res.status === 403 && /quota|storage/i.test(msg)) msg = 'Google 雲端硬碟空間不足';
    throw new Error('Google 雲端硬碟：' + msg);
  }
  return res;
}
function qs(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

async function listFiles(q, fields = 'id,name,modifiedTime,appProperties') {
  const out = [];
  let pageToken = '';
  do {
    const p = new URLSearchParams({ q, fields: 'nextPageToken,files(' + fields + ')', pageSize: '1000', spaces: 'drive' });
    if (pageToken) p.set('pageToken', pageToken);
    const r = await (await api(API + '/files?' + p.toString())).json();
    out.push(...(r.files || []));
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  return out;
}

function multipart(meta, blob) {
  const boundary = 'diet' + Math.random().toString(36).slice(2);
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`
  ]);
  return { body, headers: { 'Content-Type': 'multipart/related; boundary=' + boundary } };
}

async function createFile(meta, blob) {
  const m = multipart(meta, blob);
  return (await api(UPLOAD + '/files?uploadType=multipart&fields=id,modifiedTime,appProperties', { method: 'POST', ...m })).json();
}
async function updateFile(id, meta, blob) {
  const m = multipart(meta, blob);
  return (await api(UPLOAD + '/files/' + id + '?uploadType=multipart&fields=id,modifiedTime,appProperties', { method: 'PATCH', ...m })).json();
}
async function createFolder(name, parent) {
  const meta = { name, mimeType: FOLDER_MIME };
  if (parent) meta.parents = [parent];
  return (await api(API + '/files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta)
  })).json();
}

let folderCache = null;
async function folders(create) {
  if (folderCache) return folderCache;
  let root = (await listFiles(`name=${qs(ROOT_NAME)} and mimeType=${qs(FOLDER_MIME)} and trashed=false`, 'id'))[0];
  if (!root) {
    if (!create) return null;
    root = await createFolder(ROOT_NAME);
  }
  let photos = (await listFiles(`name=${qs(PHOTO_FOLDER_NAME)} and mimeType=${qs(FOLDER_MIME)} and ${qs(root.id)} in parents and trashed=false`, 'id'))[0];
  if (!photos) {
    if (!create) return { root: root.id, photos: null };
    photos = await createFolder(PHOTO_FOLDER_NAME, root.id);
  }
  folderCache = { root: root.id, photos: photos.id };
  return folderCache;
}
export function resetCache() { folderCache = null; }

export async function getUser() {
  const r = await (await api(API + '/about?fields=user(emailAddress,displayName)')).json();
  return r.user || {};
}

// 雲端目前的備份狀態
export async function getInfo() {
  const f = await folders(false);
  if (!f) return { exists: false };
  const file = (await listFiles(`name=${qs(DATA_NAME)} and ${qs(f.root)} in parents and trashed=false`))[0];
  if (!file) return { exists: false };
  const ap = file.appProperties || {};
  return {
    exists: true, fileId: file.id, modifiedTime: file.modifiedTime,
    deviceId: ap.deviceId || '', savedAt: Number(ap.savedAt) || Date.parse(file.modifiedTime),
    entries: Number(ap.entries) || 0, photos: Number(ap.photos) || 0
  };
}

async function runPool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// 備份：照片一張一個檔（只上傳新的），資料存成一個 JSON
export async function backup({ data, photoIds, getPhoto, deviceId, onProgress = () => {} }) {
  onProgress('準備雲端資料夾…');
  const f = await folders(true);
  const existing = await listFiles(`${qs(f.photos)} in parents and trashed=false`, 'id,name,appProperties');
  const have = new Set(existing.map(x => (x.appProperties && x.appProperties.itemId) || x.name.replace(/\.jpg$/, '')));
  const todo = photoIds.filter(id => !have.has(id));
  let done = 0;
  if (todo.length) onProgress(`上傳照片 0/${todo.length}…`);
  await runPool(todo, 3, async (id) => {
    const src = await getPhoto(id);
    if (src) {
      await createFile({ name: id + '.jpg', parents: [f.photos], appProperties: { itemId: id } }, dataUrlToBlob(src));
    }
    done++;
    onProgress(`上傳照片 ${done}/${todo.length}…`);
  });
  onProgress('上傳記錄…');
  const savedAt = Date.now();
  const entries = Object.values(data.logs || {}).reduce((s, l) => s + (l ? l.length : 0), 0);
  const appProperties = { deviceId, savedAt: String(savedAt), entries: String(entries), photos: String(photoIds.length) };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const info = await getInfo();
  const file = info.exists
    ? await updateFile(info.fileId, { appProperties }, blob)
    : await createFile({ name: DATA_NAME, parents: [f.root], appProperties }, blob);
  return { modifiedTime: file.modifiedTime, savedAt, uploadedPhotos: todo.length, entries };
}

// 還原：下載資料 JSON 與所有照片
export async function restore({ onProgress = () => {} }) {
  onProgress('讀取雲端備份…');
  const info = await getInfo();
  if (!info.exists) throw new Error('雲端還沒有備份');
  const data = await (await api(API + '/files/' + info.fileId + '?alt=media')).json();
  const f = await folders(false);
  const need = new Set();
  Object.values(data.logs || {}).forEach(list => (list || []).forEach(it => { if (it && it.hasPhoto) need.add(it.id); }));
  const photos = {};
  if (f && f.photos && need.size) {
    const files = (await listFiles(`${qs(f.photos)} in parents and trashed=false`, 'id,name,appProperties'))
      .map(x => ({ id: x.id, itemId: (x.appProperties && x.appProperties.itemId) || x.name.replace(/\.jpg$/, '') }))
      .filter(x => need.has(x.itemId));
    let done = 0;
    onProgress(`下載照片 0/${files.length}…`);
    await runPool(files, 4, async (x) => {
      const blob = await (await api(API + '/files/' + x.id + '?alt=media')).blob();
      photos[x.itemId] = await blobToDataUrl(blob);
      done++;
      onProgress(`下載照片 ${done}/${files.length}…`);
    });
  }
  return { data, photos, info };
}
