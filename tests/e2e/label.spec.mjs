// 照營養標示算（不用拿計算機）＋一筆記錄最多 3 張照片（食物、營養標示、秤重）
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, appState, photoBytes, openSettings, importFile, closeScreens } from './helpers.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAAMBgEB1JqCEwAAAABJRU5ErkJggg==', 'base64');
const pic = (name) => ({ name, mimeType: 'image/png', buffer: PNG });

const todayOf = (page) => page.evaluate(() => window.__dietApp.ui.date);
const entries = async (page) => (await appState(page)).logs[await todayOf(page)] || [];
async function saveManual(page) {
  await page.click('[form=addFoodForm][type=submit]');
  await expect(page.locator('#scr-manual')).toBeHidden();
}

test('照營養標示算：每 35 克 100 大卡、脂肪 10 克，吃 7 克 → 20 大卡、脂肪 2 克，標示一起存', async ({ page }) => {
  await openApp(page);
  await page.click('[data-screen=scr-manual]');
  await page.fill('#foodNameInput', '堅果');
  await page.click('#add-lb summary');
  await page.fill('#add-lb-g', '35');
  await page.fill('#add-lb-kcal', '100');
  await page.fill('#add-lb-f', '10');
  await page.fill('#add-lb-eat', '7');
  await expect(page.locator('#add-lb-out')).toContainText('20 大卡、脂肪 2 克');
  await expect(page.locator('#foodKcalInput')).toHaveValue('20');
  await expect(page.locator('#add-f')).toHaveValue('2');
  // 「吃了 1 份」＝標示的克數
  await page.click('[data-lb-one=add]');
  await expect(page.locator('#add-lb-eat')).toHaveValue('35');
  await expect(page.locator('#foodKcalInput')).toHaveValue('100');
  await page.fill('#add-lb-eat', '7');
  await saveManual(page);
  const [it] = await entries(page);
  expect(it).toMatchObject({ name: '堅果', kcal: 20, f: 2, grams: 7, label: { g: 35, kcal: 100, f: 10 } });
  expect(it.label.p).toBeUndefined();   // 沒填的不要當成 0
  // 下次打開是空的
  await page.click('[data-screen=scr-manual]');
  await expect(page.locator('#add-lb-g')).toHaveValue('');
  await expect(page.locator('#add-lb')).not.toHaveAttribute('open', '');
});

test('一筆記 3 張照片：都存起來、列表標 +2、放大全部看得到；修改時可以移除、改標示重算', async ({ page }) => {
  await openApp(page);
  await page.click('[data-screen=scr-manual]');
  await page.fill('#foodNameInput', '洋芋片');
  await page.setInputFiles('#foodPhotoInput', pic('food.png'));
  await page.click('#add-lb summary');
  await page.setInputFiles('#add-lb-file', pic('label.png'));
  await page.setInputFiles('#foodPhotoInput', pic('scale.png'));
  await expect(page.locator('#add-photos .ph')).toHaveCount(3);
  await expect(page.locator('#add-photos .ph-add')).toHaveCount(0);   // 滿 3 張就不能再加
  await page.fill('#add-lb-g', '30');
  await page.fill('#add-lb-kcal', '160');
  await page.fill('#add-lb-eat', '45');
  await saveManual(page);
  let [it] = await entries(page);
  expect(it).toMatchObject({ kcal: 240, hasPhoto: true });
  expect(it.morePhotos).toHaveLength(2);
  expect(it.morePhotos.every(k => k.startsWith('x_' + it.id + '_') && !k.includes('-'))).toBe(true);
  for (const k of [it.id, ...it.morePhotos]) expect(await photoBytes(page, k)).toBeGreaterThan(0);
  await expect(page.locator('.view-photo-btn')).toContainText('+2');
  await page.click('.view-photo-btn');
  await expect(page.locator('#lightboxImgs img')).toHaveCount(3);
  await page.click('#lightboxEditEntryBtn');

  // 修改：標示已經填好，改吃的克數會重算；移除第 1 張，第 2 張變成第 1 張
  await expect(page.locator('#edit-lb')).toHaveAttribute('open', '');
  await expect(page.locator('#edit-lb-eat')).toHaveValue('45');
  await expect(page.locator('#edit-photos .ph')).toHaveCount(3);
  await page.fill('#edit-lb-eat', '15');
  await expect(page.locator('#editLogKcalInput')).toHaveValue('80');
  await page.click('[data-ph-del="edit:0"]');
  await expect(page.locator('#edit-photos .ph')).toHaveCount(2);
  const [labelKey, scaleKey] = it.morePhotos;
  await page.click('#editLogForm [type=submit]');
  await expect(page.locator('#editLogModal')).toBeHidden();
  const before = it;
  [it] = await entries(page);
  expect(it).toMatchObject({ kcal: 80, grams: 15, hasPhoto: true, morePhotos: [scaleKey] });
  expect(it.photoKey).not.toBe(before.photoKey);   // 第 1 張換了：雲端要上傳新的
  expect(await photoBytes(page, labelKey)).toBe(0);  // 原本的第 2 張已經搬到第 1 張
  expect(await photoBytes(page, it.id)).toBeGreaterThan(0);

  // 刪除：照片都刪掉；復原：都回來
  await page.click('.del-entry-btn');
  await expect.poll(() => photoBytes(page, it.id)).toBe(0);
  expect(await photoBytes(page, scaleKey)).toBe(0);
  await page.click('#toastAction');
  await expect.poll(() => photoBytes(page, scaleKey)).toBeGreaterThan(0);
  expect(await photoBytes(page, it.id)).toBeGreaterThan(0);
});

test('沒有照片時，「加照片」只放一張也照舊（沒有 morePhotos）；複製前一天不帶照片', async ({ page }) => {
  await openApp(page);
  await page.click('[data-screen=scr-manual]');
  await page.fill('#foodNameInput', '飯糰');
  await page.fill('#foodKcalInput', '300');
  await page.setInputFiles('#foodPhotoInput', pic('a.png'));
  await saveManual(page);
  const [it] = await entries(page);
  expect(it.hasPhoto).toBe(true);
  expect('morePhotos' in it).toBe(false);
  expect('label' in it).toBe(false);
});

test('備份檔：第 2、3 張照片也會備份，匯入後都回來', async ({ page }) => {
  await openApp(page);
  await page.click('[data-screen=scr-manual]');
  await page.fill('#foodNameInput', '牛奶');
  await page.fill('#foodKcalInput', '120');
  await page.setInputFiles('#foodPhotoInput', pic('a.png'));
  await page.setInputFiles('#foodPhotoInput', pic('b.png'));
  await saveManual(page);
  const [it] = await entries(page);
  await openSettings(page, '#setDataRow');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportJsonBtn')]);
  const out = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(Object.keys(out.photos).sort()).toEqual([it.id, it.morePhotos[0]].sort());

  // 清掉這台再匯入
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise(r => { const q = indexedDB.deleteDatabase('diet-tracker'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  });
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  if (await page.isVisible('#scr-welcome')) await page.click('#welcomeStartBtn');
  expect(await importFile(page, { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(out)) })).toContain('匯入完成');
  await closeScreens(page);
  expect(await photoBytes(page, it.id)).toBeGreaterThan(0);
  expect(await photoBytes(page, it.morePhotos[0])).toBeGreaterThan(0);
});

// 假的 Google 雲端硬碟（兩台裝置共用）：記得同步檔和照片
function fakeDrive() {
  return { data: null, photos: new Map(), deleted: [], n: 0 };
}
async function useDrive(page, drive) {
  await page.route('https://www.googleapis.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (o) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    const mod = '2026-11-21T00:00:0' + drive.n + 'Z';
    if (req.method() === 'DELETE') {
      const id = url.pathname.split('/').pop();
      for (const [k, v] of drive.photos) if (v.id === id) { drive.photos.delete(k); drive.deleted.push(k); }
      return route.fulfill({ status: 204, body: '' });
    }
    if (req.method() === 'GET' && url.pathname.endsWith('/files')) {
      const q = url.searchParams.get('q') || '';
      if (q.includes("name='飲控隨身記'")) return json({ files: [{ id: 'root' }] });
      if (q.includes("name='照片'")) return json({ files: [{ id: 'photos' }] });
      if (q.includes('飲控隨身記備份.json')) return json({ files: drive.data ? [{ id: 'data', modifiedTime: mod }] : [] });
      if (q.includes("'photos' in parents")) return json({ files: [...drive.photos].map(([k, v]) => ({ id: v.id, name: k + '.jpg', appProperties: { itemId: k } })) });
      return json({ files: [] });
    }
    if (req.method() === 'GET' && url.pathname.endsWith('/files/data')) return json(drive.data);
    if (req.method() === 'GET' && url.pathname.includes('/files/p')) {
      const id = url.pathname.split('/').pop();
      const hit = [...drive.photos.values()].find(v => v.id === id);
      return route.fulfill({ contentType: 'image/jpeg', body: hit ? hit.body : Buffer.alloc(0) });
    }
    if (url.pathname.includes('/upload/')) {
      const body = req.postDataBuffer() || Buffer.alloc(0);
      const text = body.toString('latin1');
      const meta = JSON.parse(Buffer.from(text.match(/\r\n\r\n(\{.*?\})\r\n/)[1], 'latin1').toString('utf8'));
      drive.n++;
      if (meta.appProperties && meta.appProperties.itemId) {
        const start = body.indexOf('\r\n\r\n', body.indexOf('image/')) + 4;
        drive.photos.set(meta.appProperties.itemId, { id: 'p' + drive.n, body: body.subarray(start, body.lastIndexOf('\r\n--')) });
        return json({ id: 'p' + drive.n, modifiedTime: mod });
      }
      const m = body.toString('utf8').match(/\{"app":"diet-tracker"[\s\S]*\}(?=\r\n--)/);
      drive.data = JSON.parse(m[0]);
      return json({ id: 'data', modifiedTime: '2026-11-21T00:00:0' + drive.n + 'Z' });
    }
    return json({});
  });
}
async function linkCloud(context) {
  await context.addInitScript(() => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_gdrive_token', JSON.stringify({ token: 't', exp: Date.now() + 3 * 86400e3 }));
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ meta: { welcomed: true, cloud: { linked: true, auto: false, email: 'me@example.com' } } }));
  });
}
async function syncNow(page) {
  await openSettings(page, '#setDataRow');
  await page.click('#cloudSyncBtn');
  await expect(page.locator('#cloudStatus')).toContainText('已同步');
  await closeScreens(page);
}

test('同步：第 2、3 張照片上傳到雲端、另一台下載得到；拿掉的照片雲端也刪掉', async ({ page, browser }) => {
  const drive = fakeDrive();
  await linkCloud(page.context());
  await useDrive(page, drive);
  await openApp(page);
  await page.click('[data-screen=scr-manual]');
  await page.fill('#foodNameInput', '優格');
  await page.fill('#foodKcalInput', '150');
  await page.setInputFiles('#foodPhotoInput', pic('a.png'));
  await page.setInputFiles('#foodPhotoInput', pic('b.png'));
  await page.setInputFiles('#foodPhotoInput', pic('c.png'));
  await saveManual(page);
  const [it] = await entries(page);
  await syncNow(page);
  expect([...drive.photos.keys()].sort()).toEqual([it.photoKey || it.id, ...it.morePhotos].sort());

  // 另一台
  const ctx2 = await browser.newContext({ baseURL: 'http://127.0.0.1:4173/', viewport: { width: 390, height: 844 } });
  await linkCloud(ctx2);
  const page2 = await ctx2.newPage();
  await useDrive(page2, drive);
  await openApp(page2);
  await syncNow(page2);
  for (const k of [it.id, ...it.morePhotos]) expect(await photoBytes(page2, k)).toBeGreaterThan(0);

  // 第二台拿掉第 3 張 → 同步後雲端刪掉那張，第 2 張留著
  await page2.click('.edit-entry-btn');
  await page2.click('[data-ph-del="edit:2"]');
  await page2.click('#editLogForm [type=submit]');
  await expect(page2.locator('#editLogModal')).toBeHidden();
  await syncNow(page2);
  expect(drive.deleted).toEqual([it.morePhotos[1]]);
  expect(drive.photos.has(it.morePhotos[0])).toBe(true);

  // 第一台同步：這台的第 3 張也刪掉
  await syncNow(page);
  expect((await entries(page))[0].morePhotos).toEqual([it.morePhotos[0]]);
  expect(await photoBytes(page, it.morePhotos[1])).toBe(0);
  await ctx2.close();
});
