// 食物資料庫：克數換算、生熟重換算、六大類份數、搜尋
// 食物格式見 tfda_foods.json（每 100 g 可食部分：kcal, p, f, c, sugar, na）。
// 這個檔案只有純函式，不碰畫面或儲存，方便測試。

const r1 = (v) => Math.round(v * 10) / 10;

/* ---------------- 克數換算 ---------------- */

// 常用克數快捷鈕（「+1 份」依食物自己的份量，另外處理）
export const GRAM_PRESETS = [
  { label: '半碗', g: 100 },
  { label: '一碗', g: 200 },
  { label: '1 湯匙', g: 15 }
];

// 生熟重換算：資料是「生重」，使用者秤的是「熟重」時要換回生重再算。
// factor＝熟重 ÷ 生重。只有下列兩類有定義，其他食物不顯示切換。
//   肉類：煮熟約縮水成 0.75 倍（熟 100 g ≈ 生 133 g）
//   米：煮成飯約 2.2 倍（飯 220 g ≈ 生米 100 g）。資料庫另有「白飯」（熟），能選熟的就選熟的。
const RICE_NAME = /米/;
const NOT_RICE = /玉米|小米|胚芽$|粉|米漿|米香|米苔目|米糕|米血|爆米|米酒|米醋/;
export function cookConversion(food) {
  if (!food || food.state !== 'raw') return null;
  if (food.category === '肉類') return { factor: 0.75, label: '肉類熟重（約縮水為 0.75 倍）' };
  if (food.category === '穀物類' && RICE_NAME.test(food.name) && !NOT_RICE.test(food.name)) {
    return { factor: 2.2, label: '煮熟的飯（約為生米 2.2 倍重）' };
  }
  return null;
}

// 使用者輸入的克數 → 資料庫基準（生重）的克數
export function baseGrams(food, grams, weighed = 'asis') {
  const g = Number(grams);
  if (!Number.isFinite(g) || g <= 0) return 0;
  if (weighed === 'cooked') {
    const conv = cookConversion(food);
    if (conv) return g / conv.factor;
  }
  return g;
}

// 算出這個克數的熱量與營養素：{ kcal, p, f, c, sugar, na, ex }
// weighed：'asis'（照資料庫狀態秤）或 'cooked'（秤的是熟重，只在 cookConversion 有定義時有效）
export function nutrientsFor(food, grams, weighed = 'asis') {
  const g = baseGrams(food, grams, weighed);
  const per = (food && food.per100g) || {};
  const m = g / 100;
  const val = (k, digits) => (per[k] == null ? null : digits === 0 ? Math.round(per[k] * m) : r1(per[k] * m));
  return {
    kcal: val('kcal', 0) ?? 0,
    p: val('p'), f: val('f'), c: val('c'),
    sugar: val('sugar'), na: val('na', 0),
    ex: exchangesFor(food, g)
  };
}

/* ---------------- 六大類份數（國健署食物代換表） ---------------- */
// 依食品分類決定屬於哪一類，再用該類的「每份」營養素換算：
//   全穀雜糧 1 份＝碳水 15 g；豆魚蛋肉 1 份＝蛋白質 7 g；蔬菜 1 份＝生重 100 g（乾貨用熱量 25 kcal）
//   水果 1 份＝碳水 15 g；乳品 1 份＝蛋白質 8 g；油脂與堅果種子 1 份＝脂肪 5 g
// 加工食品、糕餅、飲料、調味料等混合食物無法單純歸類，回傳 null（不要亂猜）；
// 例外：豆腐、豆干、豆漿等黃豆製品 TFDA 歸在加工食品，但代換表算豆魚蛋肉。
const GROUP_OF_CATEGORY = {
  '穀物類': 'grain', '澱粉類': 'grain',
  '肉類': 'prot', '魚貝類': 'prot', '蛋類': 'prot', '豆類': 'bean',
  '蔬菜類': 'veg', '菇類': 'veg', '藻類': 'veg',
  '水果類': 'fruit',
  '乳品類': 'dairy',
  '油脂類': 'oil', '堅果及種子類': 'oil'
};
const SOY = /豆腐|豆干|豆漿|豆皮|干絲|豆包|百頁|天貝/;
const NOT_SOY = /腐乳|豆花|優酪|布丁|酥|餅|糖|醬/;
export function exchangeGroup(food) {
  if (!food) return null;
  if (food.category === '加工調理食品及其他類' && SOY.test(food.name) && !NOT_SOY.test(food.name)) return 'prot';
  const g = GROUP_OF_CATEGORY[food.category];
  if (g !== 'bean') return g || null;
  // 豆類：四季豆、豌豆莢等「豆莢」算蔬菜；紅豆、綠豆等澱粉多的算全穀雜糧；黃豆、黑豆、毛豆算豆魚蛋肉
  if (/莢/.test(food.name)) return 'veg';
  const per = food.per100g || {};
  return (per.c || 0) > 2 * (per.p || 0) ? 'grain' : 'prot';
}
export function exchangesFor(food, baseG) {
  // 食物自己帶了每 100 g 的六大類份數（AI 估算、自訂食物）就直接用
  if (food && food.exPer100g && baseG > 0) {
    const out = {};
    Object.entries(food.exPer100g).forEach(([k, v]) => { const n = r1((Number(v) || 0) * baseG / 100); if (n > 0) out[k] = n; });
    return Object.keys(out).length ? out : null;
  }
  const group = exchangeGroup(food);
  if (!group || !(baseG > 0)) return null;
  const per = food.per100g || {};
  const m = baseG / 100;
  let n;
  if (group === 'grain' || group === 'fruit') n = ((per.c || 0) * m) / 15;
  else if (group === 'prot') n = ((per.p || 0) * m) / 7;
  else if (group === 'dairy') n = ((per.p || 0) * m) / 8;
  else if (group === 'oil') n = ((per.f || 0) * m) / 5;
  else if (group === 'veg') n = /乾/.test(food.note || '') || /乾/.test(food.name) ? ((per.kcal || 0) * m) / 25 : m;
  n = r1(n);
  return n > 0 ? { [group]: n } : null;
}

/* ---------------- 搜尋 ---------------- */

// 統一寫法：全形轉半形、去空白、異體字
export function normalize(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/臺/g, '台')
    .replace(/蕃/g, '番')
    .replace(/藷/g, '薯');
}

// 台灣日常說法 ↔ 資料庫用語（同一組裡任一個詞都能找到其他詞）
// TFDA 的「俗名」已經涵蓋很多（例如甘藷的俗名有地瓜），這裡只補不足的。
export const SYNONYMS = [
  ['地瓜', '甘藷', '番薯'],
  ['地瓜葉', '甘藷葉'],
  ['高麗菜', '甘藍'],
  ['花椰菜', '青花菜', '綠花椰', '綠花椰菜'],
  ['芭樂', '番石榴'],
  ['豆漿', '豆奶'],
  ['雞蛋', '蛋'],
  // TFDA 雞肉用部位名稱（「里肌肉(肉雞)」備註「生,雞胸部位」）
  ['雞胸肉', '雞胸', '雞胸部位'],
  ['雞腿肉', '雞腿', '雞腿部位'],
  ['香蕉', '北蕉'],
  ['鮮奶', '牛奶', '鮮乳'],
  ['優格', '凝態發酵乳'],
  ['優酪乳', '濃稠發酵乳', '發酵乳'],
  ['起司', '乳酪', '乾酪'],
  ['杏仁', '甘扁桃仁'],
  ['番茄', '西紅柿'],
  ['馬鈴薯', '洋芋'],
  ['奇異果', '獼猴桃'],
  ['白飯', '米飯']
].map(group => group.map(normalize));

// 查詢詞 → [{ term, penalty }]：原詞 0 分扣分，同義詞換過的稍微扣分
export function expandQuery(query) {
  const q = normalize(query);
  if (!q) return [];
  const out = [{ term: q, penalty: 0 }];
  const seen = new Set([q]);
  for (const group of SYNONYMS) {
    // 只換查詢裡出現的最長那個詞（避免「雞蛋」裡的「蛋」又被換成「雞蛋」）
    const word = group.filter(w => q.includes(w)).sort((a, b) => b.length - a.length)[0];
    if (!word) continue;
    for (const alt of group) {
      const t = q.replace(word, alt);
      if (!seen.has(t)) { seen.add(t); out.push({ term: t, penalty: 5 }); }
    }
  }
  return out;
}

// 同一食物的多次取樣（「北蕉平均值」「北蕉(2月取樣)」…）合成一組
const SAMPLE_TAG = /\((\d{4}年|\d{1,2}月)取樣\)/;
export function baseName(name) {
  return String(name || '').replace(new RegExp(SAMPLE_TAG.source, 'g'), '').replace('平均值', '');
}
function variantRank(food) {
  // 平均值優先，再來是沒有標取樣時間的，最後是最新一次取樣
  if (food.name.includes('平均值')) return 0;
  if (!SAMPLE_TAG.test(food.name)) return 1;
  const y = food.name.match(/(\d{4})年取樣/);
  return 2 + (y ? (3000 - Number(y[1])) / 10000 : 0.5);
}

// 中文名稱的主體通常在最後（「全脂鮮乳」是鮮乳、「鮮奶可可」是可可），
// 所以名稱結尾相同比開頭相同分數高。比對前去掉取樣、平均值和結尾的括號說明。
function coreName(name) {
  return normalize(baseName(name)).replace(/(\([^()]*\))+$/, '');
}
function matchScore(food, term) {
  const name = normalize(food.name);
  const core = coreName(food.name);
  let s = 0;
  if (core === term || name === term) s = 100;
  else if (core.endsWith(term)) s = 80;
  else if (core.startsWith(term)) s = 70;
  else if (name.includes(term)) s = 55;
  for (const a of food.aliases || []) {
    const an = normalize(a);
    if (an === term) s = Math.max(s, 75);
    else if (an.includes(term)) s = Math.max(s, 50);
  }
  // 備註：部位名稱（「生,雞胸部位」）很準，其他備註只是參考
  if (!s && term.length > 1) {
    const note = normalize(food.note);
    if (note.includes(term)) s = term.endsWith('部位') ? 85 : 40;
  }
  if (!s) return 0;
  // 名字越短越可能是「那個東西本身」（「雞蛋」勝過「雞蛋豆漿」）
  return s - Math.min(15, Math.max(0, core.length - term.length));
}

// 早上（05:00–10:30）把早餐常見食材往前排
const BREAKFAST = /蛋|豆漿|豆奶|鮮乳|牛奶|發酵乳|燕麥|甘薯|饅頭|吐司|土司|麵包|北蕉/;
export function isBreakfastTime(date) {
  if (!date) return false;
  const m = date.getHours() * 60 + date.getMinutes();
  return m >= 5 * 60 && m <= 10 * 60 + 30;
}

// 搜尋：回傳 [{ food, score, variants }]，variants 是同一食物的其他取樣
// foods：資料庫陣列（已刪除的 removed 品項不會出現）；now：Date，用來判斷早餐時段
export function searchFoods(foods, query, { limit = 30, now = null } = {}) {
  const terms = expandQuery(query);
  if (!terms.length) return [];
  const morning = isBreakfastTime(now);
  const hits = [];
  for (const food of foods || []) {
    if (!food || food.removed) continue;
    let best = 0;
    let ways = 0;
    for (const { term, penalty } of terms) {
      const s = matchScore(food, term);
      if (s) { best = Math.max(best, s - penalty); ways++; }
    }
    if (!best) continue;
    // 原詞和同義詞都找得到（例如甘藷的俗名是地瓜、名稱又有甘藷）更可能是要找的
    if (ways > 1) best += 5;
    if (morning && BREAKFAST.test(normalize(food.name))) best += 10;
    hits.push({ food, score: best });
  }
  // 合併取樣：同分類＋同基本名稱為一組，代表項用平均值
  const groups = new Map();
  for (const h of hits) {
    const key = h.food.category + '|' + normalize(baseName(h.food.name));
    const g = groups.get(key);
    if (!g) { groups.set(key, { members: [h], score: h.score }); continue; }
    g.members.push(h);
    g.score = Math.max(g.score, h.score);
  }
  const out = [];
  for (const g of groups.values()) {
    g.members.sort((a, b) => variantRank(a.food) - variantRank(b.food));
    out.push({ food: g.members[0].food, score: g.score, variants: g.members.slice(1).map(m => m.food) });
  }
  out.sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length || (a.food.id < b.food.id ? -1 : 1));
  return out.slice(0, limit);
}

/* ---------------- 熱量密度（每公克幾大卡） ---------------- */
// 糖尿病衛教學會《臺灣小吃營養大解析》：一般小吃每公克 1～2 大卡；糕餅、糖果、油炸類 3 大卡以上。
// 3 以上標「熱量密度高」：一小份熱量就很多。
// 不直接吃的乾料不標（照字面標會誤導，例如生米煮成飯每公克只剩約 1.6 大卡）：
//   調味料香辛料（用量很少）、名稱有粉／沖泡／即溶的、還沒煮的穀物／澱粉／乾豆。
export const DENSITY_HIGH = 3;
const NOT_AS_EATEN_CATS = new Set(['調味料及香辛料類']);
const DRY_CATS = new Set(['穀物類', '澱粉類', '豆類']);
const POWDER = /粉|沖泡|即溶/;

// 這樣食物適不適合標熱量密度
export function densityApplies(food) {
  if (!food) return false;
  if (NOT_AS_EATEN_CATS.has(food.category)) return false;
  if (POWDER.test(food.name || '')) return false;
  if (DRY_CATS.has(food.category) && food.state !== 'cooked') return false;
  return true;
}
// → null（不適用）或 { perG: 每公克大卡（一位小數）, high }
//   kcalPerG：實際吃下去的每公克熱量（例如用熟重算的）；沒給就用每 100 g 的值
export function energyDensity(food, kcalPerG = null) {
  if (!densityApplies(food)) return null;
  const v = kcalPerG != null ? Number(kcalPerG) : Number(food.per100g && food.per100g.kcal) / 100;
  if (!Number.isFinite(v) || v <= 0) return null;
  const perG = Math.round(v * 10) / 10;
  return { perG, high: v >= DENSITY_HIGH };
}

/* ---------------- 糯米類（支鏈澱粉多，血糖上升比較快） ---------------- */
// 糖尿病衛教學會《臺灣小吃營養大解析》：粽子、米糕等糯米類支鏈澱粉多，比蓬萊米、在來米的升糖指數高。
// 用名稱、別名、備註判斷（備註寫「糯米」的也算，例如米漿、芝麻糊沖泡包）。
// 不算：糯米椒（辣椒）、糯米醋、寧波年糕（蓬萊米）、蘿蔔糕／芋頭粿／碗粿／粿仔條／粄條（在來米）、粉粿（澱粉）。
const GLUTINOUS = /糯(?!米椒|米醋)|粽|米糕|米血|油飯|麻糬|湯圓|元宵|年糕|甜粿|草仔粿|紅龜粿|鼠麴粿|紫米|大福|艾草粄|紅豆粄|客家菜包|粢粑|糍粑|八寶飯/;
const NOT_GLUTINOUS = /寧波年糕|糯米椒|糯米醋/;
export function isGlutinous(food) {
  if (!food) return false;
  const name = food.name || '';
  if (NOT_GLUTINOUS.test(name)) return false;
  const text = [name, ...(food.aliases || []), food.note || ''].join(' ');
  return GLUTINOUS.test(text);
}
