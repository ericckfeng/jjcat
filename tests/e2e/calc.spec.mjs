// 依體重試算目標：試算畫面、套用、喝水目標、手動改過就不再提醒重算
import { test, expect } from '@playwright/test';
import { openApp, appState, closeScreens, openSettings } from './helpers.mjs';

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const birthYearFor = (age) => new Date().getFullYear() - age;

async function seed(page, data) {
  await page.addInitScript((data) => {
    if (localStorage.getItem('diet_tracker_v2')) return;
    localStorage.setItem('diet_tracker_v2', JSON.stringify({ logs: {}, quickItems: [], tomb: {}, meta: { welcomed: true }, ...data }));
  }, data);
}
async function openCalc(page) {
  await closeScreens(page); await page.click('#openTargetBtn');
  await page.click('#openCalcBtn');
  await expect(page.locator('#scr-calc')).toBeVisible();
}

test('試算：體重用 7 天平均，填好資料算出建議，套用後寫入目標與個人資料', async ({ page }) => {
  const errors = [];
  await seed(page, { days: { [ago(2)]: { weight: 80.4 }, [ago(0)]: { weight: 79.6 } }, profile: { name: '', height: 172 } });
  await openApp(page, { errors });
  await openCalc(page);
  await expect(page.locator('#calcWeight')).toHaveValue('80');
  await expect(page.locator('#calcWeightNote')).toContainText('7 天平均');
  await expect(page.locator('#calcHeight')).toHaveValue('172');
  await expect(page.locator('#calcResult')).toContainText('請填性別、出生年');
  await expect(page.locator('#calcApplyBtn')).toBeDisabled();
  await page.click('[data-calc-sex=m]');
  await page.fill('#calcBirthYear', String(birthYearFor(45)));
  await page.click('[data-calc-act=light]');
  await page.click('[data-calc-goal=lose]');
  await page.click('[data-calc-prot="1.6"]');
  await expect(page.locator('#calcActivity')).toContainText('每天約 5,000–7,500 步');
  await expect(page.locator('#calcResult')).toContainText('1,780');
  await expect(page.locator('#calcResult')).toContainText('2,800 ml');
  await page.click('#calcApplyBtn');  // 原本沒設過目標：直接套用
  await expect(page.locator('#scr-calc')).toBeHidden();
  const st = await appState(page);
  expect(st.targets).toMatchObject({ kcal: 1780, p: 128, c: 173, f: 64, water: 2800, calc: { weight: 80, activity: 'light', goal: 'lose', protein: 1.6 } });
  expect(st.profile).toMatchObject({ sex: 'm', height: 172, birthYear: birthYearFor(45), activity: 'light' });
  // 再打開，會記得上次的選擇
  await openCalc(page);
  await expect(page.locator('[data-calc-goal=lose]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-calc-prot="1.6"]')).toHaveClass(/is-active/);
  expect(errors).toEqual([]);
});

test('已經有營養師的目標：先確認，選「保留原本的」就不改', async ({ page }) => {
  await seed(page, {
    days: { [ago(0)]: { weight: 68 } },
    targets: { kcal: 1500, p: 70, c: null, f: null, ex: { veg: 4 }, weight: 60 }, targetsAt: 5,
    profile: { name: '', height: 158, sex: 'f', birthYear: birthYearFor(66) }, profileAt: 5
  });
  await openApp(page);
  await openCalc(page);
  await expect(page.locator('#calcResult')).toContainText('1,200');
  await expect(page.locator('#calcResult')).toContainText('為了安全');
  await page.click('#calcApplyBtn');
  await expect(page.locator('#confirmModal')).toBeVisible();
  await expect(page.locator('#confirmMessage')).toContainText('1,500 kcal');
  await page.click('#confirmCancelBtn');
  expect((await appState(page)).targets.kcal).toBe(1500);
  await page.click('#calcApplyBtn');
  await page.click('#confirmOkBtn');
  const t = (await appState(page)).targets;
  expect(t).toMatchObject({ kcal: 1200, water: 2400, ex: { veg: 4 }, weight: 60 }); // 六大類份數、目標體重保留
});

test('喝水目標：喝水頁和首頁顯示目標，運動加碼', async ({ page }) => {
  await seed(page, { days: { [ago(0)]: { water: 1000, exMin: 60 } }, targets: { kcal: 1800, ex: {}, water: 2000 }, targetsAt: 5 });
  await openApp(page);
  await expect(page.locator('#tileWater')).toHaveText('1000 / 2500 ml');
  await page.click('[data-screen=scr-water]');
  await expect(page.locator('#waterCups')).toContainText('目標 2,500 ml（含運動 +500），還差 1,500 ml');
  await page.click('[data-water-add="500"]');
  await page.click('[data-water-add="500"]');
  await page.click('[data-water-add="500"]');
  await expect(page.locator('#waterCups')).toContainText('✓ 達成了');
});

test('體重和試算時差 2 公斤：小芽提醒重算；手動改過目標就不再提醒', async ({ page }) => {
  await seed(page, {
    days: { [ago(1)]: { weight: 77.8 }, [ago(0)]: { weight: 77.6 } },
    targets: { kcal: 1780, p: 128, c: 173, f: 64, ex: {}, water: 2800, calc: { at: 1, weight: 80, activity: 'light', goal: 'lose', protein: 1.6 } }, targetsAt: 5,
    meta: { welcomed: true, mascot: false }
  });
  await openApp(page);
  await expect(page.locator('#tipsList')).toContainText('體重比上次試算時少了 2.3 公斤');
  // 只改名字（基本資料）：還是試算的目標
  await openSettings(page, '[data-screen=scr-profile]');
  await page.fill('#profileName', '王小明');
  await page.click('#profileSaveBtn');
  expect((await appState(page)).profile.name).toBe('王小明');
  expect((await appState(page)).targets.calc).toBeTruthy();
  // 手動改熱量：變成自己的目標，不再提醒
  await closeScreens(page); await page.click('#openTargetBtn');
  await expect(page.locator('#tgt-water')).toHaveValue('2800');
  await page.fill('#tgt-kcal', '1700');
  await page.click('#saveTargetBtn');
  const t = (await appState(page)).targets;
  expect(t.calc).toBeUndefined();
  expect(t).toMatchObject({ kcal: 1700, water: 2800 });
  await expect(page.locator('#tipsCard')).toBeHidden();
});

test('有 InBody 基礎代謝：預設用它，可以切回公式；只填體重也能算', async ({ page }) => {
  await seed(page, { days: { [ago(9)]: { weight: 80, bmr: 1720 }, [ago(0)]: { weight: 80 } } });
  await openApp(page);
  // 體脂機報告頁可以填基礎代謝
  await page.click('#tab-log [data-screen=scr-bodycomp]');
  await expect(page.locator('#scr-bodycomp [data-bc=bmr]')).toBeVisible();
  await page.click('#scr-bodycomp [data-back]');
  await openCalc(page);
  await expect(page.locator('#calcBmrWrap')).toBeVisible();
  await expect(page.locator('[data-calc-bmr=inbody]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-calc-bmr=inbody]')).toContainText('1,720 kcal');
  await page.click('[data-calc-act=light]');
  await page.click('[data-calc-goal=lose]');
  await expect(page.locator('#calcResult')).toContainText('基礎代謝 1,720（體脂機）');
  await expect(page.locator('#calcResult')).toContainText('1,870');
  // 切回公式：要填性別等資料
  await page.click('[data-calc-bmr=formula]');
  await expect(page.locator('#calcResult')).toContainText('請填性別');
  await page.click('[data-calc-bmr=inbody]');
  await page.click('#calcApplyBtn');
  const st = await appState(page);
  expect(st.targets).toMatchObject({ kcal: 1870, calc: { bmrSource: 'inbody', bmr: 1720 } });
});

test('有體重＋體脂率：可以用去脂體重算基礎代謝，也可以用目標體脂率訂目標體重', async ({ page }) => {
  await seed(page, { days: { [ago(5)]: { weight: 68, bodyFat: 32 }, [ago(0)]: { weight: 67.6 } }, profile: { name: '', sex: 'f' }, profileAt: 1 });
  await openApp(page);
  await openCalc(page);
  // 沒有體脂機的基礎代謝：預設用體脂率算（去脂 46.2 kg → 1,368）
  await expect(page.locator('[data-calc-bmr=ffm]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-calc-bmr=ffm]')).toContainText('1,368 kcal');
  await expect(page.locator('[data-calc-bmr=ffm]')).toContainText('去脂體重 46.2 kg');
  await expect(page.locator('#calcResult')).toContainText('基礎代謝 1,368（依體脂率）');
  await expect(page.locator('#calcFatInfo')).toContainText('一般建議女性體脂率低於 30%');
  await page.fill('#calcTargetFat', '28');
  await expect(page.locator('#calcFatResult')).toContainText('目標體重約 64.2 kg（比現在少 3.8 kg）');
  await page.click('#calcApplyBtn');
  const t = (await appState(page)).targets;
  expect(t).toMatchObject({ weight: 64.2, bodyFat: 28, calc: { bmrSource: 'ffm', bmr: 1368 } });
  // 手動改目標體重：目標體脂率拿掉
  await closeScreens(page); await page.click('#openTargetBtn');
  await page.fill('#tgt-weight', '63');
  await page.click('#saveTargetBtn');
  expect((await appState(page)).targets.bodyFat).toBeUndefined();
});

test('骨骼肌：減重時肌肉也掉了，小提醒和營養師報告都會說', async ({ page }) => {
  const errors = [];
  await seed(page, {
    days: { [ago(30)]: { weight: 72, smm: 24.1 }, [ago(2)]: { weight: 70, smm: 23.5 } },
    meta: { welcomed: true, mascot: false }
  });
  await openApp(page, { errors });
  await expect(page.locator('#tipsList')).toContainText('骨骼肌也少了 0.6 公斤');
  // 體脂機報告頁有骨骼肌欄位
  await page.click('#tab-log [data-screen=scr-bodycomp]');
  await expect(page.locator('#scr-bodycomp [data-bc=smm]')).toBeVisible();
  await page.click('#scr-bodycomp [data-back]');
  await closeScreens(page); await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('[data-days="7"]');
  await page.click('#genReportBtn');
  await expect(page.locator('#reportArea .hl')).toContainText('骨骼肌 24.1 → 23.5 kg（-0.6），同期體重 -2 kg：減掉的有一部分是肌肉');
  expect(errors).toEqual([]);
});

test('內臟脂肪、相位角、細胞外水分比：可以記錄，報告和文字摘要會列出', async ({ page }) => {
  const errors = [];
  await seed(page, { days: {} });
  await openApp(page, { errors });
  await page.click('#tab-log [data-screen=scr-bodycomp]');
  await page.fill('[data-bc=vfl]', '11');
  await page.fill('[data-bc=pa]', '4.8');
  await page.fill('[data-bc=ecw]', '0.392');
  await page.fill('[data-bc=vfa]', '261.7');
  await page.click('#scr-bodycomp [data-back]');
  const d = (await appState(page)).days[ago(0)];
  expect(d).toMatchObject({ vfl: 11, pa: 4.8, ecw: 0.392, vfa: 261.7 });
  await closeScreens(page); await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('[data-days="7"]');
  await page.click('#genReportBtn');
  const head = page.locator('#reportArea thead');
  await expect(head).toContainText('內臟脂肪等級');
  await expect(head).toContainText('相位角');
  await expect(head).toContainText('細胞外水分比');
  await expect(page.locator('#reportArea tbody')).toContainText('0.392');
  const text = await page.evaluate(() => window.__dietApp.lastReportText());
  expect(text).toContain('身體數據：內臟脂肪等級 11 級、內臟脂肪面積 261.7 cm²、相位角 4.8°、細胞外水分比 0.392');
  expect(errors).toEqual([]);
});

test('四肢肌肉量：手腳四個數字幫忙加總，算出 SMI；偏低時試算頁和報告會提醒', async ({ page }) => {
  const errors = [];
  await seed(page, { days: { [ago(0)]: { weight: 140.6 } }, profile: { name: '', sex: 'm', height: 181 }, profileAt: 1 });
  await openApp(page, { errors });
  await page.click('#tab-log [data-screen=scr-bodycomp]');
  await page.click('#limbHelper summary');
  const limbs = page.locator('[data-limb]');
  for (const [i, v] of ['4.54', '4.41', '12.9', '12.7'].entries()) await limbs.nth(i).fill(v);
  await expect(page.locator('#bcAsm')).toHaveValue('34.55');
  await expect(page.locator('#smiText')).toContainText('SMI 10.5 kg/m²');
  await expect(page.locator('#smiText')).toContainText('在參考值（男性 7.0）以上');
  expect((await appState(page)).days[ago(0)].asm).toBe(34.55);
  // 改成偏低的數字
  await page.fill('#bcAsm', '21');
  await expect(page.locator('#smiText')).toContainText('SMI 6.4 kg/m²');
  await expect(page.locator('#smiText')).toContainText('肌肉偏少');
  await page.click('#scr-bodycomp [data-back]');
  await closeScreens(page); await page.click('#openTargetBtn');
  await page.click('#openCalcBtn');
  await page.fill('#calcBirthYear', String(birthYearFor(58)));
  await expect(page.locator('#calcResult')).toContainText('四肢骨骼肌指數 6.4 kg/m² 偏低');
  await page.click('[data-calc-goal=keep]');
  await expect(page.locator('#calcResult')).not.toContainText('偏低');
  await page.click('#scr-calc [data-back]');
  await closeScreens(page); await page.click('.mobile-nav-tab[data-tab=report]');
  await page.click('[data-days="7"]');
  await page.click('#genReportBtn');
  await expect(page.locator('#reportArea .hl')).toContainText('四肢骨骼肌指數 6.4 kg/m²，低於肌少症參考值 7.0（AWGS 2019）');
  expect(errors).toEqual([]);
});

test('體脂機報告：可以選量的日期；填體重和體脂率會算去脂體重；從試算頁去填，回來就有新選項', async ({ page }) => {
  const errors = [];
  await seed(page, { days: { [ago(0)]: { weight: 140.6 } }, profile: { name: '', sex: 'm', height: 181, birthYear: 1968 }, profileAt: 1 });
  await openApp(page, { errors });
  await expect(page.locator('#tileBodyComp')).toHaveText('InBody、健身房或家用體脂機');
  await page.click('#openTargetBtn');
  await page.click('#openCalcBtn');
  await expect(page.locator('#calcBmrWrap')).toBeHidden();
  await page.click('#calcBcLink');
  await expect(page.locator('#scr-bodycomp')).toBeVisible();
  await expect(page.locator('#bcDate')).toHaveValue(ago(0));
  // 改成三天前量的
  await page.fill('#bcDate', ago(3));
  await page.dispatchEvent('#bcDate', 'change');
  await page.fill('[data-bc=weight]', '140.6');
  await page.fill('[data-bc=bodyFat]', '44.4');
  await expect(page.locator('#bcInfo')).toContainText('去脂體重（肌肉、骨骼、水分）約 78.2 公斤');
  await expect(page.locator('#bcInfo')).toContainText('基礎代謝約 2,059 kcal');
  await page.fill('[data-bc=bmr]', '2058');
  await expect(page.locator('#bcInfo')).toContainText('報表上是 2,058');
  const d = (await appState(page)).days[ago(3)];
  expect(d).toMatchObject({ weight: 140.6, bodyFat: 44.4, bmr: 2058 });
  expect((await appState(page)).days[ago(0)].bodyFat).toBeUndefined();
  // 回到試算頁：出現體脂機的選項
  await page.click('#scr-bodycomp [data-back]');
  await expect(page.locator('#scr-calc')).toBeVisible();
  await expect(page.locator('#calcBmrWrap')).toBeVisible();
  await expect(page.locator('[data-calc-bmr=inbody]')).toContainText('2,058 kcal');
  await expect(page.locator('#calcBcLink')).toBeHidden();
  await closeScreens(page);
  await expect(page.locator('#tileBodyComp')).toContainText('上次 ' + Number(ago(3).slice(5, 7)) + '/' + Number(ago(3).slice(8)) + ' 量的');
  expect(errors).toEqual([]);
});
