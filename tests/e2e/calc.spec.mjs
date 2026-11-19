// 依體重試算目標：試算畫面、套用、喝水目標、手動改過就不再提醒重算
import { test, expect } from '@playwright/test';
import { openApp, appState } from './helpers.mjs';

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
  await page.click('#openTargetBtn');
  await page.click('#openCalcBtn');
  await expect(page.locator('#scr-calc')).toBeVisible();
  await expect(page.locator('#targetModal')).toBeHidden();
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
  // 只改名字：還是試算的目標
  await page.click('#openTargetBtn');
  await page.fill('#profileName', '王小明');
  await page.click('#saveTargetBtn');
  expect((await appState(page)).targets.calc).toBeTruthy();
  // 手動改熱量：變成自己的目標，不再提醒
  await page.click('#openTargetBtn');
  await expect(page.locator('#tgt-water')).toHaveValue('2800');
  await page.fill('#tgt-kcal', '1700');
  await page.click('#saveTargetBtn');
  const t = (await appState(page)).targets;
  expect(t.calc).toBeUndefined();
  expect(t).toMatchObject({ kcal: 1700, water: 2800 });
  await expect(page.locator('#tipsCard')).toBeHidden();
});
