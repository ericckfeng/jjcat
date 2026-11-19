// 吃到飽・聚餐速記：按 ＋／−、中途關掉重開還在、貼上備忘錄、記成同一組
import { test, expect } from '@playwright/test';
import { openApp, appState, closeScreens, photoBytes } from './helpers.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAAMBgEB1JqCEwAAAABJRU5ErkJggg==', 'base64');

test('港點吃到飽：拿一輪按一下 → 重開 App 數量還在 → 貼上備忘錄 → 記到晚餐（同一組）', async ({ page }) => {
  const errors = [];
  await openApp(page, { errors });
  const today = await page.evaluate(() => window.__dietApp.ui.date);
  await page.click('[data-screen=scr-party]');
  await expect(page.locator('#scr-party')).toBeVisible();
  await expect(page.locator('#partyKcal')).toHaveText('150');   // 隱形油醬整餐 1 次
  await page.click('#scr-party [data-meal=dinner]');
  for (let i = 0; i < 3; i++) await page.click('[data-party-plus=A1]');
  await page.click('[data-party-plus=C3]');
  await page.click('[data-party-plus=C3]');
  await page.click('[data-party-minus=C3]');
  await expect(page.locator('#partyKcal')).toHaveText(String(150 + 3 * 50 + 320));
  await expect(page.locator('#partySaveBtn')).toHaveText('記到晚餐（620 大卡）');
  // 中途關掉 App：數量存在這台裝置，首頁顯示進行中
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  await expect(page.locator('#partyTileSub')).toContainText('進行中：目前 620 大卡');
  await page.click('[data-screen=scr-party]');
  await page.click('#scr-party [data-meal=dinner]');
  await expect(page.locator('#partyKcal')).toHaveText('620');
  // 貼上備忘錄：有寫到的換成備忘錄的數量
  await page.click('#scr-party summary');
  await page.fill('#partyPaste', 'A1(蝦餃/顆): 2+2\nB1: 1');
  await page.click('#partyPasteBtn');
  await expect(page.locator('#partyKcal')).toHaveText(String(150 + 4 * 50 + 320 + 60));
  await page.click('#partySaveBtn');
  await expect(page.locator('#scr-party')).toBeHidden();
  const st = await appState(page);
  const list = st.logs[today].filter(x => x.name.startsWith('港式點心'));
  expect(list.map(x => [x.name, x.kcal, x.meal])).toEqual([
    ['港式點心・純海鮮蒸點 4顆', 200, 'dinner'],
    ['港式點心・高脂蒸籠 1塊', 60, 'dinner'],
    ['港式點心・酥皮・牛油 1個', 320, 'dinner'],
    ['港式點心・隱形油醬・勾芡 1餐', 150, 'dinner']
  ]);
  expect(new Set(list.map(x => x.groupId)).size).toBe(1);
  expect(list[0].groupId).toMatch(/^grp/);
  expect(list[0].p).toBe(18);
  expect(list[0].party).toEqual({ tpl: 'dimsum', code: 'A1', n: 4, unit: '顆', kcal1: 50 });   // 之後校正重算用
  expect(st.meta.party).toBeUndefined();   // 記好就清掉，下次重新開始
  // 速記草稿不進同步／備份檔
  await closeScreens(page);
  await expect(page.locator('#partyTileSub')).toHaveText('拿一輪按一下，最後自動算熱量');
  expect(errors).toEqual([]);
});

test('還沒按任何一樣不能記；清空會問', async ({ page }) => {
  await openApp(page);
  await page.click('[data-screen=scr-party]');
  await page.click('[data-party-minus=D0]');
  await page.click('#partySaveBtn');
  await expect(page.locator('#scr-party')).toBeVisible();
  await page.click('[data-party-plus=A2]');
  const payload = await page.evaluate(() => JSON.stringify(window.__dietApp.exportPayload()));
  expect(payload).not.toContain('"party"');
});

test('秤重模式：拍一顆的秤重照、填公克 → 跟著那一類的記錄存；秤了沒按數量會先問', async ({ page }) => {
  await openApp(page);
  const today = await page.evaluate(() => window.__dietApp.ui.date);
  await page.click('[data-screen=scr-party]');
  await expect(page.locator('[data-party-shot=A1]')).toHaveCount(0);
  await page.check('#partyWeighToggle');
  await page.locator('[data-party-shot=A1]').click();
  await page.setInputFiles('#partyPhotoInput', { name: 'scale.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('[data-party-shot=A1]')).toHaveText('✓ 已拍・重拍');
  await page.fill('[data-party-g=A1]', '28');
  await page.locator('[data-party-g=A1]').blur();
  await page.fill('[data-party-g=C3]', '55');
  await page.locator('[data-party-g=C3]').blur();
  await page.click('[data-party-plus=A1]');
  await page.click('[data-party-plus=A1]');
  // 重開還在
  await page.reload();
  await page.waitForFunction(() => window.__dietApp);
  await page.click('[data-screen=scr-party]');
  await expect(page.locator('#partyWeighToggle')).toBeChecked();
  await expect(page.locator('[data-party-g=A1]')).toHaveValue('28');
  // C3 秤了但沒按 → 先問
  await page.click('#partySaveBtn');
  await expect(page.locator('#confirmTitle')).toHaveText('有秤重、但沒按吃了幾個');
  await expect(page.locator('#confirmMessage')).toContainText('C3');
  await page.click('#confirmOkBtn');
  await expect(page.locator('#scr-party')).toBeHidden();
  const st = await appState(page);
  const a1 = st.logs[today].find(x => x.party && x.party.code === 'A1');
  expect(a1.party).toEqual({ tpl: 'dimsum', code: 'A1', n: 2, unit: '顆', kcal1: 50, g: 28 });
  expect(a1.hasPhoto).toBe(true);
  await expect.poll(() => photoBytes(page, a1.id)).toBeGreaterThan(0);
  await expect.poll(() => photoBytes(page, 'party_A1')).toBe(0);   // 暫存的照片清掉
  expect(st.logs[today].find(x => x.party && x.party.code === 'D0').hasPhoto).toBe(false);
});
