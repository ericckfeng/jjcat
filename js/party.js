// 吃到飽・聚餐速記（純函式，有單元測試）
// 一個範本＝一組「代碼＋每單位營養素」；現場只數幾顆／幾份，最後一次算好、記成同一組。
// 也可以把手機備忘錄的速記文字（例如「A1: 3+2」）貼進來自動換成數量。
// 熱量是估計值（每單位的平均），給營養師看的是大概，不是精確數字。

export const PARTY_TEMPLATES = [
  {
    id: 'dimsum', title: '港式點心吃到飽', icon: '🥟',
    note: '每拿一輪就按一下。無糖熱茶免記。最後的「隱形油醬」整餐算 1 次就好。',
    items: [
      { code: 'A1', group: 'A 蒸籠點心（算顆／條）', name: '純海鮮蒸點', unit: '顆', kcal: 50, c: 6, p: 4.5, f: 1, eg: '蝦餃、帶子餃、魚翅餃' },
      { code: 'A2', group: 'A 蒸籠點心（算顆／條）', name: '腸粉', unit: '條', kcal: 90, c: 14, p: 4, f: 2, eg: '鮮蝦、牛肉、叉燒腸粉' },
      { code: 'A3', group: 'A 蒸籠點心（算顆／條）', name: '肉餡蒸點', unit: '顆', kcal: 75, c: 7, p: 4, f: 3.5, eg: '燒賣、小籠包、牛肉丸' },
      { code: 'A4', group: 'A 蒸籠點心（算顆／條）', name: '包子', unit: '顆', kcal: 140, c: 22, p: 4, f: 4, eg: '叉燒包、奶皇包、流沙包、馬拉糕' },
      { code: 'B1', group: 'B 肉類・燒臘（算籠／拳頭）', name: '高脂蒸籠', unit: '籠', kcal: 240, c: 6, p: 14, f: 18, eg: '鳳爪、豉汁排骨、金錢肚' },
      { code: 'B2', group: 'B 肉類・燒臘（算籠／拳頭）', name: '瘦的燒臘・熱炒', unit: '拳頭', kcal: 180, c: 4, p: 22, f: 8, eg: '油雞、去皮燒鴨、白灼蝦、炒青菜' },
      { code: 'B3', group: 'B 肉類・燒臘（算籠／拳頭）', name: '肥的燒臘', unit: '拳頭', kcal: 320, c: 8, p: 16, f: 25, eg: '脆皮燒肉、肥叉燒' },
      { code: 'C1', group: 'C 煎炸・酥皮（算片／件）', name: '煎糕', unit: '片', kcal: 100, c: 15, p: 2, f: 3.5, eg: '蘿蔔糕、芋頭糕、馬蹄糕' },
      { code: 'C2', group: 'C 煎炸・酥皮（算片／件）', name: '炸點心', unit: '件', kcal: 180, c: 16, p: 4, f: 11, eg: '春捲、鹹水角、腐皮捲、炸雲吞' },
      { code: 'C3', group: 'C 煎炸・酥皮（算片／件）', name: '酥皮・牛油', unit: '個', kcal: 320, c: 30, p: 4, f: 20, eg: '蛋塔、菠蘿油、叉燒酥' },
      { code: 'D1', group: 'D 主食・甜品・醬料', name: '飯麵・焗烤', unit: '拳頭', kcal: 280, c: 35, p: 8, f: 12, eg: '炒飯、炒河粉、糯米雞、焗白菜' },
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

// 全形數字、冒號、加號 → 半形；代碼不分大小寫
function halfWidth(s) {
  return String(s || '').replace(/[０-９Ａ-Ｚａ-ｚ．＋：＝]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
}

// 備忘錄文字 → { counts, unknown }。認得的寫法：
//   A1(蝦餃/顆): 3   A1：3   A1 3   a1=3   A1: 2+3（每拿一輪加一次）   A1: 0.5
// 同一個代碼出現好幾次會加起來；沒有數字的不算。
export function parsePartyText(text, tpl) {
  const known = new Set(tpl.items.map(it => it.code));
  const counts = {};
  const unknown = [];
  const re = /\b([A-Za-z]\d{1,2})\b(?:\s*[(（][^)）]*[)）])?\s*[:=]?\s*((?:\d+(?:\.\d+)?\s*\+\s*)*\d+(?:\.\d+)?)/g;
  let m;
  const src = halfWidth(text).replace(/（/g, '(').replace(/）/g, ')');
  while ((m = re.exec(src))) {
    const code = m[1].toUpperCase();
    const n = m[2].split('+').reduce((s, x) => s + Number(x), 0);
    if (!known.has(code)) { if (!unknown.includes(code)) unknown.push(code); continue; }
    counts[code] = (counts[code] || 0) + n;
  }
  Object.keys(counts).forEach(k => { counts[k] = cleanCount(counts[k]); if (!counts[k]) delete counts[k]; });
  return { counts, unknown };
}

// 給手機備忘錄用的空白速記格式
export function partyMemo(tpl) {
  const lines = ['【' + tpl.title + '速記】'];
  let group = '';
  tpl.items.forEach(it => {
    if (it.group !== group) { group = it.group; lines.push('-- ' + group + ' --'); }
    lines.push(it.code + '(' + it.name + '/' + it.unit + '): ' + (it.start || ''));
  });
  return lines.join('\n');
}

// 數量 → 要記的飲食記錄（每個有數量的品項一筆；kcal 等已乘上數量）
export function partyEntries(tpl, counts) {
  return tpl.items.filter(it => cleanCount(counts && counts[it.code])).map(it => {
    const n = cleanCount(counts[it.code]);
    return {
      name: tpl.title.replace(/吃到飽$/, '') + '・' + it.name + ' ' + n + it.unit,
      kcal: Math.round(it.kcal * n), p: r1(it.p * n), c: r1(it.c * n), f: r1(it.f * n), ex: null
    };
  });
}

export function partyTotals(tpl, counts) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  partyEntries(tpl, counts).forEach(e => { t.kcal += e.kcal; t.p += e.p; t.c += e.c; t.f += e.f; });
  return { kcal: t.kcal, p: r1(t.p), c: r1(t.c), f: r1(t.f) };
}
