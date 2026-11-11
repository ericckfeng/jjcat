// 營養相關常數：餐別、三大營養素、六大類食物代換（衛福部國健署「食物代換表」）

export const MEAL_KEYS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MEAL_META = {
  breakfast: { label: '早餐', badge: 'bg-amber-50 text-amber-700' },
  lunch: { label: '午餐', badge: 'bg-emerald-50 text-emerald-700' },
  dinner: { label: '晚餐', badge: 'bg-indigo-50 text-indigo-700' },
  snack: { label: '點心', badge: 'bg-rose-50 text-rose-700' }
};

export const MACRO_KEYS = ['p', 'c', 'f'];
export const MACRO_META = {
  p: { label: '蛋白質', short: 'P', kcalPerG: 4, bar: 'bg-sky-500', color: '#0ea5e9' },
  c: { label: '碳水', short: 'C', kcalPerG: 4, bar: 'bg-amber-500', color: '#f59e0b' },
  f: { label: '脂肪', short: 'F', kcalPerG: 9, bar: 'bg-rose-400', color: '#fb7185' }
};

export const EX_KEYS = ['grain', 'prot', 'veg', 'fruit', 'dairy', 'oil'];
export const EX_META = {
  grain: { label: '全穀雜糧類', short: '全穀', emoji: '🍚' },
  prot: { label: '豆魚蛋肉類', short: '豆魚蛋肉', emoji: '🥚' },
  veg: { label: '蔬菜類', short: '蔬菜', emoji: '🥬' },
  fruit: { label: '水果類', short: '水果', emoji: '🍎' },
  dairy: { label: '乳品類', short: '乳品', emoji: '🥛' },
  oil: { label: '油脂與堅果種子類', short: '油脂', emoji: '🥜' }
};

// 由「份數」推算時使用的每份營養素（豆魚蛋肉以中脂、乳品以低脂計）
export const EX_DEFAULT_NUTR = {
  grain: { kcal: 70, p: 2, c: 15, f: 0 },
  prot: { kcal: 75, p: 7, c: 0, f: 5 },
  veg: { kcal: 25, p: 1, c: 5, f: 0 },
  fruit: { kcal: 60, p: 0, c: 15, f: 0 },
  dairy: { kcal: 120, p: 8, c: 12, f: 4 },
  oil: { kcal: 45, p: 0, c: 0, f: 5 }
};

// 自助餐／無標示餐點目測估算按鈕（每按一次 = 1 份）
export const EST_PARTS = [
  { id: 'grain', title: '🍚 全穀主食', sub: '飯 1/4 碗・麵半碗', kcal: 70, p: 2, c: 15, f: 0, ex: { grain: 1 } },
  { id: 'protLow', title: '🐟 低脂豆魚肉', sub: '雞胸／魚／豆腐 3 指寬', kcal: 55, p: 7, c: 0, f: 3, ex: { prot: 1 } },
  { id: 'protMid', title: '🥚 中脂肉蛋', sub: '雞腿肉／里肌／蛋 1 顆', kcal: 75, p: 7, c: 0, f: 5, ex: { prot: 1 } },
  { id: 'protHigh', title: '🥩 高脂肉／炸物', sub: '五花／炸排骨／貢丸', kcal: 120, p: 7, c: 0, f: 10, ex: { prot: 1 } },
  { id: 'veg', title: '🥬 蔬菜', sub: '煮熟約半碗', kcal: 25, p: 1, c: 5, f: 0, ex: { veg: 1 } },
  { id: 'fruit', title: '🍎 水果', sub: '約 1 個拳頭', kcal: 60, p: 0, c: 15, f: 0, ex: { fruit: 1 } },
  { id: 'oil', title: '🥄 油脂', sub: '炒菜油 1 茶匙／堅果 1 拇指', kcal: 45, p: 0, c: 0, f: 5, ex: { oil: 1 } },
  { id: 'dairyWhole', title: '🥛 全脂鮮乳', sub: '240 ml', kcal: 150, p: 8, c: 12, f: 8, ex: { dairy: 1 } },
  { id: 'dairyLow', title: '🥛 低脂鮮乳', sub: '240 ml', kcal: 120, p: 8, c: 12, f: 4, ex: { dairy: 1 } }
];

// 預設外食快選（熱量來源見 App 內「資料來源」；營養素／份數只填可由代換表直接換算者）
export const PRESET_FOODS = [
  { id: 'f1', name: '茶葉蛋 (1顆)', kcal: 77, cat: 'breakfast', p: 7, c: 0, f: 5, ex: { prot: 1 } },
  { id: 'f2', name: '嫩雞胸肉 (超商即食)', kcal: 99, cat: 'breakfast' },
  { id: 'f3', name: '地瓜 (110g)', kcal: 140, cat: 'breakfast', p: 4, c: 30, f: 0, ex: { grain: 2 } },
  { id: 'f4', name: '豬肉漢堡 (1份)', kcal: 400, cat: 'breakfast' },
  { id: 'f5', name: '無糖高纖豆漿 (450ml)', kcal: 230, cat: 'drink' },
  { id: 'f6', name: '奶茶 (700cc)', kcal: 294, cat: 'drink' },
  { id: 'f7', name: '無糖珍珠奶茶 (大杯)', kcal: 350, cat: 'drink' },
  { id: 'f8', name: '珍珠奶茶 (大杯全糖)', kcal: 710, cat: 'drink' },
  { id: 'f9', name: '無調味堅果 (20g小包)', kcal: 100, cat: 'drink' },
  { id: 'f10', name: '薯條 (大份)', kcal: 473, cat: 'drink' },
  { id: 'f11', name: '白飯 (1碗)', kcal: 280, cat: 'meal', p: 8, c: 60, f: 0, ex: { grain: 4 } },
  { id: 'f12', name: '炸雞腿便當', kcal: 810, cat: 'meal' },
  { id: 'f13', name: '滷肉飯', kcal: 648, cat: 'meal' },
  { id: 'f14', name: '高麗菜水餃 (10顆)', kcal: 600, cat: 'meal' },
  { id: 'f15', name: '蚵仔麵線 (1小碗)', kcal: 415, cat: 'meal' },
  { id: 'f16', name: '蚵仔煎', kcal: 516, cat: 'meal' },
  { id: 'f17', name: '蔥油餅', kcal: 541, cat: 'meal' }
];

export const HUNGER_LABELS = { 1: '不餓', 2: '有點', 3: '普通', 4: '偏餓', 5: '很餓' };
export const MOOD_OPTIONS = { 1: '😫', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };
export const BOWEL_LABELS = { 0: '無', 1: '1 次', 2: '2 次以上' };
