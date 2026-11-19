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
//   noBowelDays,                      // 排便記「無」的天數
//   muscle: { smm1, smm2, delta, weightDelta } | null   // 最近兩次骨骼肌（最近一次在期間內才有）
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

  const mu = x.muscle;
  if (mu) {
    const wd = mu.weightDelta != null ? `，同期體重 ${signed(mu.weightDelta)} kg` : '';
    if (mu.delta <= -0.5) add(82, 'warn', `骨骼肌 ${n1(mu.smm1)} → ${n1(mu.smm2)} kg（${signed(mu.delta)}）${wd}：減掉的有一部分是肌肉`);
    else add(68, mu.delta >= 0 ? 'good' : 'info', `骨骼肌 ${n1(mu.smm1)} → ${n1(mu.smm2)} kg（${signed(mu.delta)}）${wd}`);
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

/* ---------------- 小芽週報（給使用者自己看、可傳 LINE） ---------------- */

// 上一個完整的週（週一～週日）。today：'YYYY-MM-DD'
export function lastWeek(today) {
  const [y, m, d] = today.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  const back = (t.getDay() + 6) % 7 + 7;      // 回到上週一
  const s = (n) => { const x = new Date(y, m - 1, d - n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  return { from: s(back), to: s(back - 6) };
}

// input 和 buildHighlights 一樣，另外用到：goodKcalDays（和目標差不到 10% 的天數）、waterMetDays（喝水達標天數）
// 回傳 { good: [文字…]（最多 3 條）, tryNext: 文字 }
export function buildWeekly(input) {
  const x = input || {};
  const good = [];
  const add = (pri, text) => good.push({ pri, text });
  const tex = x.targetEx || {};
  const avgEx = x.avgEx || {};

  if (x.loggedDays >= 5) add(90, `這週記錄了 ${x.loggedDays} 天，很用心 📒`);
  else if (x.loggedDays >= 3) add(60, `這週記錄了 ${x.loggedDays} 天，有在持續 📒`);
  const w = x.weight;
  if (w && x.targetWeight > 0 && Math.abs(w.delta) >= 0.2 && Math.sign(x.targetWeight - w.first) === Math.sign(w.delta)) {
    add(95, `7 天平均體重${w.delta < 0 ? '少' : '多'}了 ${n1(Math.abs(w.delta))} 公斤，往目標前進 🎉`);
  }
  if (x.goodKcalDays >= 3) add(80, `有 ${x.goodKcalDays} 天吃得剛剛好 👍`);
  if (x.muscle && x.muscle.delta >= 0.3) add(85, `骨骼肌多了 ${n1(x.muscle.delta)} 公斤 💪`);
  const ex = x.exercise || {};
  if (ex.totalMin >= 60) add(75, `運動了 ${ex.days} 天，共 ${n0(ex.totalMin)} 分鐘 🏃`);
  else if (ex.totalMin > 0) add(50, `有運動 ${ex.days} 天，動起來就很棒 🏃`);
  if (x.targetP > 0 && x.macroDays >= 3 && x.avgP >= x.targetP * 0.85) add(70, '蛋白質吃得夠 💪');
  if (x.exDays >= 3 && (tex.veg > 0 ? (avgEx.veg || 0) >= tex.veg * 0.8 : (avgEx.veg || 0) >= 3)) add(70, '青菜吃得夠 🥬');
  if (x.waterMetDays >= 4) add(65, `有 ${x.waterMetDays} 天水喝夠了 💧`);
  const s = x.sleep;
  if (s && s.days >= 3 && s.avgMin >= 420) add(55, `平均睡 ${n1(s.avgMin / 60)} 小時，睡得很好 😴`);

  const picked = good.sort((a, b) => b.pri - a.pri).slice(0, 3).map(g => g.text);
  if (!picked.length) picked.push('願意打開 App 記錄，就是很好的開始 🌱');

  // 下週可以試的一件事：只挑一件，最重要的先
  const tries = [
    [x.loggedDays < 4, '每天至少記一餐，下週會更清楚自己吃了什麼'],
    [x.muscle && x.muscle.delta <= -0.5, '肌肉有一點流失：每餐都要有蛋白質，再加上每天走路或簡單的肌力運動'],
    [x.targetP > 0 && x.macroDays >= 2 && x.avgP != null && x.avgP < x.targetP * 0.85, '每餐加一份蛋白質，例如一顆蛋、一杯無糖豆漿或一個手掌大的魚肉'],
    [x.targetKcal > 0 && x.avgKcal != null && x.avgKcal > x.targetKcal * 1.1, '挑一餐吃少一點，例如飯減半碗、不喝含糖飲料'],
    [x.targetKcal > 0 && x.avgKcal != null && x.avgKcal < x.targetKcal * 0.85, '三餐都要吃，吃夠了比較不會想吃零食'],
    [x.exDays >= 2 && (tex.veg > 0 ? (avgEx.veg || 0) < tex.veg * 0.8 : (avgEx.veg || 0) < 3), '每天多吃一碗青菜，午餐、晚餐各加一份'],
    [s && s.days > 0 && (s.avgMin < 360 || s.shortDays >= 3), '每天早 30 分鐘上床，睡飽比較不嘴饞'],
    [x.water && x.water.avg != null && x.water.avg < (x.water.goal || 1500) * 0.8, '起床先喝一杯水，三餐飯前再各喝一杯'],
    [x.exDays >= 2 && tex.fruit > 0 && (avgEx.fruit || 0) < tex.fruit * 0.8, '每天吃一份水果，大約一個拳頭大'],
    [x.exDays >= 2 && tex.oil > 0 && (avgEx.oil || 0) > tex.oil * 1.2, '少吃油炸，改選蒸、煮、滷的'],
    [!(ex.totalMin > 0), '每天飯後散步 10 分鐘']
  ];
  const t = tries.find(([cond]) => cond);
  return { good: picked, tryNext: t ? t[1] : '保持這週的好習慣，下週繼續 👍' };
}

export function weeklyText({ from, to, good, tryNext, name }, fmtMD) {
  return [
    `🌱 小芽週報${name ? '（' + name + '）' : ''} ${fmtMD(from)}～${fmtMD(to)}`,
    '這週做得好的事：',
    ...good.map(g => '✓ ' + g),
    '下週可以試的一件事：',
    '👉 ' + tryNext
  ].join('\n');
}
