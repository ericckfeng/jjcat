// 營養師報告頂端的「本週重點」：從期間統計挑出最值得討論的 4～5 條
// 這個檔案只有純函式，不碰畫面或儲存，方便測試。
// 語氣：給營養師看的客觀描述，不責備；資料不夠就不說。
//
// input = {
//   days, loggedDays, pending,
//   avgKcal, targetKcal, overDays,
//   weight: { first, last, delta } | null,  targetWeight,
//   macroDays, avgP, targetP,
//   exDays, avgEx: { grain, ... }, targetEx: { grain, ... },
//   sleep: { avgMin, days, shortDays, kcalShort, kcalGood } | null,   // kcalShort／kcalGood：睡不夠／睡飽那幾天的平均熱量（各至少 2 天，否則 null）
//   water: { avg, goal } | null,     // goal：這段期間每天喝水目標的平均（沒設是 null）
//   exercise: { totalMin, days },
//   questions,                        // 「想問營養師」有寫的天數
//   noBowelDays                       // 排便記「無」的天數
// }
// 回傳 [{ tone: 'good' | 'warn' | 'info', text }]，最多 limit 條，重要的在前

const EX_LABEL = { grain: '全穀雜糧', prot: '豆魚蛋肉', veg: '蔬菜', fruit: '水果', dairy: '乳品', oil: '油脂' };
const EX_ORDER = ['veg', 'fruit', 'prot', 'dairy', 'grain', 'oil'];
const n0 = (v) => Math.round(v).toLocaleString('en-US');
const n1 = (v) => String(Math.round(v * 10) / 10);
const signed = (v) => (v > 0 ? '+' : '') + n1(v);

export function buildHighlights(input, { limit = 5 } = {}) {
  const x = input || {};
  const out = [];
  const add = (pri, tone, text) => out.push({ pri, tone, text });

  // 熱量（含記錄天數）
  if (x.loggedDays > 0 && x.avgKcal != null && x.targetKcal > 0) {
    const pre = `記錄 ${x.loggedDays}/${x.days} 天，`;
    const diff = x.avgKcal - x.targetKcal;
    const ratio = diff / x.targetKcal;
    if (Math.abs(ratio) <= 0.05) add(100, 'good', `${pre}平均每天 ${n0(x.avgKcal)} kcal，接近目標 ${n0(x.targetKcal)}`);
    else if (diff > 0) add(100, 'warn', `${pre}平均每天 ${n0(x.avgKcal)} kcal，比目標多 ${n0(diff)}；超過目標 ${x.overDays} 天`);
    else if (ratio < -0.15) add(100, 'warn', `${pre}平均每天 ${n0(x.avgKcal)} kcal，比目標少 ${n0(-diff)}，可能吃得太少`);
    else add(100, 'good', `${pre}平均每天 ${n0(x.avgKcal)} kcal，比目標少 ${n0(-diff)}`);
  }
  if (x.days > 0 && x.loggedDays < x.days * 0.7) {
    add(85, 'info', `有 ${x.days - x.loggedDays} 天沒有飲食記錄，平均數字僅供參考`);
  }

  // 體重（7 天平均）
  if (x.weight) {
    const w = x.weight;
    const toward = x.targetWeight > 0 && w.delta !== 0 && Math.sign(x.targetWeight - w.first) === Math.sign(w.delta);
    add(95, toward ? 'good' : 'info', `體重（7 天平均）${n1(w.first)} → ${n1(w.last)} kg（${signed(w.delta)}）${x.targetWeight > 0 ? '，目標 ' + n1(x.targetWeight) + ' kg' : ''}`);
  }

  if (x.questions > 0) add(92, 'info', `有 ${x.questions} 天寫了「想問營養師」，列在下方「想和營養師討論」`);

  // 蛋白質
  if (x.targetP > 0 && x.macroDays >= 2 && x.avgP != null) {
    const r = x.avgP / x.targetP;
    if (r < 0.85) add(80, 'warn', `蛋白質平均 ${n0(x.avgP)} g，目標 ${n0(x.targetP)} g（約 ${Math.round(r * 100)}%）`);
    else add(70, 'good', `蛋白質平均 ${n0(x.avgP)} g，有達到目標 ${n0(x.targetP)} g`);
  }
  if (x.loggedDays >= 2 && x.macroDays < x.loggedDays / 2) {
    add(60, 'info', `只有 ${x.macroDays} 天有填營養素，蛋白質等數字不完整`);
  }

  // 六大類
  const tex = x.targetEx || {};
  if (x.exDays >= 2 && EX_ORDER.some(k => tex[k] > 0)) {
    const low = EX_ORDER.filter(k => tex[k] > 0 && (x.avgEx[k] || 0) < tex[k] * 0.8);
    const high = ['oil', 'grain'].filter(k => tex[k] > 0 && (x.avgEx[k] || 0) > tex[k] * 1.2);
    const part = (k) => `${EX_LABEL[k]} ${n1(x.avgEx[k] || 0)} 份（目標 ${n1(tex[k])}）`;
    if (low.length) add(78, 'warn', `偏少：${low.slice(0, 3).map(part).join('、')}`);
    if (high.length) add(76, 'warn', `偏多：${high.map(part).join('、')}`);
    if (!low.length && !high.length) add(65, 'good', '六大類份數都接近目標');
  }

  // 睡眠
  const s = x.sleep;
  if (s && s.days > 0 && (s.avgMin < 360 || s.shortDays >= 2)) {
    const more = s.kcalShort != null && s.kcalGood != null && s.kcalShort - s.kcalGood >= 200
      ? `；睡不夠的日子平均多吃 ${n0(s.kcalShort - s.kcalGood)} kcal` : '';
    add(72, 'warn', `平均睡 ${n1(s.avgMin / 60)} 小時，不到 6 小時有 ${s.shortDays} 天${more}`);
  }

  if (x.noBowelDays >= 2) add(66, 'warn', `有 ${x.noBowelDays} 天沒有排便`);

  // 喝水
  const wa = x.water;
  if (wa && wa.avg != null) {
    const goal = wa.goal || 1500;
    if (wa.avg < goal * 0.8) add(64, 'warn', `喝水平均 ${n0(wa.avg)} ml，${wa.goal ? '目標 ' + n0(wa.goal) + ' ml' : '偏少'}`);
  }

  if (x.pending > 0) add(55, 'info', `還有 ${x.pending} 筆「暫估待修」，熱量可能不準`);

  // 運動
  const ex = x.exercise;
  if (ex && ex.totalMin > 0) add(50, 'good', `運動 ${ex.days} 天，共 ${n0(ex.totalMin)} 分鐘`);
  else if (x.days >= 7) add(40, 'info', '這段期間沒有運動記錄');

  return out.sort((a, b) => b.pri - a.pri).slice(0, limit).map(({ tone, text }) => ({ tone, text }));
}
