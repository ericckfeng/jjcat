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

export async function openApp(page, { errors } = {}) {
  await stubCdn(page);
  if (errors) {
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  }
  await page.goto('/');
  await page.waitForFunction(() => window.__dietApp);
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

export async function importFile(page, file) {
  await page.click('.mobile-nav-tab[data-tab=report]');
  await page.setInputFiles('#importJsonInput', file);
  await page.click('#confirmOkBtn');
  await page.waitForFunction(() => /匯入完成|匯入失敗/.test(document.getElementById('toastMsg').textContent));
  return page.textContent('#toastMsg');
}
