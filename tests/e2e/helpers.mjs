// 共用：CDN 離線替身、開啟 App、讀取狀態
export async function stubCdn(page) {
  // Tailwind 替身只提供 .hidden，足夠讓畫面切換正常運作
  await page.route('https://cdn.tailwindcss.com/**', r => r.fulfill({
    contentType: 'application/javascript',
    body: "(()=>{const s=document.createElement('style');s.textContent='.hidden{display:none!important}';document.head.appendChild(s)})()"
  }));
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.fulfill({ body: '' }));
}

// keepWelcome：保留新裝置的歡迎畫面（預設會按「直接開始」關掉，方便測其他流程）
export async function openApp(page, { errors, keepWelcome = false } = {}) {
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
