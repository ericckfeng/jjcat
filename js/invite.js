// 公測邀請碼（純函式，有單元測試）
// 號碼在管理者的 Google 試算表（tools/invite/Code.gs）：JJ-加 4 位數字，一組最多 3 台裝置。
// 這台裝置的狀態存在 meta.invite（只存本機）：
//   { code, name, at, rev, lastCheck, locked?, reason? }：用邀請碼加入的（哪個碼、哪天、哪一版 Rev 加入）
//   { legacy: true, at, rev }：有邀請碼之前就在用的裝置（有記錄），直接放行
// 同一份也存在同步資料最上層的 betaInvite（{ code, name, updatedAt } 或 { legacy: true, updatedAt }）：
// 刪掉 App 重裝、或換新裝置時，用 Google 帳號登入取回記錄就不用再找邀請碼。
// js/config.js 的 INVITE_URL 是空的時候，整個功能關閉（和以前一樣，不用邀請碼）。

export const MAX_TRIES = 5;           // 連續輸錯幾次要等
export const WAIT_MS = 60 * 1000;     // 等多久
export const CHECK_EVERY = 20 * 3600 * 1000;   // 多久問一次號碼有沒有被停用（約每天第一次打開）

// 「JJ-4821」「jj4821」「4821」「４８２１」都算同一組
export function normalizeInvite(s) {
  const d = String(s || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\D/g, '');
  return d.length === 4 ? 'JJ-' + d : '';
}

// off：沒有啟用；open：可以用；legacy：舊用戶，要記成放行；restore：雲端有邀請碼，用它登記這台；
// new：新裝置要輸入；locked：號碼被停用了，要重新輸入
// 只連了 Google、雲端沒有邀請碼也沒有記錄的，一樣要輸入（不然誰登入都能用）
export function gateState({ url, invite, hasData, cloudInvite }) {
  if (!url) return 'off';
  if (invite && invite.legacy) return 'open';
  if (invite && invite.code) return invite.locked ? 'locked' : 'open';
  if (cloudInvite && cloudInvite.code) return 'restore';
  return hasData || (cloudInvite && cloudInvite.legacy) ? 'legacy' : 'new';
}

// 這台的邀請碼要不要寫進同步資料：回傳要寫的那一份，不用寫回傳 null
// 雲端的比這台新（例如別台換了新號碼）就不蓋掉
export function cloudInviteFor(invite, cloudInvite, now) {
  if (!invite || invite.locked || !(invite.code || invite.legacy)) return null;
  const cur = cloudInvite || null;
  if (invite.legacy) return cur ? null : { legacy: true, updatedAt: now };
  if (cur && cur.code === invite.code) return null;
  if (cur && cur.code && (Number(cur.updatedAt) || 0) >= (Number(invite.at) || 0)) return null;
  return { code: invite.code, name: invite.name || '', updatedAt: now };
}

export const needCheck = (invite, now) => Boolean(invite && invite.code && !invite.locked && !(now - (invite.lastCheck || 0) < CHECK_EVERY));

// 輸錯次數：{ n, until }。回傳要等幾秒（0＝可以試）
export function waitSeconds(fails, now) {
  return fails && fails.until && now < fails.until ? Math.ceil((fails.until - now) / 1000) : 0;
}
// 等過一輪（有 until）之後重新算
export function addFail(fails, now) {
  const n = (fails && !fails.until ? fails.n || 0 : 0) + 1;
  return n >= MAX_TRIES ? { n: 0, until: now + WAIT_MS } : { n };
}

// 管理者那邊回的原因 → 給使用者看的話
export function inviteMessage(reason) {
  return {
    unknown: '這組邀請碼不對。請再看一次，或向邀請你的人確認。',
    disabled: '這組邀請碼已經停用了，請向邀請你的人索取新的邀請碼。你的記錄都還在，輸入新的邀請碼就能繼續用。',
    full: '這組邀請碼已經用在 3 台裝置上了，請向邀請你的人索取新的邀請碼。',
    busy: '現在太多人在試，請 10 分鐘後再試。',
    name: '請填你的姓名。',
    network: '連不上，請確認有網路（Wi-Fi 或行動網路）再試一次。'
  }[reason] || '出了點問題，請稍後再試一次。';
}
