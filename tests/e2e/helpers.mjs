// 共用：CDN 離線替身、開啟 App、讀取狀態
const CDN_FILES = {
  '/npm/chart.js@4.4.1/dist/chart.umd.js': 'node_modules/chart.js/dist/chart.umd.js',
  '/npm/@zxing/library@0.21.3/umd/index.min.js': 'node_modules/@zxing/library/umd/index.min.js'
};
export async function stubCdn(page) {
  // Tailwind 替身只提供 .hidden（畫面切換）和 Tailwind 預設的 border-box（寬度含內距，檢查畫面有沒有比手機寬才準）
  await page.route('https://cdn.tailwindcss.com/**', r => r.fulfill({
    contentType: 'application/javascript',
    body: "(()=>{const s=document.createElement('style');s.textContent='.hidden{display:none!important}*,::before,::after{box-sizing:border-box}';document.head.appendChild(s)})()"
  }));
  // Chart.js、ZXing 有加檢查碼（integrity）：給 npm 裝的同一版真實檔案，檢查碼算錯時測試會失敗
  await page.route('https://cdn.jsdelivr.net/**', r => {
    const url = r.request().url();
    const local = Object.entries(CDN_FILES).find(([k]) => url.endsWith(k));
    if (!local) return r.fulfill({ contentType: 'application/javascript', body: '' });
    return r.fulfill({ contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, path: local[1] });
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.fulfill({ body: '' }));
}

// keepWelcome：保留新裝置的歡迎畫面（預設會按「直接開始」關掉，方便測其他流程）
// 時鐘固定從今天中午 12 點開始走：晚上 10 點後記錄會問「這是現在吃的嗎？」，
// 不固定的話測試結果會跟著跑測試的時間變。自己 page.clock.install 的測試傳 ownClock: true。
export async function openApp(page, { errors, keepWelcome = false, ownClock = false } = {}) {
  if (!ownClock) {
    const noon = new Date(); noon.setHours(12, 0, 0, 0);
    await page.clock.install({ time: noon });
  }
  await stubCdn(page);
  if (errors) {
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  }
  await page.goto('/');
  await page.waitForFunction(() => window.__dietApp);
  if (!keepWelcome && await page.isVisible('#scr-welcome')) await page.click('#welcomeStartBtn');
}

export const appState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__dietApp.state)));

export async function photoBytes(page, id) {
  return page.evaluate((key) => new Promise((resolve) => {
    const req = indexedDB.open('diet-tracker');
    req.onsuccess = () => {
      const get = req.result.transaction('photos').objectStore('photos').get(key);
      get.onsuccess = () => resolve(get.result ? get.result.length : 0);
      get.onerror = () => resolve(0);
    };
    req.onerror = () => resolve(0);
  }), id);
}

// 關掉所有開著的全螢幕頁（像手機按返回鍵）
export async function closeScreens(page) {
  for (let i = 0; i < 8; i++) {
    if (!(await page.locator('.screen:not(.hidden)').count())) return;
    await page.goBack();
  }
}
// ⚙️ 設定 → 某一列（例如 '#setDataRow'、'[data-screen=scr-features]'）
export async function openSettings(page, row) {
  await closeScreens(page);
  await page.click('#openSettingsBtn');
  if (row) await page.click('#scr-settings ' + row);
}

export async function importFile(page, file) {
  if (!(await page.isVisible('#scr-data'))) await openSettings(page, '#setDataRow');
  // 清掉上一次的提示，否則連續匯入時會誤認為已完成
  await page.evaluate(() => { document.getElementById('toastMsg').textContent = ''; });
  await page.setInputFiles('#importJsonInput', file);
  await page.click('#confirmOkBtn');
  await page.waitForFunction(() => /匯入完成|匯入失敗/.test(document.getElementById('toastMsg').textContent));
  return page.textContent('#toastMsg');
}
