// 食物資料庫（js/packs.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  guessMapping, parseServing, splitVariant, rowsToFoods, findDuplicates, mergeExact,
  buildPack, packFromFile, packRows, searchPacks, groupHits, hashId, PACK_CSV_HEAD,
  myFoodsFile, packToFile, isMyFoodsFile, planMyFoodsImport, tfdaOverlap
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

test('分享我的食物：沒有 pack 的資料庫檔，不帶修改時間；資料庫也能整包分享', () => {
  const foods = [{ id: 'cf_1', name: '堅果包', serving: { g: 35 }, per100g: { kcal: 285.71 }, updatedAt: 9, futureField: 1 }];
  const file = myFoodsFile(foods, { now: 0 });
  assert.deepEqual(file, { app: 'diet-tracker-foods', version: 1, exportedAt: '1970-01-01T00:00:00.000Z', foods: [{ id: 'cf_1', name: '堅果包', serving: { g: 35 }, per100g: { kcal: 285.71 } }] });
  assert.equal(isMyFoodsFile(file), true);
  const pf = packToFile({ id: 'pk_1', name: '外食', foods, updatedAt: 3 }, { now: 0 });
  assert.equal(isMyFoodsFile(pf), false);
  assert.deepEqual(pf.pack, { id: 'pk_1', name: '外食' });
  assert.equal(packFromFile(pf).pack.foods.length, 1);
});

test('匯入別人分享的我的食物：新的加進來（新 id）、同名數字不同的等使用者決定、一樣的不動', () => {
  const local = [
    { id: 'cf_a', name: '堅果包', serving: { g: 35 }, per100g: { kcal: 285.71 }, aliases: ['堅果'], updatedAt: 1 },
    { id: 'cf_b', name: '無糖豆漿', perServing: { kcal: 120 }, updatedAt: 1 }
  ];
  const incoming = [
    { id: 'x1', name: '堅果包', serving: { g: 30 }, per100g: { kcal: 300 } },
    { id: 'x2', name: '無糖 豆漿', perServing: { kcal: 120 } },
    { id: 'x3', name: '烤地瓜', serving: { g: 150 }, per100g: { kcal: 127 }, updatedAt: 5 },
    { id: 'x4', name: '烤地瓜', perServing: { kcal: 1 } },
    { id: 'x5', name: '沒數字的' }
  ];
  let n = 0;
  const plan = planMyFoodsImport(local, incoming, { makeId: (p) => p + '_new' + (++n), now: 7 });
  assert.deepEqual(plan.add, [{ id: 'cf_new1', name: '烤地瓜', serving: { g: 150 }, per100g: { kcal: 127 }, updatedAt: 7 }]);
  assert.equal(plan.same, 1);
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].old, local[0]);
  assert.deepEqual(plan.update[0].food, { id: 'cf_a', name: '堅果包', aliases: ['堅果'], serving: { g: 30 }, per100g: { kcal: 300 }, updatedAt: 7 });
});

test('和衛福部重複：沒有店家（或來源是衛福部）的同名品項才算；連鎖店的不算', () => {
  const tfda = [{ id: 'T1', name: '白飯', aliases: ['米飯'] }, { id: 'T2', name: '漢堡' }];
  const foods = [
    { id: 'a', name: '白飯(標準1碗)', base: '白飯', brand: '自助餐單品基準(TFDA資料庫)' },
    { id: 'b', name: '米飯', base: '米飯' },
    { id: 'c', name: '漢堡', base: '漢堡', brand: '台灣麥當勞', source: '官方' },
    { id: 'd', name: '滷肉飯', base: '滷肉飯' }
  ];
  assert.deepEqual(tfdaOverlap(foods, tfda).map(x => [x.food.id, x.tfda.id]), [['a', 'T1'], ['b', 'T1']]);
});

test('貼上 AI 的回答：```csv 區塊、Markdown 表格、Excel（Tab）都讀得懂；前面的說明略過；分段貼可以接起來', async () => {
  const { parsePastedTable, appendPasted, packPrompt, guessMapping, rowsToFoods, PACK_CSV_HEAD } = await import('../../js/packs.js');
  const csv = '好的，以下是整理結果：\n```csv\n名稱,店家,計量方式,每份克數,份量說明,熱量(kcal),蛋白質(g)\n漢堡,麥當勞,每份,102,1份,260,12.2\n"薯條(中, 大)",麥當勞,每份,,1包,330,\n```\n還有，請說繼續';
  const a = parsePastedTable(csv);
  assert.deepEqual(a, [['名稱', '店家', '計量方式', '每份克數', '份量說明', '熱量(kcal)', '蛋白質(g)'], ['漢堡', '麥當勞', '每份', '102', '1份', '260', '12.2'], ['薯條(中, 大)', '麥當勞', '每份', '', '1包', '330', '']]);
  const md = '以下是表格：\n\n| 名稱 | 熱量(kcal) |\n|---|---|\n| 可樂 | 140 |\n| 雪碧 | 150 |';
  assert.deepEqual(parsePastedTable(md), [['名稱', '熱量(kcal)'], ['可樂', '140'], ['雪碧', '150']]);
  assert.deepEqual(parsePastedTable('名稱\t熱量\n奶茶\t1,200'), [['名稱', '熱量'], ['奶茶', '1,200']]);
  // 第二段（說了「繼續」之後）沒有欄位名稱 → 直接接上；有的話拿掉
  const b = parsePastedTable('```csv\n冰炫風,麥當勞,每份,,1杯,340,8\n```');
  assert.equal(appendPasted(a, b).length, 4);
  assert.equal(appendPasted(a, parsePastedTable(csv)).length, 5);
  // 照提示詞的欄位回答 → 整理工具一般流程
  assert.ok(packPrompt().includes(PACK_CSV_HEAD.join(',')));
  const { foods } = rowsToFoods(a.slice(1), guessMapping(a[0]));
  assert.deepEqual(foods.map(f => [f.brand, f.name, f.perServing.kcal]), [['麥當勞', '漢堡', 260], ['麥當勞', '薯條(中, 大)', 330]]);
  assert.equal(guessMapping(['頁碼', '名稱'])[0], 'page');
});

import { packsWithMine, looseMine, packFields, packFileWithMine } from '../../js/packs.js';
test('自己加到資料庫的：畫面用的資料庫＝原本的（拿掉改過的）＋自己加的；我的食物只列沒歸到資料庫的', () => {
  const pk = { id: 'pk_a', name: '外食', foods: [{ id: 'pf_1', name: '鍋貼', brand: '八方雲集' }, { id: 'pf_2', name: '酸辣湯', brand: '八方雲集' }] };
  const add = { id: 'cf_new', name: '咖哩鍋貼', packId: 'pk_a', brand: '八方雲集', perServing: { kcal: 60 } };
  const fix = { id: 'cf_fix', name: '鍋貼', packId: 'pk_a', brand: '八方雲集', replaces: 'pf_1', perServing: { kcal: 55 } };
  const loose = { id: 'cf_x', name: '堅果' };
  const orphan = { id: 'cf_o', name: '舊店', packId: 'pk_gone' };
  const [view] = packsWithMine([pk], [add, fix, loose, orphan]);
  assert.deepEqual(view.foods.map(f => f.id), ['pf_2', 'cf_new', 'cf_fix']);
  assert.equal(view.foods[1], add);   // 同一個物件：修改、記錄都照我的食物
  assert.equal(pk.foods.length, 2);   // 原本的資料庫不動
  assert.deepEqual(looseMine([add, fix, loose, orphan], [pk]).map(f => f.id), ['cf_x', 'cf_o']);
  assert.equal(packsWithMine([pk], [loose])[0], pk);
});
test('歸到資料庫：名稱拆成品項＋規格；沒填店家就留原本的', () => {
  assert.deepEqual(packFields({ name: '珍珠奶茶(大杯/微糖)' }, { packId: 'pk_a', brand: ' 50嵐 ' }), { packId: 'pk_a', base: '珍珠奶茶', variant: '大杯/微糖', brand: '50嵐' });
  assert.deepEqual(packFields({ name: '鍋貼', brand: '八方雲集' }, { packId: 'pk_a', brand: '' }), { packId: 'pk_a', base: '鍋貼', variant: null, brand: '八方雲集' });
});
test('分享資料庫：合成原本的＋自己加的；改過的用原本的 id，不帶 packId、updatedAt', () => {
  const pk = { id: 'pk_a', name: '外食', edition: '2026', updatedAt: 5, foods: [{ id: 'pf_1', name: '鍋貼', brand: '八方雲集', perServing: { kcal: 50 } }] };
  const fix = { id: 'cf_fix', name: '鍋貼', base: '鍋貼', packId: 'pk_a', brand: '八方雲集', replaces: 'pf_1', perServing: { kcal: 55 }, updatedAt: 9 };
  const add = { id: 'cf_new', name: '咖哩鍋貼', base: '咖哩鍋貼', variant: null, packId: 'pk_a', brand: '八方雲集', perServing: { kcal: 60 }, updatedAt: 9 };
  const file = packFileWithMine(pk, [fix, add], { now: 0 });
  assert.deepEqual(file.pack, { id: 'pk_a', name: '外食', edition: '2026' });
  assert.deepEqual(file.foods, [
    { id: 'pf_1', name: '鍋貼', brand: '八方雲集', perServing: { kcal: 55 }, base: '鍋貼' },
    { id: 'cf_new', name: '咖哩鍋貼', brand: '八方雲集', perServing: { kcal: 60 }, base: '咖哩鍋貼' }
  ]);
  assert.ok(packFromFile(file).pack);   // 別人匯入得了
});
