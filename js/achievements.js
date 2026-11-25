// 小成就（純函式，有單元測試）
// 全部從記錄算出來，不另外存要同步的資料：換手機、從雲端取回，成就照樣在。
// 「已經慶祝過哪些」只存在這台裝置（meta.badgesSeen），每個成就每台裝置只放一次彩帶。
// 原則：不責備、不歸零。連續中斷了，最長紀錄和累計天數都還在。

const DAY = 86400000;
const toMs = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const addDay = (d, n) => new Date(toMs(d) + n * DAY).toISOString().slice(0, 10);

// 每一組：計數的方式、門檻、圖示、怎麼說
export const BADGE_GROUPS = [
  { id: 'streak', emoji: '🔥', name: '連續記錄', unit: '天', levels: [3, 7, 14, 30, 60, 100, 200, 365],
    title: (n) => '連續記錄 ' + n + ' 天', hint: '每天記一餐就算' },
  { id: 'days', emoji: '📒', name: '累計記錄', unit: '天', levels: [10, 30, 50, 100, 200, 365, 500, 1000],
    title: (n) => '累計記錄 ' + n + ' 天', hint: '中斷了也會一直累積' },
  { id: 'water', emoji: '💧', name: '喝水達標', unit: '天', levels: [7, 30, 100, 200],
    title: (n) => '喝水達標 ' + n + ' 天', hint: '一天喝到目標（沒設目標是 1500 毫升）' },
  { id: 'weigh', emoji: '⚖️', name: '量體重', unit: '天', levels: [7, 30, 100, 200],
    title: (n) => '量體重 ' + n + ' 天', hint: '早上起床量最準' },
  { id: 'sleep', emoji: '😴', name: '記錄睡眠', unit: '天', levels: [7, 30, 100],
    title: (n) => '記錄睡眠 ' + n + ' 天', hint: '填上床和起床時間' },
  { id: 'walk', emoji: '🚶', name: '走路達標', unit: '天', levels: [7, 30, 100, 200],
    title: (n) => '走路達標 ' + n + ' 天', hint: '走到每天的步數下限（沒設下限，有記步數就算）' },
  { id: 'move', emoji: '🏃', name: '有運動', unit: '天', levels: [5, 20, 50, 100, 200],
    title: (n) => '有運動的日子 ' + n + ' 天', hint: '散步也算' },
  // 投稿被採用（加進外食圖書館）：只有用邀請碼加入公測的才有這一組
  { id: 'helper', emoji: '🙌', name: '熱心貢獻者', unit: '樣', levels: [1, 5, 20, 50],
    title: (n) => n === 1 ? '熱心貢獻者' : '熱心貢獻者・採用 ' + n + ' 樣', hint: '我的食物按「📮 推薦給外食圖書館」，管理者採用就算' },
  // 體重往目標前進（沒有方向，例如體重正常、沒設目標，就沒有這一組）
  { id: 'kg', emoji: '🎯', name: '體重前進', unit: '公斤', levels: [1, 2, 3, 5, 8, 10, 15, 20],
    title: (n, dir) => (dir < 0 ? '少了 ' : '增加了 ') + n + ' 公斤',
    // 500 毫升的水約 0.5 公斤：1 公斤 ≈ 2 瓶
    life: (n, dir) => (dir < 0 ? '≈ 少背 ' : '≈ 多了 ') + n * 2 + ' 瓶 500 毫升的水', hint: '從第一次量的體重開始算' }
];

// facts：每一天的事實，日期遞增，只放有資料的日子
//   [{ date, food, water, weigh, sleep, move, walk }]（都是 true/false）
// weights：[{ date, kg }] 日期遞增；dir：-1 想減、1 想增、0 維持（不算體重前進）
// today：今天（YYYY-MM-DD）
// 回傳 { stats, badges }
//   stats：{ streak, todayLogged, longest, days, water, weigh, sleep, move, walk, kg }
//   badges：每一組每一級 { id, group, level, emoji, title, life, earnedOn（日期或 null）, have, need }
// helper：投稿被採用的日期（遞增）；null＝沒有加入公測，不列這一組
export function computeBadges({ facts = [], weights = [], dir = 0, today, helper = null }) {
  const earned = {};   // id → 第一次達到的日期
  const mark = (id, date) => { if (!earned[id]) earned[id] = date; };
  const count = { days: 0, water: 0, weigh: 0, sleep: 0, move: 0, walk: 0 };
  let run = 0, longest = 0, prev = null;
  for (const f of facts) {
    if (f.food) {
      run = prev && addDay(prev, 1) === f.date ? run + 1 : 1;
      prev = f.date;
      longest = Math.max(longest, run);
      count.days++;
      BADGE_GROUPS[0].levels.forEach(n => { if (run >= n) mark('streak-' + n, f.date); });
    }
    ['water', 'weigh', 'sleep', 'move', 'walk'].forEach(k => { if (f[k]) count[k]++; });
    ['days', 'water', 'weigh', 'sleep', 'move', 'walk'].forEach(k => {
      BADGE_GROUPS.find(g => g.id === k).levels.forEach(n => { if (count[k] >= n) mark(k + '-' + n, f.date); });
    });
  }
  // 目前的連續：今天記了就算到今天，還沒記就算到昨天（今天還有機會）
  const foodDates = new Set(facts.filter(f => f.food).map(f => f.date));
  const todayLogged = foodDates.has(today);
  let streak = 0;
  for (let d = todayLogged ? today : addDay(today, -1); foodDates.has(d) && streak < 5000; d = addDay(d, -1)) streak++;
  // 體重往目標前進：和第一次量的比，往目標方向的公斤數
  let kg = 0;
  if (dir && weights.length > 1) {
    const start = weights[0].kg;
    for (const w of weights) {
      const moved = Math.round((w.kg - start) * dir * 10) / 10;
      if (moved > kg) kg = moved;
      BADGE_GROUPS.find(g => g.id === 'kg').levels.forEach(n => { if (moved >= n) mark('kg-' + n, w.date); });
    }
    // 現在的進度用最近一次（最大值只用來記「哪天達到」）
    kg = Math.max(0, Math.round((weights[weights.length - 1].kg - start) * dir * 10) / 10);
  }
  const helped = Array.isArray(helper) ? helper.length : 0;
  if (helped) BADGE_GROUPS.find(g => g.id === 'helper').levels.forEach(n => { if (helped >= n) mark('helper-' + n, helper[n - 1]); });
  const stats = { streak, todayLogged, longest, ...count, kg, helper: helped };
  const haveOf = { streak: longest, days: count.days, water: count.water, weigh: count.weigh, sleep: count.sleep, move: count.move, walk: count.walk, kg, helper: helped };
  const badges = [];
  BADGE_GROUPS.forEach(g => {
    if (g.id === 'kg' && !dir) return;
    if (g.id === 'helper' && !Array.isArray(helper)) return;
    g.levels.forEach(n => {
      const id = g.id + '-' + n;
      badges.push({ id, group: g.id, level: n, emoji: g.emoji, title: g.title(n, dir), life: g.life ? g.life(n, dir) : '',
        earnedOn: earned[id] || null, have: haveOf[g.id], need: n });
    });
  });
  return { stats, badges };
}

// 每一組要顯示的：已經得到的全部，加上下一個目標（沒得到的不要一次列一大排）
export function badgesToShow(badges) {
  const out = [];
  BADGE_GROUPS.forEach(g => {
    const list = badges.filter(b => b.group === g.id);
    if (!list.length) return;
    const got = list.filter(b => b.earnedOn);
    const next = list.find(b => !b.earnedOn);
    out.push({ group: g, earned: got, next: next || null });
  });
  return out;
}

// 新得到、這台裝置還沒慶祝過的（最近得到的在前）。seen 是 null（第一次用這個功能）時不慶祝舊的，全部當成看過
export function newBadges(badges, seen) {
  if (!Array.isArray(seen)) return [];
  const s = new Set(seen);
  return badges.filter(b => b.earnedOn && !s.has(b.id)).sort((a, b) => b.earnedOn.localeCompare(a.earnedOn) || b.level - a.level);
}

// 「還差幾天」：下一個目標的說法
export function remainText(b) {
  const g = BADGE_GROUPS.find(x => x.id === b.group);
  const left = Math.round((b.need - (b.have || 0)) * 10) / 10;
  if (b.group === 'streak') return '最長連續 ' + (b.have || 0) + ' 天，再 ' + left + ' 天';
  if (b.group === 'helper') return '已經被採用 ' + (b.have || 0) + ' 樣，再 ' + left + ' 樣';
  return '已經 ' + (b.have || 0) + ' ' + g.unit + '，再 ' + left + ' ' + g.unit;
}
