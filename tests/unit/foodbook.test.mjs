// AI 建檔小工具（js/foodbook.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookPrompt, normalizeBookPage, checkBookItem, bookToPack, bookSummary } from '../../js/foodbook.js';
import { packFromFile } from '../../js/packs.js';

const PAGE = {
  rotation: 90,
  items: [
    { name: '牛肉麵', weight_g: 600, serving_label: '1 碗', kcal: 540, protein: 30, fat: 18, carbs: 64, exchanges: { grain: 4.2, protein: 2.4, oil: 2 }, exchanges_from_chart: true, printed_kcal_per_g: 1.6, has_soup: true, note: '牛腱、麵條' },
    { name: '滷肉飯', weight_g: 250, kcal: 450, protein: 12, fat: 15, carbs: 66, printed_kcal_per_g: 1.4, printed_carbs_per_g: 0.26 },
    { name: '  ', kcal: 100 },
    { name: '綠豆湯', serving_label: '1 碗', exchanges: { grain: 2 } }
  ],
  page_note: ''
};

test('提示詞：只填頁面上印的數字；有章節類別時說明', () => {
  assert.match(bookPrompt(), /沒印的不要估/);
  assert.doesNotMatch(bookPrompt(), /這一章/);
  assert.match(bookPrompt({ category: 'grain' }), /這一章每一樣的重量就是「全穀雜糧」1 份/);
});

test('整理 AI 回傳：轉正角度、長條圖份數取到 0.5、沒名稱的丟掉', () => {
  const { rotation, items } = normalizeBookPage(PAGE);
  assert.equal(rotation, 90);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    name: '牛肉麵', weightG: 600, servingLabel: '1 碗', kcal: 540, p: 30, f: 18, c: 64, sugar: null, na: null, fiber: null,
    ex: { grain: 4, prot: 2.5, oil: 2 }, exFromChart: true, kcalPerG: 1.6, carbPerG: null, hasSoup: true, note: '牛腱、麵條'
  });
  assert.equal(items[2].kcal, null);
  assert.equal(normalizeBookPage({ rotation: 45, items: [] }).rotation, 0);
});

test('依章節定份數：這一類自動 1 份，不再算長條圖估讀', () => {
  const { items } = normalizeBookPage(PAGE, { category: 'grain' });
  assert.equal(items[0].ex.grain, 1);
  assert.equal(items[0].exFromChart, false);
  assert.deepEqual(items[2].ex, { grain: 1 });
});

test('檢查：熱量÷重量對不上 → 有湯的只提示、沒湯的請確認；沒熱量不能匯出；長條圖請校對', () => {
  const [noodle, rice, soup] = normalizeBookPage(PAGE).items;
  const n = checkBookItem(noodle);
  assert.deepEqual(n.map(f => f.level), ['info', 'warn']);
  assert.match(n[0].msg, /熱量÷重量＝0\.9，書上印 1\.6：有湯汁，對不上是正常的/);
  const r = checkBookItem(rice);
  assert.deepEqual(r.map(f => f.level), ['warn'], '醣類 66÷250＝0.264，和書上 0.26 對得上');
  assert.match(r[0].msg, /熱量÷重量＝1\.8，書上印 1\.4：有湯汁，或可能讀錯/);
  assert.deepEqual(checkBookItem(soup).map(f => f.level), ['error']);
  assert.deepEqual(checkBookItem({ name: 'a', kcal: 100, weightG: 100, kcalPerG: 1.05 }), []);
});

test('匯出：沒熱量和刪掉的不收；有重量的以克計、沒有的以份計；同名只留一筆；App 讀得回來', () => {
  const items = normalizeBookPage(PAGE).items.map(it => ({ ...it, checked: true }));
  items.push({ ...items[1], kcal: 460 });            // 別頁的同一道菜：後面的蓋掉前面的
  items.push({ ...items[0], name: '刪掉的', removed: true });
  const { file } = bookToPack(items, { name: '糖尿病飲食書', org: '某醫院', edition: '2024', askBy: 'grams' }, { now: 0 });
  assert.equal(file.foods.length, 2);
  const noodle = file.foods.find(f => f.name === '牛肉麵');
  assert.deepEqual(noodle.serving, { g: 600, label: '1 碗' });
  assert.equal(noodle.per100g.kcal, 90);
  assert.deepEqual(noodle.exPer100g, { grain: 0.67, prot: 0.42, oil: 0.33 });
  assert.equal(noodle.note, '牛腱、麵條');
  assert.equal(noodle.source, '糖尿病飲食書 2024');
  assert.equal(file.foods.find(f => f.name === '滷肉飯').per100g.kcal, 184);
  assert.equal(packFromFile(file).pack.foods.length, 2);
  // 問幾份：一律存每份
  const s = bookToPack(items, { name: 'x', askBy: 'serving' }).file;
  assert.deepEqual(s.foods.find(f => f.name === '牛肉麵').perServing.kcal, 540);
});

test('進度摘要', () => {
  const items = normalizeBookPage(PAGE).items.map((it, i) => ({ ...it, checked: i === 0 }));
  const s = bookSummary({ pages: [{ status: 'done' }, { status: 'todo' }, { status: 'error' }], items });
  assert.deepEqual(s, { pages: 3, done: 1, failed: 1, todo: 2, items: 3, checked: 1, flagged: 3 });
});
