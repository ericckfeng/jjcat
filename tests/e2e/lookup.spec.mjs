// 拍照記・待查：拍照＋用手比大小＋數量（＋類別粗估）；待查清單一筆一筆補，或匯出待查表、填好再回填
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, appState, photoBytes } from './helpers.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAAMBgEB1JqCEwAAAABJRU5ErkJggg==', 'base64');
const pic = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
const todayOf = (page) => page.evaluate(() => window.__dietApp.ui.date);

async function savePhotoQuick(page) {
  await page.click('#photoQuickSave');
  await expect(page.locator('#scr-photo')).toBeHidden();
}

test('拍照記：2 張照片、拳頭 1/2 × 2、飯麵類 → 粗估 280 大卡，記成待查；首頁出現待查', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#lookupTile')).toBeHidden();
  await page.click('[data-screen=scr-photo]');
  await page.setInputFiles('#photoQuickInput', pic('a.png'));
  await expect(page.locator('#photoQuickShoot')).toBeHidden();
  await page.click('[data-ph-add=pq]');   // 「加照片」那一格
  await page.setInputFiles('#photoQuickInput', pic('b.png'));
  await expect(page.locator('#pq-photos .ph')).toHaveCount(2);
  await page.click('[data-pq-ref=fist]');
  await page.click('[data-pq-amt="0.5"]');
  await page.click('#pqPlus');
  await expect(page.locator('#pqN')).toHaveText('2');
  await page.click('[data-pq-cat=grain]');
  await expect(page.locator('#pqEst')).toContainText('粗估約 280 大卡（拳頭 1/2 × 2）');
  await savePhotoQuick(page);
  const [it] = (await appState(page)).logs[await todayOf(page)];
  expect(it).toMatchObject({ name: '待查・飯麵・包子糕點', kcal: 280, pending: true, hasPhoto: true, ex: { grain: 4 }, lookup: { ref: 'fist', amt: 0.5, n: 2, cat: 'grain' } });
  expect(it.morePhotos).toHaveLength(1);
  await expect(page.locator('#lookupTile')).toBeVisible();
  await expect(page.locator('#lookupTileT')).toHaveText('還有 1 筆待查');
  // 下次打開是空的
  await page.click('[data-screen=scr-photo]');
  await expect(page.locator('#photoQuickShoot')).toBeVisible();
  await expect(page.locator('#pqEst')).toBeHidden();
});

test('拍照記：只拍照＝待查 0 大卡（跟以前一樣）；填了熱量就不是待查；什麼都沒填不能存', async ({ page }) => {
  await openApp(page);
  await page.click('[data-screen=scr-photo]');
  await page.click('#photoQuickSave');
  await expect(page.locator('#toastMsg')).toContainText('請先拍照');
  await page.setInputFiles('#photoQuickInput', pic('a.png'));
  await savePhotoQuick(page);
  await page.click('[data-screen=scr-photo]');
  await page.fill('#photoQuickName', '雞腿便當');
  await page.fill('#photoQuickKcal', '750');
  await page.click('[data-pq-ref=palm]');
  await savePhotoQuick(page);
  const list = (await appState(page)).logs[await todayOf(page)];
  expect(list[0]).toMatchObject({ kcal: 0, pending: true, hasPhoto: true });
  expect(list[0].lookup).toBeUndefined();
  expect(list[1]).toMatchObject({ name: '雞腿便當', kcal: 750, pending: false, lookup: { ref: 'palm', amt: 1 } });
});

test('吃到飽找不到對應的：直接開拍照記', async ({ page }) => {
  await openApp(page);
  await page.click('[data-screen=scr-party]');
  await page.click('#scr-party [data-screen=scr-photo]');
  await expect(page.locator('#scr-photo')).toBeVisible();
});

// 兩天各一筆待查＋一筆已經查好的
async function seed(page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    const d = new Date(); d.setHours(12);
    const iso = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    const today = iso(d); d.setDate(d.getDate() - 1); const yday = iso(d);
    localStorage.setItem('diet_tracker_v2', JSON.stringify({
      meta: { welcomed: true },
      logs: {
        [yday]: [{ id: 'item_y', name: '待查・炸物・酥皮・肥肉', kcal: 360, meal: 'dinner', multiplier: 1, pending: true, ex: null, lookup: { ref: 'fist', amt: 1 / 3, n: 2, cat: 'fried' }, updatedAt: 1 }],
        [today]: [
          { id: 'item_t', name: '午餐拍照待查', kcal: 0, meal: 'lunch', multiplier: 1, pending: true, updatedAt: 1 },
          { id: 'item_ok', name: '白飯', kcal: 280, meal: 'lunch', multiplier: 1, updatedAt: 1 }
        ]
      }
    }));
  });
}

test('待查清單：列出每天的待查，點一筆就能改；改好了就從清單消失', async ({ page }) => {
  await seed(page);
  await openApp(page);
  await expect(page.locator('#lookupTileT')).toHaveText('還有 2 筆待查');
  await page.click('#lookupTile');
  await expect(page.locator('[data-lookup-edit]')).toHaveCount(2);
  await expect(page.locator('#lookupList')).toContainText('拳頭 1/3 × 2');
  await page.click('[data-lookup-edit$="|item_y"]');
  await expect(page.locator('#editLogModal')).toBeVisible();
  await expect(page.locator('#editLookupInfo')).toHaveText('記的時候用手比：拳頭 1/3 × 2・炸物・酥皮・肥肉');
  await page.fill('#editLogNameInput', '春捲');
  await page.fill('#editLogKcalInput', '300');
  await page.uncheck('#editLogPendingCheck');
  await page.click('#editLogForm [type=submit]');
  await expect(page.locator('[data-lookup-edit]')).toHaveCount(1);
  await expect(page.locator('#lookupTileT')).toHaveText('還有 1 筆待查');
});

test('待查表：匯出表格＋照片；AI 填好的整段貼回來，確認後回填，對不到的略過', async ({ page }) => {
  await page.addInitScript(() => { delete Navigator.prototype.canShare; });   // 測電腦的下載
  await seed(page);
  await openApp(page);
  // 先給今天那筆一張照片
  await page.click('.edit-entry-btn >> nth=0');
  await page.setInputFiles('#editLogPhotoInput', pic('a.png'));
  await page.click('#editLogForm [type=submit]');
  await expect(page.locator('#editLogModal')).toBeHidden();
  expect(await photoBytes(page, 'item_t')).toBeGreaterThan(0);

  await page.click('#lookupTile');
  const downloads = [];
  page.on('download', d => downloads.push(d));
  await page.click('#lookupExportBtn');
  await expect.poll(() => downloads.length).toBe(2);
  const csv = downloads.find(d => d.suggestedFilename().endsWith('.csv'));
  expect(downloads.find(d => d.suggestedFilename() === 'item_t_1.jpg')).toBeTruthy();
  const text = readFileSync(await csv.path(), 'utf8');
  expect(text.startsWith('﻿編號,日期,餐別,名稱,大小')).toBe(true);
  expect(text).toContain('item_y,');
  expect(text).toContain('拳頭 1/3 × 2,炸物・酥皮・肥肉,360');
  expect(text).toContain('item_t_1.jpg');
  expect(text).not.toContain('item_ok');

  await page.fill('#lookupPaste', [
    '這是填好的：', '```csv',
    '編號,日期,餐別,名稱,大小,類別,目前粗估(大卡),照片,查到的名稱,熱量(大卡),蛋白質(克),脂肪(克),碳水(克),備註',
    'item_y,,,,,,,,炸春捲,320,6,18,33,兩條',
    'item_t,,,,,,,,滷肉飯,520,15,20,70,',
    'item_gone,,,,,,,,不見的,100,,,,', '```'
  ].join('\n'));
  await page.click('#lookupImportBtn');
  await expect(page.locator('#confirmModal')).toContainText('回填 2 筆');
  await expect(page.locator('#confirmModal')).toContainText('另外 1 筆對不到記錄');
  await page.click('#confirmOkBtn');
  await expect(page.locator('#lookupNote')).toContainText('已回填 2 筆');
  await expect(page.locator('#lookupList')).toContainText('沒有待查的記錄了');
  const s = await appState(page);
  const all = Object.values(s.logs).flat();
  expect(all.find(i => i.id === 'item_y')).toMatchObject({ name: '炸春捲', kcal: 320, p: 6, f: 18, c: 33, pending: false, ex: null, lookup: { cat: 'fried' } });
  expect(all.find(i => i.id === 'item_t')).toMatchObject({ name: '滷肉飯', kcal: 520, pending: false, hasPhoto: true });
  await page.goBack();
  await expect(page.locator('#lookupTile')).toBeHidden();
});

test('待查表：不是待查表的內容會說明原因', async ({ page }) => {
  await seed(page);
  await openApp(page);
  await page.click('#lookupTile');
  await page.fill('#lookupPaste', '名稱,熱量\n白飯,280');
  await page.click('#lookupImportBtn');
  await expect(page.locator('#lookupNote')).toContainText('找不到「編號」');
});
