// 食物資料庫（js/packs.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  guessMapping, parseServing, splitVariant, rowsToFoods, findDuplicates, mergeExact,
  buildPack, packFromFile, packRows, searchPacks, groupHits, hashId, PACK_CSV_HEAD
} from '../../js/packs.js';

// 和使用者給的外食表同樣的欄位
const HEAD = ['提供者(餐廳店家)', '餐點分類', '品項名稱', '份量規格', '熱量(kcal)', '蛋白質(g)', '脂肪(g)', '飽和脂肪(g)', '反式脂肪(g)', '碳水化合物(g)', '糖(g)', '鈉(mg)', '資料來源說明'];
const ROWS = [
  ['台灣麥當勞', '主餐', '漢堡', '1份 (102g)', '260.0', '12.2', '9.5', '', '', '30.6', '', '500.0', '麥當勞官方'],
  ['50嵐', '奶茶', '珍珠奶茶(大杯/無糖)', '1杯 (L/700ml)', '340', '', '', '', '', '', '0', '', '50嵐官方'],
  ['50嵐', '奶茶', '珍珠奶茶(大杯/正常糖)', '1杯 (L/700ml)', '520', '', '', '', '', '', '45', '', '50嵐官方'],
  ['清心福全', '奶茶', '珍珠奶茶（大杯/無糖）', '1杯', '360', '', '', '', '', '', '0', '', '清心官方'],
  ['拿坡里', '披薩', '地中海漁夫披薩(大)', '1片', '238', '12', '18', '', '', '30', '', '', ''],
  ['', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['台灣麥當勞', '主餐', '沒熱量的', '1份', '', '1', '', '', '', '', '', '', ''],
  ['台灣麥當勞', '主餐', '漢 堡', '1份 (102g)', '260', '12.2', '9.5', '3.1', '0.2', '30.6', '6', '500', '麥當勞官方'],
  ['台灣麥當勞', '飲料', '可樂(中)', '1杯', 'abc', '0', '0', '', '', '', '', '', '']
];

test('欄位對照：使用者外食表的欄名都認得（飽和脂肪不會被當成脂肪、資料來源說明不是備註）', () => {
  assert.deepEqual(guessMapping(HEAD), ['brand', 'category', 'name', 'serving', 'kcal', 'p', 'f', 'sfa', 'tfa', 'c', 'sugar', 'na', 'source']);
  // CSV 範本的欄名（含六大類、舊名稱）
  assert.deepEqual(guessMapping(['名稱', '別名', '計量方式', '每份克數', '份量說明', '醣類(g)', '主食類(份)', '油脂類(份)', '膳食纖維(g)', '備註']),
    ['name', 'aliases', 'basis', 'servingG', 'serving', 'c', 'grain', 'oil', 'fiber', 'note']);
});

test('份量：拆出克數、毫升，說明留給人看', () => {
  assert.deepEqual(parseServing('1份 (102g)'), { g: 102, label: '1份' });
  assert.deepEqual(parseServing('3顆 (約45g)'), { g: 45, label: '3顆' });
  assert.deepEqual(parseServing('1杯 (L/660ml)'), { ml: 660, label: '1杯 (L/660ml)' });
  assert.deepEqual(parseServing('每100g'), { g: 100 });
  assert.deepEqual(parseServing('大杯 Grande'), { label: '大杯 Grande' });
  assert.deepEqual(parseServing(''), {});
});

test('名稱：結尾括號是規格（大杯／甜度），全形括號也可以', () => {
  assert.deepEqual(splitVariant('珍珠奶茶(大杯/正常糖)'), { base: '珍珠奶茶', variant: '大杯/正常糖' });
  assert.deepEqual(splitVariant('珍珠奶茶（大杯/無糖）'), { base: '珍珠奶茶', variant: '大杯/無糖' });
  assert.deepEqual(splitVariant('魚餃/燕餃(3顆)'), { base: '魚餃/燕餃', variant: '3顆' });
  assert.deepEqual(splitVariant('大麥克'), { base: '大麥克', variant: '' });
});

test('表格 → 食物：外食問幾份；空白不是 0；沒名稱、沒熱量不收；熱量對不起來提醒', () => {
  const { foods, problems } = rowsToFoods(ROWS, guessMapping(HEAD));
  assert.equal(foods.length, 6, '可樂的熱量看不懂 → 當成空白 → 沒熱量不收');
  assert.deepEqual(foods[0], {
    id: foods[0].id, name: '漢堡', base: '漢堡', brand: '台灣麥當勞', category: '主餐', source: '麥當勞官方',
    perServing: { kcal: 260, p: 12.2, f: 9.5, c: 30.6, na: 500 }, serving: { g: 102, label: '1份' }, row: 2
  });
  assert.equal(foods[1].variant, '大杯/無糖');
  assert.deepEqual(foods[1].perServing, { kcal: 340, sugar: 0 }, '糖 0 是真的 0，其他空白不寫');
  assert.deepEqual(problems.map(p => [p.row, p.level]), [[6, 'check'], [8, 'skip'], [10, 'blank'], [10, 'skip']]);
  assert.match(problems[0].msg, /熱量 238，用三大營養素算是 330/);
});

test('食材份量表（問幾克）：有每份克數就存每 100 g；計量方式「每100g」照填', () => {
  const head = ['名稱', '計量方式', '每份克數', '熱量', '蛋白質', '全穀雜糧(份)'];
  const { foods } = rowsToFoods([
    ['白飯', '每份', '160', '280', '5', '4'],
    ['燕麥', '每100g', '', '389', '16.9', ''],
    ['滷肉飯', '每份', '', '500', '', '3']
  ], guessMapping(head), { askBy: 'grams' });
  assert.deepEqual(foods[0].per100g, { kcal: 175, p: 3.13 });
  assert.deepEqual(foods[0].exPer100g, { grain: 2.5 });
  assert.deepEqual(foods[0].serving, { g: 160 });
  assert.deepEqual(foods[1].per100g, { kcal: 389, p: 16.9 });
  assert.equal(foods[1].serving, undefined);
  assert.deepEqual(foods[2].perServing, { kcal: 500 }, '不知道克數 → 問幾份');
  assert.deepEqual(foods[2].exPerServing, { grain: 3 });
});

test('重複：同店同名（寫法不同）合併、留資料完整的；數字一樣的列出來；不同店同品項不合併', () => {
  const { foods } = rowsToFoods(ROWS, guessMapping(HEAD));
  const d = findDuplicates(foods);
  assert.equal(d.exact.length, 1);
  assert.deepEqual(d.exact[0].map(f => f.name), ['漢堡', '漢 堡']);
  assert.deepEqual(d.crossBrand.map(g => g[0].base), ['珍珠奶茶']);
  const m = mergeExact(foods);
  assert.equal(m.foods.length, 5);
  assert.equal(m.dropped[0].name, '漢堡');
  assert.equal(m.foods.find(f => f.id === foods[0].id).perServing.sfa, 3.1);
  const same = findDuplicates([
    { id: 'a', brand: 'S', base: '油醋醬', perServing: { kcal: 60, p: 0, f: 6, c: 1 } },
    { id: 'b', brand: 'S', base: '千島醬', perServing: { kcal: 60, p: 0, f: 6, c: 1 } },
    { id: 'c', brand: 'T', base: '千島醬', perServing: { kcal: 60, p: 0, f: 6, c: 1 } }
  ]).sameNumbers;
  assert.deepEqual(same.map(g => g.map(f => f.id)), [['a', 'b']]);
});

test('id：同一家店同一個名稱，每次整理都一樣（換新版資料庫時記錄連得回去）', () => {
  const a = rowsToFoods(ROWS.slice(0, 1), guessMapping(HEAD)).foods[0].id;
  const b = rowsToFoods([ROWS[0].map((c, i) => (i === 4 ? '999' : c))], guessMapping(HEAD)).foods[0].id;
  assert.equal(a, b);
  assert.equal(hashId('x'), hashId('x'));
  assert.notEqual(hashId('x'), hashId('y'));
});

test('資料庫檔：產生、讀回來；不是資料庫檔、較新版、沒食物會說明', () => {
  const { foods } = rowsToFoods(ROWS, guessMapping(HEAD));
  assert.equal(buildPack({ name: ' ' }, foods).error, '請幫資料庫取個名字');
  const { file } = buildPack({ name: '外食連鎖店', org: '自己整理', edition: '2026', askBy: 'serving' }, foods, { now: 0 });
  assert.equal(file.app, 'diet-tracker-foods');
  assert.match(file.pack.id, /^pk_/);
  assert.equal(file.foods[0].row, undefined);
  assert.equal(buildPack({ name: '外食連鎖店', org: '自己整理', edition: '2027' }, foods).file.pack.id, file.pack.id, '新版本同一個 id');
  const { pack } = packFromFile(JSON.parse(JSON.stringify(file)), { now: 5 });
  assert.equal(pack.foods.length, 6);
  assert.equal(pack.updatedAt, 5);
  assert.equal(pack.edition, '2026');
  assert.equal(packFromFile({ app: 'diet-tracker' }).error, '這不是食物資料庫檔');
  assert.match(packFromFile({ ...file, version: 9 }).error, /較新版/);
  assert.equal(packFromFile({ ...file, foods: [] }).error, '資料庫檔裡沒有食物');
});

test('標準 CSV：照範本欄位；以克計的換回一份的數字；公式開頭的字加 \'', () => {
  const file = {
    pack: { name: '我的表', edition: '2026' },
    foods: [
      { id: 'a', name: '白飯', serving: { g: 160 }, per100g: { kcal: 175, p: 3.13 }, exPer100g: { grain: 2.5 } },
      { id: 'b', name: '=壞東西', brand: '店', serving: { label: '1碗' }, perServing: { kcal: 500, sfa: 2 }, source: '官方' }
    ]
  };
  const rows = packRows(file);
  assert.deepEqual(rows[0], PACK_CSV_HEAD);
  const col = (r, h) => r[PACK_CSV_HEAD.indexOf(h)];
  assert.equal(col(rows[1], '計量方式'), '每份');
  assert.equal(col(rows[1], '每份克數'), 160);
  assert.equal(col(rows[1], '熱量(kcal)'), 280);
  assert.equal(col(rows[1], '全穀雜糧(份)'), 4);
  assert.equal(col(rows[1], '資料來源'), '我的表');
  assert.equal(col(rows[2], '名稱'), "'=壞東西");
  assert.equal(col(rows[2], '飽和脂肪(g)'), 2);
  // 匯出的 CSV 再讀回來，數字一樣
  const back = rowsToFoods(rows.slice(1), guessMapping(rows[0]), { askBy: 'grams' }).foods;
  assert.deepEqual(back[0].per100g, { kcal: 175, p: 3.13 });
  assert.equal(back[1].name, '=壞東西');
});

test('查食物：品項、店家都找得到；同一個品項收成一組，列出有哪幾家', () => {
  const { foods } = rowsToFoods(ROWS, guessMapping(HEAD));
  const packs = [{ id: 'pk1', name: '外食', foods }];
  const groups = groupHits(searchPacks(packs, '珍珠奶茶'));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].hits.length, 3);
  assert.deepEqual(groups[0].brands, ['50嵐', '清心福全']);
  assert.deepEqual(groupHits(searchPacks(packs, '麥當勞')).map(g => g.base), ['漢堡', '沒熱量的', '可樂'].filter(b => foods.some(f => f.base === b)));
  assert.deepEqual(searchPacks(packs, '珍珠', { packId: 'other' }), []);
});
