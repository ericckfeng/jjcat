// Google 雲端備份設定
// 在 Google Cloud Console 建立「網頁應用程式」OAuth 用戶端後，把用戶端 ID 貼在這裡。
// 這個 ID 本來就是公開的（會出現在登入網址上），放在程式碼裡沒有安全問題。
// 留空時，App 不會顯示雲端備份功能。
export const GOOGLE_CLIENT_ID = '474494053412-21ck8avc54kfgpelu9bhtt29i51l9qot.apps.googleusercontent.com';

// 公測邀請碼：管理者的 Google Apps Script 網頁應用程式網址（tools/invite/Code.gs，部署步驟見 docs/INVITE.md）。
// 留空時不用邀請碼，和以前一樣。
export const INVITE_URL = 'https://script.google.com/macros/s/AKfycbwKDMRQRrLMBLw2lKHGhx8KuSFHvMJ-1hxNVnQ71mvk0kpHUWGDUwnfp4DlejaWAZA3/exec';
