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

// ---- 意見回饋（設定 → 關於 → 💬 意見回饋）----
// 用邀請碼登記過的裝置，文字送到管理者試算表的「回饋」分頁（tools/invite/Code.gs 的 feedback）；
// 有截圖、或沒有邀請碼的舊用戶，用分享選單從自己常用的聊天 App 傳（LINE、Messenger、Teams、Email 都可以）
export const FEEDBACK_MAX = 500;
export const FEEDBACK_KINDS = [
  { key: 'bug', label: '🐞 哪裡怪怪的', sheet: '哪裡怪怪的' },
  { key: 'wish', label: '💡 希望增加', sheet: '希望增加' },
  { key: 'other', label: '💬 其他', sheet: '其他' }
];
export const canSendFeedback = (invite) => Boolean(invite && invite.code && !invite.locked);

// 貼到聊天 App 的開頭：讓管理者知道是哪一版、哪台
export function feedbackInfo({ label, device, invite }) {
  const lines = ['【飲控隨身記 意見回饋】', '版本：' + label, '裝置：' + device];
  if (invite && invite.code) lines.push('邀請碼：' + invite.code + (invite.name ? '（' + invite.name + '）' : ''));
  lines.push('想說的話：');
  return lines.join('\n');
}

export function feedbackMessage(reason) {
  return {
    empty: '請先寫下想說的話。',
    long: '最多 ' + FEEDBACK_MAX + ' 個字，請分兩次送。',
    limit: '今天已經送了很多則，明天再送；或用下面的按鈕，從你常用的聊天 App 告訴我們。',
    device: '這台裝置沒有在公測名單裡，請用下面的按鈕，從你常用的聊天 App 告訴我們。',
    disabled: '你的邀請碼已經停用，請用下面的按鈕，從你常用的聊天 App 告訴我們。',
    unknown: '你的邀請碼已經停用，請用下面的按鈕，從你常用的聊天 App 告訴我們。',
    busy: '現在太多人在送，請 10 分鐘後再試。',
    network: '連不上，請確認有網路（Wi-Fi 或行動網路）再試一次。'
  }[reason] || '出了點問題，請稍後再試一次；或用下面的按鈕，從你常用的聊天 App 告訴我們。';
}
