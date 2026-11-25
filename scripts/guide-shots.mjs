// 使用說明（guide.html）的截圖：用示範資料打開 App，照手機的大小（390×844）把每個功能拍下來，存到 guide/。
// App 改版後重跑一次：npm run guide:shots（需要網路：Tailwind、Chart.js 從 CDN 載入，和使用者看到的一樣）
// 示範資料只在這個程式開的瀏覽器裡，不會碰到你自己的資料。
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'guide');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// 本機網站（和 npm run serve 一樣，只是不用另外開）
const server = createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '');
    if (!p || p.endsWith('/')) p += 'index.html';
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://localhost:' + server.address().port + '/';

// 示範資料：小明，記了一週多
function demoState() {
  const ymd = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const t = Date.now();
  const e = (id, name, kcal, meal, time, extra = {}) => ({ id, name, kcal, meal, time, multiplier: 1, updatedAt: t, ...extra });
  const logs = {}, days = {};
  for (let i = 1; i <= 9; i++) {
    logs[ymd(i)] = [
      e('b' + i, '燕麥 40g', 150, 'breakfast', '07:30', { p: 5, c: 27, f: 3, hasPhoto: i <= 6 }),
      e('l' + i, ['雞腿便當', '牛肉麵', '自助餐（飯一拳頭、三樣菜）', '滷肉飯＋燙青菜', '鮭魚飯糰＋無糖豆漿', '八方雲集 鍋貼 10 顆', '麥當勞 麥香雞', '水餃 10 顆', '雞胸肉沙拉'][i - 1], [780, 650, 620, 590, 480, 550, 380, 520, 350][i - 1], 'lunch', '12:15', { p: 30, c: 80, f: 20, hasPhoto: i <= 6 }),
      e('d' + i, ['燙青菜＋滷豆腐＋半碗飯', '鮭魚＋糙米飯', '雞湯＋地瓜'][i % 3], [520, 600, 480][i % 3], 'dinner', '18:40', { p: 28, c: 55, f: 15, hasPhoto: i <= 6 })
    ];
    days[ymd(i)] = {
      weight: Math.round((68.6 - i * -0.15) * 10) / 10, water: [1500, 2000, 1750, 2250, 1250, 2000, 1500, 1750, 2000][i - 1],
      steps: [6200, 8100, 4300, 7600, 9000, 5200, 6800, 7300, 5100][i - 1], sleepBed: '23:00', sleepWake: '06:30', sleepMin: [450, 390, 420, 330, 480, 400, 440, 420, 360][i - 1], sleepQ: 4,
      bp: [{ id: 'bp' + i, t: '07:00', sys: [128, 132, 125, 138, 130, 126, 134, 129, 131][i - 1], dia: [82, 85, 80, 88, 84, 81, 86, 83, 84][i - 1], pulse: 72 }],
      glucose: [{ id: 'gl' + i, t: '06:50', kind: 'fasting', v: [102, 108, 98, 112, 104, 99, 106, 101, 103][i - 1] }],
      adviceDone: i % 2 ? ['ad_veg'] : ['ad_veg', 'ad_rice']
    };
  }
  logs[ymd(0)] = [
    e('b0', '燕麥 40g', 150, 'breakfast', '07:30', { p: 5, c: 27, f: 3, hasPhoto: true }),
    e('t1', '無糖豆漿 1 杯', 120, 'breakfast', '07:30', { p: 8, c: 6, f: 7 }),
    e('l0', '雞腿便當', 780, 'lunch', '12:20', { p: 35, c: 95, f: 28, hasPhoto: true }),
    e('p0', '午餐拍照待查', 0, 'snack', '15:30', { pending: true, hasPhoto: true, lookup: { cat: 'snack', ref: 'fist', amt: 0.5, n: 1 } })
  ];
  days[ymd(0)] = { weight: 68.4, water: 1250, steps: 4200, sleepMin: 420, sleepBed: '23:10', sleepWake: '06:10', bp: [{ id: 'bp0', t: '07:05', sys: 127, dia: 82, pulse: 70 }], glucose: [{ id: 'gl0', t: '06:45', kind: 'fasting', v: 101 }] };
  const pk = (id, name, brand, category, kcal, p, extra = {}) => ({ id, name, base: name.replace(/[(（].*$/, ''), brand, category, serving: { label: '1份' }, perServing: { kcal, p, ...extra } });
  return {
    logs, days, quickItems: [], tomb: {},
    profile: { name: '小明', sex: 'M', height: 168, birthYear: 1962, features: { bp: true, glucose: true } }, profileAt: t,
    targets: { kcal: 1700, p: 75, c: 210, f: 50, water: 2000, steps: 6000, weight: 65, ex: {} }, targetsAt: t,
    customFoods: [
      { id: 'cf1', name: '無糖豆漿', serving: { label: '1 杯' }, perServing: { kcal: 120, p: 8, f: 7, c: 6 }, updatedAt: t },
      { id: 'cf2', name: '全家烤地瓜', serving: { g: 200, label: '1 條' }, per100g: { kcal: 125, p: 1.5, c: 29 }, updatedAt: t },
      { id: 'cf3', name: '堅果包', serving: { g: 35, label: '1 包' }, per100g: { kcal: 285.71, p: 8.6, f: 25.7, c: 11.4 }, updatedAt: t }
    ],
    combos: [{ id: 'cb1', name: '每天的早餐', items: [{ customFoodId: 'cf1', grams: 1, snapshot: { name: '無糖豆漿', perServing: { kcal: 120 } } }], updatedAt: t }],
    foodPacks: [{ id: 'pk_demo', name: '外食連鎖店', org: '自己整理', askBy: 'serving', updatedAt: t, foods: [
      pk('m1', '大麥克', '台灣麥當勞', '主餐', 530, 28, { c: 45, f: 27 }), pk('m2', '麥香雞', '台灣麥當勞', '主餐', 380, 14, { c: 40, f: 17 }), pk('m3', '烤雞沙拉', '台灣麥當勞', '配餐', 150, 20, { c: 8, f: 4 }),
      pk('m4', '中薯', '台灣麥當勞', '配餐', 330, 4, { c: 42, f: 16 }), pk('m5', '無糖綠茶', '台灣麥當勞', '飲料', 0, 0, { c: 0, f: 0 }), pk('m6', '可樂(中)', '台灣麥當勞', '飲料', 210, 0, { c: 52, f: 0, sugar: 52 }),
      pk('b1', '招牌鍋貼', '八方雲集', '鍋貼', 550, 20), pk('b2', '酸辣湯', '八方雲集', '湯品', 120, 6), pk('b3', '韭菜鍋貼', '八方雲集', '鍋貼', 520, 18)
    ] }],
    advice: [
      { id: 'ad_veg', text: '午餐便當多一份青菜', from: '王營養師', date: ymd(10), active: true, updatedAt: t },
      { id: 'ad_rice', text: '晚餐飯吃半碗就好', from: '王營養師', date: ymd(10), active: true, updatedAt: t },
      { id: 'ad_tea', text: '含糖飲料改無糖茶', from: '王營養師', date: ymd(10), active: true, updatedAt: t }
    ],
    meta: { welcomed: true, fontSize: 'l', lastBackup: t - 2 * 86400000, badgesSeen: [], weeklySeen: null, installHintDismissed: true, aiPaste: true }
  };
}

// 照片：畫一個食物圖示當示範（真的使用時是自己拍的照片）
async function putPhotos(page, ids) {
  await page.evaluate((ids) => new Promise((resolve, reject) => {
    const icons = ['🥣', '🍱', '🍜', '🥗', '🍙', '🥟', '🍔', '🍲', '🍠'];
    const colors = ['#fde68a', '#fecaca', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa'];
    const req = indexedDB.open('diet-tracker');
    req.onsuccess = () => {
      const tx = req.result.transaction('photos', 'readwrite');
      ids.forEach((id, i) => {
        const c = document.createElement('canvas'); c.width = c.height = 360;
        const g = c.getContext('2d');
        g.fillStyle = colors[i % colors.length]; g.fillRect(0, 0, 360, 360);
        g.font = '200px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(icons[i % icons.length], 180, 195);
        tx.objectStore('photos').put(c.toDataURL('image/jpeg', 0.8), id);
      });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }), ids);
}

const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });
async function fresh({ state = demoState(), photos = true, invite = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'zh-TW', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  // 邀請碼畫面：假的網址（只拍畫面，不送出）；其他截圖不用邀請碼
  await page.route(/\/js\/config\.js(\?.*)?$/, async r => {
    const body = (await readFile(join(ROOT, 'js/config.js'), 'utf8')).replace(/export const INVITE_URL = '[^']*';/, 'export const INVITE_URL = ' + JSON.stringify(invite ? 'https://example.invalid/exec' : '') + ';');
    r.fulfill({ contentType: 'text/javascript', body });
  });
  if (state) await page.addInitScript((s) => { if (!localStorage.getItem('diet_tracker_v2')) localStorage.setItem('diet_tracker_v2', JSON.stringify(s)); }, state);
  await page.goto(BASE);
  await page.waitForFunction(() => window.__dietApp && typeof Chart !== 'undefined');
  if (photos && state) {
    const ids = Object.values(state.logs).flat().filter(x => x.hasPhoto).map(x => x.id);
    await putPhotos(page, ids);
    await page.reload();
    await page.waitForFunction(() => window.__dietApp);
  }
  await page.waitForTimeout(400);
  return { ctx, page };
}
const done = [];
async function shot(page, name, { el = null, full = false } = {}) {
  await page.waitForTimeout(350);
  const opt = { path: join(OUT, name + '.jpg'), type: 'jpeg', quality: 78 };
  if (el) await page.locator(el).screenshot(opt); else await page.screenshot({ ...opt, fullPage: full });
  done.push(name);
}
const scrollTo = (page, sel) => page.locator(sel).first().evaluate(el => el.scrollIntoView({ block: 'start' }));

// 1. 第一次打開：邀請碼（公測期間）、歡迎畫面
{ const { ctx, page } = await fresh({ state: null, invite: true }); await shot(page, '00-invite'); await ctx.close(); }
{ const { ctx, page } = await fresh({ state: null }); await shot(page, '01-welcome'); await ctx.close(); }
// 加入主畫面的提示（安裝那一段用）
{ const st = demoState(); st.meta.installHintDismissed = false;
  const { ctx, page } = await fresh({ state: st }); await shot(page, '06-install-banner', { el: '#installBanner' }); await ctx.close(); }
// 2. 首頁
{ const { ctx, page } = await fresh(); await shot(page, '02-home');
  await scrollTo(page, '#adviceCard'); await shot(page, '03-home-advice');
  await scrollTo(page, 'h2.sec-title'); await shot(page, '04-home-tiles');
  await scrollTo(page, '#bodySection'); await shot(page, '05-home-body');
  await ctx.close(); }
// 3. 記錄吃的
{ const { ctx, page } = await fresh();
  await page.click('[data-food-open=mine] >> nth=0'); await shot(page, '10-myfood');
  await page.goBack(); await page.click('[data-food-open=all] >> nth=0'); await page.fill('#foodSearch', '白飯');
  await page.waitForSelector('#foodResults [data-food-id]'); await shot(page, '11-search');
  await page.click('#foodResults [data-food-id] >> nth=0'); await page.fill('#gramsInput', '120'); await shot(page, '12-grams');
  await ctx.close(); }
{ const { ctx, page } = await fresh(); await page.click('#tab-log [data-screen=scr-photo]'); await shot(page, '13-photo'); await ctx.close(); }
{ const { ctx, page } = await fresh(); await page.click('#lookupTile'); await shot(page, '14-lookup'); await ctx.close(); }
{ const { ctx, page } = await fresh(); await page.click('#tab-log [data-screen=scr-est]'); await shot(page, '15-est'); await ctx.close(); }
{ const { ctx, page } = await fresh(); await page.click('#tab-log [data-screen=scr-manual]');
  await page.fill('#foodNameInput', '洋芋片'); await page.click('#add-lb summary'); await page.fill('#add-lb-g', '30'); await page.fill('#add-lb-kcal', '160'); await page.fill('#add-lb-eat', '45');
  await shot(page, '16-manual'); await ctx.close(); }
{ const { ctx, page } = await fresh(); await page.click('#aiTile'); await shot(page, '17-ai'); await ctx.close(); }
// 4. 外食怎麼點、資料庫
{ const { ctx, page } = await fresh(); await page.click('[data-food-open=all] >> nth=0'); await page.click('#scr-food [data-meal=lunch]');
  await page.click('#eatoutOpenBtn'); await shot(page, '20-eatout-brands');
  await page.click('[data-eo-brand="台灣麥當勞"]'); await shot(page, '21-eatout-plan'); await ctx.close(); }
{ const { ctx, page } = await fresh(); await page.click('.mobile-nav-tab[data-tab=library]'); await shot(page, '22-library');
  await scrollTo(page, '#packList'); await shot(page, '23-packs');
  await page.click('[data-pack-open=pk_demo]'); await page.fill('#packSearch', '八方雲集'); await shot(page, '24-pack-open'); await ctx.close(); }
// 5. 身體
{ const { ctx, page } = await fresh(); await page.click('#bodySection [data-feature=water]'); await shot(page, '30-water'); await ctx.close(); }
{ const { ctx, page } = await fresh(); await page.click('#bodySection [data-feature=bp]'); await shot(page, '31-bp'); await ctx.close(); }
{ const { ctx, page } = await fresh(); await page.click('#bodySection [data-feature=glucose]'); await shot(page, '32-glucose'); await ctx.close(); }
{ const { ctx, page } = await fresh(); await page.click('#openSettingsBtn'); await shot(page, '33-settings');
  await page.click('#scr-settings [data-screen=scr-features]'); await page.locator('#featureToggles').evaluate(el => el.parentElement.scrollIntoView({ block: 'start' })); await shot(page, '34-features'); await ctx.close(); }
// 6. 趨勢、報告、營養師
{ const { ctx, page } = await fresh(); await page.click('.mobile-nav-tab[data-tab=trends]'); await page.waitForTimeout(500); await shot(page, '40-trends');
  await scrollTo(page, '#vitalsCard'); await shot(page, '41-trends-vitals'); await ctx.close(); }
{ const { ctx, page } = await fresh(); await page.click('.mobile-nav-tab[data-tab=report]'); await shot(page, '42-report-tab');
  await page.click('[data-days="7"]'); await page.click('#genReportBtn'); await page.waitForSelector('#reportArea:not(.hidden)'); await page.waitForTimeout(600);
  await scrollTo(page, '#reportArea'); await shot(page, '43-report'); await ctx.close(); }
{ const { ctx, page } = await fresh(); await page.click('.mobile-nav-tab[data-tab=report]'); await page.click('#tab-report [data-screen=scr-advice]'); await shot(page, '44-advice'); await ctx.close(); }
{ const { ctx, page } = await fresh(); await page.click('.mobile-nav-tab[data-tab=report]'); await page.click('#tab-report [data-screen=scr-photowall]'); await page.waitForTimeout(500); await shot(page, '45-photowall'); await ctx.close(); }
{ const { ctx, page } = await fresh(); await page.click('.mobile-nav-tab[data-tab=report]'); await page.click('#tab-report [data-screen=scr-weekly]'); await shot(page, '46-weekly'); await ctx.close(); }
{ const { ctx, page } = await fresh(); await page.click('.mobile-nav-tab[data-tab=report]'); await page.click('#tab-report [data-screen=scr-badges]'); await shot(page, '47-badges'); await ctx.close(); }

await browser.close();
server.close();
console.log('已拍 ' + done.length + ' 張：' + done.join('、'));
