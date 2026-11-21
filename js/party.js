// 吃到飽・聚餐速記（純函式，有單元測試）
// Rev. 43 起畫面已拿掉（使用者覺得用不到，找不到的改用「拍照記・待查」）。
// 留著範本和換算，只為了把舊版留在裝置上、還沒記下來的速記（meta.party）記成飲食記錄；舊記錄的 party 欄位照樣保留。
// 一個範本＝一組「代碼＋每單位營養素」；現場只數幾顆／幾份，最後一次算好、記成同一組。
// 熱量是估計值（每單位的平均），給營養師看的是大概，不是精確數字。
// 單位一律用「一顆、一塊、一條、一杯」：第一次可以秤一顆拍照（秤重模式），之後依重量校正，
// 所以每筆記錄都存 party: { tpl, code, n, unit, kcal1, g }，校正後可以把舊記錄一起重算。
// B1／B2／B3 原始模板是「1 籠」「1 拳頭」，改成「1 塊」時用 籠÷4、拳頭÷3 粗估，等秤重校正。

export const PARTY_TEMPLATES = [
  {
    id: 'dimsum', title: '港式點心吃到飽', icon: '🥟',
    note: '吃一顆、一塊、一杯就按一下（分著吃的只算自己吃的）。無糖熱茶免記。「隱形油醬」整餐算 1 次，沾很多就按 2。',
    items: [
      { code: 'A1', group: 'A 蒸籠點心', name: '純海鮮蒸點', unit: '顆', kcal: 50, c: 6, p: 4.5, f: 1, eg: '蝦餃、帶子餃、魚翅餃' },
      { code: 'A2', group: 'A 蒸籠點心', name: '腸粉', unit: '條', kcal: 90, c: 14, p: 4, f: 2, eg: '鮮蝦、牛肉、叉燒腸粉' },
      { code: 'A3', group: 'A 蒸籠點心', name: '肉餡蒸點', unit: '顆', kcal: 75, c: 7, p: 4, f: 3.5, eg: '燒賣、小籠包、牛肉丸' },
      { code: 'A4', group: 'A 蒸籠點心', name: '包子', unit: '顆', kcal: 140, c: 22, p: 4, f: 4, eg: '叉燒包、奶皇包、流沙包、馬拉糕' },
      { code: 'B1', group: 'B 肉類・燒臘', name: '高脂蒸籠', unit: '塊', kcal: 60, c: 1.5, p: 3.5, f: 4.5, eg: '鳳爪 1 隻、排骨 1 塊、金錢肚 1 塊' },
      { code: 'B2', group: 'B 肉類・燒臘', name: '瘦的燒臘・熱炒', unit: '塊', kcal: 60, c: 1.3, p: 7.3, f: 2.7, eg: '油雞、去皮燒鴨 1 塊，白灼蝦 1 隻，青菜 1 筷子' },
      { code: 'B3', group: 'B 肉類・燒臘', name: '肥的燒臘', unit: '塊', kcal: 105, c: 2.7, p: 5.3, f: 8.3, eg: '脆皮燒肉、肥叉燒 1 塊' },
      { code: 'C1', group: 'C 煎炸・酥皮', name: '煎糕', unit: '片', kcal: 100, c: 15, p: 2, f: 3.5, eg: '蘿蔔糕、芋頭糕、馬蹄糕' },
      { code: 'C2', group: 'C 煎炸・酥皮', name: '炸點心', unit: '件', kcal: 180, c: 16, p: 4, f: 11, eg: '春捲、鹹水角、腐皮捲、炸雲吞' },
      { code: 'C3', group: 'C 煎炸・酥皮', name: '酥皮・牛油', unit: '個', kcal: 320, c: 30, p: 4, f: 20, eg: '蛋塔、菠蘿油、叉燒酥' },
      { code: 'D1', group: 'D 主食・甜品・醬料', name: '飯麵・焗烤', unit: '小碗', kcal: 280, c: 35, p: 8, f: 12, eg: '炒飯、炒河粉、焗白菜 1 小碗，糯米雞 1 個' },
      { code: 'D2', group: 'D 主食・甜品・醬料', name: '甜飲・甜湯', unit: '杯', kcal: 220, c: 32, p: 3, f: 9, eg: '奶茶、凍檸茶、楊枝甘露、西米露' },
      { code: 'D0', group: 'D 主食・甜品・醬料', name: '隱形油醬・勾芡', unit: '餐', kcal: 150, c: 8, p: 0, f: 13, eg: '腸粉醬油、XO 醬、辣油、勾芡', start: 1 }
    ]
  }
];

export const partyTemplate = (id) => PARTY_TEMPLATES.find(t => t.id === id) || PARTY_TEMPLATES[0];

const r1 = (v) => Math.round(v * 10) / 10;
const cleanCount = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= 99 ? Math.round(n * 2) / 2 : 0; };

// 開始時的數量（D0 這種整餐固定 1 次的）
export function startCounts(tpl) {
  const c = {};
  tpl.items.forEach(it => { if (it.start) c[it.code] = it.start; });
  return c;
}

// 秤重模式量到的一顆重量（公克）；不合理的不算
export const cleanGrams = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= 2000 ? r1(n) : null; };

// 數量 → 要記的飲食記錄（每個有數量的品項一筆；kcal 等已乘上數量）
// grams：秤重模式量到的「一顆幾公克」{ 代碼: g }，存進記錄給之後校正用
export function partyEntries(tpl, counts, grams = {}) {
  return tpl.items.filter(it => cleanCount(counts && counts[it.code])).map(it => {
    const n = cleanCount(counts[it.code]);
    const party = { tpl: tpl.id, code: it.code, n, unit: it.unit, kcal1: it.kcal };
    const g = cleanGrams(grams && grams[it.code]);
    if (g) party.g = g;
    return {
      name: tpl.title.replace(/吃到飽$/, '') + '・' + it.name + ' ' + n + it.unit,
      kcal: Math.round(it.kcal * n), p: r1(it.p * n), c: r1(it.c * n), f: r1(it.f * n), ex: null, party
    };
  });
}

export function partyTotals(tpl, counts) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  partyEntries(tpl, counts).forEach(e => { t.kcal += e.kcal; t.p += e.p; t.c += e.c; t.f += e.f; });
  return { kcal: t.kcal, p: r1(t.p), c: r1(t.c), f: r1(t.f) };
}
