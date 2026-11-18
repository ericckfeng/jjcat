// 舊版資料相容性：每一種曾經存在過的備份格式都要能匯入，資料不能遺失
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, appState, photoBytes, importFile } from './helpers.mjs';

const fx = (name) => new URL('../fixtures/' + name, import.meta.url).pathname;

test('v1（最早的單檔版）備份檔：記錄、照片、目標、常用清單都匯入', async ({ page }) => {
  const errors = [];
  await openApp(page, { errors });
  expect(await importFile(page, fx('backup-v1-single-file.json'))).toContain('匯入完成');
  const s = await appState(page);
  const list = s.logs['2026-10-01'];
  expect(list.map(i => i.name).sort()).toEqual(['茶葉蛋', '雞腿便當']);
  expect(list.find(i => i.id === 'item_1').hasPhoto).toBe(true);
  expect(list.find(i => i.id === 'item_1').photo).toBeUndefined();
  expect(await photoBytes(page, 'item_1')).toBeGreaterThan(100);
  expect(list.find(i => i.id === 'item_2').pending).toBe(true);
  expect(s.targets.kcal).toBe(1600);
  expect(s.quickItems.some(q => q.id === 'qi_old')).toBe(true);
  expect(errors).toEqual([]);
});

test('v2（PWA 初版）備份檔：營養素、照片、每日資料、目標都匯入', async ({ page }) => {
  await openApp(page);
  expect(await importFile(page, fx('backup-v2-pwa.json'))).toContain('新增 2 筆');
  const s = await appState(page);
  const a = s.logs['2026-11-10'].find(i => i.id === 'item_v2a');
  expect(a).toMatchObject({ kcal: 350, p: 15, c: 40, f: 12, hasPhoto: true, ex: { grain: 2, prot: 1 } });
  expect(await photoBytes(page, 'item_v2a')).toBeGreaterThan(100);
  expect(s.days['2026-11-10']).toMatchObject({ weight: 70.2, waist: 88, water: 750, question: '晚上嘴饞怎麼辦？' });
  expect(s.targets).toMatchObject({ kcal: 1500, p: 80, weight: 68 });
});

test('v3（同步版）備份檔：身體尺寸、睡眠、補眠、照片版本都匯入', async ({ page }) => {
  await openApp(page);
  await importFile(page, fx('backup-v3-sync.json'));
  const s = await appState(page);
  expect(s.days['2026-11-12']).toMatchObject({ hip: 100, arm: 31, bodyFat: 24.5, sleepMin: 450, sleepQ: 4, naps: [{ id: 'nap_1', min: 30 }] });
  expect(s.profile).toMatchObject({ height: 168, sex: 'm' });
  const a = s.logs['2026-11-12'].find(i => i.id === 'item_v3a');
  expect(a.photoKey).toBe('item_v3a-1794400100000');
  expect(s.meta.photoVer.item_v3a).toBe('item_v3a-1794400100000');
  expect(await photoBytes(page, 'item_v3a')).toBeGreaterThan(100);
});

test('同一個備份檔匯入兩次不會重複', async ({ page }) => {
  await openApp(page);
  await importFile(page, fx('backup-v2-pwa.json'));
  expect(await importFile(page, fx('backup-v2-pwa.json'))).toContain('新增 0 筆');
  expect((await appState(page)).logs['2026-11-10']).toHaveLength(2);
});

test('三個版本依序匯入可以並存，重新整理後資料和照片都還在', async ({ page }) => {
  await openApp(page);
  for (const f of ['backup-v1-single-file.json', 'backup-v2-pwa.json', 'backup-v3-sync.json']) await importFile(page, fx(f));
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  const s = await appState(page);
  expect(Object.keys(s.logs).sort()).toEqual(['2026-10-01', '2026-11-10', '2026-11-12']);
  expect(await photoBytes(page, 'item_1')).toBeGreaterThan(100);
  expect(await photoBytes(page, 'item_v3a')).toBeGreaterThan(100);
});

test('瀏覽器裡還留著最早單檔版的資料時，第一次開啟會自動搬過來', async ({ page }) => {
  const v1 = readFileSync(fx('backup-v1-single-file.json'), 'utf8');
  await page.addInitScript((data) => {
    if (!localStorage.getItem('diet_tracker_v2')) localStorage.setItem('daily_calorie_tracker_v1', data);
  }, v1);
  await openApp(page);
  const s = await appState(page);
  expect(s.logs['2026-10-01']).toHaveLength(2);
  expect(s.targets.kcal).toBe(1600);
});

test('含新版資料的備份檔：看不懂的最上層資料會保留，重新整理、再匯出都還在', async ({ page }) => {
  await openApp(page);
  await importFile(page, fx('backup-v3-extra-keys.json'));
  let s = await appState(page);
  expect(s.customFoods.map(x => x.id)).toEqual(['cf_1', 'cf_2']);
  expect(s.futureSettings).toMatchObject({ mode: 'auto' });
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  s = await appState(page);
  expect(s.customFoods.map(x => x.id)).toEqual(['cf_1', 'cf_2']);
  await page.click('.mobile-nav-tab[data-tab=report]');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportJsonBtn')]);
  const out = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(out.customFoods.map(x => x.id)).toEqual(['cf_1', 'cf_2']);
  expect(out.futureSettings).toMatchObject({ mode: 'auto' });
  expect(out.meta).toBeUndefined();
});

test('最早單檔版的欄位（targetKcal）不會被當成新資料存起來', async ({ page }) => {
  await openApp(page);
  await importFile(page, fx('backup-v1-single-file.json'));
  const s = await appState(page);
  expect(s.targetKcal).toBeUndefined();
});
